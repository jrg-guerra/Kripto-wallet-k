// Motor del paper trader: analiza el mercado (Binance API pública), calcula
// momentum, genera recomendaciones de compra/venta y mantiene la wallet
// SIMULADA. Si hay .env con API key de solo lectura, también valoriza la
// wallet real. NUNCA envía órdenes.

import { readFileSync, writeFileSync, existsSync, appendFileSync, renameSync, copyFileSync } from 'node:fs';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
// KW_DATA permite apuntar a una copia del estado: así los tests corren sobre
// un sandbox y jamás tocan la billetera de verdad.
const DATA = process.env.KW_DATA || join(ROOT, 'data');
const API = 'https://api.binance.com';
// Stablecoins de USD: valen 1:1 con USDT para la valorización.
const STABLES_USD = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'BUSD', 'USDP', 'USD1', 'XUSD']);
// Lista completa de stables (USD + EUR): se excluyen de los candidatos de la
// estrategia. Las de EUR NO valen 1 USDT — se valorizan por su par (EURUSDT…).
const STABLES = new Set([...STABLES_USD, 'EUR', 'EURI', 'AEUR']);
// Valores tokenizados de bolsa (Binance ADGM): siguen horario bursátil, no son
// criptos — se excluyen de la estrategia. Los nuevos se detectan además por
// patrón de volumen en momentumModelo().
const TOKENIZADOS = new Set(['SNXXB', 'SNDKB', 'SPCXB', 'MUB', 'KORUB', 'CRCLB']);
const CAPITAL_INICIAL = 10_000;
const CANDIDATOS = 30;
const PICKS = 3;
// v2d del backtest (90d +54,1% / 180d +60,4%, Sharpe 1,40) contra v1 (7d,
// diario: -29,5% / -35,4%). Promovido 2026-08-21: la ventana corta era la que
// empujaba a rotar rápido — la misma lógica que sacó a XRP del sleeve a las
// 32 horas, justo antes de que corriera +40%.
// Umbral del plazo: cuánto tiene que haber rendido una posición para que su
// plazo NO la liquide. No es cero ni un porcentaje fijo — salir en el punto de
// equilibrio de un activo que oscila 4-6% al día lo decide el ruido de los
// últimos minutos, no si la tesis funcionó. Es la misma lección de GPS/ACE que
// ya rige los stops (1,5x la volatilidad) y que el plazo se escribió ignorando.
//
//   umbral = comisión ida+vuelta  +  BANDA_RUIDO_VOL x volatilidad diaria
//
// BANDA_RUIDO_VOL es un JUICIO, no un dato: nace del mismo razonamiento que el
// 1,5x de los stops y está sin validar. Va como hipótesis abierta en el motor
// de aprendizaje (`umbral-plazo-por-volatilidad`) para revisarla con datos.
const BANDA_RUIDO_VOL = 0.5;
const STOP_VECES_VOL = 1.5;   // el múltiplo con que stopsSugeridos fija el límite

const VENTANA_MODELO_DIAS = 30;
const REBALANCEO_CADA_DIAS = 7;
const FEE = 0.001;

const WALLET_FILE = join(DATA, 'wallet.json');
const HISTORY_FILE = join(DATA, 'history.csv');
const LASTRUN_FILE = join(DATA, 'last-run.json');
const SNAPSHOT_FILE = join(DATA, 'real-wallet.json');
const SNAPSHOTS_FILE = join(DATA, 'snapshots.jsonl');
const MOVIMIENTOS_FILE = join(DATA, 'movimientos.jsonl');
const POSICIONES_FILE = join(DATA, 'posiciones.json');
const ALERTAS_FILE = join(DATA, 'alertas.jsonl');
const APRENDIZAJE_FILE = join(DATA, 'aprendizaje.jsonl');
const OFERTAS_FILE = join(DATA, 'ofertas.json');
const SEGURIDAD_FILE = join(DATA, 'seguridad.json');

// ---------------------------------------------------------------------------
// Escritura segura del estado
//
// `writeFileSync` directo trunca el archivo antes de escribirlo: si el proceso
// muere en el medio (Mac que se suspende, kill, batería) el estado queda
// destruido y sin respaldo. Se escribe a `.tmp` y se renombra — `rename` es
// atómico dentro del mismo filesystem, así que el archivo real nunca existe
// a medias. La versión anterior queda en `.bak` para poder volver atrás.
function escribirEstado(archivo, contenido) {
  const tmp = `${archivo}.tmp`;
  writeFileSync(tmp, contenido);
  if (existsSync(archivo)) { try { copyFileSync(archivo, `${archivo}.bak`); } catch { /* el .bak es un extra, no bloquea */ } }
  renameSync(tmp, archivo);
}

const escribirJSON = (archivo, obj) => escribirEstado(archivo, JSON.stringify(obj, null, 2));

// Estado que no se puede leer: se avisa con el respaldo a mano en vez de
// dejar que un JSON.parse a medias tumbe el servidor sin explicación.
function leerJSON(archivo) {
  try {
    return JSON.parse(readFileSync(archivo, 'utf8'));
  } catch (e) {
    const bak = `${archivo}.bak`;
    throw new Error(
      `${archivo} está corrupto o ilegible (${e.message}).` +
      (existsSync(bak) ? ` Hay respaldo en ${bak}: revísalo y renómbralo para recuperar el estado.` : ''));
  }
}

// ---------------------------------------------------------------------------
// Candado del estado
//
// El monitor de fondo (cada 3 min) y los endpoints HTTP escriben los mismos
// archivos. Sin candado compartido, dos flujos pueden leer el mismo saldo y
// sobrescribirse: una compra desaparece y el dinero se materializa. El flag
// vive en el motor —no en el server— porque el motor es lo único que ambos
// comparten.
let _ocupado = null;
export const estadoOcupado = () => _ocupado;

export async function conCandado(nombre, fn) {
  if (_ocupado) throw Object.assign(new Error(`Hay otra operación en curso (${_ocupado})`), { codigo: 409 });
  _ocupado = nombre;
  try { return await fn(); } finally { _ocupado = null; }
}

// ---------------------------------------------------------------------------
// Validación de montos
//
// Un NaN no lo atrapa ninguna comparación (`NaN < 0.01` es false), así que
// entraba al estado y lo dejaba con `null` sin forma de reconstruirlo.
function montoValido(v, campo) {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw Object.assign(new Error(`${campo} inválido: se esperaba un número positivo, llegó ${JSON.stringify(v)}`), { codigo: 400 });
  }
  return v;
}

// Registro del motor de aprendizaje. Vive acá para reusar la escritura
// atómica y para que `aprendizaje.mjs` no dependa del layout de archivos.
export function leerAprendizaje() {
  if (!existsSync(APRENDIZAJE_FILE)) return [];
  return readFileSync(APRENDIZAJE_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}
export function appendAprendizaje(registro) {
  appendFileSync(APRENDIZAJE_FILE, JSON.stringify(registro) + '\n');
}
export const escribirAprendizaje = (archivo, obj) => escribirJSON(archivo, obj);

// ---------------------------------------------------------------------------
// OFERTAS — oportunidades concretas, aprobables desde el dashboard o Telegram
//
// Viven en el estado del proyecto, no en la memoria de un proceso. Antes vivían
// en un Map: cualquier reinicio las borraba y el dashboard no las veía. El
// razonamiento era correcto —una oferta vieja tiene precios viejos— pero la
// solución no: la protección real no es que el proceso muera, es
//
//   1. un vencimiento explícito, y
//   2. **validar el precio al momento de ejecutar**: si se movió más que la
//      tolerancia, la oferta ya no es la que se aprobó y se rechaza.
//
// Con eso, una oferta puede sobrevivir un reinicio sin volverse peligrosa, y se
// puede tomar desde donde sea.

const OFERTA_MS = 15 * 60_000;
const DRIFT_MAX_PCT = 2;   // si el precio se movió más que esto, es otra jugada

// --- WATCHLIST: candidatos esperando su punto de entrada --------------------
//
// Un candidato que hoy no pasa los criterios (ej. RSI 84) antes se descartaba y
// se evaporaba. Acá queda VIGILADO con una condición de armado explícita; el
// monitor la evalúa cada tanto y, si se cumple, crea la oferta — que Jorge
// aprueba o rechaza como siempre. La watchlist nunca ejecuta: arma.
//
// Correcciones sobre la idea de póster de la que nace:
//   · toda entrada CADUCA (7 días): una watchlist que solo crece es una lista
//     de deseos rancia;
//   · toda caducidad deja autopsia en el aprendizaje: qué condición nunca se
//     cumplió también es dato;
//   · estado del proyecto (data/watchlist.json), no memoria de proceso — la
//     lección de las ofertas.

const WATCHLIST_FILE = join(DATA, 'watchlist.json');
const WATCH_DIAS = 7;
const REGIMENES_VETADOS = ['débil', 'caída amplia'];

function leerWatch() {
  if (!existsSync(WATCHLIST_FILE)) return { entradas: [] };
  return leerJSON(WATCHLIST_FILE);
}
const escribirWatch = data => escribirJSON(WATCHLIST_FILE, data);

function caducarWatch(data) {
  let cambio = false;
  for (const w of data.entradas) {
    if (w.estado === 'vigilando' && Date.now() > Date.parse(w.vence)) {
      w.estado = 'caducada';
      w.resueltaEn = new Date().toISOString();
      // autopsia: qué le faltó hasta el final es el dato que deja
      appendAprendizaje({
        tipo: 'watchlist-caducada', ts: w.resueltaEn, asset: w.asset,
        motivo: w.motivo, condicion: w.condicion,
        faltabaAlCaducar: w.ultimoEstadoCond ?? null, chequeos: w.chequeos ?? 0,
      });
      cambio = true;
    }
  }
  return cambio;
}

export function watchlist() {
  const data = leerWatch();
  if (caducarWatch(data)) escribirWatch(data);
  return data.entradas;
}

// `zonaPct` es azúcar: "avisame si retrocede un 6%" se traduce a un precio
// concreto AL DAR DE ALTA, no cada vez que se evalúa. Si se recalculara sobre
// el precio del momento, la zona perseguiría al precio hacia abajo y nunca se
// alcanzaría — un blanco móvil.
export function agregarWatch({ asset, condicion = {}, zonaPct = null, precioRef = null, motivo = null, origen = 'dashboard' }) {
  activoValido(asset);
  if (zonaPct != null) {
    if (!Number.isFinite(zonaPct) || zonaPct <= 0 || zonaPct >= 50) {
      throw Object.assign(new Error('zonaPct debe ser un porcentaje entre 0 y 50'), { codigo: 400 });
    }
    if (!Number.isFinite(precioRef) || precioRef <= 0) {
      throw Object.assign(new Error('para fijar la zona hace falta el precio de referencia'), { codigo: 400 });
    }
    condicion = {
      ...condicion,
      precioMax: Number((precioRef * (1 - zonaPct / 100)).toPrecision(8)),
      // piso: el doble del retroceso pedido. Más abajo ya no es descuento.
      precioMin: Number((precioRef * (1 - 2 * zonaPct / 100)).toPrecision(8)),
      zonaPct, precioRef,
    };
  }
  const data = leerWatch();
  caducarWatch(data);
  const ya = data.entradas.find(w => w.estado === 'vigilando' && w.asset === asset);
  if (ya) return { ok: false, motivo: `${asset} ya está en vigilancia`, entrada: ya };
  const entrada = {
    id: randomBytes(12).toString('base64url'),
    asset,
    estado: 'vigilando',
    creada: new Date().toISOString(),
    vence: new Date(Date.now() + WATCH_DIAS * 86_400_000).toISOString(),
    // la condición por defecto es el espejo de los criterios que lo rechazaron:
    // RSI enfriado bajo el umbral del screening y fase sana (ni pico ni caída)
    condicion: { rsiMax: 70, fasesOk: ['tendencia'], ...condicion },
    motivo, origen,
    chequeos: 0, ultimoChequeo: null, ultimoEstadoCond: null,
  };
  data.entradas.push(entrada);
  escribirWatch(data);
  return { ok: true, entrada };
}

export function cancelarWatch(id, origen = 'dashboard') {
  const data = leerWatch();
  const w = data.entradas.find(x => x.id === id);
  if (!w) return { ok: false, motivo: 'no existe esa entrada' };
  if (w.estado !== 'vigilando') return { ok: false, motivo: `ya está ${w.estado}` };
  w.estado = 'cancelada';
  w.resueltaEn = new Date().toISOString();
  w.canceladaPor = origen;
  escribirWatch(data);
  return { ok: true };
}

// La condición, evaluada como función PURA sobre un contexto ya medido: así se
// prueba sin red. Devuelve qué falta, no solo sí/no — eso es lo que se muestra
// en el dashboard y lo que la autopsia registra.
export function condicionCumplida(condicion, ctx) {
  const faltas = [];
  // ZONA DE ENTRADA: el precio también es una condición. Sin esto la watchlist
  // solo sabía esperar indicadores; con esto sabe esperar un PRECIO — "entrá si
  // retrocede a X", que es lo que un trader llama zona de entrada. El mecanismo
  // de espera ya existía; esto es un campo más, no un sistema nuevo.
  if (condicion.precioMax != null) {
    if (ctx.precio == null) faltas.push('sin precio para comparar');
    else if (ctx.precio > condicion.precioMax) {
      const lejos = ((ctx.precio / condicion.precioMax - 1) * 100).toFixed(1);
      faltas.push(`precio ${ctx.precio} sobre la zona (entra en ${condicion.precioMax}, falta bajar ${lejos}%)`);
    }
  }
  // Piso de la zona: por debajo, la tesis del retroceso ya no se sostiene —
  // dejó de ser un descuento y pasó a ser una caída.
  if (condicion.precioMin != null && ctx.precio != null && ctx.precio < condicion.precioMin) {
    faltas.push(`precio ${ctx.precio} bajo el piso de la zona (${condicion.precioMin}): ya no es retroceso`);
  }
  if (ctx.enCuarentena) faltas.push('en cuarentena por un corte reciente');
  if (REGIMENES_VETADOS.includes(ctx.regimen)) faltas.push(`régimen "${ctx.regimen}" vetado`);
  if (condicion.rsiMax != null && !(ctx.rsi14d != null && ctx.rsi14d < condicion.rsiMax)) {
    faltas.push(`RSI ${ctx.rsi14d ?? 'sin dato'} (necesita < ${condicion.rsiMax})`);
  }
  // VOLATILIDAD. La watchlist sabía esperar indicadores y precio, pero no que
  // el activo se calmara — y hay activos que no se rechazan por caros sino por
  // INDIMENSIONABLES: con 27% diario, TUT necesita un stop de -15% y el mínimo
  // de orden de 5 USDT obliga a arriesgar 2,1x el objetivo. Sin esta condición,
  // la entrada armaría una oferta que la compuerta rechaza cada 15 minutos.
  if (condicion.volMaxPct != null && !(ctx.volDiariaPct != null && ctx.volDiariaPct <= condicion.volMaxPct)) {
    faltas.push(`volatilidad ${ctx.volDiariaPct?.toFixed(1) ?? 'sin dato'}%/día (necesita <= ${condicion.volMaxPct}%)`);
  }
  if (condicion.fasesOk?.length && !condicion.fasesOk.includes(ctx.fase)) {
    faltas.push(`fase "${ctx.fase ?? 'sin dato'}" (necesita ${condicion.fasesOk.join(' o ')})`);
  }
  return { ok: faltas.length === 0, faltas };
}

// Evalúa las vigilantes contra el mercado real. NO arma nada por sí misma:
// devuelve las que están listas y quien llama crea la oferta — si esa creación
// falla (p. ej. congelado), la entrada sigue vigilando y se reintenta.
//
// DOS FASES a propósito. La fase de red tarda segundos (velas por cada
// vigilada) y este archivo también lo escriben el dashboard y Telegram
// (agregar/cancelar) fuera del candado de vigilancia: leer, esperar la red y
// escribir lo leído pisaba cualquier entrada agregada en el medio — la entrada
// desaparecía en silencio. Ahora toda la red ocurre ANTES de leer el estado
// que se va a escribir; la fase de estado no tiene ningún await, y sin await
// nada puede intercalarse en ella.
export async function evaluarWatchlist(regimen) {
  // FASE 1 · red: medir el contexto de cada vigilada, sin tocar el archivo.
  const vigilando = leerWatch().entradas.filter(x => x.estado === 'vigilando');
  const ctxPorId = new Map();
  for (const w of vigilando) {
    try {
      const velas = await pub('/api/v3/klines', { symbol: `${w.asset}USDT`, interval: '1d', limit: 31 });
      const cierres = velas.map(k => parseFloat(k[4]));
      ctxPorId.set(w.id, {
        rsi14d: rsi(cierres),
        fase: clasificarTendencia(cierres)?.estado ?? null,
        regimen: regimen?.tipo ?? null,
        enCuarentena: enCuarentena(w.asset),
        // el cierre de la última vela sirve de precio: la zona de entrada se
        // evalúa cada 15 min, no necesita el tick exacto
        precio: cierres.at(-1) ?? null,
        // Volatilidad diaria, de las mismas 31 velas y sin una llamada más.
        // Se mide sobre las últimas 15 igual que `stopsSugeridos`, o la
        // condición estaría esperando un número distinto del que después
        // decide el tamaño de la posición.
        volDiariaPct: volatilidadDiaria(cierres.slice(-15)),
      });
    } catch (e) {
      console.error(`watchlist ${w.asset}: ${e.message}`);
    }
  }

  // FASE 2 · estado: releer y aplicar, sin ningún await en el medio.
  const data = leerWatch();
  let cambio = caducarWatch(data);
  const listas = [];

  const w4 = loadWallet(null) ?? {};
  const enCartera = a => BOLSILLOS.some(b => (w4[b] ?? {})[a] > 0);

  for (const w of data.entradas.filter(x => x.estado === 'vigilando')) {
    if (enCartera(w.asset)) {
      w.estado = 'cancelada';
      w.resueltaEn = new Date().toISOString();
      w.canceladaPor = 'motor';
      w.motivoCancelacion = 'el activo ya está en la cartera';
      cambio = true;
      continue;
    }
    // agregada durante la fase de red, o sin velas: la mide el próximo ciclo
    const ctx = ctxPorId.get(w.id);
    if (!ctx) continue;
    const r = condicionCumplida(w.condicion, ctx);
    w.chequeos = (w.chequeos ?? 0) + 1;
    w.ultimoChequeo = new Date().toISOString();
    w.ultimoEstadoCond = r.ok ? 'cumplida' : r.faltas;
    cambio = true;
    if (r.ok) listas.push({ ...w });
  }

  if (cambio) escribirWatch(data);
  return { listas };
}

// Se llama DESPUÉS de crear la oferta con éxito: recién ahí la entrada se arma.
export function marcarWatchOferta(id, ofertaId) {
  const data = leerWatch();
  const w = data.entradas.find(x => x.id === id);
  if (!w || w.estado !== 'vigilando') return { ok: false };
  w.estado = 'armada';
  w.resueltaEn = new Date().toISOString();
  w.ofertaId = ofertaId;
  escribirWatch(data);
  appendAprendizaje({
    tipo: 'watchlist-armada', ts: w.resueltaEn, asset: w.asset,
    motivo: w.motivo, condicion: w.condicion, chequeos: w.chequeos, ofertaId,
  });
  return { ok: true };
}

// --- CONGELADO: el interruptor de pánico ------------------------------------
//
// Vive en el MOTOR, no en Telegram, por dos razones que antes lo dejaban ser un
// adorno: vivía en memoria (un reinicio lo descongelaba) y solo lo consultaba
// el bot (el dashboard seguía ejecutando con normalidad). El guardián tiene que
// estar donde se ejecuta, y sobrevivir a un reinicio: si se congela porque el
// teléfono se perdió, un `node src/server.mjs` no puede deshacerlo.

function leerSeguridad() {
  if (!existsSync(SEGURIDAD_FILE)) return { congelado: false };
  try { return leerJSON(SEGURIDAD_FILE); } catch { return { congelado: true, motivo: 'estado de seguridad ilegible' }; }
}

export const congelado = () => leerSeguridad().congelado === true;
export const motivoCongelado = () => leerSeguridad().motivo ?? null;

// Congelar ANULA las ofertas vigentes. Antes el mensaje decía que lo hacía y no
// era cierto: una oferta viva es una aprobación pendiente, y dejarla en pie
// mientras se corta la ejecución es la contradicción exacta.
export function congelar(motivo = 'activado desde Telegram', origen = 'telegram') {
  escribirJSON(SEGURIDAD_FILE, { congelado: true, motivo, origen, desde: new Date().toISOString() });
  const data = leerOfertas();
  let anuladas = 0;
  for (const o of data.ofertas) if (o.estado === 'vigente') { o.estado = 'anulada'; o.motivoVencimiento = `ejecución congelada: ${motivo}`; anuladas++; }
  if (anuladas) escribirOfertas(data);
  console.log(`[SEGURIDAD] EJECUCIÓN CONGELADA (${origen}) — ${motivo}; ${anuladas} oferta(s) anulada(s)`);
  return { anuladas };
}

export function descongelar(origen = 'dashboard') {
  escribirJSON(SEGURIDAD_FILE, { congelado: false, descongeladoEn: new Date().toISOString(), origen });
  console.log(`[SEGURIDAD] ejecución reactivada (${origen})`);
}

function leerOfertas() {
  if (!existsSync(OFERTAS_FILE)) return { ofertas: [] };
  return leerJSON(OFERTAS_FILE);
}

function escribirOfertas(data) { escribirJSON(OFERTAS_FILE, data); }

// Marca como vencidas las que pasaron su hora, sin borrarlas: el historial de
// ofertas no tomadas es dato para el aprendizaje.
function caducarOfertas(data) {
  let cambio = false;
  for (const o of data.ofertas) {
    if (o.estado === 'vigente' && Date.now() > Date.parse(o.vence)) { o.estado = 'vencida'; cambio = true; }
  }
  return cambio;
}

export function crearOferta({ asset, montoUSDT, limitePct, objetivoPct, precio, contexto = {} }) {
  // Congelado no crea ofertas: ofrecer algo que no se puede aprobar es ruido.
  if (congelado()) { const e = new Error(`ejecución congelada (${motivoCongelado() ?? 'sin motivo'})`); e.codigo = 423; throw e; }
  activoValido(asset);
  montoValido(montoUSDT, 'monto de la oferta');
  const data = leerOfertas();
  caducarOfertas(data);
  // una sola oferta vigente por activo: dos ofertas del mismo activo son la
  // misma decisión ofrecida dos veces
  for (const o of data.ofertas) if (o.estado === 'vigente' && o.asset === asset) o.estado = 'reemplazada';
  const oferta = {
    id: randomBytes(12).toString('base64url'),
    estado: 'vigente',
    creada: new Date().toISOString(),
    vence: new Date(Date.now() + OFERTA_MS).toISOString(),
    asset, montoUSDT, limitePct, objetivoPct,
    precioAlCrear: precio,
    driftMaxPct: DRIFT_MAX_PCT,
    contexto,
    tomadaPor: null, tomadaEn: null,
  };
  data.ofertas.push(oferta);
  escribirOfertas(data);
  return oferta;
}

// Todas las ofertas, en cualquier estado: sirve para explicar qué se decidió.
export const leerOfertasTodas = () => leerOfertas().ofertas;

export function ofertasVigentes() {
  const data = leerOfertas();
  if (caducarOfertas(data)) escribirOfertas(data);
  return data.ofertas.filter(o => o.estado === 'vigente');
}

// Tercera salida de una oferta: ni aprobar ni rechazar, sino VIGILAR. Hasta acá
// rechazar borraba la oferta para siempre, así que una buena idea que llegaba en
// mal momento se perdía. Ahora pasa a la watchlist con su condición de armado y
// vuelve sola cuando el momento sea el correcto.
//
// Es la pieza que faltaba para cerrar el circuito: el motor ya sabía esperar
// (watchlist) y ya sabía proponer (ofertas), pero no había puente entre "esto no
// me convence AHORA" y "avisame cuando cambie".
export function vigilarOferta(id, { origen = 'dashboard', zonaPct = null } = {}) {
  const data = leerOfertas();
  const o = data.ofertas.find(x => x.id === id);
  if (!o) return { ok: false, motivo: 'no existe esa oferta' };
  if (o.estado !== 'vigente') return { ok: false, motivo: `la oferta ya está ${o.estado}` };

  const alta = agregarWatch({
    asset: o.asset,
    zonaPct, precioRef: zonaPct != null ? o.precioAlCrear : null,
    motivo: `oferta de ${o.asset} pasada a vigilancia${o.contexto?.senalNombre ? ` (${o.contexto.senalNombre})` : ''}`,
    origen,
  });
  // Si ya estaba en vigilancia, la oferta igual se resuelve: no tiene sentido
  // dejarla viva esperando a que caduque.
  o.estado = 'a-vigilancia';
  o.tomadaPor = origen;
  o.tomadaEn = new Date().toISOString();
  o.watchId = alta.entrada?.id ?? null;
  escribirOfertas(data);

  appendAprendizaje({
    tipo: 'oferta-a-vigilancia', ts: o.tomadaEn,
    asset: o.asset, origen, montoUSDT: o.montoUSDT,
    contexto: o.contexto, watchId: o.watchId,
    yaVigilada: !alta.ok ? alta.motivo : null,
  });
  return { ok: true, oferta: o, watch: alta.entrada ?? null, yaVigilada: !alta.ok };
}

export function descartarOferta(id, origen = 'dashboard') {
  const data = leerOfertas();
  const o = data.ofertas.find(x => x.id === id);
  if (!o) return { ok: false, motivo: 'no existe esa oferta' };
  if (o.estado !== 'vigente') return { ok: false, motivo: `la oferta ya está ${o.estado}` };
  o.estado = 'descartada';
  o.tomadaPor = origen;
  o.tomadaEn = new Date().toISOString();
  escribirOfertas(data);
  // Un rechazo no mueve plata, así que no es un movimiento — pero SÍ es una
  // decisión, y las decisiones son el dato que el aprendizaje necesita. Sin
  // esto, los casos donde NO operamos no dejan rastro.
  appendAprendizaje({
    tipo: 'oferta-descartada', ts: new Date().toISOString(),
    asset: o.asset, origen, montoUSDT: o.montoUSDT,
    limitePct: o.limitePct, objetivoPct: o.objetivoPct,
    precioAlCrear: o.precioAlCrear, contexto: o.contexto,
  });
  return { ok: true, oferta: o };
}

// Ejecuta la oferta. La validación de precio es la protección real: si el
// mercado se movió más que la tolerancia, lo que se aprobó ya no existe.
export async function tomarOferta(id, origen = 'dashboard') {
  // El congelado se comprueba ACÁ y no en cada cliente: da igual si la
  // aprobación viene del teléfono, del dashboard o del monitor.
  if (congelado()) return { ok: false, motivo: `ejecución congelada (${motivoCongelado() ?? 'sin motivo'}); se reactiva desde la máquina`, congelado: true };
  const data = leerOfertas();
  caducarOfertas(data);
  const o = data.ofertas.find(x => x.id === id);
  if (!o) return { ok: false, motivo: 'no existe esa oferta' };
  if (o.estado !== 'vigente') return { ok: false, motivo: `la oferta está ${o.estado}` };

  const { prices } = await marketSnapshotLigero([o.asset]);
  const ahora = prices[`${o.asset}USDT`];
  if (!ahora) return { ok: false, motivo: `sin precio para ${o.asset}` };
  const drift = ((ahora / o.precioAlCrear) - 1) * 100;
  if (Math.abs(drift) > o.driftMaxPct) {
    o.estado = 'vencida';
    o.motivoVencimiento = `el precio se movió ${drift.toFixed(2)}% desde que se creó (tolerancia ${o.driftMaxPct}%)`;
    escribirOfertas(data);
    return { ok: false, motivo: o.motivoVencimiento, drift };
  }

  const r = await jugadaManual({
    comprar: [{
      asset: o.asset, usdt: o.montoUSDT,
      limitePct: o.limitePct, objetivoPct: o.objetivoPct,
      // la invalidación viaja con la oferta: se midió al proponerla, y volver a
      // calcularla al aprobar daría otro número con el mercado ya movido
      invalidacionPct: o.contexto?.invalidacionPct ?? null,
      // El score que DE VERDAD gateó esta entrada, no uno reconstruido después:
      // viaja con la oferta desde el screening que la creó.
      score: o.contexto?.score ?? null,
      senal: o.contexto?.senal ?? null,
      tesis: `Oferta aprobada desde ${origen}. RSI14 ${o.contexto.rsi14d ?? '—'}, régimen ${o.contexto.regimen ?? '—'}.`,
    }],
    etiqueta: `oferta aprobada (${o.asset})`,
    origen,
  });

  o.estado = 'tomada';
  o.tomadaPor = origen;
  o.tomadaEn = new Date().toISOString();
  o.precioEjecutado = ahora;
  o.driftPct = Number(drift.toFixed(2));
  escribirOfertas(data);
  return { ok: true, oferta: o, resultado: r };
}

function activoValido(a) {
  if (typeof a !== 'string' || !/^[A-Z0-9]{2,15}$/.test(a)) {
    throw Object.assign(new Error(`Activo inválido: ${JSON.stringify(a)}`), { codigo: 400 });
  }
  return a;
}

// Fecha YYYY-MM-DD en hora LOCAL (no UTC): define la frontera del "día" para
// el rebalanceo diario y las fechas del historial. Con UTC, después de las
// 20:00 de Chile empezaba un "día" nuevo y permitía rebalancear dos veces.
function fechaLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

function loadEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function pub(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}${path}${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// Recorre una lista llamando a Binance de a varios a la vez.
//
// El análisis pedía las velas de los 30 candidatos DE A UNO. Medido contra la
// API real: 10 símbolos tardan 3.564 ms en serie y 390 ms en paralelo — 9x. El
// análisis completo pasa de ~21 s a ~2 s.
//
// El límite no es adorno: 60 peticiones de golpe pueden chocar con el peso por
// minuto de Binance, y un 429 tumbaría el análisis entero. Con 6 a la vez se
// captura casi toda la ganancia sin acercarse al techo. El remedio no puede ser
// peor que la lentitud que arregla.
//
// DOS GARANTÍAS que los bucles secuenciales ya daban y no se pueden perder:
//   1. El resultado sale EN EL ORDEN de entrada, no en el de llegada. El
//      ranking de candidatos se construye con este arreglo; si el orden
//      dependiera de qué respuesta llega primero, los empates de momentum se
//      resolverían por latencia de red.
//   2. Un fallo NO tumba al resto: cada elemento devuelve `{ ok, valor, error }`
//      igual que el try/catch por candidato de antes ("un símbolo delistado
//      nunca debe tumbar el análisis completo").
const CONCURRENCIA = 6;

async function enParalelo(items, fn, limite = CONCURRENCIA) {
  const salida = new Array(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      try {
        salida[i] = { ok: true, valor: await fn(items[i], i), error: null };
      } catch (e) {
        salida[i] = { ok: false, valor: null, error: e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return salida;
}

// Llamada firmada. `metodo` existe porque algunos endpoints de saldo (Funding)
// solo aceptan POST, aunque no modifiquen nada — sigue siendo de solo lectura.
async function signedGet(path, env, params = {}, metodo = 'GET') {
  const qs = new URLSearchParams({ ...params, timestamp: Date.now(), recvWindow: 10_000 }).toString();
  const sig = createHmac('sha256', env.BINANCE_API_SECRET).update(qs).digest('hex');
  const res = await fetch(`${API}${path}?${qs}&signature=${sig}`, {
    method: metodo,
    headers: { 'X-MBX-APIKEY': env.BINANCE_API_KEY },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// Símbolos que Binance reconoce, aprendidos del último barrido completo.
// Evita pedir pares inexistentes (ETHW) en el modo ligero.
let _simbolosValidos = null;

// Activos que realmente hay que valorizar: los de ambas billeteras + BTC.
// Se leen sin precios, solo para armar la lista de símbolos a pedir.
function activosNecesarios() {
  const set = new Set(['BTC']);
  if (existsSync(WALLET_FILE)) {
    const w = leerJSON(WALLET_FILE);
    for (const k of [...BOLSILLOS, ...bolsillosNoDeclarados(w), 'holdings']) {
      for (const a of Object.keys(w[k] ?? {})) set.add(a);
    }
  }
  if (existsSync(SNAPSHOT_FILE)) {
    for (const a of Object.keys(leerJSON(SNAPSHOT_FILE).balances ?? {})) set.add(a);
  }
  return [...set];
}

// SNAPSHOT LIGERO: pide solo los símbolos de la cartera (~3 KB) en vez de los
// 3.684 pares de Binance (~1,9 MB). Se usa en refrescos y vigilancia, que
// corren muchas veces al día; el análisis sigue usando el barrido completo
// porque necesita el universo entero para rankear.
async function marketSnapshotLigero(extra = []) {
  const simbolos = [...new Set([...activosNecesarios(), ...extra])]
    .filter(a => !STABLES_USD.has(a))
    .map(a => `${a}USDT`)
    .filter(s => !_simbolosValidos || _simbolosValidos.has(s));
  if (!simbolos.length) return marketSnapshot();
  try {
    const tickers = await pub('/api/v3/ticker/24hr', { symbols: JSON.stringify(simbolos) });
    const prices = {}, stats = {};
    for (const t of tickers) {
      prices[t.symbol] = parseFloat(t.lastPrice);
      stats[t.symbol.slice(0, -4)] = {
        pct: parseFloat(t.priceChangePercent),
        high: parseFloat(t.highPrice),
        low: parseFloat(t.lowPrice),
        volM: parseFloat(t.quoteVolume) / 1e6,
        last: parseFloat(t.lastPrice),
      };
    }
    return { prices, stats, candidatos: [], ligero: true };
  } catch (e) {
    console.error('snapshot ligero falló, usando completo:', e.message);
    return marketSnapshot();
  }
}

async function marketSnapshot() {
  const tickers = await pub('/api/v3/ticker/24hr');
  _simbolosValidos = new Set(tickers.map(t => t.symbol));
  const prices = {};
  const stats = {}; // por activo: variación/rango/volumen 24h (para tendencia + tooltip)
  for (const t of tickers) {
    prices[t.symbol] = parseFloat(t.lastPrice);
    if (t.symbol.endsWith('USDT')) {
      stats[t.symbol.slice(0, -4)] = {
        pct: parseFloat(t.priceChangePercent),
        high: parseFloat(t.highPrice),
        low: parseFloat(t.lowPrice),
        volM: parseFloat(t.quoteVolume) / 1e6,
        last: parseFloat(t.lastPrice),
      };
    }
  }
  const candidatos = tickers
    .filter(t => t.symbol.endsWith('USDT'))
    .filter(t => !STABLES.has(t.symbol.slice(0, -4)))
    .filter(t => !TOKENIZADOS.has(t.symbol.slice(0, -4)))
    .filter(t => parseFloat(t.lastPrice) > 0)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, CANDIDATOS);
  return { prices, candidatos, stats };
}

// Tendencia 24h + explicación informativa por activo (para las billeteras).
function cambios24hPara(assets, stats) {
  const fmt = (v, d = 2) => v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v < 1 ? 6 : d);
  const out = {};
  for (const asset of assets) {
    const s = stats[asset];
    if (!s) continue;
    const rango = s.high - s.low;
    const posEnRango = rango > 0 ? (s.last - s.low) / rango : 0.5;
    let contexto;
    if (posEnRango > 0.8) contexto = 'operando cerca de su máximo de 24 h';
    else if (posEnRango < 0.2) contexto = 'operando cerca de su mínimo de 24 h';
    else contexto = 'en la zona media de su rango de 24 h';
    const motivo = `${s.pct >= 0 ? 'Sube' : 'Baja'} ${Math.abs(s.pct).toFixed(2)}% en 24 h — ` +
      `${contexto} (${fmt(s.low)}–${fmt(s.high)}), volumen ${s.volM >= 1000 ? (s.volM / 1000).toFixed(1) + 'B' : s.volM.toFixed(0) + 'M'} USDT. ` +
      `Dato de mercado Binance, no asesoría.`;
    out[asset] = { pct: s.pct, motivo };
  }
  return out;
}

async function momentumModelo(symbol) {
  const klines = await pub('/api/v3/klines', { symbol, interval: '1d', limit: VENTANA_MODELO_DIAS + 1 });
  if (klines.length < VENTANA_MODELO_DIAS + 1) return null;

  // Detección de activos con horario bursátil (valores tokenizados no listados
  // aún en TOKENIZADOS): su volumen de fin de semana es residual (~3-4% de un
  // día hábil), mientras una cripto 24/7 mantiene 30%+ . Umbral: 10%.
  let volSemana = 0, nSemana = 0, volFinde = 0, nFinde = 0;
  for (const k of klines) {
    const dow = new Date(k[0]).getUTCDay(); // 0=dom, 6=sáb
    const vol = parseFloat(k[7]); // volumen en moneda de cotización (USDT)
    if (dow === 0 || dow === 6) { volFinde += vol; nFinde++; }
    else { volSemana += vol; nSemana++; }
  }
  if (nFinde > 0 && nSemana > 0) {
    const promSemana = volSemana / nSemana;
    const promFinde = volFinde / nFinde;
    if (promSemana > 0 && promFinde / promSemana < 0.10) return null; // horario bursátil: fuera
  }

  const cierres = klines.map(k => parseFloat(k[4]));
  return {
    momentum: cierres.at(-1) / cierres[0] - 1,
    tendencia: clasificarTendencia(cierres),
    rsi14d: rsi(cierres),   // gratis: mismas velas; el radar lo muestra
  };
}

// RSI de Wilder. Vive en el motor (una sola copia): lo usan el screening del
// aprendizaje y la condición de armado de la watchlist.
export function rsi(closes, periodo = 14) {
  if (closes.length < periodo + 1) return null;
  let ganancia = 0, perdida = 0;
  for (let i = 1; i <= periodo; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ganancia += d; else perdida -= d;
  }
  ganancia /= periodo; perdida /= periodo;
  for (let i = periodo + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ganancia = (ganancia * (periodo - 1) + (d > 0 ? d : 0)) / periodo;
    perdida = (perdida * (periodo - 1) + (d < 0 ? -d : 0)) / periodo;
  }
  if (perdida === 0) return 100;
  return Number((100 - 100 / (1 + ganancia / perdida)).toFixed(1));
}

// Estado de tendencia de UN activo, desde sus cierres diarios (viejo→nuevo).
// El régimen global ya dice si el mercado respira; esto dice en qué fase está
// cada activo: subiendo con su media (tendencia), estirado muy por encima de
// ella (extendido: comprar acá es pagar el pico), lateral (rango) o cayendo.
//
// El umbral de "extendido" NO es un % fijo: es 1,5x la volatilidad diaria del
// propio activo — el mismo múltiplo que rige los stops. Un 8% sobre la media
// es extendido en BTC y ruido en un activo que se mueve 8% al día; un % fijo
// repetiría el error del umbral del plazo que ya corregimos.
export function clasificarTendencia(cierres) {
  if (!cierres || cierres.length < 26) return null;   // 20 de media + 5 de pendiente + 1
  const media = (n, atras = 0) => {
    const tramo = cierres.slice(cierres.length - n - atras, cierres.length - atras || undefined);
    return tramo.reduce((a, b) => a + b, 0) / tramo.length;
  };
  const sma20 = media(20);
  const sma20Hace5 = media(20, 5);
  const precio = cierres.at(-1);
  const distSma20Pct = (precio / sma20 - 1) * 100;

  const retornos = [];
  for (let i = cierres.length - 20; i < cierres.length; i++) retornos.push(cierres[i] / cierres[i - 1] - 1);
  const prom = retornos.reduce((a, b) => a + b, 0) / retornos.length;
  const volDiariaPct = Math.sqrt(retornos.reduce((a, r) => a + (r - prom) ** 2, 0) / retornos.length) * 100;

  // Una tendencia fuerte SIEMPRE está lejos de su media — la media la persigue
  // con ~10 días de rezago, así que la deriva sola explica una distancia de
  // (deriva diaria x 9,5). "Extendido" no es estar lejos: es el EXCESO por
  // encima de lo que la propia deriva explica, medido en volatilidades del
  // activo (2x, con piso de 0,5% para que un activo anómalamente quieto no
  // clasifique por ruido numérico). El primer intento usaba la distancia cruda
  // y marcaba extendida cualquier subida ordenada — el test lo cazó.
  const derivaPct = prom * 100;
  const excesoPct = distSma20Pct - derivaPct * 9.5;
  const banda = 2 * Math.max(volDiariaPct, 0.5);

  // pendiente de la media con tolerancia: una media plana con ruido no debe
  // oscilar entre tendencia y caída por milésimas
  const mediaSubiendo = sma20 > sma20Hace5 * 1.001;
  const mediaBajando = sma20 < sma20Hace5 * 0.999;
  const estado = excesoPct > banda ? 'extendido'
    : precio > sma20 && mediaSubiendo ? 'tendencia'
    : precio < sma20 && mediaBajando ? 'caida'
    : 'rango';

  return {
    estado,
    distSma20Pct: Number(distSma20Pct.toFixed(2)),
    excesoPct: Number(excesoPct.toFixed(2)),
    volDiariaPct: Number(volDiariaPct.toFixed(2)),
    mediaSubiendo,
  };
}

// ---------------------------------------------------------------------------
// BOLSILLOS: la wallet declara para qué sirve cada peso.
//   ancla   → convicción de largo plazo; el motor NO puede tocarla
//   legado  → lo que la billetera real ya tenía al nacer la simulación, fuera
//             de BTC; protegido igual que el ancla. Antes cualquier posición
//             heredada (ej. XRP) caía directo al sleeve como capital fresco:
//             se liquidó a las 32 horas, justo antes de que corriera +40%.
//             Pasarla a este bolsillo la saca de la rotación día uno; moverla
//             a sleeve requiere una jugada explícita, no es automático.
//   reserva → USDT: vía de retiro y resguardo; solo se mueve por decisión
//   sleeve  → donde opera la estrategia, acotado a limiteSleevePct del total
//   polvo   → residuos sin valor operativo
// ---------------------------------------------------------------------------
const LIMITE_SLEEVE_PCT = 25;
const ANCLA_POR_DEFECTO = ['BTC'];
const UMBRAL_POLVO_USDT = 0.5;

// ÚNICA declaración de los bolsillos de activos. Antes esta lista estaba
// escrita a mano en diez lugares (valorización, migración, aplanado, resumen,
// clasificación, wallet de respaldo, y dos veces en el front) que tenían que
// coincidir sin que nada lo obligara. El bug de `legado` no fue un olvido
// suelto: fue la consecuencia previsible de eso — y el wallet de respaldo ya
// se estaba creando sin él. Agregar un bolsillo es agregarlo ACÁ y nada más.
//
// `reserva` NO va en la lista a propósito: es un número en USDT, no un mapa
// de activo→cantidad. Aplanar esa diferencia sería esconderla.
const BOLSILLOS = ['ancla', 'legado', 'sleeve', 'polvo'];

// Claves del wallet que no son bolsillos de activos. Sirven para detectar lo
// contrario de lo que arregla BOLSILLOS: un bolsillo que existe en los DATOS
// pero nadie declaró. Ese es el único camino que queda para perder plata en
// silencio, así que se vigila explícitamente.
const CLAVES_NO_BOLSILLO = new Set([
  'createdAt', 'capitalInicial', 'limiteSleevePct', 'reserva', 'cashUSDT',
  'lastRun', 'ultimoRebalanceo', 'holdings',
]);

export function bolsillosNoDeclarados(wallet) {
  return Object.keys(wallet ?? {}).filter(k =>
    !CLAVES_NO_BOLSILLO.has(k) && !BOLSILLOS.includes(k) &&
    wallet[k] && typeof wallet[k] === 'object');
}

function migrarWallet(w, prices) {
  if (w.sleeve) return w;                       // ya migrada
  // todos los bolsillos nacen, vacíos si no reciben nada: ninguno puede faltar
  const bolsillos = Object.fromEntries(BOLSILLOS.map(b => [b, {}]));
  for (const [asset, qty] of Object.entries(w.holdings ?? {})) {
    const valor = qty * (prices?.[`${asset}USDT`] ?? 0);
    const destino = ANCLA_POR_DEFECTO.includes(asset) ? 'ancla'
      : valor < UMBRAL_POLVO_USDT ? 'polvo'
      : 'legado';   // heredado, no capital fresco: ver nota arriba
    bolsillos[destino][asset] = qty;
  }
  return {
    createdAt: w.createdAt,
    capitalInicial: w.capitalInicial,
    limiteSleevePct: LIMITE_SLEEVE_PCT,
    ...bolsillos,
    reserva: w.cashUSDT ?? 0,
    lastRun: w.lastRun,
  };
}

function loadWallet(prices) {
  if (!existsSync(WALLET_FILE)) return null;
  const w = leerJSON(WALLET_FILE);
  if (!w.sleeve && prices) {
    const migrada = migrarWallet(w, prices);
    escribirJSON(WALLET_FILE, migrada);
    return migrada;
  }
  return w;
}

// Todas las tenencias en un solo mapa (para valorizar, mostrar y snapshots).
function holdingsPlanos(wallet) {
  const claves = [...BOLSILLOS, ...bolsillosNoDeclarados(wallet), 'holdings'];
  return Object.assign({}, ...claves.map(k => wallet[k] ?? {}));
}

function valorDe(mapa, prices) {
  let total = 0;
  for (const [asset, qty] of Object.entries(mapa ?? {})) {
    const p = prices[`${asset}USDT`];
    if (p) total += qty * p;
  }
  return total;
}

function walletValue(wallet, prices) {
  if (!wallet.sleeve) {                          // estructura antigua
    return (wallet.cashUSDT ?? 0) + valorDe(wallet.holdings, prices);
  }
  // Se suman TODOS los bolsillos declarados más los no declarados: si alguien
  // agrega uno a los datos sin declararlo, el total sigue siendo correcto y el
  // aviso lo delata — antes esa plata simplemente desaparecía de la vista.
  const claves = [...BOLSILLOS, ...bolsillosNoDeclarados(wallet)];
  return (wallet.reserva ?? 0)
    + claves.reduce((a, k) => a + valorDe(wallet[k], prices), 0);
}

// Presupuesto del bolsillo táctico y su estado actual.
function estadoSleeve(wallet, prices) {
  const total = walletValue(wallet, prices);
  const limitePct = wallet.limiteSleevePct ?? LIMITE_SLEEVE_PCT;
  const presupuesto = total * (limitePct / 100);
  const actual = valorDe(wallet.sleeve, prices);
  return {
    total, limitePct, presupuesto, actual,
    ocupacionPct: total > 0 ? (actual / total) * 100 : 0,
    excedente: Math.max(0, actual - presupuesto),
    disponible: Math.max(0, presupuesto - actual),
  };
}

// Rebalanceo DENTRO DEL SLEEVE. El ancla y la reserva son intocables: las
// ventas van a reserva y las compras salen del presupuesto del sleeve.
// Muta `wallet`.
// `ranuras` es entre cuántas partes se divide el presupuesto del sleeve, y por
// defecto son los picks. Se separa del largo de `picks` para el caso en que uno
// queda vetado a mitad de semana: si se dividiera entre los que sobreviven, su
// parte se repartiría entre ellos y CONCENTRARÍA más plata en cada uno — lo
// contrario de dejar el sleeve con menos exposición. Con las ranuras fijas, la
// parte del vetado queda sin usar hasta el próximo rebalanceo.
function rebalance(wallet, picks, prices, ranuras = picks.length) {
  const est = estadoSleeve(wallet, prices);
  const presupuesto = est.presupuesto;
  const targets = {};
  for (const p of picks) targets[p] = ranuras ? presupuesto / ranuras : 0;

  const trades = [];
  // ventas: todo lo del sleeve que sobre respecto de su objetivo → reserva
  for (const [asset, qty] of Object.entries({ ...wallet.sleeve })) {
    const price = prices[`${asset}USDT`];
    if (!price) continue;
    const actual = qty * price;
    const objetivo = targets[asset] ?? 0;
    if (objetivo < actual - 0.01) {
      const venderUSDT = actual - objetivo;
      const venderQty = venderUSDT / price;
      wallet.sleeve[asset] -= venderQty;
      if (wallet.sleeve[asset] * price < 0.01) delete wallet.sleeve[asset];
      wallet.reserva += venderUSDT * (1 - FEE);
      trades.push({ accion: 'VENDER', asset, qty: venderQty, usdt: venderUSDT, precio: price });
    }
  }
  // compras: solo hasta donde alcance el presupuesto del sleeve y la reserva
  let comprasTotal = 0;
  const compras = [];
  for (const [asset, objetivo] of Object.entries(targets)) {
    const price = prices[`${asset}USDT`];
    if (!price) continue;
    const actual = (wallet.sleeve[asset] ?? 0) * price;
    if (objetivo > actual + 0.01) {
      compras.push({ asset, monto: objetivo - actual, price });
      comprasTotal += objetivo - actual;
    }
  }
  const factor = comprasTotal > 0 ? Math.min(1, wallet.reserva / comprasTotal) : 1;
  for (const { asset, monto, price } of compras) {
    const gasto = monto * factor;
    if (gasto < 0.01) continue;
    wallet.reserva -= gasto;
    const qty = (gasto * (1 - FEE)) / price;
    wallet.sleeve[asset] = (wallet.sleeve[asset] ?? 0) + qty;
    trades.push({ accion: 'COMPRAR', asset, qty, usdt: gasto, precio: price });
  }
  return trades;
}

// COSECHA: si el sleeve supera su techo, el exceso se vende a reserva USDT
// (regla de Jorge: las ganancias se convierten en plata retirable).
function cosecharExcedente(wallet, prices, { dryRun = false } = {}) {
  const est = estadoSleeve(wallet, prices);
  if (est.excedente < 1) return [];              // menos de 1 USDT: no vale la comisión
  const trades = [];
  let porCosechar = est.excedente;
  // se recorta proporcionalmente, empezando por la posición más grande
  const posiciones = Object.entries(wallet.sleeve)
    .map(([asset, qty]) => ({ asset, qty, price: prices[`${asset}USDT`] ?? 0 }))
    .filter(p => p.price > 0)
    .sort((a, b) => b.qty * b.price - a.qty * a.price);
  for (const p of posiciones) {
    if (porCosechar < 0.01) break;
    const valor = p.qty * p.price;
    const vender = Math.min(valor, porCosechar);
    const qty = vender / p.price;
    porCosechar -= vender;
    trades.push({ accion: 'VENDER', asset: p.asset, qty, usdt: vender, precio: p.price });
    if (dryRun) continue;
    wallet.sleeve[p.asset] -= qty;
    if (wallet.sleeve[p.asset] * p.price < 0.01) delete wallet.sleeve[p.asset];
    wallet.reserva = Math.round((wallet.reserva + vender * (1 - FEE)) * 100) / 100;
  }
  return trades;
}

function valueBalances(balances, prices) {
  let total = 0;
  const detalle = [];
  for (const [asset, qty] of balances) {
    if (qty <= 0) continue;
    let usdt;
    if (STABLES_USD.has(asset)) usdt = qty;
    else {
      const p = prices[`${asset}USDT`];
      if (!p) continue;
      usdt = qty * p;
    }
    // sin umbral: se muestra el espectro completo de la billetera, como en
    // la vista de Binance. El polvo se distingue visualmente, no se oculta.
    total += usdt;
    detalle.push({ asset, qty, usdt });
  }
  detalle.sort((a, b) => b.usdt - a.usdt);
  return { total, detalle };
}

// La billetera real son VARIAS billeteras en Binance. `/api/v3/account` trae
// solo Spot: leyendo solo eso, el total quedaba sistemáticamente por debajo del
// "Valor total est." que muestra Binance. Se suma Funding (y Earn si hubiera),
// consolidando por activo. Si un endpoint falla, se sigue con lo que haya:
// perder Funding es un desfase chico, quedarse sin total es peor.
async function realWalletValue(env, prices) {
  const cantidades = new Map();
  const suma = (asset, qty) => { if (qty > 0) cantidades.set(asset, (cantidades.get(asset) ?? 0) + qty); };
  const fuentes = [];

  const account = await signedGet('/api/v3/account', env);
  for (const b of account.balances) suma(b.asset, parseFloat(b.free) + parseFloat(b.locked));
  fuentes.push('spot');

  // Funding solo acepta POST, aunque sea de lectura
  try {
    const fondos = await signedGet('/sapi/v1/asset/get-funding-asset', env, {}, 'POST');
    let hay = false;
    for (const f of fondos ?? []) {
      const q = parseFloat(f.free ?? 0) + parseFloat(f.locked ?? 0) + parseFloat(f.freeze ?? 0);
      if (q > 0) { suma(f.asset, q); hay = true; }
    }
    if (hay) fuentes.push('funding');
  } catch { /* la key puede no tener permiso de wallet: se sigue con spot */ }

  try {
    const earn = await signedGet('/sapi/v1/simple-earn/flexible/position', env);
    let hay = false;
    for (const p of earn?.rows ?? []) {
      const q = parseFloat(p.totalAmount ?? 0);
      if (q > 0) { suma(p.asset, q); hay = true; }
    }
    if (hay) fuentes.push('earn');
  } catch { /* sin permiso o sin posiciones */ }

  return {
    ...valueBalances([...cantidades], prices),
    fuente: 'api',
    billeteras: fuentes,          // qué se alcanzó a leer, para poder auditarlo
    actualizado: new Date().toISOString(),
  };
}

// Snapshot manual (leído desde la web de Binance): cantidades fijas,
// valorizadas con precios en vivo en cada análisis.
function snapshotWalletValue(prices) {
  if (!existsSync(SNAPSHOT_FILE)) return null;
  const snap = leerJSON(SNAPSHOT_FILE);
  return {
    ...valueBalances(Object.entries(snap.balances), prices),
    fuente: 'snapshot',
    actualizado: snap.actualizado,
  };
}

function readHistory() {
  if (!existsSync(HISTORY_FILE)) return [];
  return readFileSync(HISTORY_FILE, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map(line => {
      const [fecha, sim, real, btc, picks] = line.split(',');
      return {
        fecha,
        sim: parseFloat(sim) || null,
        real: real ? parseFloat(real) : null,
        btc: parseFloat(btc) || null,
        picks: picks ? picks.split('|') : [],
      };
    });
}

// Escribe (o REEMPLAZA) la fila del día en el historial diario. Antes se
// escribía una sola vez y quedaba congelada con el valor de la primera
// medición: el día 0 marcó 80,10 cuando en realidad cerró en 78,51.
function upsertHistoria(fecha, simValor, realTotal, btc, picks) {
  const CAB = 'fecha,sim_usdt,real_usdt,btc_usdt,picks\n';
  const fila = `${fecha},${simValor.toFixed(2)},${realTotal != null ? realTotal.toFixed(2) : ''},${btc},${picks.join('|')}`;
  const filas = existsSync(HISTORY_FILE)
    ? readFileSync(HISTORY_FILE, 'utf8').trim().split('\n').slice(1).filter(Boolean)
    : [];
  const i = filas.findIndex(l => l.startsWith(fecha + ','));
  if (i >= 0) filas[i] = fila; else filas.push(fila);
  escribirEstado(HISTORY_FILE, CAB + filas.join('\n') + '\n');
}

// Registra un punto de la serie intradía con desglose por cripto.
function appendSnapshot(wallet, simValue, real, prices) {
  const r2 = v => Math.round(v * 100) / 100;
  const simActivos = {};
  for (const [asset, qty] of Object.entries(holdingsPlanos(wallet))) {
    const p = prices[`${asset}USDT`];
    if (p && qty * p >= 0.01) simActivos[asset] = r2(qty * p);
  }
  const reserva = wallet.reserva ?? wallet.cashUSDT ?? 0;
  if (reserva > 0.01) simActivos.USDT = r2(reserva);
  const realActivos = {};
  if (real) for (const d of real.detalle) realActivos[d.asset] = r2(d.usdt);
  appendFileSync(SNAPSHOTS_FILE, JSON.stringify({
    ts: new Date().toISOString(),
    sim: { total: r2(simValue), activos: simActivos },
    real: real ? { total: r2(real.total), activos: realActivos } : null,
  }) + '\n');
}

// Registro persistente de movimientos de la billetera ficticia (uno por evento).
// `categoria` es el dato estructurado ('jugada'|'stop'|'objetivo'|'plan'):
// la cuarentena y los reportes filtran por él, no por el texto del tipo.
// `origen` dice DESDE DÓNDE se operó: 'dashboard' | 'telegram' | 'motor'. Antes
// solo se podía inferir leyendo el texto de la etiqueta — un dato estructurado
// permite filtrarlo y mostrarlo, y sirve para el aprendizaje (¿decido distinto
// desde el teléfono que frente al dashboard?).
function appendMovimientos(fecha, tipo, operaciones, categoria = 'jugada', origen = 'dashboard', version = null) {
  if (!operaciones.length) return;
  appendFileSync(MOVIMIENTOS_FILE, JSON.stringify({
    fecha,
    ts: new Date().toISOString(),
    tipo,
    categoria,
    origen,
    version,   // sello del motor que produjo el movimiento (ver versionMotor)
    operaciones,
  }) + '\n');
}

export function readMovimientos() {
  if (!existsSync(MOVIMIENTOS_FILE)) return [];
  return readFileSync(MOVIMIENTOS_FILE, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// Serie intradía: un punto por cada análisis ejecutado, con desglose por cripto.
function readSnapshots() {
  if (!existsSync(SNAPSHOTS_FILE)) return [];
  return readFileSync(SNAPSHOTS_FILE, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// Unión de activos presentes en la ficticia y la real (para tendencias 24h).
function activosEnCartera(wallet, real) {
  const set = new Set();
  if (wallet) Object.keys(holdingsPlanos(wallet)).forEach(a => set.add(a));
  if (real) real.detalle.forEach(d => d.asset !== 'USDT' && set.add(d.asset));
  return [...set];
}


export function getState() {
  const lastRun = existsSync(LASTRUN_FILE) ? leerJSON(LASTRUN_FILE) : null;
  return { lastRun, historia: readHistory(), snapshots: readSnapshots(), movimientos: readMovimientos(), alertas: getAlertas() };
}

function lastRunPrevio() {
  return existsSync(LASTRUN_FILE) ? leerJSON(LASTRUN_FILE) : null;
}

// ---------------------------------------------------------------------------
// POSICIONES con salida programada (estado propio, no resultado de análisis).
// ---------------------------------------------------------------------------

export function readPosiciones() {
  if (!existsSync(POSICIONES_FILE)) return { posiciones: [] };
  return leerJSON(POSICIONES_FILE);
}

function writePosiciones(data) {
  escribirJSON(POSICIONES_FILE, data);
}

export function abrirPosicion({ asset, qty, entrada, objetivoPct, limitePct, horizonte, horizonteHoras, volatilidadDiariaPct, origen, version = null, invalidacionPct = null, politicaSalida = null, trailPct = null, activarTrailEnPct = null }) {
  const data = readPosiciones();
  data.posiciones.push({
    id: `pos-${String(data.posiciones.length + 1).padStart(4, '0')}`,
    asset, qty, entrada, objetivoPct, limitePct,
    // La política de salida se GRABA EN LA POSICIÓN, no se lee de una constante
    // global al evaluar. Si se leyera global, adoptar una política nueva
    // cambiaría las reglas de las posiciones ya abiertas a mitad de vuelo:
    // PUMP se abrió con objetivo +33% y trailing 25% desde la apertura, y esa
    // es la apuesta que se hizo. Cambiarle el trato después corrompe justo lo
    // que el sello de versión existe para poder auditar.
    //
    // Ausente = comportamiento anterior (el objetivo corta). Las posiciones
    // viejas no se migran a propósito.
    politicaSalida, trailPct, activarTrailEnPct,
    // Qué motor tomó esta decisión. Sin esto, comparar la jugada 3 con la 11
    // es comparar dos sistemas distintos creyendo que es uno solo.
    version,
    // Nivel que, si se pierde, no dice "esta jugada salió mal" sino "el setup
    // no era válido": clasifica el cierre y manda el activo a cuarentena.
    invalidacionPct: invalidacionPct ?? null,
    // se guarda la volatilidad DEL MOMENTO DE ENTRAR: el umbral del plazo debe
    // medirse contra el ruido que había cuando se tomó la decisión, no contra
    // el de hoy (que puede haber cambiado por lo que pasó después)
    volatilidadDiariaPct: volatilidadDiariaPct ?? null,
    // El reloj del plazo arranca cuando el plazo se PONE, no cuando se abrió la
    // posición. Naciendo con plazo son el mismo instante; la diferencia importa
    // al ponérselo a una posición que ya lleva días abierta (ver fijarHorizonte).
    plazoDesde: horizonteHoras != null ? new Date().toISOString() : null,
    horizonte: horizonte ?? null,       // etiqueta libre, solo para mostrar
    horizonteHoras: horizonteHoras ?? null,   // plazo real: se evalúa en evaluarPosiciones
    origen: origen ?? 'manual',
    abierto: new Date().toISOString(),
    estado: 'abierta',
  });
  writePosiciones(data);
  return data.posiciones[data.posiciones.length - 1];
}

// Pone o cambia el plazo de una posición YA abierta. `horizonte` que existía
// antes se guardaba y no lo miraba nadie: no había ninguna liquidación por
// tiempo, solo la etiqueta decorativa en el dashboard.
export function fijarHorizonte(ids, horizonteHoras, etiqueta) {
  const data = readPosiciones();
  let tocadas = 0;
  for (const p of data.posiciones) {
    if (p.estado === 'abierta' && ids.includes(p.id)) {
      p.horizonteHoras = horizonteHoras;
      // El reloj arranca AHORA, no en la apertura. Contarlo desde `abierto`
      // hacía que ponerle 48 h a una posición de 3 días la dejara vencida al
      // instante y la liquidara sola — lo contrario de lo que uno espera al
      // escribir "48 h", y una venta por sorpresa.
      p.plazoDesde = new Date().toISOString();
      p.horizonte = etiqueta ?? `${horizonteHoras}h: liquidar si no rentó`;
      tocadas++;
    }
  }
  if (tocadas) writePosiciones(data);
  return { tocadas };
}

export function cerrarPosicion(asset, motivo, precioSalida) {
  const data = readPosiciones();
  let cerrada = null;
  for (const p of data.posiciones) {
    if (p.asset === asset && p.estado === 'abierta') {
      p.estado = 'cerrada';
      p.cerrado = new Date().toISOString();
      p.motivoCierre = motivo;
      p.precioSalida = precioSalida ?? null;
      p.pnlPct = precioSalida ? (precioSalida / p.entrada - 1) * 100 : null;
      // Brecha: cuánto se pasó la salida real del nivel que se había fijado.
      // Negativa = salió peor que lo planeado (el monitor es discreto y muere
      // con el equipo dormido, así que los stops se saltan; lección GPS −18 pp).
      if (p.pnlPct != null && !/horizonte/i.test(motivo)) {
        const nivel = /límite|stop/i.test(motivo) ? p.limitePct : p.objetivoPct;
        p.brechaPp = p.pnlPct - nivel;
        p.nivelEsperado = nivel;
      }
      cerrada = p;
    }
  }
  writePosiciones(data);
  return cerrada;
}

// Venta PARCIAL: la posición sigue viva con menos tamaño. Cerrarla entera —lo
// que pasaba antes— dejaba el resto de las monedas en el sleeve sin stop, sin
// trailing y sin vigilancia: dinero huérfano de todos los controles. La
// reducción va de la posición más vieja a la más nueva; si a una la venta se la
// lleva completa, esa sí se cierra con su PnL.
function reducirPosicion(asset, qtyVendida, precio) {
  const data = readPosiciones();
  let resta = qtyVendida;
  let cambio = false;
  for (const p of data.posiciones) {
    if (p.asset !== asset || p.estado !== 'abierta' || resta <= 0) continue;
    const toma = Math.min(p.qty, resta);
    resta -= toma;
    // tolerancia de redondeo: vender el 99,9% de la posición es venderla toda
    if (toma >= p.qty * 0.999) {
      p.estado = 'cerrada';
      p.cerrado = new Date().toISOString();
      p.motivoCierre = 'jugada manual';
      p.precioSalida = precio;
      p.pnlPct = (precio / p.entrada - 1) * 100;
    } else {
      p.qty -= toma;
    }
    cambio = true;
  }
  if (cambio) writePosiciones(data);
}

// Volatilidad diaria de una posición. Las nuevas la guardan al abrirse; las
// anteriores se recuperan del `limitePct`, que se fijó como 1,5x la
// volatilidad (error medido < 0,4 pp en APT/FET/FIL). Sin red y sin migración.
function volatilidadDe(p) {
  if (Number.isFinite(p.volatilidadDiariaPct) && p.volatilidadDiariaPct > 0) return p.volatilidadDiariaPct;
  if (Number.isFinite(p.limitePct)) return Math.abs(p.limitePct) / STOP_VECES_VOL;
  return null;
}

// Cuánto debe haber rendido (NETO) para que el plazo la deje seguir.
function umbralPlazoPct(p) {
  const vol = volatilidadDe(p);
  const comisionIdaVuelta = 2 * FEE * 100;
  return comisionIdaVuelta + BANDA_RUIDO_VOL * (vol ?? 0);
}

// POLÍTICA DE SALIDA VIGENTE — v4a, adoptada el 2026-09-01.
//
// Medida sobre 221 ventanas históricas (`replay-salidas.mjs --historico`) y
// sobre las 16 posiciones reales. La política anterior —objetivo fijo + plazo
// de 24 h— rendía **-0,205% por operación NETO de comisiones**: no es que
// rindiera poco, es que perdía plata. Esta rinde +0,968%, la mejor de las seis
// probadas tanto con la media completa como con la media podada del 5% mejor
// (la prueba que desenmascaró al trailing del 20%, que era un solo acierto).
//
// LO QUE SE PAGA POR ESA VENTAJA, y está medido: mediana -4,19% contra -1,26%,
// acierto 35% contra 42%, y capital retenido 116 h contra 38. Se gana menos
// veces, se pierde más grande cuando se pierde, y la plata queda inmovilizada
// tres veces más. Es rentable en promedio, no cómodo de mirar.
//
// Una sola declaración porque la lee el motor Y su propio backtest: si la
// política cambiara acá y no allá, el replay compararía contra un "actual" que
// ya no existe — la duplicación de siempre, esta vez en el instrumento de
// medición.
export const POLITICA_SALIDA = {
  politicaSalida: 'trailing',
  trailPct: 10,
  activarTrailEnPct: 10,
  // Sin plazo: el reloj deja de cortar. El plazo recortaba las pérdidas
  // (mediana -1,26% contra -4,19%) pero cobraba esa protección con el borde
  // entero — quitarlo vale +0,726 pp por operación.
  horizonteHoras: null,
};

// NIVELES Y SEÑAL DE UNA POSICIÓN — parte PURA, sin reloj ni disco.
//
// Se extrajo de `evaluarPosiciones` para que el replay de políticas de salida
// (`src/replay-salidas.mjs`) mida EXACTAMENTE las reglas que el motor ejecuta.
// Reimplementarlas allá habría sido la duplicación de siempre: dos copias que
// tienen que coincidir sin que nada lo obligue, y un backtest que valida un
// sistema que no es el que opera.
//
// `horasDePlazo` entra como dato en vez de leerse del reloj: es lo único que
// ataba este cálculo al presente, y es justo lo que un replay necesita mover.
export function evaluarNiveles(p, precio, horasDePlazo) {
  const objetivo = p.entrada * (1 + p.objetivoPct / 100);
  const limite = p.entrada * (1 + p.limitePct / 100);
  const pnlPct = (precio / p.entrada - 1) * 100;
  // progreso: 0 = pegado al límite, 1 = pegado al objetivo
  const progreso = Math.max(0, Math.min(1, (precio - limite) / (objetivo - limite)));
  const vencida = p.horizonteHoras != null && horasDePlazo >= p.horizonteHoras;

  // PLAZO PROGRESIVO (ver la nota extensa en el llamador original).
  const destinoPlazoPct = p.horizonteHoras != null ? umbralPlazoPct(p) : null;
  const rampa = vencida
    ? Math.min(1, (horasDePlazo - p.horizonteHoras) / p.horizonteHoras) : 0;
  const porPlazoPct = vencida
    ? p.limitePct + (destinoPlazoPct - p.limitePct) * rampa
    : p.limitePct;

  // TRAILING desde el PICO. Solo APRIETA.
  //
  // `activarTrailEnPct` es la ARMADURA del trailing: mientras la posición no
  // haya alcanzado esa renta, el trailing no rige. Sin esto, un trailing del
  // 10% puesto al abrir pone el stop en -10% desde el primer minuto y deja de
  // ser una protección de ganancia para volverse un stop más estrecho — que es
  // otra regla, con otro resultado. El replay midió la versión ARMADA (10%
  // desde +10%), así que el motor tiene que implementar esa y no su parecida.
  //
  // El pico se sigue midiendo siempre (es un hecho del mercado); lo que la
  // activación decide es si ese hecho manda o no. Por eso el umbral vive acá y
  // no en `refrescarPicos`.
  const trailArmado = p.trailPct != null && p.picoDesdeApertura > 0
    && (p.activarTrailEnPct == null
      || p.picoDesdeApertura >= p.entrada * (1 + p.activarTrailEnPct / 100));
  const porTrailPct = trailArmado
    ? (p.picoDesdeApertura * (1 - p.trailPct / 100) / p.entrada - 1) * 100
    : null;

  const limitePctEfectivo = porTrailPct != null
    ? Math.max(porPlazoPct, porTrailPct) : porPlazoPct;
  const limiteEfectivo = p.entrada * (1 + limitePctEfectivo / 100);

  // Con política de trailing el objetivo deja de ser una SALIDA y pasa a ser
  // solo referencia. Sigue existiendo porque es el numerador del R:B, que es un
  // criterio de ENTRADA: se mide si hay recorrido hasta la resistencia, y
  // después se deja correr sin cobrar ahí. Quitarlo del todo habría desarmado
  // la compuerta, que rechaza entradas con R:B bajo 1,5.
  const objetivoCorta = p.politicaSalida !== 'trailing';

  let senal = 'ok';
  if (objetivoCorta && precio >= objetivo) senal = 'cruzo-objetivo';
  else if (precio <= limite) senal = 'cruzo-limite';
  // el trailing corta como un stop cuando ES el nivel que manda
  else if (porTrailPct != null && porTrailPct > porPlazoPct && precio <= limiteEfectivo) senal = 'cruzo-limite';
  // Por encima del stop original pero debajo del apretado por el plazo: la
  // tesis no falló, se le acabó el tiempo.
  else if (vencida && precio <= limiteEfectivo) senal = 'vencido-sin-renta';
  // 'cerca-objetivo' solo tiene sentido si el objetivo VENDE. Bajo política de
  // trailing una posición en +50% con techo de referencia en +10% quedaba
  // etiquetada "cerca del objetivo": un panel anunciando un cobro que no va a
  // ocurrir. El estado que importa ahí es si el trailing ya armó, y ese viaja
  // en `trailActivo`.
  else if (objetivoCorta && pnlPct >= p.objetivoPct * 0.7) senal = 'cerca-objetivo';
  else if (pnlPct <= p.limitePct * 0.7) senal = 'cerca-limite';

  return {
    objetivo, limite, pnlPct, progreso, senal, vencida,
    limitePctEfectivo: Number(limitePctEfectivo.toFixed(2)),
    limiteEfectivo,
    trailActivo: porTrailPct != null && limitePctEfectivo > porPlazoPct,
    rampaPlazo: Number(rampa.toFixed(2)),
    umbralPlazoPct: destinoPlazoPct,
  };
}

// Evalúa cada posición abierta contra sus niveles. Devuelve el estado completo
// para el dashboard y las señales de cruce para las alertas.
export function evaluarPosiciones(prices) {
  return readPosiciones().posiciones
    .filter(p => p.estado === 'abierta')
    .map(p => {
      const precio = prices[`${p.asset}USDT`];
      if (!precio) return { ...p, sinPrecio: true };
      const horasAbierta = (Date.now() - Date.parse(p.abierto)) / 3_600_000;
      // `plazoDesde` cuando existe; si no, la apertura (posiciones anteriores a
      // este campo, donde el plazo se puso al abrir y son el mismo instante).
      const horasDePlazo = (Date.now() - Date.parse(p.plazoDesde ?? p.abierto)) / 3_600_000;
      const n = evaluarNiveles(p, precio, horasDePlazo);
      const { objetivo, limite, pnlPct, progreso, senal, limitePctEfectivo, limiteEfectivo } = n;

      return {
        ...p, precio, objetivo, limite, pnlPct, progreso, senal, horasAbierta, horasDePlazo,
        // el stop que rige AHORA: igual al original hasta que vence el plazo
        limitePctEfectivo, limiteEfectivo,
        trailPct: p.trailPct ?? null,
        picoDesdeApertura: p.picoDesdeApertura ?? null,
        trailActivo: n.trailActivo,
        rampaPlazo: n.rampaPlazo,
        umbralPlazoPct: n.umbralPlazoPct,
        horasRestantesPlazo: p.horizonteHoras != null ? Math.max(0, p.horizonteHoras - horasDePlazo) : null,
        valorUSDT: p.qty * precio,
        pnlUSDT: p.qty * (precio - p.entrada),
        // lo que se pierde en ESTA posición si el precio cae hasta su límite
        riesgoUSDT: Math.max(0, p.qty * (precio - limite)),
      };
    });
}

// Riesgo abierto: cuánto se pierde si TODOS los stops abiertos pegan a la vez.
// Es el número que define si queda espacio para abrir otra posición, y no
// estaba a la vista en ninguna parte: había que calcularlo a mano.
export function riesgoAbierto(prices, capital) {
  const abiertas = evaluarPosiciones(prices).filter(p => !p.sinPrecio);
  const usdt = abiertas.reduce((a, p) => a + (p.riesgoUSDT ?? 0), 0);
  const expuesto = abiertas.reduce((a, p) => a + p.valorUSDT, 0);
  return {
    usdt,
    pct: capital ? (usdt / capital) * 100 : null,
    expuestoUSDT: expuesto,
    expuestoPct: capital ? (expuesto / capital) * 100 : null,
    posiciones: abiertas.length,
    detalle: abiertas.map(p => ({ asset: p.asset, riesgoUSDT: p.riesgoUSDT, limitePct: p.limitePct })),
  };
}

// Estadística de las jugadas cerradas: win rate, expectativa y la brecha
// promedio de los stops. Con n<30 no hay significancia — se reporta el n para
// que el número no se lea como conclusión.
export function estadisticaJugadas() {
  const todas = readPosiciones().posiciones.filter(p => p.estado === 'cerrada' && p.pnlPct != null);
  if (!todas.length) return { n: 0 };
  const prom = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

  // Una salida por PLAZO no valida ni refuta la tesis: se cerró porque se
  // acabó el tiempo, no porque el precio decidiera algo. Mezclarla con los
  // cierres por nivel infla la tasa de aciertos con ganancias mínimas que no
  // prueban nada — y esa tasa es justo con la que se va a juzgar el modelo.
  const porTiempo = todas.filter(p => /horizonte/i.test(p.motivoCierre ?? ''));
  const cerradas = todas.filter(p => !/horizonte/i.test(p.motivoCierre ?? ''));

  const medir = arr => {
    if (!arr.length) return { n: 0 };
    const ganadas = arr.filter(p => p.pnlPct > 0);
    const perdidas = arr.filter(p => p.pnlPct <= 0);
    const wr = ganadas.length / arr.length;
    return {
      n: arr.length,
      winRate: wr * 100,
      gananciaProm: prom(ganadas.map(p => p.pnlPct)),
      perdidaProm: prom(perdidas.map(p => p.pnlPct)),
      expectativaPct: wr * prom(ganadas.map(p => p.pnlPct)) + (1 - wr) * prom(perdidas.map(p => p.pnlPct)),
    };
  };

  const brechas = cerradas.filter(p => p.brechaPp != null).map(p => p.brechaPp);
  return {
    // los números principales son SOLO los cierres por nivel: el veredicto de la tesis
    ...medir(cerradas),
    brechaPromPp: brechas.length ? prom(brechas) : null,
    brechaPeorPp: brechas.length ? Math.min(...brechas) : null,
    significativo: cerradas.length >= 30,
    // las salidas por tiempo se reportan aparte, no se esconden
    porTiempo: medir(porTiempo),
    nTotal: todas.length,
  };
}

// Cierres con su brecha: el registro del sistema muestra el PnL, pero lo que
// enseña es cuánto se pasó la salida del nivel que se había fijado.
export function cierres() {
  return readPosiciones().posiciones
    .filter(p => p.estado === 'cerrada')
    .map(p => ({
      asset: p.asset, cerrado: p.cerrado, motivoCierre: p.motivoCierre,
      pnlPct: p.pnlPct, nivelEsperado: p.nivelEsperado ?? null, brechaPp: p.brechaPp ?? null,
    }));
}

// --- ATRIBUCIÓN DE LA BRECHA ------------------------------------------------
//
// La brecha entre la ficticia y la real es el costo TOTAL de haber operado en
// vez de sostener: la billetera real no se toca, así que es literalmente el
// escenario "no hice nada". Pero el número solo no dice QUÉ decisión la abrió.
//
// Cada operación se juzga contra no haberla hecho, a precios de hoy:
//   VENDER X → costó lo que X vale hoy menos lo que nos dieron entonces
//   COMPRAR X → aportó lo que X vale hoy menos lo que pagamos
//
// La suma NO cuadra exacto con la brecha, y eso se reporta en vez de esconderse:
// faltan las comisiones, el redondeo de la reserva a dos decimales en cada
// operación, y las diferencias menores entre ambas carteras. Un número que
// explica el 70-80% con nombre y apellido vale más que uno exacto sin detalle.

export async function atribucionBrecha() {
  const movs = readMovimientos();
  if (!movs.length) return { filas: [], n: 0 };

  const activos = [...new Set(movs.flatMap(e => e.operaciones.map(o => o.asset)))]
    .filter(a => !STABLES_USD.has(a));
  const { prices } = await marketSnapshotLigero(activos);

  // los que el snapshot no trajo (activos que ya no están en cartera) se piden sueltos
  const px = { ...prices };
  const faltantes = activos.filter(a => !px[`${a}USDT`]);
  const sueltos = await enParalelo(faltantes, a => pub('/api/v3/ticker/price', { symbol: `${a}USDT` }));
  for (const [i, r] of sueltos.entries()) {
    // delistado o sin par: se omite y se declara abajo
    if (r.ok) px[`${faltantes[i]}USDT`] = parseFloat(r.valor.price);
  }

  const filas = [];
  const sinPrecio = new Set();
  for (const ev of movs) {
    for (const o of ev.operaciones) {
      const p = px[`${o.asset}USDT`];
      if (!p) { sinPrecio.add(o.asset); continue; }
      const hoy = o.qty * p;
      const impacto = o.accion === 'VENDER' ? o.usdt - hoy : hoy - o.usdt;
      filas.push({
        ts: ev.ts, fecha: ev.fecha, asset: o.asset, accion: o.accion,
        origen: ev.origen ?? null, categoria: ev.categoria ?? null,
        entoncesUSDT: o.usdt, hoyUSDT: hoy, impactoUSDT: impacto,
      });
    }
  }

  const explicado = filas.reduce((a, f) => a + f.impactoUSDT, 0);
  const previo = lastRunPrevio();
  const brechaReal = previo?.sim?.valor != null && previo?.real?.total != null
    ? previo.sim.valor - previo.real.total : null;

  return {
    filas: filas.sort((a, b) => a.impactoUSDT - b.impactoUSDT),
    n: filas.length,
    explicadoUSDT: explicado,
    brechaUSDT: brechaReal,
    residuoUSDT: brechaReal != null ? brechaReal - explicado : null,
    cobertturaPct: brechaReal ? (explicado / brechaReal) * 100 : null,
    comisionesUSDT: comisionesPagadas().comisionesUSDT,
    sinPrecio: [...sinPrecio],
  };
}

// --- SEGUIMIENTO POST-CIERRE ------------------------------------------------
//
// Qué pasó con el precio DESPUÉS de que salimos. Es la única forma de saber si
// una salida fue buena o si dejó dinero sobre la mesa, y aplica en los dos
// sentidos: un objetivo que sigue subiendo vendió temprano; un stop que se
// recupera cortó una posición que iba a volver.
//
// Se calcula de las velas, no de un registro en vivo, así que funciona
// RETROACTIVAMENTE sobre los cierres que ya existen. Una vez pasada la ventana
// el número es definitivo, así que se cachea y no se vuelve a pedir.

const SEGUIMIENTO_FILE = join(DATA, 'seguimiento.json');
const VENTANAS_H = [24, 48];

function leerSeguimiento() {
  if (!existsSync(SEGUIMIENTO_FILE)) return {};
  try { return leerJSON(SEGUIMIENTO_FILE); } catch { return {}; }
}

export async function seguimientoCierres() {
  const cache = leerSeguimiento();
  const cerradas = readPosiciones().posiciones.filter(p =>
    p.estado === 'cerrada' && p.cerrado && p.precioSalida > 0);
  const maxH = Math.max(...VENTANAS_H);
  const filas = [];
  let cambioCache = false;

  for (const p of cerradas) {
    const salida = Date.parse(p.cerrado);
    const horasDesde = (Date.now() - salida) / 3_600_000;
    const clave = `${p.id}`;
    let dato = cache[clave];

    if (!dato || (!dato.completo && horasDesde > (dato.horasMedidas ?? 0) + 1)) {
      try {
        // velas de 1 h desde la salida; +2 de colchón por el redondeo de vela
        const velas = await pub('/api/v3/klines', {
          symbol: `${p.asset}USDT`, interval: '1h',
          startTime: salida, limit: maxH + 2,
        });
        const precioA = h => {
          const v = velas[Math.min(h, velas.length - 1)];
          return v ? parseFloat(v[4]) : null;                 // cierre de esa vela
        };
        const maximo = velas.length
          ? Math.max(...velas.slice(0, maxH + 1).map(v => parseFloat(v[2])))
          : null;
        dato = {
          asset: p.asset,
          horasMedidas: Math.min(horasDesde, maxH),
          completo: horasDesde >= maxH,
          maximoPct: maximo ? (maximo / p.precioSalida - 1) * 100 : null,
        };
        for (const h of VENTANAS_H) {
          const px = horasDesde >= h ? precioA(h) : null;
          dato[`h${h}Pct`] = px ? (px / p.precioSalida - 1) * 100 : null;
        }
        cache[clave] = dato;
        cambioCache = true;
      } catch (e) {
        console.error(`seguimiento ${p.asset}: ${e.message}`);
        continue;
      }
    }

    const esStop = /stop|límite/i.test(p.motivoCierre ?? '');
    const esPlazo = /horizonte/i.test(p.motivoCierre ?? '');
    filas.push({
      id: p.id, asset: p.asset, cerrado: p.cerrado, pnlPct: p.pnlPct,
      tipo: esStop ? 'stop' : esPlazo ? 'horizonte' : 'objetivo',
      precioSalida: p.precioSalida,
      ...dato,
      // Lectura del signo: subir DESPUÉS de vender es malo si salimos por
      // objetivo (dejamos plata) y también si salimos por stop (nos cortó
      // antes de la recuperación). En los dos casos, positivo = nos costó.
      costoPct: dato.h48Pct ?? dato.h24Pct ?? null,
      // …y lo mismo EN PLATA, al tamaño que de verdad se operó. Un "+68%"
      // sobre una posición de 5 USDT y sobre una de 50 son la misma cifra y
      // dos hechos distintos: el porcentaje dice si la regla falla, los USDT
      // dicen cuánto cuesta. Para decidir si vale la pena cambiar la regla
      // hace falta el segundo.
      valorSalidaUSDT: Number((p.qty * p.precioSalida).toFixed(2)),
      costoUSDT: dato.costoPctBase == null && (dato.h48Pct ?? dato.h24Pct) == null
        ? null
        : Number((p.qty * p.precioSalida * ((dato.h48Pct ?? dato.h24Pct) / 100)).toFixed(2)),
      // El mejor momento posible después de salir: el techo de lo que se
      // podría haber capturado con una salida perfecta.
      maximoUSDT: dato.maximoPct == null ? null
        : Number((p.qty * p.precioSalida * (dato.maximoPct / 100)).toFixed(2)),
    });
  }

  if (cambioCache) escribirJSON(SEGUIMIENTO_FILE, cache);

  const medidos = filas.filter(f => f.costoPct != null);
  const porTipo = tipo => {
    const g = medidos.filter(f => f.tipo === tipo);
    if (!g.length) return { n: 0 };
    const prom = g.reduce((a, f) => a + f.costoPct, 0) / g.length;
    return { n: g.length, promedioPct: prom, siguieronSubiendo: g.filter(f => f.costoPct > 0).length };
  };

  return {
    filas: filas.sort((a, b) => (b.cerrado ?? '').localeCompare(a.cerrado ?? '')),
    ventanasH: VENTANAS_H,
    objetivo: porTipo('objetivo'),
    stop: porTipo('stop'),
    horizonte: porTipo('horizonte'),
    // con n<20 el motor de aprendizaje no concluye; acá se aplica el mismo criterio
    significativo: medidos.length >= 20,
    n: medidos.length,
  };
}

// Comisiones realmente pagadas, desde el ledger (no estimadas).
export function comisionesPagadas() {
  const movs = readMovimientos();
  const volumen = movs.reduce((a, m) => a + m.operaciones.reduce((x, o) => x + (o.usdt ?? 0), 0), 0);
  return { volumenUSDT: volumen, comisionesUSDT: volumen * FEE, operaciones: movs.reduce((a, m) => a + m.operaciones.length, 0) };
}

function readAlertas() {
  if (!existsSync(ALERTAS_FILE)) return [];
  return readFileSync(ALERTAS_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// Chequeo de vigilancia: detecta cruces NUEVOS (no re-alerta lo ya avisado).
export async function chequearAlertas() {
  const { prices } = await marketSnapshotLigero();
  const evaluadas = evaluarPosiciones(prices);
  const previas = readAlertas();
  const nuevas = [];
  const SENALES_ALERTA = new Set(['cruzo-limite', 'cruzo-objetivo', 'vencido-sin-renta']);
  for (const p of evaluadas) {
    if (!SENALES_ALERTA.has(p.senal)) continue;
    const yaAvisada = previas.some(a => a.asset === p.asset && a.senal === p.senal && a.abierto === p.abierto);
    if (yaAvisada) continue;
    const alerta = {
      ts: new Date().toISOString(),
      asset: p.asset,
      senal: p.senal,
      precio: p.precio,
      entrada: p.entrada,
      pnlPct: p.pnlPct,
      abierto: p.abierto,
      texto: p.senal === 'cruzo-limite'
        ? `${p.asset} cruzó su LÍMITE (${p.limitePct}%): ${p.precio} · PnL ${p.pnlPct.toFixed(1)}%`
        : p.senal === 'vencido-sin-renta'
        ? `${p.asset} cumplió su plazo (${p.horizonteHoras}h) sin rentar: ${p.precio} · PnL ${p.pnlPct.toFixed(1)}% → se liquida`
        : `${p.asset} alcanzó su OBJETIVO (+${p.objetivoPct}%): ${p.precio} · PnL +${p.pnlPct.toFixed(1)}%`,
    };
    appendFileSync(ALERTAS_FILE, JSON.stringify(alerta) + '\n');
    nuevas.push(alerta);
  }
  return { nuevas, evaluadas };
}

export function getAlertas(limite = 20) {
  return readAlertas().slice(-limite).reverse();
}

// Stops dimensionados a la volatilidad real del activo (lección de GPS: un
// límite de −8% en una moneda que se mueve 20% diario salta por puro ruido).
// límite ≈ 1,5× volatilidad diaria (piso −4%, techo −15%); objetivo = 2,5× ese
// riesgo, para que ganar valga más que perder.
// --- COMPUERTA DE RIESGO -----------------------------------------------------
//
// Un solo lugar donde preguntar "¿puedo abrir esta posición?" y recibir sí o no.
// Antes los controles existían pero estaban REGADOS: el techo del sleeve en un
// lado, el congelado en otro, el riesgo abierto solo como número informativo. Un
// control disperso que falla en silencio no detiene nada — ya nos pasó con
// `tg.crearOferta`, mudo dentro de su catch durante semanas.
//
// Dos niveles a propósito:
//   BLOQUEOS — condiciones donde no se abre nada, venga de donde venga.
//   AVISOS   — cosas que Jorge debe VER antes de decidir, no que le impidan
//              decidir. Bloquear por todo entrena a ignorar los bloqueos.

// Caída máxima tolerada desde el pico del capital antes de dejar de abrir.
// Con capital CERRADO (nunca entra ni sale dinero) el valor total es una curva
// de equity limpia, así que la caída desde el máximo se mide directo.
//
// El 10% es un JUICIO: la peor caída registrada en los primeros 5 días fue
// -2,58%, así que no hay datos para calibrarlo. Se define ahora, cuando no
// duele — que es el único momento honesto para fijar un freno.
const DRAWDOWN_MAX_PCT = 10;
const RIESGO_ABIERTO_MAX_PCT = 5;    // % del capital comprometido en stops a la vez
const VOL_DIARIA_AVISO_PCT = 8;      // sobre esto se avisa (el bloqueo lo pone el desvío de riesgo)
// Cuántas veces el riesgo objetivo puede excederse antes de bloquear. No es un
// umbral de volatilidad: es el desvío que la volatilidad PRODUCE una vez que el
// mínimo de orden de 5 USDT deja de permitir dimensionar. 1,5x deja pasar el
// redondeo normal y corta los casos como PUMP (2,0x).
const RIESGO_DESVIO_MAX_VECES = 1.5;

// Pico histórico del capital, desde los snapshots ya guardados: no hace falta
// estado nuevo ni recordar máximos entre reinicios.
export function drawdownActual(valorAhora) {
  let pico = 0;
  for (const snap of readSnapshots()) {
    const v = snap?.sim?.total;
    if (Number.isFinite(v) && v > pico) pico = v;
  }
  if (Number.isFinite(valorAhora) && valorAhora > pico) pico = valorAhora;
  if (!pico) return { pico: null, drawdownPct: 0, limitePct: DRAWDOWN_MAX_PCT };
  return {
    pico: Number(pico.toFixed(2)),
    drawdownPct: Number(((valorAhora / pico - 1) * 100).toFixed(2)),
    limitePct: DRAWDOWN_MAX_PCT,
  };
}

// `plan` es la entrada que se quiere abrir: { montoUSDT, limitePct, volatilidadDiariaPct }
// `opciones.wallet` deja evaluar una billetera EN MEMORIA en vez de la del
// disco. Lo necesita la jugada manual: sus ventas y sus compras anteriores del
// mismo lote todavía no están escritas, y juzgar con el estado viejo daría un
// veredicto sobre una cartera que ya no existe.
// `opciones.riesgoExtraUSDT` es el riesgo de las aperturas ENCOLADAS de ese
// mismo lote: aún no están en posiciones.json, así que riesgoAbierto() las
// sumaría en cero y dos compras que juntas pasan el tope del 5% se colaban.
export function compuertaRiesgo(plan, prices, { wallet: walletDado = null, riesgoExtraUSDT = 0 } = {}) {
  const bloqueos = [], avisos = [];
  const wallet = walletDado ?? loadWallet(prices);
  if (!wallet) return { pasa: false, bloqueos: ['no hay billetera ficticia'], avisos };

  const total = walletValue(wallet, prices);
  const dd = drawdownActual(total);
  const est = estadoSleeve(wallet, prices);
  const riesgo = riesgoAbierto(prices, total);

  // --- BLOQUEOS ---
  if (congelado()) bloqueos.push(`ejecución congelada (${motivoCongelado() ?? 'sin motivo'})`);

  if (dd.drawdownPct <= -dd.limitePct) {
    bloqueos.push(`caída del ${Math.abs(dd.drawdownPct)}% desde el pico de ${dd.pico} USDT (límite ${dd.limitePct}%): no se abren posiciones nuevas`);
  }

  const monto = plan?.montoUSDT ?? 0;
  if (monto > 0) {
    // CHECK DE VOLATILIDAD. Antes solo avisaba, y el propio texto del aviso
    // confesaba el problema: "el mínimo de orden hará arriesgar más de lo
    // objetivo". Sabíamos que nos pasábamos del riesgo y seguíamos igual —
    // PUMP quedó con 0,70 USDT de riesgo contra un objetivo de 0,35.
    //
    // El piso de 5 USDT hace que el objetivo sea inalcanzable arriba de ~4,7%
    // de volatilidad diaria; el aviso recién saltaba a 8%. Entre medio nos
    // pasábamos SIN DECIR NADA. Ahora el límite no es un umbral de volatilidad
    // sino el desvío real sobre el riesgo objetivo, que es lo que importa.
    const riesgoDelPlan = monto * Math.abs(plan.limitePct ?? 0) / 100;
    const vecesObjetivo = riesgoDelPlan / RIESGO_OBJETIVO_USDT;
    if (vecesObjetivo > RIESGO_DESVIO_MAX_VECES) {
      bloqueos.push(`arriesga ${riesgoDelPlan.toFixed(2)} USDT, ${vecesObjetivo.toFixed(1)}x el objetivo de ${RIESGO_OBJETIVO_USDT} (tope ${RIESGO_DESVIO_MAX_VECES}x): con esta volatilidad el mínimo de orden no permite dimensionar bien`);
    }

    // RELACIÓN RIESGO/BENEFICIO. El screening automático ya descartaba
    // candidatos con R:B pobre, pero una oferta pedida a mano desde el
    // dashboard o Telegram entraba sin pasar por ese filtro: LINK se creó con
    // 1,17 — arriesgar 6% para ganar 8%. Ahora el mínimo rige venga la oferta
    // de donde venga; la puerta es una sola.
    //
    // El caso típico que corta es un activo pegado a su techo de 30 días: queda
    // poco recorrido arriba y el stop sigue midiendo lo mismo abajo. Medido en
    // el radar, corta 7 de 12 — BTC 0,75, ZEC 0,58, PUMP 0,29 — y deja pasar 5.
    if (plan?.objetivoPct > 0 && plan?.limitePct) {
      const rb = plan.objetivoPct / Math.abs(plan.limitePct);
      if (rb < RB_MINIMO) {
        bloqueos.push(`R:B ${rb.toFixed(2)} bajo el mínimo de ${RB_MINIMO}: arriesga ${Math.abs(plan.limitePct)}% para ganar ${plan.objetivoPct}%`);
      }
    }

    if (est.actual + monto > est.presupuesto + 0.01) {
      bloqueos.push(`el sleeve quedaría en ${(est.actual + monto).toFixed(2)} sobre su techo de ${est.presupuesto.toFixed(2)} USDT`);
    }
    if (monto > (wallet.reserva ?? 0) + 0.01) {
      bloqueos.push(`reserva insuficiente: ${(wallet.reserva ?? 0).toFixed(2)} USDT disponibles`);
    }
    const riesgoNuevo = monto * Math.abs(plan.limitePct ?? 0) / 100;
    const riesgoTotalPct = total ? ((riesgo.usdt + riesgoExtraUSDT + riesgoNuevo) / total) * 100 : 0;
    if (riesgoTotalPct > RIESGO_ABIERTO_MAX_PCT) {
      bloqueos.push(`el riesgo abierto llegaría al ${riesgoTotalPct.toFixed(1)}% del capital (tope ${RIESGO_ABIERTO_MAX_PCT}%)`);
    }
  }

  // --- AVISOS ---
  if (dd.drawdownPct < -dd.limitePct / 2) {
    avisos.push(`vas ${Math.abs(dd.drawdownPct)}% bajo el pico: a mitad de camino del freno automático`);
  }
  if (plan?.volatilidadDiariaPct > VOL_DIARIA_AVISO_PCT) {
    avisos.push(`volatilidad de ${plan.volatilidadDiariaPct}% diaria: el stop es ancho y el mínimo de orden hará arriesgar más de lo objetivo`);
  }
  if (est.ocupacionPct > est.limitePct * 0.8) {
    avisos.push(`el sleeve va al ${est.ocupacionPct.toFixed(0)}% de su techo`);
  }

  return {
    pasa: bloqueos.length === 0,
    bloqueos, avisos,
    estado: {
      drawdownPct: dd.drawdownPct, picoUSDT: dd.pico, drawdownLimitePct: dd.limitePct,
      sleeveUSDT: Number(est.actual.toFixed(2)), sleevePresupuestoUSDT: Number(est.presupuesto.toFixed(2)),
      riesgoAbiertoUSDT: Number(riesgo.usdt.toFixed(2)), riesgoAbiertoPct: Number((riesgo.pct ?? 0).toFixed(2)),
      riesgoAbiertoMaxPct: RIESGO_ABIERTO_MAX_PCT,
      reservaUSDT: wallet.reserva ?? 0,
    },
  };
}

// --- TAMAÑO POR RIESGO -------------------------------------------------------
//
// El monto sale del RIESGO, no al revés. Con monto fijo, un stop ancho arriesga
// mucho más que uno estrecho sin que nadie lo decida: medido en la cartera del
// 23-08, FIL arriesgaba 0,13 USDT y PUMP 1,02 — **8,1 veces más**, puro efecto
// secundario de combinar monto fijo con stop por volatilidad.
//
// LÍMITE HONESTO, y no es de implementación sino aritmético: con el mínimo de
// orden real de Binance (~5 USDT) sobre una cartera de ~93, el riesgo NO se
// puede igualar. Para cubrir stops de -4% a -15% haría falta a la vez un
// objetivo >= 0,75 (por el piso) y <= 0,32 (por el techo). Se probaron cuatro
// valores y todos convergen a ~2,3x de dispersión.
//
// Así que esto NO promete riesgo parejo: baja la dispersión de 8,1x a ~2,3x y
// **declara el residuo** en cada jugada — cuánto arriesga de verdad y si el
// piso del exchange la desvió del objetivo. Es la contra-evidencia que la
// hipótesis `sizing-riesgo-fijo` ya tenía escrita desde el 19-08.
export const RIESGO_OBJETIVO_USDT = 0.35;
const MONTO_MINIMO_USDT = 5;   // mínimo de orden real en Binance
const MONTO_MAXIMO_USDT = 8;   // ~1/3 del presupuesto del sleeve: no concentrar

export function montoPorRiesgo(limitePct, { riesgoObjetivo = RIESGO_OBJETIVO_USDT } = {}) {
  const fraccion = Math.abs(limitePct) / 100;
  if (!Number.isFinite(fraccion) || fraccion <= 0) {
    throw Object.assign(new Error('limitePct inválido para dimensionar'), { codigo: 400 });
  }
  // Se redondea ANTES de comparar contra los topes. Sin esto, 0,35/0,07 da
  // 4,999999999999999 y un ideal de exactamente 5,00 disparaba el piso: la
  // salida decía "ideal 5,00 · acotado por el mínimo de 5", una contradicción.
  const ideal = Number((riesgoObjetivo / fraccion).toFixed(2));
  const montoUSDT = Number(Math.min(MONTO_MAXIMO_USDT, Math.max(MONTO_MINIMO_USDT, ideal)).toFixed(2));
  const riesgoRealUSDT = Number((montoUSDT * fraccion).toFixed(2));
  return {
    montoUSDT,
    montoIdealUSDT: Number(ideal.toFixed(2)),
    riesgoObjetivoUSDT: riesgoObjetivo,
    riesgoRealUSDT,
    // qué tope actuó, si alguno: es el residuo que no se esconde
    acotadoPor: ideal < MONTO_MINIMO_USDT ? 'minimo-de-orden'
      : ideal > MONTO_MAXIMO_USDT ? 'techo-de-concentracion' : null,
    desvioPct: Number(((riesgoRealUSDT / riesgoObjetivo - 1) * 100).toFixed(0)),
  };
}

// Relación riesgo/beneficio mínima. Existe porque el objetivo dejó de ser un
// múltiplo del stop: mientras `objetivo = |stop| x 2,5`, el R:B era una
// CONSTANTE por construcción (2,50 en las cinco posiciones abiertas) y no podía
// informar ninguna decisión. Con objetivo estructural el R:B varía de verdad, y
// recién ahí sirve de filtro.
const RB_MINIMO = 1.5;
const OBJETIVO_MAX_VECES_STOP = 3;   // techo: un activo derrumbado no da un objetivo absurdo

// Stop, objetivo y R:B de una entrada.
//
// El stop sigue saliendo de la volatilidad (1,5x, piso 4% y techo 15%): esa es
// la lección de GPS y ACE y no se toca.
//
// El OBJETIVO cambia. Antes era `|stop| x 2,5`, aritmética sobre el stop que no
// sabe nada de hasta dónde puede llegar el precio — y el seguimiento post-cierre
// midió el costo: 3 de 3 salidas dejaron dinero en la mesa (TRUMP +68% sobre el
// precio de salida). Ahora, cuando se conoce la distancia al techo de 30 días,
// el objetivo se apoya en ESA resistencia.
//
// Excepción honesta: en una RUPTURA el precio ya está en su techo, así que no
// hay resistencia visible arriba. Ahí se vuelve a la proyección por
// volatilidad — inventar un nivel que no existe sería peor.
// Parte PURA del cálculo: sin red, para poder probarla. Recibe la volatilidad
// ya medida en vez de ir a buscar las velas.
export function planDeEntrada({ volPct, distanciaTechoPct = null, distanciaPisoPct = null, senal = null }) {
  const limiteVolPct = -Math.min(15, Math.max(4, Math.round(volPct * STOP_VECES_VOL)));

  // STOP ESTRUCTURAL. El objetivo ya se apoyaba en el techo de 30 días, pero el
  // stop seguía siendo pura volatilidad: el R:B dividía una distancia
  // estructural por una estadística, así que el mínimo de 1,5 no significaba lo
  // que parecía.
  //
  // El piso de 30 días es el nivel que la estructura defiende. El stop va un
  // poco DEBAJO de él (medio día de volatilidad, mínimo 0,5%) para no salir por
  // el roce normal del precio contra su propio soporte.
  //
  // Regla de una sola dirección: la estructura solo puede APRETAR el stop,
  // nunca ensancharlo. Si el soporte está a -12% y la volatilidad manda -6%,
  // manda -6% — ensanchar rompería el presupuesto de riesgo y la lección de
  // GPS. Y el piso duro de -4% sigue vigente: un stop a -1,5% lo barre el ruido.
  const alPisoPct = distanciaPisoPct != null && distanciaPisoPct > 0 ? distanciaPisoPct : null;
  const margen = Math.max(0.5, volPct * 0.5);
  const limiteEstructuralPct = alPisoPct != null
    ? Math.min(-4, -Math.round(alPisoPct + margen)) : null;
  const limitePct = limiteEstructuralPct != null
    ? Math.max(limiteVolPct, limiteEstructuralPct) : limiteVolPct;
  const usaEstructuraEnStop = limitePct !== limiteVolPct;

  const riesgo = Math.abs(limitePct);

  // `distanciaTechoPct` es negativa cuando el precio está bajo su máximo de 30d,
  // así que el recorrido disponible hasta esa resistencia es su valor absoluto.
  const alTechoPct = distanciaTechoPct != null && distanciaTechoPct < 0
    ? Math.abs(distanciaTechoPct) : null;
  const proyeccion = Math.round(riesgo * 2.5);

  const usaEstructura = alTechoPct != null && senal !== 'ruptura';
  const objetivoPct = usaEstructura
    ? Math.max(1, Math.min(Math.round(alTechoPct), riesgo * OBJETIVO_MAX_VECES_STOP))
    : proyeccion;

  return {
    volatilidadDiariaPct: Number(volPct.toFixed(1)),
    limitePct,
    objetivoPct,
    tipoObjetivo: usaEstructura ? 'estructural' : 'proyeccion',
    objetivoProyeccionPct: proyeccion,
    alTechoPct: alTechoPct != null ? Number(alTechoPct.toFixed(1)) : null,
    riesgoBeneficio: Number((objetivoPct / riesgo).toFixed(2)),
    rbMinimo: RB_MINIMO,
    // --- estructura por abajo -----------------------------------------------
    tipoStop: usaEstructuraEnStop ? 'estructural' : 'volatilidad',
    limiteVolatilidadPct: limiteVolPct,
    alPisoPct: alPisoPct != null ? Number(alPisoPct.toFixed(1)) : null,
    // INVALIDACIÓN: no es el stop. El stop dice dónde salgo de ESTA operación;
    // la invalidación dice dónde muere la TESIS. En el póster está dibujada
    // debajo del stop y es otro nivel — perder el piso de 30 días no significa
    // "esta jugada salió mal", significa "el setup no era válido", y eso manda
    // el activo a cuarentena en vez de dejarlo listo para reproponerse mañana.
    invalidacionPct: alPisoPct != null ? -Number(alPisoPct.toFixed(2)) : null,
  };
}

// Volatilidad diaria en % sobre una serie de cierres. Una sola copia: la usan
// el plan de entrada y la condición de la watchlist, y tienen que dar el MISMO
// número o la condición esperaría algo distinto de lo que decide el tamaño.
export function volatilidadDiaria(cierres) {
  const rets = [];
  for (let i = 1; i < cierres.length; i++) rets.push(cierres[i] / cierres[i - 1] - 1);
  if (!rets.length) return null;
  const media = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, r) => a + (r - media) ** 2, 0) / rets.length) * 100;
}

export async function stopsSugeridos(asset, { distanciaTechoPct = null, distanciaPisoPct = null, senal = null } = {}) {
  // 31 velas para ver el piso de 30 días, pero la VOLATILIDAD se sigue midiendo
  // sobre las últimas 15 exactamente como antes. Ampliar la ventana habría
  // cambiado todos los stops de rebote, que es justo lo que no se quiere al
  // agregar una regla nueva: un cambio a la vez, y este no toca el existente.
  const kl = await pub('/api/v3/klines', { symbol: `${asset}USDT`, interval: '1d', limit: 31 });
  const cierres = kl.map(k => parseFloat(k[4]));
  const vol = volatilidadDiaria(cierres.slice(-15));

  // El piso lo calcula acá quien no lo tenga medido; si viene dado (el contexto
  // de entrada ya lo trae de las mismas velas) se respeta y no se recalcula.
  let piso = distanciaPisoPct;
  if (piso == null) {
    // El piso del RETROCESO EN CURSO: el mínimo desde que se marcó el techo de
    // 30 días. El mínimo del mes entero queda 23-184% abajo en el radar real y
    // como ancla no aprieta nunca (medido en los 12 activos).
    const alturas = kl.map(k => parseFloat(k[2]));
    const iTecho = alturas.indexOf(Math.max(...alturas));
    const desdeTecho = kl.slice(iTecho).map(k => parseFloat(k[3]));
    const pisoRetroceso = desdeTecho.length ? Math.min(...desdeTecho) : null;
    const ahora = cierres.at(-1);
    if (pisoRetroceso > 0 && ahora > pisoRetroceso) piso = (ahora / pisoRetroceso - 1) * 100;
  }
  return planDeEntrada({ volPct: vol, distanciaTechoPct, distanciaPisoPct: piso, senal });
}

// RENDIMIENTO DEL SLEEVE — la métrica que mide EL MODELO, no a BTC.
// Con la estrategia operando solo el 25% del capital, comparar "ficticia total
// vs hold total" mide bitcoin. Esto compara cada jugada contra lo que esa misma
// plata habría rendido quieta en BTC durante exactamente el mismo período.
export async function rendimientoSleeve(prices) {
  const todas = readPosiciones().posiciones;
  if (!todas.length) return null;

  // precios de BTC por hora, para valorizar el benchmark en la fecha de entrada
  const desde = Math.min(...todas.map(p => Date.parse(p.abierto)));
  const horas = Math.ceil((Date.now() - desde) / 3_600_000) + 2;
  let btcHist = [];
  try {
    btcHist = await pub('/api/v3/klines', { symbol: 'BTCUSDT', interval: '1h', limit: Math.min(1000, Math.max(2, horas)) });
  } catch { /* sin histórico: el benchmark queda nulo */ }
  const btcEn = ts => {
    if (!btcHist.length) return null;
    const t = Date.parse(ts);
    let mejor = btcHist[0];
    for (const k of btcHist) if (Math.abs(k[0] - t) < Math.abs(mejor[0] - t)) mejor = k;
    return parseFloat(mejor[4]);
  };
  const btcAhora = prices.BTCUSDT;

  const detalle = todas.map(p => {
    const cerrada = p.estado === 'cerrada';
    const precioFinal = cerrada ? (p.precioSalida ?? p.entrada) : (prices[`${p.asset}USDT`] ?? p.entrada);
    const capital = p.qty * p.entrada;
    const pnlUSDT = p.qty * (precioFinal - p.entrada);
    const btc0 = btcEn(p.abierto);
    const btcRef = cerrada && p.cerrado ? btcEn(p.cerrado) : btcAhora;
    const benchPct = btc0 ? (btcRef / btc0 - 1) * 100 : null;
    const pnlPct = (precioFinal / p.entrada - 1) * 100;
    return {
      asset: p.asset, estado: p.estado, capital, pnlUSDT, pnlPct,
      benchPct,
      alfaPct: benchPct == null ? null : pnlPct - benchPct,
      alfaUSDT: benchPct == null ? null : capital * ((pnlPct - benchPct) / 100),
      motivoCierre: p.motivoCierre ?? null,
    };
  });

  const capital = detalle.reduce((a, d) => a + d.capital, 0);
  const pnl = detalle.reduce((a, d) => a + d.pnlUSDT, 0);
  const alfa = detalle.reduce((a, d) => a + (d.alfaUSDT ?? 0), 0);
  const cerradas = detalle.filter(d => d.estado === 'cerrada');
  const ganadoras = cerradas.filter(d => d.pnlUSDT > 0).length;

  return {
    detalle,
    capitalDesplegado: capital,
    pnlUSDT: pnl,
    pnlPct: capital > 0 ? (pnl / capital) * 100 : 0,
    alfaUSDT: alfa,
    alfaPct: capital > 0 ? (alfa / capital) * 100 : 0,
    jugadas: detalle.length,
    cerradas: cerradas.length,
    ganadoras,
    aciertoPct: cerradas.length ? (ganadoras / cerradas.length) * 100 : null,
  };
}

// JUGADA MANUAL — las jugadas que Jorge elige del abanico dejan de ser scripts
// temporales y pasan a ser una operación del producto, repetible y registrada.
//   vender:  [{ asset, usdt }] · usdt omitido = vender la posición completa
//   comprar: [{ asset, usdt, objetivoPct?, limitePct? }] · si no vienen los
//            niveles, se calculan por volatilidad (stopsSugeridos)
// Opera SIEMPRE dentro del sleeve; el ancla es intocable.

// Las tres fases de una jugada, separadas a propósito: validar (sin tocar nada),
// ejecutar en memoria (abortable) y persistir (ya no puede fallar). Antes eran
// 188 líneas seguidas con el "punto de no retorno" marcado solo por un
// comentario; ahora es una frontera de función, que es más difícil de cruzar
// por accidente al editar.

// FASE 1a · Lo que se puede rechazar sin salir a la red ni leer la billetera.
function validarEntrada(operaciones) {
  for (const c of operaciones) {
    activoValido(c.asset);
    montoValido(c.usdt, `monto de ${c.asset}`);
    if (c.objetivoPct != null && (!Number.isFinite(c.objetivoPct) || c.objetivoPct <= 0)) {
      throw Object.assign(new Error(`objetivoPct de ${c.asset} inválido: debe ser un porcentaje positivo`), { codigo: 400 });
    }
    if (c.limitePct != null && (!Number.isFinite(c.limitePct) || c.limitePct >= 0)) {
      throw Object.assign(new Error(`limitePct de ${c.asset} inválido: debe ser un porcentaje negativo`), { codigo: 400 });
    }
  }
}

// FASE 1b · Lo que depende de la cartera: bolsillos intocables y par existente.
function validarContraCartera(operaciones, wallet, prices) {
  for (const c of operaciones) {
    if (wallet.ancla?.[c.asset]) throw new Error(`${c.asset} está en el ancla: no se opera desde una jugada`);
    if (wallet.legado?.[c.asset]) throw new Error(`${c.asset} es capital heredado (legado): no se opera desde una jugada`);
    if (!prices[`${c.asset}USDT`]) throw new Error(`${c.asset} no tiene par USDT en Binance`);
  }
}


// FASE 3 · El punto de no retorno. Recibe lo que la fase 2 dejó encolado y lo
// escribe. No valida, no sale a la red y no puede fallar por causas externas:
// si algo iba a rechazar la jugada, ya la rechazó.
function confirmarJugada(cierresPendientes, aperturasPendientes) {
  for (const cerrar of cierresPendientes) cerrar();
  return aperturasPendientes.map(spec => abrirPosicion(spec));
}


// FASE 2a · Ventas. En memoria: el cierre en disco se encola para la fase 3.
// Las ventas NUNCA se bloquean por riesgo — poder salir no puede depender de un
// control, menos en una caída. Por eso viven aparte de las compras.
function aplicarVentas(vender, wallet, prices, { trades, cierresPendientes, avisos }) {
  for (const v of vender) {
    const precio = prices[`${v.asset}USDT`];
    const tenencia = wallet.sleeve?.[v.asset] ?? wallet.polvo?.[v.asset] ?? 0;
    if (!tenencia) { avisos.push(`Sin ${v.asset} en el sleeve: venta omitida`); continue; }
    const bolsillo = wallet.sleeve?.[v.asset] != null ? wallet.sleeve : wallet.polvo;
    const bruto = v.usdt != null ? Math.min(v.usdt, tenencia * precio) : tenencia * precio;
    const qty = bruto / precio;
    bolsillo[v.asset] -= qty;
    if (bolsillo[v.asset] * precio < 0.01) delete bolsillo[v.asset];
    wallet.reserva = Math.round((wallet.reserva + bruto * (1 - FEE)) * 100) / 100;
    trades.push({ accion: 'VENDER', asset: v.asset, qty, usdt: bruto, precio });
    // Venta completa → la posición se cierra. Venta PARCIAL → la posición se
    // REDUCE: cerrarla entera dejaba el resto en el sleeve sin stop ni
    // vigilancia (y cerrarPosicion cierra TODAS las abiertas del activo).
    const ventaTotal = v.usdt == null || bruto >= tenencia * precio - 0.01;
    cierresPendientes.push(ventaTotal
      ? () => cerrarPosicion(v.asset, 'jugada manual', precio)
      : () => reducirPosicion(v.asset, qty, precio));
  }
}

// INSTRUMENTACIÓN · El contexto del momento de decidir se captura acá o no se
// captura nunca. Falla en silencio a propósito: perder el registro de
// aprendizaje es malo, pero abortar una jugada YA EJECUTADA es peor. No es
// camino del dinero — por eso está fuera de él.
async function registrarContexto(comprar, posicionesNuevas, planes, nota, avisos) {
  for (const [i, c] of comprar.entries()) {
    const pos = posicionesNuevas.find(p => p.asset === c.asset);
    if (!pos) continue;
    try {
      const { contextoEntrada, registrarDecision } = await import('./aprendizaje.mjs');
      registrarDecision({
        asset: c.asset, posicionId: pos.id,
        tesis: c.tesis ?? nota ?? null,
        confianza: c.confianza ?? null,
        montoUSDT: pos.qty * pos.entrada / (1 - FEE),
        limitePct: pos.limitePct, objetivoPct: pos.objetivoPct,
        // si vienen de una oferta, son el score y la señal que la gatearon;
        // si no, registrarDecision los deriva del contexto y lo declara
        score: c.score ?? null, senal: c.senal ?? null,
        contexto: { ...(await contextoEntrada(c.asset)), volatilidadDiariaPct: planes[i].volatilidadDiariaPct },
      });
      if (c.tesis == null && nota == null) avisos.push(`${c.asset}: sin tesis registrada — el aprendizaje queda sin el "por qué"`);
    } catch (e) {
      avisos.push(`No se pudo registrar el contexto de aprendizaje de ${c.asset}: ${e.message}`);
    }
  }
}

export async function jugadaManual({ vender = [], comprar = [], nota, etiqueta, origen = 'dashboard' } = {}) {
  const sello = await versionMotor();

  validarEntrada([...vender, ...comprar]);

  // los activos de la jugada pueden no estar aún en la cartera: pedirlos igual
  const { prices } = await marketSnapshotLigero([...vender, ...comprar].map(c => c.asset));
  const wallet = loadWallet(prices);
  if (!wallet) throw new Error('No hay billetera ficticia');

  validarContraCartera([...vender, ...comprar], wallet, prices);

  const trades = [];
  const avisos = [];

  // NADA toca el disco hasta que todo esté validado.
  //
  // Antes las ventas cerraban posiciones (escritura inmediata) y recién después
  // se calculaban los stops de las compras — con una llamada a Binance en el
  // medio. Si esa llamada fallaba, quedaba la posición cerrada en disco y la
  // billetera sin escribir: el activo contado dos veces. Ahora los cierres y
  // las aperturas se encolan y se ejecutan al final, cuando ya no puede fallar
  // nada. La compuerta aprovecha lo mismo: puede rechazar sin dejar rastro.
  const cierresPendientes = [];
  const aperturasPendientes = [];

  // 1) ventas → reserva (en memoria; el cierre en disco queda encolado)
  aplicarVentas(vender, wallet, prices, { trades, cierresPendientes, avisos });

  // Los planes se calculan ANTES de tocar nada y una sola vez: la compuerta
  // tiene que juzgar EXACTAMENTE el plan que se va a ejecutar, no otro que una
  // segunda llamada a Binance devolvió con la volatilidad ya movida.
  const bajados = await enParalelo(comprar, c => stopsSugeridos(c.asset));
  // Acá el fallo SÍ aborta: sin niveles no hay plan que la compuerta pueda
  // juzgar, y ejecutar una compra a ciegas es exactamente lo que no se quiere.
  const malo = bajados.find(r => !r.ok);
  if (malo) throw malo.error;
  const planes = bajados.map(r => r.valor);

  // 2) compras ← reserva, con salidas dimensionadas por volatilidad.
  //
  // El gasto es EL PEDIDO, sin recortar. Antes se hacía min(pedido, reserva):
  // pedir 8 USDT con 6 disponibles compraba 6 en silencio — y como el monto ya
  // llegaba recortado, el bloqueo "reserva insuficiente" de la compuerta no
  // podía dispararse nunca por este camino. Un control que siempre dice OK no
  // controla nada: ahora el que juzga la reserva es la compuerta, con el monto
  // real, y si no alcanza la jugada rebota entera con el motivo a la vista.
  const posicionesNuevas = [];
  let riesgoDelLoteUSDT = 0;
  for (const [i, c] of comprar.entries()) {
    const precio = prices[`${c.asset}USDT`];
    const gasto = c.usdt;
    if (gasto < 5) avisos.push(`${c.asset}: ${gasto.toFixed(2)} USDT queda bajo el mínimo de orden real de Binance (~5 USDT)`);
    // los sugeridos sirven de vara aunque vengan niveles explícitos: un stop más
    // estrecho que la volatilidad se corta por ruido
    const sugeridos = planes[i];
    const niveles = (c.objetivoPct != null && c.limitePct != null)
      ? { objetivoPct: c.objetivoPct, limitePct: c.limitePct }
      : sugeridos;
    if (c.limitePct != null && c.limitePct > sugeridos.limitePct) {
      avisos.push(`${c.asset}: límite ${c.limitePct}% más estrecho que el sugerido por volatilidad (${sugeridos.limitePct}%) — riesgo de corte por ruido (lección GPS/ACE)`);
    }

    // COMPUERTA. Este camino iba DIRECTO al estado: el botón de jugada manual
    // se saltaba el freno de caída, el techo del sleeve, el tope de riesgo
    // abierto, el desvío de riesgo y el R:B mínimo. Cerrar el R:B en las
    // ofertas y dejarlo abierto acá era cerrar una puerta y no la de al lado.
    //
    // Se le pasa la billetera EN MEMORIA, con las ventas de esta misma jugada
    // ya aplicadas: si no, "vender A para comprar B" se bloquearía por reserva
    // insuficiente mirando el saldo de antes de la venta. Y como las compras
    // anteriores del mismo lote también están aplicadas, dos compras que solas
    // caben bajo el techo no pueden colarse juntas.
    // `riesgoExtraUSDT` lleva el riesgo de las compras anteriores de este mismo
    // lote: sus posiciones todavía no existen en disco y el tope del 5% de
    // riesgo abierto no las vería.
    const puerta = compuertaRiesgo({
      montoUSDT: gasto, limitePct: niveles.limitePct, objetivoPct: niveles.objetivoPct,
      volatilidadDiariaPct: sugeridos.volatilidadDiariaPct,
    }, prices, { wallet, riesgoExtraUSDT: riesgoDelLoteUSDT });
    if (!puerta.pasa) {
      throw Object.assign(new Error(`riesgo en ${c.asset}: ${puerta.bloqueos.join(' · ')}`), { codigo: 423 });
    }
    avisos.push(...puerta.avisos.map(a => `${c.asset}: ${a}`));
    riesgoDelLoteUSDT += gasto * Math.abs(niveles.limitePct ?? 0) / 100;

    const qty = (gasto * (1 - FEE)) / precio;
    wallet.reserva = Math.round((wallet.reserva - gasto) * 100) / 100;
    wallet.sleeve[c.asset] = (wallet.sleeve[c.asset] ?? 0) + qty;
    trades.push({ accion: 'COMPRAR', asset: c.asset, qty, usdt: gasto, precio });
    aperturasPendientes.push({
      asset: c.asset, qty, entrada: precio,
      objetivoPct: niveles.objetivoPct, limitePct: niveles.limitePct,
      volatilidadDiariaPct: sugeridos.volatilidadDiariaPct,
      // La invalidación viaja siempre desde los sugeridos, incluso con niveles
      // explícitos: es un hecho del mercado (dónde está el piso de 30 días), no
      // una preferencia de quien opera.
      invalidacionPct: c.invalidacionPct ?? sugeridos.invalidacionPct,
      // POLÍTICA DE SALIDA VIGENTE (v4a). Lo que pida la jugada manda —para eso
      // Jorge puede fijar un plazo o un trailing distinto en una jugada
      // puntual— pero el DEFECTO ya no es "objetivo fijo + lo que venga":
      // es la política medida.
      politicaSalida: c.politicaSalida ?? POLITICA_SALIDA.politicaSalida,
      trailPct: c.trailPct ?? POLITICA_SALIDA.trailPct,
      activarTrailEnPct: c.activarTrailEnPct ?? POLITICA_SALIDA.activarTrailEnPct,
      horizonte: c.horizonte,
      horizonteHoras: c.horizonteHoras ?? POLITICA_SALIDA.horizonteHoras,
      origen: etiqueta ?? 'jugada manual (Jorge)',
      version: sello,
    });
  }

  if (!trades.length) throw new Error('La jugada no generó operaciones');

  // --- PUNTO DE NO RETORNO ---------------------------------------------------
  // Todo lo de arriba fue en memoria y pudo abortar sin dejar rastro. De acá en
  // adelante ya no hay llamadas a la red ni validaciones: solo escritura.
  posicionesNuevas.push(...confirmarJugada(cierresPendientes, aperturasPendientes));

  // INSTRUMENTACIÓN: el contexto del momento de decidir se captura acá o no se
  // captura nunca. Falla en silencio a propósito — perder el registro de
  // aprendizaje es malo, pero abortar una jugada ya ejecutada es peor.
  await registrarContexto(comprar, posicionesNuevas, planes, nota, avisos);

  escribirJSON(WALLET_FILE, wallet);
  appendMovimientos(fechaLocal(), etiqueta ?? 'jugada manual (Jorge)', trades, 'jugada', origen, sello);

  const est = estadoSleeve(wallet, prices);
  if (est.excedente > 1) avisos.push(`El sleeve quedó en ${est.ocupacionPct.toFixed(0)}% (techo ${est.limitePct}%): ${est.excedente.toFixed(2)} USDT de excedente por cosechar`);

  const previo = lastRunPrevio();
  const sim = simSummary(wallet, prices);
  if (previo) {
    persistLastRun({
      ...previo,
      generadoA: new Date().toISOString(),
      sim,
      posiciones: evaluarPosiciones(prices),
      notaDelDia: nota ?? previo.notaDelDia,
    });
  }
  return { trades, posicionesNuevas, avisos, sim, sleeve: est };
}

// NIVEL 4 — Corte automático en la billetera FICTICIA. Vende a USDT (reserva)
// cuando una posición cruza su límite o alcanza su objetivo. Nunca toca dinero
// real: las órdenes reales siempre las ejecuta Jorge en Binance.
// --- RECONSTRUCCIÓN DE CIERRES ----------------------------------------------
//
// El monitor mira cada 3 min y muere con el equipo dormido. En los primeros 5
// días el sistema estuvo **95 h ciego de 120 (79%)**, con huecos de hasta 11 h
// de madrugada. Consecuencia medida: HEMI cerró en +46,1% con objetivo en +30%
// y ACE en -16,3% con stop en -12%. Al despertar, ejecutar al precio de AHORA
// registra dónde estaba el mercado al abrir los ojos, no dónde estaba cuando la
// regla se cumplió.
//
// Esto reconstruye el momento real del cruce desde las velas de 1 minuto y
// ejecuta a ESE nivel — lo que una orden OCO en Binance habría hecho sola.
//
// No es una licencia para inventar precios mejores: solo se usa cuando la vela
// confirma que el nivel se cruzó ANTES de esta revisión, y el precio de
// ejecución se acota al nivel (no al extremo de la mecha, que sería regalarse
// un relleno imposible).

const RECONSTRUCCION_MAX_H = 24;   // más atrás, las velas de 1m ya no están

// El pico alcanzado ANTES de un instante dado. Hace falta para reconstruir un
// trailing en posiciones más viejas que la ventana de reconstrucción: el máximo
// que armó el nivel pudo formarse antes de la primera vela que se mira.
//
// No sirve usar `p.picoDesdeApertura` como semilla: ése es el máximo de TODA la
// vida de la posición, y si el pico se hizo DESPUÉS del inicio de la ventana,
// sembrar con él pondría el nivel de trailing demasiado arriba desde el primer
// minuto y detectaría un cruce que en ese momento todavía no existía —
// inventando una venta a un precio que el mercado nunca disparó.
async function picoAntesDe(p, hasta) {
  const desde = Date.parse(p.abierto);
  if (hasta <= desde) return 0;
  const horas = Math.ceil((hasta - desde) / 3_600_000) + 1;
  const k = await pub('/api/v3/klines', {
    symbol: `${p.asset}USDT`, interval: '1h',
    startTime: desde, limit: Math.min(1000, Math.max(2, horas)),
  });
  const previas = k.filter(v => Number(v[0]) < hasta).map(v => parseFloat(v[2]));
  return previas.length ? Math.max(...previas) : 0;
}

async function reconstruirCruce(p, senal) {
  const desde = Date.parse(p.plazoDesde ?? p.abierto);
  const inicio = Math.max(desde, Date.now() - RECONSTRUCCION_MAX_H * 3_600_000);
  const minutos = Math.ceil((Date.now() - inicio) / 60_000);
  if (minutos < 5) return null;   // sin hueco que reconstruir

  // NIVEL FIJO vs NIVEL MÓVIL. Hasta acá esto buscaba siempre el stop ORIGINAL,
  // y con la política v4a —donde el trailing ES la salida principal— eso dejó
  // de reconstruir el caso más común: una posición con pico en +30% y trailing
  // en +17% que de madrugada cae a +5% cruzaba su trailing, pero acá se buscaba
  // el cruce de −8%, nunca se encontraba, y se vendía al precio del despertar.
  // Doce puntos perdidos, justo la ventaja que la política venía a capturar.
  const conTrail = senal === 'cruzo-limite' && p.trailPct != null;
  const nivelFijo = senal === 'cruzo-limite'
    ? p.entrada * (1 + p.limitePct / 100)
    : p.entrada * (1 + p.objetivoPct / 100);
  const umbralArmado = p.activarTrailEnPct != null
    ? p.entrada * (1 + p.activarTrailEnPct / 100) : 0;

  const velas = await pub('/api/v3/klines', {
    symbol: `${p.asset}USDT`, interval: '1m',
    startTime: inicio, limit: Math.min(1000, minutos + 2),
  });
  if (!velas.length) return null;

  // El pico solo se pide si la ventana no cubre la vida entera de la posición.
  let pico = conTrail && inicio > desde ? await picoAntesDe(p, inicio) : 0;

  for (const v of velas) {
    const alto = parseFloat(v[2]), bajo = parseFloat(v[3]);
    // El nivel del trailing es el de ESTE minuto, con el pico acumulado hasta
    // el minuto anterior: incorporar el máximo de la vela en curso y además
    // cortar con su mínimo sería asumir que el alto vino primero.
    let nivel = nivelFijo;
    if (conTrail && pico >= umbralArmado && pico > 0) {
      // solo aprieta, nunca ensancha: la misma regla que en evaluarNiveles
      nivel = Math.max(nivelFijo, pico * (1 - p.trailPct / 100));
    }
    const cruzo = senal === 'cruzo-limite' ? bajo <= nivel : alto >= nivel;
    if (cruzo) {
      const cuando = Number(v[0]);
      // Solo cuenta si el cruce fue ANTES de esta revisión con margen: si
      // ocurrió recién, el precio de ahora ya es el correcto.
      if (Date.now() - cuando < 4 * 60_000) return null;
      return {
        precio: nivel,               // se ejecuta EN el nivel, no en la mecha
        cuando: new Date(cuando).toISOString(),
        minutosTarde: Math.round((Date.now() - cuando) / 60_000),
      };
    }
    if (conTrail) pico = Math.max(pico, alto);
  }
  return null;
}

// Recalcula el máximo alcanzado desde la apertura para las posiciones con
// trailing. De VELAS, no de precios observados: con el equipo dormido el 95%
// del tiempo, un pico acumulado tick a tick sería el máximo de lo que alguien
// alcanzó a mirar, y el trailing protegería una ganancia que no existió.
// Es la misma lección que la reconstrucción de cierres.
//
// Falla hacia el comportamiento anterior: sin velas, el pico se queda como
// estaba y manda el stop original.
async function refrescarPicos() {
  const data = readPosiciones();
  const conTrail = data.posiciones.filter(p => p.estado === 'abierta' && p.trailPct != null);
  if (!conTrail.length) return;

  const bajadas = await enParalelo(conTrail, async p => {
    const horas = Math.ceil((Date.now() - Date.parse(p.abierto)) / 3_600_000) + 2;
    const k = await pub('/api/v3/klines', {
      symbol: `${p.asset}USDT`, interval: '1h', limit: Math.min(1000, Math.max(2, horas)),
    });
    return Math.max(...k.map(v => parseFloat(v[2])));
  });

  let cambio = false;
  bajadas.forEach((r, i) => {
    if (!r.ok || !(r.valor > 0)) return;
    // el pico solo sube: si una vela vieja se cae del rango pedido, no se pierde
    const previo = conTrail[i].picoDesdeApertura ?? 0;
    if (r.valor > previo) { conTrail[i].picoDesdeApertura = r.valor; cambio = true; }
  });
  if (cambio) writePosiciones(data);
}

// Pone o quita el trailing de una posición ya abierta. `pct` = cuánto puede
// devolverse desde el pico antes de salir; null lo desactiva.
export function fijarTrailing(ids, pct) {
  if (pct != null && (!Number.isFinite(pct) || pct <= 0 || pct >= 90)) {
    throw Object.assign(new Error('el trailing debe ser un porcentaje entre 0 y 90'), { codigo: 400 });
  }
  const data = readPosiciones();
  const tocadas = [];
  for (const p of data.posiciones) {
    if (!ids.includes(p.id) || p.estado !== 'abierta') continue;
    p.trailPct = pct;
    if (pct == null) delete p.picoDesdeApertura;
    tocadas.push(p.id);
  }
  if (tocadas.length) writePosiciones(data);
  return { tocadas };
}

export async function ejecutarStops({ dryRun = false, reconstruir = true } = {}) {
  const selloStops = await versionMotor();
  const { prices } = await marketSnapshotLigero();
  if (!dryRun) await refrescarPicos();
  const evaluadas = evaluarPosiciones(prices);
  const wallet = loadWallet(prices);
  const ejecutados = [];
  if (!wallet) return { ejecutados, evaluadas };

  const SENALES_CIERRE = new Set(['cruzo-limite', 'cruzo-objetivo', 'vencido-sin-renta']);
  for (const p of evaluadas) {
    if (!SENALES_CIERRE.has(p.senal)) continue;
    const disponible = wallet.sleeve?.[p.asset] ?? wallet.holdings?.[p.asset];
    if (!disponible) {
      if (!dryRun) cerrarPosicion(p.asset, 'sin saldo en la ficticia', p.precio);
      continue;
    }
    // Reconstrucción: si el nivel se cruzó mientras nadie miraba, se ejecuta a
    // ESE nivel y no al precio de ahora. Falla hacia el comportamiento anterior.
    let recon = null;
    if (reconstruir && (p.senal === 'cruzo-limite' || p.senal === 'cruzo-objetivo')) {
      try { recon = await reconstruirCruce(p, p.senal); }
      catch (e) { console.error(`reconstrucción ${p.asset}: ${e.message}`); }
    }
    const precioSalida = recon?.precio ?? p.precio;
    const pnlPctReal = (precioSalida / p.entrada - 1) * 100;

    const qty = Math.min(disponible, p.qty);
    const bruto = qty * precioSalida;
    const neto = bruto * (1 - FEE);
    const esStop = p.senal === 'cruzo-limite';
    const esVencido = p.senal === 'vencido-sin-renta';

    // INVALIDACIÓN ESTRUCTURAL. No es una salida propia: el stop vive justo
    // debajo del soporte, así que quien corta es siempre él. Lo que la
    // invalidación decide es CÓMO SE LEE ese cierre.
    //
    // (Acá me aparto del dibujo del póster, que pone el stop por encima de la
    // invalidación. Un stop por encima del soporte se barre en cada toque del
    // soporte, que es exactamente lo que un soporte hace. El stop va debajo; lo
    // que la invalidación aporta es la lectura, no otro nivel de salida.)
    //
    // Si el precio de salida quedó bajo el piso de 30 días, la estructura se
    // rompió: el setup no era válido y el activo no debe poder reproponerse
    // mañana. Se marca como corte (`stop`) para que la cuarentena lo tome —
    // incluso cuando salió por plazo, que si no quedaría fuera del veto.
    const nivelInvalidacion = p.invalidacionPct != null
      ? p.entrada * (1 + p.invalidacionPct / 100) : null;
    const invalidada = nivelInvalidacion != null && precioSalida <= nivelInvalidacion;

    const categoria = (esStop || invalidada) ? 'stop' : esVencido ? 'horizonte' : 'objetivo';
    const nota = recon ? ` [reconstruido: cruzó hace ${recon.minutosTarde} min]` : '';
    const detalle = {
      asset: p.asset, qty, precio: precioSalida, brutoUSDT: bruto, netoUSDT: neto,
      entrada: p.entrada, pnlPct: pnlPctReal, pnlUSDT: qty * (precioSalida - p.entrada),
      precioAlDetectar: p.precio,
      reconstruido: recon ? { cuando: recon.cuando, minutosTarde: recon.minutosTarde, precioAhora: p.precio } : null,
      invalidada,
      tipo: (esStop ? 'stop (límite)' : esVencido ? `horizonte vencido (${p.horizonteHoras}h sin rentar)` : 'objetivo (toma de ganancia)')
        + (invalidada ? ' · estructura rota: a cuarentena' : ''),
    };
    ejecutados.push(detalle);
    if (dryRun) continue;

    const bolsillo = wallet.sleeve?.[p.asset] != null ? wallet.sleeve : wallet.holdings;
    bolsillo[p.asset] -= qty;
    if ((bolsillo[p.asset] ?? 0) * precioSalida < 0.01) delete bolsillo[p.asset];
    if (wallet.reserva != null) wallet.reserva = Math.round((wallet.reserva + neto) * 100) / 100;
    else wallet.cashUSDT = Math.round((wallet.cashUSDT + neto) * 100) / 100;

    appendMovimientos(fechaLocal(),
      `auto-${categoria}: ${p.asset} ${pnlPctReal >= 0 ? '+' : ''}${pnlPctReal.toFixed(1)}% → reserva USDT${nota}`,
      [{ accion: 'VENDER', asset: p.asset, qty, usdt: bruto, precio: precioSalida }],
      categoria, 'motor', selloStops);
    cerrarPosicion(p.asset, detalle.tipo, precioSalida);
    appendFileSync(ALERTAS_FILE, JSON.stringify({
      ts: new Date().toISOString(), asset: p.asset, senal: p.senal, precio: precioSalida,
      entrada: p.entrada, pnlPct: pnlPctReal, abierto: p.abierto, ejecutado: true,
      reconstruido: detalle.reconstruido,
      texto: esVencido
        ? `HORIZONTE VENCIDO: ${p.asset} liquidada a ${precioSalida} tras ${p.horizonteHoras}h sin rentar (${pnlPctReal.toFixed(1)}%) → ${neto.toFixed(2)} USDT a reserva`
        : `AUTO-${esStop ? 'STOP' : 'OBJETIVO'} ejecutado: ${p.asset} vendida a ${precioSalida} (${pnlPctReal.toFixed(1)}%)${nota} → ${neto.toFixed(2)} USDT a reserva`,
    }) + '\n');
  }

  if (!dryRun && ejecutados.length) {
    escribirJSON(WALLET_FILE, wallet);
    // refleja el nuevo estado en el dashboard sin esperar al próximo refresco
    const previo = lastRunPrevio();
    if (previo) {
      persistLastRun({
        ...previo,
        generadoA: new Date().toISOString(),
        sim: simSummary(wallet, prices),
        posiciones: evaluarPosiciones(prices),
        recomendaciones: previo.recomendaciones ?? [],
      });
    }
  }
  return { ejecutados, evaluadas };
}

// Días desde que un activo fue cortado por límite de salida (null si nunca).
function diasDesdeCorte(asset) {
  let ultimo = null;
  for (const ev of readMovimientos()) {
    // eventos nuevos traen categoria; los viejos se reconocen por el texto
    const esCorte = ev.categoria
      ? ev.categoria === 'stop'
      : /corte por límite|auto-stop/i.test(ev.tipo);
    if (!esCorte) continue;
    if (ev.operaciones.some(o => o.asset === asset)) ultimo = ev.ts;
  }
  if (!ultimo) return null;
  return Math.floor((Date.now() - new Date(ultimo)) / 86400000);
}

// ¿Está vetado por cuarentena? (cortado por stop hace ≤ CUARENTENA_DIAS)
export function enCuarentena(asset) {
  const d = diasDesdeCorte(asset);
  return d !== null && d <= CUARENTENA_DIAS;
}

// Evalúa el impacto de una propuesta y levanta avisos ANTES de aplicarla:
// posiciones principales (ancla de facto), reserva USDT, stops abiertos y
// recompra de activos cortados recientemente (cuarentena).
const CUARENTENA_DIAS = 3;
const UMBRAL_ANCLA_PCT = 25; // una posición ≥25% del capital se trata como ancla

function evaluarPropuesta(trades, wallet, prices, salidas) {
  const est = estadoSleeve(wallet, prices);
  const ventas = trades.filter(t => t.accion === 'VENDER');
  const compras = trades.filter(t => t.accion === 'COMPRAR');
  const movido = ventas.reduce((a, t) => a + t.usdt, 0);
  const avisos = [];

  // el ancla y la reserva ya no son vulnerables por diseño: los avisos ahora
  // cubren lo que sí puede salir mal dentro del bolsillo táctico.
  for (const v of ventas) {
    const stop = salidas.find(s => s.asset === v.asset);
    if (stop) {
      avisos.push({ nivel: 'alto', texto: `Cierra ${v.asset}, que tiene salida programada vigente (objetivo +${stop.objetivoPct}% / límite ${stop.limitePct}%).` });
    }
    if (wallet.ancla?.[v.asset]) {
      avisos.push({ nivel: 'alto', texto: `INESPERADO: la propuesta toca ${v.asset}, que está en el ancla. Revisar el motor.` });
    }
    if (wallet.legado?.[v.asset]) {
      avisos.push({ nivel: 'alto', texto: `INESPERADO: la propuesta toca ${v.asset}, que es capital heredado (legado). Revisar el motor.` });
    }
  }
  for (const c of compras) {
    const dias = diasDesdeCorte(c.asset);
    if (dias !== null && dias <= CUARENTENA_DIAS) {
      avisos.push({ nivel: 'alto', texto: `Recompra ${c.asset}, que fue cortada por límite de salida hace ${dias === 0 ? 'menos de un día' : dias + ' día(s)'} (cuarentena de ${CUARENTENA_DIAS} días).` });
    }
    if (c.usdt < 5) {
      avisos.push({ nivel: 'medio', texto: `La compra de ${c.asset} (${c.usdt.toFixed(2)} USDT) queda bajo el mínimo de orden de Binance (~5 USDT): en real no sería ejecutable.` });
    }
  }
  if (est.excedente > 1) {
    avisos.push({ nivel: 'medio', texto: `El sleeve está en ${est.ocupacionPct.toFixed(0)}% del capital, sobre su techo de ${est.limitePct}% — hay ${est.excedente.toFixed(2)} USDT de excedente que la propuesta cosecha a reserva.` });
  }
  if (movido > est.presupuesto * 1.5) {
    avisos.push({ nivel: 'medio', texto: `Rota ${movido.toFixed(2)} USDT, más de 1,5× el presupuesto del sleeve (comisiones ≈ ${(movido * FEE * 2).toFixed(2)} USDT).` });
  }

  return {
    operaciones: trades,
    movidoUSDT: movido,
    movidoPct: est.total > 0 ? (movido / est.total) * 100 : 0,
    comisionesEstimadas: movido * FEE * 2,
    sleeve: est,
    avisos,
  };
}

// Aplica la propuesta vigente a la billetera ficticia. Acto EXPLÍCITO de Jorge.
export async function aplicarPlan() {
  const previo = lastRunPrevio();
  if (!previo?.picks?.length) throw new Error('No hay propuesta vigente: ejecuta primero un análisis');
  const hoy = fechaLocal();
  const { prices, stats } = await marketSnapshot();
  const wallet = loadWallet(prices);
  if (!wallet) throw new Error('No hay billetera ficticia');
  // Los avisos se recalculan CON LOS PRECIOS DE AHORA sobre una copia: entre el
  // análisis y el "aplicar" pueden haber pasado horas (posiciones nuevas, una
  // cuarentena recién abierta). Aprobar viendo unos avisos y ejecutar otros es
  // el riesgo más caro del sistema, así que un aviso alto nuevo lo detiene.
  const previos = new Set((previo.propuesta?.avisos ?? []).map(a => a.texto));
  const ranurasPrevias = previo.ranuras ?? previo.picks.length;
  const revalidada = evaluarPropuesta(
    rebalance(structuredClone(wallet), previo.picks, prices, ranurasPrevias), wallet, prices, previo.salidas ?? []);
  const nuevosAltos = revalidada.avisos.filter(a => a.nivel === 'alto' && !previos.has(a.texto));
  if (nuevosAltos.length) {
    throw Object.assign(new Error(
      'La propuesta cambió desde que la revisaste: ' + nuevosAltos.map(a => a.texto).join(' · ') +
      ' — ejecuta el análisis de nuevo para verla actualizada.'), { codigo: 409 });
  }

  const trades = rebalance(wallet, previo.picks, prices, ranurasPrevias);
  if (!trades.length) throw new Error('La propuesta no genera operaciones (el portafolio ya está alineado)');

  appendMovimientos(hoy, `plan del modelo v2d (30d + semanal) aplicado (picks: ${previo.picks.join(', ')})`, trades, 'plan', 'dashboard', await versionMotor());
  wallet.lastRun = hoy;
  wallet.ultimoRebalanceo = new Date().toISOString();   // arranca la cadencia de 7 días
  escribirJSON(WALLET_FILE, wallet);

  const env = loadEnv();
  const hayKeys = Boolean(env.BINANCE_API_KEY && env.BINANCE_API_SECRET);
  let real = null, realError = null;
  if (hayKeys) {
    try { real = await realWalletValue(env, prices); } catch (e) { realError = e.message; }
  }
  if (!real) real = snapshotWalletValue(prices);

  const sim = simSummary(wallet, prices);
  appendSnapshot(wallet, sim.valor, real, prices);

  const result = {
    ...previo,
    generadoA: new Date().toISOString(),
    planGeneradoA: new Date().toISOString(),
    aplicado: true,
    propuesta: null,
    recomendaciones: trades,
    // Los stops de posiciones ya cerradas dejan de existir. Se filtra contra
    // TODOS los bolsillos (holdingsPlanos): la billetera migrada no tiene la
    // clave `holdings`, y `wallet.holdings[...]` reventaba acá con la wallet
    // ya escrita — el estado quedaba a medio actualizar.
    salidas: (previo.salidas ?? []).filter(s => holdingsPlanos(wallet)[s.asset]),
    notaDelDia: `Plan del modelo v2d aplicado por Jorge: ${trades.length} operaciones, picks ${previo.picks.join(', ')}.`,
    sim,
    real: real ? { total: real.total, detalle: real.detalle, fuente: real.fuente, actualizado: real.actualizado, billeteras: real.billeteras ?? null } : null,
    realError,
    conectadoBinance: hayKeys,
    btcUSDT: prices.BTCUSDT,
    cambios24h: cambios24hPara(activosEnCartera(wallet, real), stats),
    posiciones: evaluarPosiciones(prices),
    sleeveRendimiento: await rendimientoSleeve(prices),
    riesgo: riesgoAbierto(prices, sim.valor),
    estadistica: estadisticaJugadas(),
    comisiones: comisionesPagadas(),
    cierres: cierres(),
    historia: readHistory(),
    snapshots: readSnapshots(),
    movimientos: readMovimientos(),
    alertas: getAlertas(),
  };
  persistLastRun(result);
  return result;
}

// Persiste el último análisis SIN historia/snapshots embebidos: esos datos ya
// viven en history.csv y snapshots.jsonl — duplicarlos inflaba el archivo.
function persistLastRun(result) {
  const { historia, snapshots, ...slim } = result;
  escribirJSON(LASTRUN_FILE, slim);
}

function simSummary(wallet, prices) {
  const simValue = walletValue(wallet, prices);
  // Un bolsillo presente en los DATOS pero no declarado en BOLSILLOS es el
  // único camino que queda para perder plata de vista. Se calcula acá, una vez,
  // y lo consumen el dashboard, el bot y los tests — en vez de que cada uno
  // rearme su propia comprobación (que es el mismo error un nivel más arriba).
  const noDeclarados = bolsillosNoDeclarados(wallet);
  const planos = holdingsPlanos(wallet);
  const clavesBolsillo = [...BOLSILLOS, ...bolsillosNoDeclarados(wallet)];
  const bolsilloDe = a => clavesBolsillo.find(k => wallet[k]?.[a]) ?? 'polvo';
  const holdings = Object.entries(planos).map(([asset, qty]) => ({
    asset,
    qty,
    usdt: qty * (prices[`${asset}USDT`] ?? 0),
    bolsillo: bolsilloDe(asset),
  })).sort((a, b) => b.usdt - a.usdt);
  const est = estadoSleeve(wallet, prices);
  return {
    valor: simValue,
    cash: Math.max(0, wallet.reserva ?? wallet.cashUSDT ?? 0),
    holdings,
    capitalInicial: wallet.capitalInicial,
    rendimientoPct: (simValue / wallet.capitalInicial - 1) * 100,
    desde: wallet.createdAt,
    bolsillos: {
      // valores derivados de la lista única: agregar un bolsillo lo hace
      // aparecer acá, en el dashboard y en el bot sin tocar nada más
      ...Object.fromEntries(BOLSILLOS.map(b => [b, valorDe(wallet[b], prices)])),
      ...Object.fromEntries(noDeclarados.map(b => [b, valorDe(wallet[b], prices)])),
      reserva: wallet.reserva ?? 0,
      sleeveLimitePct: est.limitePct,
      sleevePresupuesto: est.presupuesto,
      sleeveOcupacionPct: est.ocupacionPct,
      sleeveExcedente: est.excedente,
      sleeveDisponible: est.disponible,
    },
    // lista ordenada y explícita: el front la recorre en vez de nombrar bolsillos
    bolsillosDetalle: [...BOLSILLOS, ...noDeclarados]
      .map(clave => ({ clave, usdt: valorDe(wallet[clave], prices), declarado: BOLSILLOS.includes(clave) }))
      .concat([{ clave: 'reserva', usdt: wallet.reserva ?? 0, declarado: true }]),
    bolsillosNoDeclarados: noDeclarados.length
      ? { claves: noDeclarados, usdt: noDeclarados.reduce((a, k) => a + valorDe(wallet[k], prices), 0) }
      : null,
  };
}

// Refresco liviano: actualiza precios y valor de ambas billeteras SIN recalcular
// la estrategia ni rebalancear. Registra un punto en la serie intradía.
export async function refreshMarket() {
  if (!existsSync(LASTRUN_FILE)) throw new Error('Ejecuta primero un análisis completo');
  const lastRun = leerJSON(LASTRUN_FILE);
  const env = loadEnv();
  const hayKeys = Boolean(env.BINANCE_API_KEY && env.BINANCE_API_SECRET);

  const { prices, stats } = await marketSnapshotLigero();

  let real = null;
  let realError = null;
  if (hayKeys) {
    try {
      real = await realWalletValue(env, prices);
    } catch (e) {
      realError = e.message;
    }
  }
  if (!real) real = snapshotWalletValue(prices);

  const wallet = loadWallet(prices);
  let sim = lastRun.sim;
  if (wallet) {
    sim = simSummary(wallet, prices);
    appendSnapshot(wallet, sim.valor, real, prices);
    // el punto del día refleja siempre la última medición conocida
    upsertHistoria(fechaLocal(), sim.valor, real?.total, prices.BTCUSDT, lastRun.picks ?? []);
  }

  const result = {
    ...lastRun,
    generadoA: new Date().toISOString(),
    refresco: true,
    sim,
    real: real ? { total: real.total, detalle: real.detalle, fuente: real.fuente, actualizado: real.actualizado, billeteras: real.billeteras ?? null } : null,
    realError,
    conectadoBinance: hayKeys,
    btcUSDT: prices.BTCUSDT,
    cambios24h: cambios24hPara(activosEnCartera(wallet, real), stats),
    posiciones: evaluarPosiciones(prices),
    sleeveRendimiento: await rendimientoSleeve(prices),
    riesgo: riesgoAbierto(prices, sim.valor),
    estadistica: estadisticaJugadas(),
    comisiones: comisionesPagadas(),
    cierres: cierres(),
    historia: readHistory(),
    snapshots: readSnapshots(),
    movimientos: readMovimientos(),
    alertas: getAlertas(),
  };
  persistLastRun(result);
  return result;
}

// Historia de precios de las criptos principales del mercado (7 días, velas 4h).
const MAJORS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
let _mktCache = { t: 0, data: null };

// --- RADAR 24 H --------------------------------------------------------------
//
// Qué se mueve HOY entre las monedas de más volumen, y cuánto se puede mover en
// las próximas 24 h.
//
// LA COLUMNA QUE NO ESTÁ, Y POR QUÉ. Jorge pidió un "profit": si va a ganar o
// perder en las próximas 24 h. Se probó antes de construirlo, con 1.000 velas
// horarias de las 13 monedas de mayor volumen (~2.000 casos por señal):
//
//   señal                       acierto   retorno medio 24 h
//   momentum 6h                  48,3%         +0,375%
//   momentum 24h                 50,0%         +0,703%
//   reversión 24h                49,1%         −0,703%
//   posición en el rango 24h     51,5%         +0,588%
//   volumen relativo             50,5%         −0,126%
//   ─────────────────────────────────────────────────────
//   comprar cualquier cosa       51,1%         +0,893%
//
// **Ninguna le gana a comprar al azar.** Una flecha de dirección a 24 h sería
// un número inventado con cara de dato — y el riesgo no es que falle, es que
// se le crea. Así que no se muestra.
//
// Lo que SÍ se puede medir es la MAGNITUD, y está calibrada: la desviación de
// los retornos horarios × √24 contiene el 68,5% de los movimientos reales a
// 24 h, contra 68% teórico (n=2.015). Las colas son más gordas que la normal
// (89,8% dentro de ±2σ contra 95% teórico), y por eso la banda se declara como
// "2 de cada 3 veces", no como un techo.
const RADAR24_TOP = 12;

export async function radar24h(n = RADAR24_TOP) {
  const tickers = await pub('/api/v3/ticker/24hr');
  const candidatos = tickers
    .filter(t => t.symbol.endsWith('USDT'))
    .map(t => ({ ...t, asset: t.symbol.slice(0, -4) }))
    .filter(t => !STABLES.has(t.asset) && !TOKENIZADOS.has(t.asset))
    .filter(t => !/(UP|DOWN|BULL|BEAR)$/.test(t.asset))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, n);

  // 25 velas horarias alcanzan para 24 retornos. En paralelo acotado.
  const velas = await enParalelo(candidatos,
    t => pub('/api/v3/klines', { symbol: t.symbol, interval: '1h', limit: 25 }));

  const filas = candidatos.map((t, i) => {
    const precio = parseFloat(t.lastPrice);
    const fila = {
      asset: t.asset,
      precio,
      cambio24hPct: parseFloat(t.priceChangePercent),
      volumen24hM: Number((parseFloat(t.quoteVolume) / 1e6).toFixed(1)),
      recorridoPct: null, rangoMin: null, rangoMax: null,
      posicionRango: null, sinDatos: true,
    };
    if (!velas[i].ok) return fila;

    const k = velas[i].valor;
    const cierres = k.map(x => parseFloat(x[4]));
    const rets = [];
    for (let j = 1; j < cierres.length; j++) rets.push(Math.log(cierres[j] / cierres[j - 1]));
    if (rets.length < 12) return fila;

    const media = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sigma = Math.sqrt(rets.reduce((a, r) => a + (r - media) ** 2, 0) / rets.length) * Math.sqrt(24);

    // Dónde está el precio dentro del rango del día: 0 = en el mínimo,
    // 100 = en el máximo. Es un HECHO del día, no un pronóstico.
    const alto = Math.max(...k.map(x => parseFloat(x[2])));
    const bajo = Math.min(...k.map(x => parseFloat(x[3])));

    return {
      ...fila,
      sinDatos: false,
      recorridoPct: Number((sigma * 100).toFixed(1)),
      rangoMin: Number((precio * Math.exp(-sigma)).toPrecision(6)),
      rangoMax: Number((precio * Math.exp(sigma)).toPrecision(6)),
      posicionRango: alto > bajo ? Number((((precio - bajo) / (alto - bajo)) * 100).toFixed(0)) : null,
      // Lo mismo en plata, que es como se lee de verdad: cuánto se mueve una
      // posición del tamaño que usa este proyecto.
      recorridoUSDT: Number((MONTO_MINIMO_USDT * sigma).toFixed(2)),
    };
  });

  return {
    generadoA: new Date().toISOString(),
    montoReferenciaUSDT: MONTO_MINIMO_USDT,
    filas,
  };
}

export async function marketHistory() {
  if (_mktCache.data && Date.now() - _mktCache.t < 5 * 60_000) return _mktCache.data;
  const series = {};
  const bajadas = await enParalelo(MAJORS, sym => pub('/api/v3/klines', { symbol: sym, interval: '4h', limit: 42 }));
  for (const [i, r] of bajadas.entries()) {
    const sym = MAJORS[i];
    // Si una de las principales falla, el gráfico se dibuja con las demás.
    if (!r.ok) { console.error(`marketHistory ${sym}: ${r.error.message} — serie omitida`); continue; }
    series[sym.slice(0, -4)] = r.valor.map(k => ({ ts: k[0], close: parseFloat(k[4]) }));
  }
  if (Object.keys(series).length) _mktCache = { t: Date.now(), data: series };
  return series;
}

export async function runAnalysis() {
  const hoy = fechaLocal();
  const env = loadEnv();
  const hayKeys = Boolean(env.BINANCE_API_KEY && env.BINANCE_API_SECRET);

  const { prices, candidatos, stats } = await marketSnapshot();

  let real = null;
  let realError = null;
  if (hayKeys) {
    try {
      real = await realWalletValue(env, prices);
    } catch (e) {
      realError = e.message;
    }
  }
  if (!real) real = snapshotWalletValue(prices);

  let wallet = loadWallet(prices);
  if (!wallet) {
    if (real) {
      // la billetera ficticia nace como copia exacta de la real: mismas monedas, mismo total
      const holdings = {};
      let cash = 0;
      for (const d of real.detalle) {
        if (STABLES_USD.has(d.asset)) cash += d.usdt;
        else holdings[d.asset] = d.qty;
      }
      // lastRun = hoy: el primer día la ficticia queda idéntica a la real;
      // la estrategia empieza a operar recién en el próximo rebalanceo diario.
      wallet = migrarWallet({ createdAt: hoy, capitalInicial: real.total, cashUSDT: cash, holdings, lastRun: hoy }, prices);
    } else {
      // se creaba sin `legado`: la inconsistencia que la lista única elimina
      wallet = { createdAt: hoy, capitalInicial: CAPITAL_INICIAL, limiteSleevePct: LIMITE_SLEEVE_PCT,
                 ...Object.fromEntries(BOLSILLOS.map(b => [b, {}])),
                 reserva: CAPITAL_INICIAL, lastRun: null };
    }
    escribirJSON(WALLET_FILE, wallet);
  }

  // `scored` alimenta el radar (`mercado`, usado por el screening de
  // aprendizaje.mjs) y SIEMPRE se recalcula fresco — solo `picks`, la
  // selección del modelo codificado, sigue la cadencia semanal.
  const scored = [];
  // De a 6 a la vez en vez de uno por uno: son 30 candidatos x 2 llamadas de
  // velas, el grueso de lo que tarda el análisis. `enParalelo` conserva el
  // orden de entrada, así que `scored` queda idéntico a como lo dejaba el
  // bucle secuencial y el ranking no cambia.
  const medidos = await enParalelo(candidatos, t => momentumModelo(t.symbol));
  for (const [i, r] of medidos.entries()) {
    const t = candidatos[i];
    // Un símbolo caído (delistado, suspendido, error de API) se omite:
    // nunca debe tumbar el análisis completo.
    if (!r.ok) {
      console.error(`momentumModelo ${t.symbol}: ${r.error.message} — candidato omitido`);
      continue;
    }
    const m = r.valor;
    if (m === null) continue;
    scored.push({
      asset: t.symbol.slice(0, -4),
      momentum: m.momentum,
      tendencia: m.tendencia,
      rsi14d: m.rsi14d,
      precio: parseFloat(t.lastPrice),
      cambio24h: parseFloat(t.priceChangePercent) / 100,
      volumen24h: parseFloat(t.quoteVolume),
    });
  }
  scored.sort((a, b) => b.momentum - a.momentum);

  // Cadencia semanal (v2d): dentro de los 7 días del último rebalanceo
  // aplicado, la propuesta reusa los mismos picks. Recalcularlos en cada
  // corrida era la mitad del problema: la ventana de 30d ya no premia el
  // ruido de un día, pero si además se vuelve a rankear a cada rato, un pick
  // recién entrado nunca llega a rentar antes de que otro lo reemplace.
  const diasDesdeRebalanceo = wallet.ultimoRebalanceo
    ? (Date.now() - Date.parse(wallet.ultimoRebalanceo)) / 86_400_000 : Infinity;
  const picksPrevios = lastRunPrevio()?.picks;
  const dentroDeLaSemana = diasDesdeRebalanceo < REBALANCEO_CADA_DIAS && picksPrevios?.length;
  // La cuarentena veta ANTES del ranking: un pick incomprable es un pick
  // perdido. Y también veta los picks CONGELADOS en cada corrida: si uno se
  // corta por stop a mitad de semana, la propuesta seguía recomendándolo
  // durante días porque el veto solo se aplicaba al recalcular.
  //
  // Un pick vetado NO se reemplaza: se queda en dos. La cadencia semanal existe
  // para no rotar por impulso, así que buscar sustituto a mitad de semana sería
  // recalcular por la puerta de atrás. Su parte del presupuesto queda libre
  // hasta el próximo rebalanceo (el sleeve tolera estar por debajo del techo;
  // lo que no tolera es pasarse).
  const picks = dentroDeLaSemana
    ? picksPrevios.filter(a => !enCuarentena(a))
    : scored.filter(s => s.momentum > 0).filter(s => !enCuarentena(s.asset)).slice(0, PICKS).map(s => s.asset);
  const vetadosEstaSemana = dentroDeLaSemana ? picksPrevios.filter(a => enCuarentena(a)) : [];
  if (vetadosEstaSemana.length) {
    console.log(`[MODELO] ${vetadosEstaSemana.join(', ')} en cuarentena: fuera de los picks sin reemplazo hasta el próximo rebalanceo`);
  }
  // Las ranuras son las de la semana, no las que sobrevivieron al veto.
  const ranuras = dentroDeLaSemana ? picksPrevios.length : picks.length;

  // Si el veto se llevó TODOS los picks de la semana, no se propone nada. Con
  // la lista vacía el rebalanceo vendería el sleeve completo a reserva, y una
  // cuarentena dice "no vuelvas a comprar esto", no "liquida lo que tienes".
  // Sin momentum positivo sí es refugio en USDT — pero eso es otra cosa y llega
  // por el camino del recálculo, no por acá.
  const vetoVacioLaSemana = dentroDeLaSemana && !picks.length && picksPrevios.length > 0;

  // El análisis NUNCA aplica: siempre es una PROPUESTA sobre una copia.
  // Aplicarla es un acto explícito de Jorge (POST /api/aplicar-plan).
  const trades = vetoVacioLaSemana ? [] : rebalance(structuredClone(wallet), picks, prices, ranuras);
  const salidasVigentes = lastRunPrevio()?.salidas ?? [];
  const propuesta = evaluarPropuesta(trades, wallet, prices, salidasVigentes);

  // el punto diario del historial es una medición, no una operación
  upsertHistoria(hoy, walletValue(wallet, prices), real?.total, prices.BTCUSDT, picks);

  const simValue = walletValue(wallet, prices);

  appendSnapshot(wallet, simValue, real, prices);

  const previo = lastRunPrevio();
  const result = {
    fecha: hoy,
    generadoA: new Date().toISOString(),
    planGeneradoA: new Date().toISOString(), // hora del plan: el refresco no la pisa
    aplicado: false,          // el análisis nunca aplica; requiere acto explícito
    propuesta,                // operaciones + avisos de impacto
    salidas: previo?.salidas ?? [],   // los stops abiertos no se pierden al analizar
    notaDelDia: previo?.notaDelDia,
    picks,
    // ranuras del sleeve de esta semana y picks que la cuarentena dejó fuera:
    // aplicarPlan tiene que repartir el presupuesto igual que la propuesta que
    // Jorge aprobó, no recalcularlo con los que sobrevivieron
    ranuras,
    vetadosEstaSemana,
    mercado: scored.slice(0, 12),
    recomendaciones: trades,
    sim: simSummary(wallet, prices),
    real: real ? { total: real.total, detalle: real.detalle, fuente: real.fuente, actualizado: real.actualizado, billeteras: real.billeteras ?? null } : null,
    realError,
    conectadoBinance: hayKeys,
    btcUSDT: prices.BTCUSDT,
    cambios24h: cambios24hPara(activosEnCartera(wallet, real), stats),
    posiciones: evaluarPosiciones(prices),
    sleeveRendimiento: await rendimientoSleeve(prices),
    riesgo: riesgoAbierto(prices, simValue),
    estadistica: estadisticaJugadas(),
    comisiones: comisionesPagadas(),
    cierres: cierres(),
    historia: readHistory(),
    snapshots: readSnapshots(),
    movimientos: readMovimientos(),
    alertas: getAlertas(),
  };
  persistLastRun(result);
  return result;
}

// ---------------------------------------------------------------------------
// SELLO DE VERSIÓN DEL MOTOR
//
// El registro de 14 días es el producto del proyecto, y un resultado que no
// dice qué motor lo produjo no es un registro: es una anécdota. Entre el 18 y
// el 23 de agosto cambiaron el stop, el objetivo, el score, la compuerta y el
// plazo — y las 6 jugadas cerradas quedaron atribuidas a un motor que ya no
// existe, sin que nada en los datos lo dijera.
//
// La versión NO se escribe a mano. Escribirla a mano es exactamente lo que
// dejó la tabla de PLAN-DE-ACCION.md congelada en v2a mientras el motor seguía
// cambiando debajo. Se DERIVA de los parámetros vivos: si alguno cambia, el
// sello cambia solo y no hay forma de olvidarse.
// ---------------------------------------------------------------------------
const VERSIONES_FILE = join(DATA, 'versiones.json');

// Huella normalizada del CÓDIGO de una función de decisión: sin comentarios y
// con los espacios colapsados, para que reescribir un comentario no invente una
// versión nueva pero cambiar una fórmula sí.
//
// Existe porque los números no alcanzan. El stop estructural se agregó como
// lógica nueva dentro de `planDeEntrada` sin declarar ningún parámetro propio,
// y el sello NO se movió: exactamente la mentira por omisión que este mecanismo
// tiene que evitar. Ahora el sello sigue a la lógica, no solo a las constantes.
export function huellaDeFuncion(fn) {
  return String(fn)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// TODAS las funciones en el camino causal de una decisión de dinero.
//
// EL PUNTO CIEGO QUE ESTO CIERRA. La huella es `String(fn)`: el cuerpo de ESA
// función y nada más. Sellar `evaluarNiveles` no sella `umbralPlazoPct`, que
// ella llama — demostrado el 2026-09-01 cambiando `BANDA_RUIDO_VOL` por 0,9
// dentro del helper: **el sello no se movió**. No era un olvido más, era que
// el mecanismo solo veía el primer nivel de la llamada.
//
// Por eso acá va la cadena completa, no solo las funciones "principales": los
// helpers que calculan niveles (`volatilidadDiaria`, `umbralPlazoPct`), los que
// alimentan la compuerta (`drawdownActual`, `estadoSleeve`, `riesgoAbierto`),
// los que valorizan (`walletValue`, `valorDe`), los que producen operaciones
// (`rebalance`, `cosecharExcedente`) y los que vetan (`enCuarentena`).
//
// SE PREFIERE PASARSE. Incluir de más hace que un refactor sin cambio de
// conducta mueva el sello: un falso positivo, molesto. Incluir de menos deja
// una regla cambiando en silencio: un falso negativo, que es el error que este
// mecanismo existe para no cometer. `test.mjs` verifica que esta lista cubra
// todas las funciones clasificadas como decisorias — y que una función NUEVA
// sin clasificar rompa la suite en vez de pasar inadvertida.
const FUNCIONES_QUE_DECIDEN = {
  // niveles de entrada y tamaño
  planDeEntrada, montoPorRiesgo, stopsSugeridos, volatilidadDiaria,
  // salida: cuándo y a qué precio
  evaluarNiveles, umbralPlazoPct, volatilidadDe, reconstruirCruce, picoAntesDe,
  refrescarPicos, ejecutarStops,
  // qué se bloquea
  compuertaRiesgo, drawdownActual, estadoSleeve, riesgoAbierto,
  enCuarentena, diasDesdeCorte,
  // valorización: si el total está mal, la compuerta bloquea mal
  walletValue, valorDe, holdingsPlanos, bolsillosNoDeclarados,
  // qué operaciones se producen
  rebalance, cosecharExcedente, evaluarPropuesta, aplicarVentas,
  // qué se compra y cuándo entra
  marketSnapshot, momentumModelo, rsi, clasificarTendencia, runAnalysis,
  condicionCumplida, agregarWatch, tomarOferta,
  // clasificación del capital heredado
  migrarWallet,
};

// Los números que definen CÓMO decide el motor. Entran los que cambian una
// decisión; no entran rutas, timeouts ni textos. Si agregás una regla nueva con
// un número propio, va acá — si no, el sello miente por omisión.
function parametrosDelMotor() {
  return {
    stopVecesVol: STOP_VECES_VOL, stopPisoPct: 4, stopTechoPct: 15,
    bandaRuidoVol: BANDA_RUIDO_VOL, fee: FEE,
    riesgoObjetivoUSDT: RIESGO_OBJETIVO_USDT,
    montoMinimoUSDT: MONTO_MINIMO_USDT, montoMaximoUSDT: MONTO_MAXIMO_USDT,
    rbMinimo: RB_MINIMO, objetivoMaxVecesStop: OBJETIVO_MAX_VECES_STOP,
    drawdownMaxPct: DRAWDOWN_MAX_PCT, riesgoAbiertoMaxPct: RIESGO_ABIERTO_MAX_PCT,
    volDiariaAvisoPct: VOL_DIARIA_AVISO_PCT, riesgoDesvioMaxVeces: RIESGO_DESVIO_MAX_VECES,
    limiteSleevePct: LIMITE_SLEEVE_PCT, picks: PICKS, candidatos: CANDIDATOS,
    cuarentenaDias: CUARENTENA_DIAS, ventanaModeloDias: VENTANA_MODELO_DIAS,
    driftMaxPct: DRIFT_MAX_PCT, watchDias: WATCH_DIAS,
    reconstruccionMaxH: RECONSTRUCCION_MAX_H,
    // La política con que nacen las posiciones nuevas: qué las saca y cuándo.
    // Es una decisión del motor tanto como el stop, así que va al sello.
    politicaSalida: POLITICA_SALIDA,
    // La huella del CÓDIGO de cada función en el camino causal de una decisión
    // de dinero. Ver `FUNCIONES_QUE_DECIDEN`.
    logica: Object.fromEntries(
      Object.entries(FUNCIONES_QUE_DECIDEN).map(([n, f]) => [n, huellaDeFuncion(f)])),
  };
}

let _versionCache = null;

// Async porque los parámetros de señales viven en aprendizaje.mjs, que importa
// de acá: un import estático sería un ciclo. El dinámico lo evita, y como el
// resultado se cachea se paga una sola vez por proceso.
export async function versionMotor() {
  if (_versionCache) return _versionCache;
  const params = { motor: parametrosDelMotor() };
  try {
    const ap = await import('./aprendizaje.mjs');
    params.senales = typeof ap.parametrosDeSenales === 'function'
      ? ap.parametrosDeSenales() : 'modulo-sin-parametros';
  } catch {
    // Si el módulo de señales no carga, el sello queda distinto A PROPÓSITO:
    // un hash anómalo en el registro es justo la alarma que se quiere.
    params.senales = 'no-disponible';
  }
  const json = JSON.stringify(params);
  const version = 'm-' + createHash('sha1').update(json).digest('hex').slice(0, 8);
  registrarVersion(version, params);
  _versionCache = version;
  return version;
}

// Diccionario hash → parámetros. Sin esto el sello sería un número mágico:
// con esto, cualquier jugada del historial se puede volver a leer sabiendo
// exactamente con qué reglas se tomó.
function registrarVersion(version, parametros) {
  const data = existsSync(VERSIONES_FILE) ? leerJSON(VERSIONES_FILE) : { versiones: {} };
  if (data.versiones[version]) return;
  data.versiones[version] = { desde: new Date().toISOString(), parametros };
  escribirJSON(VERSIONES_FILE, data);
}

// Punto de la serie escrito por el MONITOR, no por el navegador.
//
// `appendSnapshot` solo se llamaba desde `aplicarPlan`, `refreshMarket` y
// `runAnalysis` — es decir, cuando Jorge tenía el dashboard abierto. Y
// `drawdownActual` saca el pico de esa serie: **el freno de caída del 10% medía
// contra el máximo que alguien estuvo mirando**. Un pico alcanzado de madrugada
// no existía para la compuerta, así que la caída desde él nunca la activaba.
//
// La billetera real se valoriza con las cantidades ya conocidas y precios en
// vivo: no gasta una llamada firmada ni toca las claves de Binance.
export function registrarSnapshotDeVigilancia(prices) {
  const wallet = loadWallet(prices);
  if (!wallet) return null;
  const sim = simSummary(wallet, prices);
  appendSnapshot(wallet, sim.valor, snapshotWalletValue(prices), prices);
  return sim.valor;
}

export function leerVersiones() {
  if (!existsSync(VERSIONES_FILE)) return {};
  return leerJSON(VERSIONES_FILE).versiones ?? {};
}

// --- helpers para el bot de Telegram ---------------------------------------
// Consultas baratas: el bot se usa desde el teléfono y no puede disparar el
// barrido completo del universo (3.684 pares) en cada mensaje.

// Precios de la cartera, snapshot ligero.
export const marketSnapshotParaBot = () => marketSnapshotLigero();

// Radar del ÚLTIMO análisis guardado, no uno nuevo: recalcularlo costaría el
// barrido completo. Si está viejo, el bot lo dice con la hora del análisis.
export function radarParaBot(n = 5) {
  const lr = lastRunPrevio();
  return {
    generadoA: lr?.generadoA ?? null,
    mercado: (lr?.mercado ?? []).slice(0, n),
  };
}

// Internos expuestos SOLO para los tests (src/test.mjs). No los use el server:
// la superficie pública del motor son los `export function` de arriba.
export const _test = {
  FEE, parametrosDelMotor, FUNCIONES_QUE_DECIDEN, walletValue, rebalance, migrarWallet, escribirJSON, escribirEstado, leerJSON,
  BOLSILLOS, simSummary, valorDe, clasificarTendencia,
  stopsSugeridosPuro: planDeEntrada, enParalelo, volatilidadDiaria,
  reconstruirCruce,
  fs: { readFileSync, writeFileSync },
  leerWallet: () => leerJSON(WALLET_FILE),
  WALLET_FILE,
};
