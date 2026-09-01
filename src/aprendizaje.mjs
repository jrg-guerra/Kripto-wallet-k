// MOTOR DE APRENDIZAJE
//
// Lee los registros del proyecto y acumula el conocimiento que hoy se pierde:
// por qué se tomó cada decisión, qué hipótesis tenemos abiertas y cómo fue
// evolucionando la plataforma. Tres piezas:
//
//   A · INSTRUMENTACIÓN — captura el contexto en el momento de decidir (RSI,
//       momentum, volumen, régimen de mercado, tesis, confianza). Sin esto no
//       hay nada que aprender después: los datos no capturados se pierden.
//   B · HIPÓTESIS — registro de cada afirmación que hacemos, con su estado y
//       su evidencia, más detección de deriva (reglas declaradas que no están
//       en el código).
//   C · PATRONES — cruza resultados por segmento, pero se NIEGA a concluir
//       bajo el umbral de muestra: con n chico, un patrón es superstición.
//
// Uso desde consola:  node src/aprendizaje.mjs [--json]
// No opera ni toca la billetera: solo lee y escribe sus propios registros.

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerAprendizaje, escribirAprendizaje, appendAprendizaje, rsi, clasificarTendencia, huellaDeFuncion } from './engine.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
const DATA = process.env.KW_DATA || join(ROOT, 'data');
const API = 'https://api.binance.com';

const POSICIONES = join(DATA, 'posiciones.json');
const MOVIMIENTOS = join(DATA, 'movimientos.jsonl');
const HISTORY = join(DATA, 'history.csv');
const HIPOTESIS = join(DATA, 'hipotesis.json');
const BITACORA = join(ROOT, 'BITACORA.md');

// Muestra mínima para que un cruce signifique algo. Debajo de esto el motor
// reporta "insuficiente" en vez de un número: es la diferencia entre aprender
// y construir superstición sobre ruido.
const N_MINIMO = 20;
const N_ORIENTATIVO = 8; // entre 8 y 20 se muestra como "pista", no conclusión

const leerJSON = f => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
const leerJSONL = f => existsSync(f)
  ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// ---------------------------------------------------------------------------
// A · INSTRUMENTACIÓN: el contexto del momento de decidir
// ---------------------------------------------------------------------------

async function klines(symbol, interval, limit) {
  const res = await fetch(`${API}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`klines ${symbol}: HTTP ${res.status}`);
  return res.json();
}

// RSI de Wilder sobre los cierres dados.
// rsi() vive en el motor (una sola copia): la watchlist también lo necesita.

// Régimen de mercado: distingue un rally amplio de un pump aislado. Es la
// diferencia que separó la entrada de ETH (rally real) de la de GPS (pump).
export async function regimenMercado() {
  const refs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
  const datos = await Promise.all(refs.map(async s => {
    try {
      const k = await klines(s, '1d', 8);
      const c = k.map(x => parseFloat(x[4]));
      return { s, d1: (c.at(-1) / c.at(-2) - 1) * 100, d7: (c.at(-1) / c[0] - 1) * 100 };
    } catch { return null; }
  }));
  const ok = datos.filter(Boolean);
  if (!ok.length) return null;
  const subiendo = ok.filter(d => d.d1 > 0).length;
  const btc = ok.find(d => d.s === 'BTCUSDT');
  const amplitud = subiendo / ok.length;
  return {
    btc24hPct: btc ? Number(btc.d1.toFixed(2)) : null,
    btc7dPct: btc ? Number(btc.d7.toFixed(2)) : null,
    amplitudPct: Number((amplitud * 100).toFixed(0)),
    // "amplio" = la mayoría del mercado acompaña; "aislado" = sube solo el activo
    tipo: amplitud >= 0.8 ? 'rally amplio' : amplitud >= 0.5 ? 'mixto' : amplitud >= 0.2 ? 'débil' : 'caída amplia',
  };
}

// Contexto de un activo al momento de entrar: lo que hace falta para poder
// preguntar después "¿pierdo cuando entro sobrecomprado?".
export async function contextoEntrada(asset) {
  const sym = `${asset}USDT`;
  const [d, h] = await Promise.all([
    klines(sym, '1d', 31).catch(() => null),
    klines(sym, '1h', 30).catch(() => null),
  ]);
  const ctx = { asset, capturado: new Date().toISOString() };
  if (d) {
    const c = d.map(x => parseFloat(x[4]));
    const vols = d.map(x => parseFloat(x[7]));
    ctx.rsi14d = rsi(c);
    ctx.momentum7dPct = c.length >= 8 ? Number(((c.at(-1) / c.at(-8) - 1) * 100).toFixed(2)) : null;
    ctx.momentum30dPct = c.length >= 31 ? Number(((c.at(-1) / c[0] - 1) * 100).toFixed(2)) : null;
    ctx.volumen24hM = Number((vols.at(-1) / 1e6).toFixed(1));
    // distancia al techo de 30 días: entrar en máximos es un dato, no un juicio
    const max30 = Math.max(...d.map(x => parseFloat(x[2])));
    ctx.distanciaMax30dPct = Number(((c.at(-1) / max30 - 1) * 100).toFixed(2));
    // …y al PISO DEL RETROCESO: el mínimo DESDE que se hizo ese techo. De las
    // mismas velas, sin una llamada más.
    //
    // No es el mínimo de 30 días. Medido contra el mercado real, el mínimo del
    // mes está entre 23% y 184% abajo en los 12 activos del radar: como ancla
    // del stop no aprieta nunca, es inerte. El soporte que un swing de verdad
    // defiende es el piso del retroceso en curso — entre 3% y 11% en los mismos
    // 12 activos, que es la vecindad donde vive el stop.
    const alturas = d.map(x => parseFloat(x[2]));
    const iTecho = alturas.indexOf(Math.max(...alturas));
    const desdeTecho = d.slice(iTecho).map(x => parseFloat(x[3]));
    const pisoRetroceso = desdeTecho.length ? Math.min(...desdeTecho) : null;
    ctx.distanciaPisoPct = pisoRetroceso > 0
      ? Number(((c.at(-1) / pisoRetroceso - 1) * 100).toFixed(2)) : null;

    // FASE y SALTO DE VOLUMEN. Faltaban, y su ausencia era la razón de que el
    // score no se pudiera calcular en este camino: `scoreSetup` los necesita.
    // Salen de las MISMAS 31 velas, sin una llamada más.
    ctx.fase = clasificarTendencia(c)?.estado ?? null;
    ctx.saltoVolumen = saltoVolumenDe(d);
  }
  if (h) ctx.rsi14h = rsi(h.map(x => parseFloat(x[4])));
  ctx.regimen = await regimenMercado();
  return ctx;
}

// El salto de volumen a partir de velas YA descargadas. Tiene que dar el mismo
// número que `saltoVolumen()` o el score dependería de por qué camino se
// calculó — la misma trampa que la ventana de volatilidad de la watchlist.
// Por eso replica su aritmética exacta: descartar la vela de hoy (en curso),
// quedarse con 8 días completos, y comparar el último contra los 7 previos.
function saltoVolumenDe(velasDiarias) {
  const vols = velasDiarias.slice(0, -1).map(x => parseFloat(x[7])).filter(v => v > 0).slice(-8);
  if (vols.length < 4) return null;
  const previos = vols.slice(0, -1);
  const media = previos.reduce((a, b) => a + b, 0) / previos.length;
  return media ? Number((vols.at(-1) / media).toFixed(1)) : null;
}

// El régimen se guarda como objeto (con sus métricas), pero `scoreSetup` espera
// el tipo. Un objeto ahí caía al valor por defecto en silencio y el componente
// "régimen" del score quedaba en 0,5 sin que nada lo dijera.
const tipoDeRegimen = r => (typeof r === 'string' ? r : r?.tipo) ?? null;

// Registra una decisión (apertura) con su contexto y su tesis.
//
// EL SCORE VA COMO CAMPO, NO COMO FRASE. Hasta acá el score existía solo dentro
// del texto de la tesis ("score 74, mejor R:B del lote"), así que la hipótesis
// `score-de-confianza` —correlacionar score con resultado a partir de n≥20— era
// INEJECUTABLE por construcción: aunque llegaran 200 jugadas, el dato nunca se
// había guardado en forma consultable. Es el mismo defecto que la auditoría
// encontró en tres controles: la comprobación no puede correr porque le falta
// el operando.
//
// `scoreOrigen` distingue dos números que NO son el mismo y que mezclados
// arruinarían el análisis:
//   declarado — el score que de verdad decidió (viene de la oferta que lo gateó)
//   derivado  — reconstruido acá desde el contexto, para jugadas manuales que
//               nunca pasaron por el screening
export function registrarDecision({ asset, posicionId, tesis, confianza, contexto, autor = 'Jorge', montoUSDT, limitePct, objetivoPct, score = null, desglose = null, senal = null }) {
  let scoreOrigen = null;
  if (score != null) {
    scoreOrigen = 'declarado';
  } else if (contexto) {
    // Derivable solo si el contexto trae con qué: sin fase ni régimen el score
    // sería el promedio de sus valores por defecto disfrazado de medición.
    const paraScore = {
      rsi14d: contexto.rsi14d, rsi14h: contexto.rsi14h,
      fase: contexto.fase ?? null,
      regimen: tipoDeRegimen(contexto.regimen),
      saltoVolumen: contexto.saltoVolumen ?? null,
    };
    if (paraScore.rsi14d != null && paraScore.fase && paraScore.regimen) {
      const r = scoreSetup(paraScore);
      score = r.score; desglose = r.desglose; scoreOrigen = 'derivado';
      senal ??= detectarSenales({
        momentum30dPct: contexto.momentum30dPct,
        distanciaMax30dPct: contexto.distanciaMax30dPct,
        rsi14d: contexto.rsi14d,
        fase: paraScore.fase,
        saltoVolumen: paraScore.saltoVolumen,
      }).principal;
    }
  }
  const reg = {
    tipo: 'decision',
    ts: new Date().toISOString(),
    posicionId, asset, autor,
    tesis: tesis ?? null,
    confianza: confianza ?? null,
    montoUSDT, limitePct, objetivoPct,
    score, desglose, scoreOrigen,
    senal: senal ?? null,
    senalNombre: senal ? (SENALES[senal]?.nombre ?? null) : null,
    contexto: contexto ?? null,
  };
  appendAprendizaje(reg);
  return reg;
}

// Registra el veredicto al cerrar: lo único que convierte un resultado en
// aprendizaje. La distinción clave es entre tesis equivocada y tesis correcta
// mal ejecutada — se corrigen de formas opuestas.
export const VEREDICTOS = ['tesis-correcta', 'tesis-correcta-mala-ejecucion', 'tesis-equivocada', 'ruido-de-mercado'];

export function registrarVeredicto({ posicionId, asset, veredicto, leccion, autor = 'Jorge' }) {
  if (veredicto && !VEREDICTOS.includes(veredicto)) {
    throw new Error(`Veredicto inválido: ${veredicto}. Opciones: ${VEREDICTOS.join(', ')}`);
  }
  const reg = { tipo: 'veredicto', ts: new Date().toISOString(), posicionId, asset, veredicto, leccion: leccion ?? null, autor };
  appendAprendizaje(reg);
  return reg;
}

// Decisiones que se cerraron sin veredicto: la lista de deberes pendientes.
export function veredictosPendientes() {
  const regs = leerAprendizaje();
  const pos = leerJSON(POSICIONES)?.posiciones ?? [];
  const conVeredicto = new Set(regs.filter(r => r.tipo === 'veredicto').map(r => r.posicionId));
  return pos
    .filter(p => p.estado === 'cerrada' && !conVeredicto.has(p.id))
    .map(p => ({ id: p.id, asset: p.asset, pnlPct: p.pnlPct, motivoCierre: p.motivoCierre, cerrado: p.cerrado }));
}

// ---------------------------------------------------------------------------
// OPORTUNIDADES: los criterios que venimos aplicando a mano, ahora en código
//
// Cada criterio viene de algo que nos costó dinero o quedó registrado como
// hipótesis. El objetivo NO es decir "compra", es avisar cuando vale mirar —
// y dejar el caso registrado para poder probar después si los criterios
// sirven. Hoy los aplico a mano y los casos donde NO operamos no dejan rastro.
// ---------------------------------------------------------------------------

// Exportado para que el replay histórico (`replay-salidas.mjs --historico`)
// genere entradas con LOS MISMOS criterios que el screener aplica en vivo. Si
// los copiara, mediría políticas de salida sobre entradas de otro sistema.
export const CRITERIOS = {
  rsiMaximo: 70,        // lección GPS/ACE: entrar sobrecomprado tiene castigo
  saltoVolumenMax: 6,   // hallazgo RE: 12,3x era pump propio, no rally de mercado
  regimenesVetados: ['débil', 'caída amplia'],
  horasSinRepetir: 12,  // no es un tope diario: es no repetir el mismo activo
};

// Salto de volumen del último día contra el promedio propio de 7 días. El
// volumen absoluto no distingue nada cuando todo el mercado saltó el mismo día.
export async function saltoVolumen(asset) {
  try {
    // Se pide un día extra y se descarta el último: la vela de HOY está en
    // curso, así que compararla contra días completos daba siempre ~0 y el
    // filtro nunca disparaba (RE, un pump de 12x, pasaba limpio).
    const k = await klines(`${asset}USDT`, '1d', 9);
    const vols = k.slice(0, -1).map(x => parseFloat(x[7])).filter(v => v > 0);
    if (vols.length < 4) return null;
    const ultimo = vols.at(-1);
    const previos = vols.slice(0, -1);
    const media = previos.reduce((a, b) => a + b, 0) / previos.length;
    return media ? Number((ultimo / media).toFixed(1)) : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// CONTRAFACTUAL: qué pasó con lo que NO compramos
//
// El screener evalúa ~12 candidatos por corrida y compra 0 o 1. Los otros se
// descartaban y desaparecían, así que el sistema solo podía aprender de las
// jugadas que hizo: 16 en dos semanas, con el rango de RSI aplastado entre 58 y
// 69 porque la compuerta no deja pasar otra cosa. Es un termómetro que solo
// mide entre 36 y 37 grados.
//
// Registrando también los rechazados —con su motivo etiquetado— y midiendo
// después qué hizo el precio, cada corrida deja ~12 pares contexto→resultado en
// vez de 0. Y aparece por fin la pregunta que hoy no se puede contestar: **cada
// filtro, ¿nos ahorra plata o nos la cuesta?**
//
// UNA OBSERVACIÓN POR ACTIVO Y POR DÍA. Los criterios se calculan sobre velas
// diarias, así que registrar cada 3 minutos guardaría 480 copias del mismo
// juicio. El tope vive en memoria: tras un reinicio se puede repetir una vez en
// el día, y el análisis deduplica por (activo, fecha).
const CANDIDATOS_FILE = join(DATA, 'candidatos.jsonl');
let _registradosHoy = { fecha: null, vistos: new Set() };

export function registrarCandidato(reg) {
  const fecha = new Date().toISOString().slice(0, 10);
  if (_registradosHoy.fecha !== fecha) _registradosHoy = { fecha, vistos: new Set() };
  if (_registradosHoy.vistos.has(reg.asset)) return null;
  _registradosHoy.vistos.add(reg.asset);
  const fila = { ts: new Date().toISOString(), fecha, ...reg };
  appendFileSync(CANDIDATOS_FILE, JSON.stringify(fila) + '\n');
  return fila;
}

export function leerCandidatos() {
  const filas = leerJSONL(CANDIDATOS_FILE);
  // dedup por (activo, fecha): un reinicio puede haber repetido la observación
  const vistos = new Set();
  return filas.filter(f => {
    const k = `${f.asset}|${f.fecha}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

// Qué hizo el precio DESPUÉS del juicio. Mismo método que el seguimiento
// post-cierre: se lee de las velas, así que funciona retroactivamente y una vez
// pasada la ventana el número es definitivo.
const CANDIDATOS_SEG = join(DATA, 'candidatos-seguimiento.json');
const VENTANA_CANDIDATO_H = 48;

export async function seguimientoCandidatos() {
  const cache = existsSync(CANDIDATOS_SEG) ? JSON.parse(readFileSync(CANDIDATOS_SEG, 'utf8')) : {};
  const filas = leerCandidatos().filter(f => f.precio > 0);
  let cambio = false;

  for (const f of filas) {
    const clave = `${f.asset}|${f.fecha}`;
    if (cache[clave]?.completo) continue;
    const desde = Date.parse(f.ts);
    const horas = (Date.now() - desde) / 3_600_000;
    if (horas < 1) continue;
    try {
      const k = await klines2(`${f.asset}USDT`, '1h', desde, Math.min(1000, Math.ceil(Math.min(horas, VENTANA_CANDIDATO_H)) + 2));
      if (!k.length) continue;
      const cierreA = h => {
        const v = k[Math.min(h, k.length - 1)];
        return v ? parseFloat(v[4]) : null;
      };
      const maximo = Math.max(...k.slice(0, VENTANA_CANDIDATO_H + 1).map(v => parseFloat(v[2])));
      cache[clave] = {
        completo: horas >= VENTANA_CANDIDATO_H,
        h24Pct: horas >= 24 ? (cierreA(24) / f.precio - 1) * 100 : null,
        h48Pct: horas >= 48 ? (cierreA(48) / f.precio - 1) * 100 : null,
        maximoPct: (maximo / f.precio - 1) * 100,
      };
      cambio = true;
    } catch { /* sin par o sin velas: se omite */ }
  }
  if (cambio) escribirAprendizaje(CANDIDATOS_SEG, cache);

  // Agregado por FILTRO: la pregunta que justifica todo esto.
  const porFiltro = new Map();
  let medidos = 0;
  for (const f of filas) {
    const d = cache[`${f.asset}|${f.fecha}`];
    const ret = d?.h48Pct ?? d?.h24Pct;
    if (ret == null) continue;
    medidos++;
    const k = f.veredicto === 'aceptado' ? '(aceptado)' : f.filtro ?? 'otro';
    if (!porFiltro.has(k)) porFiltro.set(k, { filtro: k, n: 0, suma: 0, subieron: 0, mejor: -Infinity, peor: Infinity });
    const g = porFiltro.get(k);
    g.n++; g.suma += ret; if (ret > 0) g.subieron++;
    g.mejor = Math.max(g.mejor, ret); g.peor = Math.min(g.peor, ret);
  }

  return {
    ventanaH: VENTANA_CANDIDATO_H,
    n: filas.length, medidos,
    // Con n chico esto es una pista, no un veredicto: mismo umbral que el resto
    // del motor de aprendizaje.
    significativo: medidos >= N_MINIMO,
    porFiltro: [...porFiltro.values()]
      .map(g => ({ ...g, medioPct: g.suma / g.n, subieronPct: (g.subieron / g.n) * 100 }))
      .sort((a, b) => b.medioPct - a.medioPct),
  };
}

// klines desde un instante dado (el `klines` de arriba pide las más recientes).
async function klines2(symbol, interval, startTime, limit) {
  const res = await fetch(`${API}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&limit=${limit}`);
  if (!res.ok) throw new Error(`klines ${symbol}: HTTP ${res.status}`);
  return res.json();
}

// Activos ya avisados hace poco: no repetir lo mismo cada 3 minutos.
function avisadosRecientes(horas) {
  const corte = Date.now() - horas * 3.6e6;
  return new Set(leerAprendizaje()
    .filter(r => r.tipo === 'oportunidad' && new Date(r.ts).getTime() > corte)
    .map(r => r.asset));
}

// --- MOTOR DE SEÑALES --------------------------------------------------------
//
// Hasta acá el sistema tenía UNA sola forma de ver el mercado: "subió mucho en
// 30 días". Por eso en la semana del 21-08 no encontró nada — un detector de
// momentum, en un mercado que ya corrió, solo sabe señalar lo que ya subió.
//
// Cada señal es un PATRÓN con nombre. Nombrarlo importa por dos razones: el
// aprendizaje puede comparar qué patrón rinde mejor (hoy imposible: todo se
// llama igual), y obliga a que cada entrada tenga una tesis reconocible en vez
// de "estaba arriba en la lista".
//
// DECISIÓN DELIBERADA: todas las señales comparten el MISMO umbral de score.
// Es tentador bajarle el listón a la ruptura —un activo en máximos tiene el RSI
// alto por definición y el score lo castiga— pero justo ese es el perfil de
// nuestras peores operaciones (ACE, GPS, RE: todas comprando fuerza). Con n=0
// entradas por señal, aflojar el filtro para el patrón que históricamente nos
// costó plata sería ajustar la regla al deseo. Que los datos decidan.
//
// NO se implementan dos de las cinco del póster, y vale decir por qué:
//   · CONTINUACIÓN — con velas diarias es indistinguible de momentum. Inventar
//     la diferencia sería dar nombres distintos a la misma medición.
//   · REVERSIÓN — comprar un giro es atrapar el cuchillo, y contradice la
//     cuarentena que ya tenemos ("el impulso que lo cortó suele seguir"). Con
//     capital cerrado y 80 USDT, ese no es el experimento a correr.

export const SENALES = {
  // El patrón que faltaba: tendencia sana que retrocedió. Se entra en el
  // descuento, no en el pico. Es la señal que habría servido esta semana.
  pullback: {
    nombre: 'Pullback',
    lectura: 'retroceso dentro de una tendencia intacta: entrar en el descuento',
    detecta: c =>
      c.momentum30dPct > 10 &&
      (c.fase === 'tendencia' || c.fase === 'rango') &&
      // Ventana de retroceso SANO: al menos 5% bajo su techo de 30d, pero no
      // más de 30%. El piso lo puso la realidad: probando contra el mercado,
      // TUT clasificaba pullback con -80% desde su máximo — eso no es un
      // retroceso, es el derrumbe de un pump (+337% en 30d, volumen 1,1x, el
      // perfil de RE). Sin techo al retroceso, "pullback" se convierte en
      // "comprar lo que se desplomó".
      c.distanciaMax30dPct <= -5 && c.distanciaMax30dPct >= -30 &&
      c.rsi14d != null && c.rsi14d < 60, // ya enfrió
  },
  // Precio rompiendo su techo de 30 días CON volumen que lo acompañe. El
  // volumen no es adorno: sin él, un máximo nuevo es una mecha, no una ruptura.
  ruptura: {
    nombre: 'Ruptura',
    lectura: 'rompe su techo de 30 días con volumen que lo acompaña',
    detecta: c =>
      c.distanciaMax30dPct >= -1.5 &&
      c.momentum30dPct > 0 &&
      c.fase !== 'caida' &&
      c.saltoVolumen != null && c.saltoVolumen >= 1.5,
  },
  // Lo que el sistema ya hacía, ahora con nombre propio.
  momentum: {
    nombre: 'Momentum',
    lectura: 'aceleración sostenida con la media de 20 días a favor',
    detecta: c => c.momentum30dPct > 0 && c.fase === 'tendencia',
  },
};

// Orden de preferencia cuando un candidato encaja en varias: el pullback es la
// entrada más barata, la ruptura la más cara. Si encaja en todas, gana pullback.
const PRIORIDAD = ['pullback', 'ruptura', 'momentum'];

export function detectarSenales(ctx) {
  const encaja = PRIORIDAD.filter(k => {
    try { return SENALES[k].detecta(ctx); } catch { return false; }
  });
  return { senales: encaja, principal: encaja[0] ?? null };
}

// --- SCORE DE CONFIANZA ------------------------------------------------------
//
// El filtro binario trataba igual a RSI 70,1 y a RSI 86: fuera los dos. El
// score gradúa la zona gris — PERO no reemplaza los vetos de seguridad, que
// siguen siendo duros (cuarentena, ya en cartera, régimen vetado, pump >6x,
// RSI >= 80 como techo de cordura). El score decide entre lo defendible.
//
// Componentes y pesos (suman 100):
//   RSI diario   36  el criterio que más pérdidas evitó (ACE, RE)
//   Fase         24  tendencia > rango > extendido (clasificador del radar)
//   Régimen      12  rally amplio > mixto (los vetados no llegan acá)
//   Volumen      14  salto 1-4x acompañado = sano; 4-6x sospechoso
//   RSI 1h       14  multi-timeframe: se capturaba en cada entrada y NUNCA se
//                    usaba — el diario dice si está caro, el horario si está
//                    comprando el pico intradía
//
// PROPIEDAD DE DISEÑO (el test la fija): los cuatro componentes sin RSI suman
// 64, bajo el umbral de 65 — ningún alineamiento perfecto de fase, régimen y
// volumen puede comprar un activo con el RSI muerto. El primer intento tenía
// los pesos en 30/25/15/15/15 y un RSI 79 con todo lo demás perfecto pasaba.
//
// Los pesos son un JUICIO sin validar (hipótesis `score-de-confianza`): el
// aprendizaje debe correlacionar score con resultado cuando haya n>=20.
export const UMBRAL_SCORE = 65;

// Fuera de scoreSetup a propósito: el sello de versión del motor los lee, y un
// peso escondido dentro de la función sería un cambio de reglas invisible.
const PESOS = { rsi: 36, fase: 24, regimen: 12, volumen: 14, rsi1h: 14 };

// Lo que este módulo aporta al sello de versión (ver versionMotor en engine).
// Los detectores entran como TEXTO de su función: tocar un umbral adentro de
// `detecta` cambia el sello sin que haya que acordarse de declararlo acá.
// La cadena causal de ESTE módulo, por la misma razón que en el motor: la
// huella es del cuerpo de una función, no de las que llama.
//
// Se agregó el 2026-09-01 después de sellar la cadena de `engine.mjs` y
// comprobar que acá seguía el mismo agujero: cambiar los umbrales de
// `regimenMercado` —los que ese mismo día vetaron los 12 candidatos del
// screening— **no movía el sello**. Arreglar un módulo y no el otro es el error
// que ya se había cometido con el dashboard y Telegram.
export const FUNCIONES_QUE_DECIDEN = {
  // qué régimen ve el sistema: sus umbrales vetan el screening entero
  regimenMercado,
  // el contexto con el que se juzga a cada candidato
  contextoEntrada, saltoVolumen, saltoVolumenDe,
  // qué patrón se reconoce y cuánto puntúa
  detectarSenales, scoreSetup,
  // el filtro completo: cada rechazo sale de acá
  buscarOportunidades, avisadosRecientes,
};

export function parametrosDeSenales() {
  return {
    umbralScore: UMBRAL_SCORE,
    pesos: PESOS,
    prioridad: PRIORIDAD,
    logica: Object.fromEntries(
      Object.entries(FUNCIONES_QUE_DECIDEN).map(([n, f]) => [n, huellaDeFuncion(f)])),
    // Los criterios del screener son reglas de decisión tanto como el score:
    // el veto de régimen rechazó los 12 candidatos del 1-sep él solo. No
    // estaban en el sello, así que cambiar `regimenesVetados` habría movido
    // qué se compra sin mover la versión — el mismo hueco que la política de
    // salida tenía, encontrado en otro sitio el mismo día.
    criterios: CRITERIOS,
    detectores: Object.fromEntries(
      Object.entries(SENALES).map(([k, s]) => [k, huellaDeFuncion(s.detecta)])),
    score: huellaDeFuncion(scoreSetup),
  };
}

export function scoreSetup(ctx) {
  const clamp = v => Math.max(0, Math.min(1, v));
  const comp = {
    rsi: ctx.rsi14d == null ? 0.4 : clamp((75 - ctx.rsi14d) / 35),
    fase: { tendencia: 1, rango: 0.55, extendido: 0.15, caida: 0 }[ctx.fase] ?? 0.4,
    regimen: { 'rally amplio': 1, mixto: 0.6, 'débil': 0.2, 'caída amplia': 0 }[ctx.regimen] ?? 0.5,
    volumen: ctx.saltoVolumen == null ? 0.5
      : ctx.saltoVolumen > 6 ? 0
      : ctx.saltoVolumen > 4 ? clamp(1 - (ctx.saltoVolumen - 4) / 2 * 0.7)
      : ctx.saltoVolumen >= 1 ? 1 : 0.5,
    rsi1h: ctx.rsi14h == null ? 0.5 : clamp((80 - ctx.rsi14h) / 25),
  };
  const score = Math.round(Object.entries(PESOS).reduce((a, [k, p]) => a + comp[k] * p, 0));
  const desglose = Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, Math.round(v * 100)]));
  return { score, desglose };
}

export async function buscarOportunidades({ registrar = true } = {}) {
  const { radarParaBot, enCuarentena, getState } = await import('./engine.mjs');

  const regimen = await regimenMercado();
  if (!regimen) return { regimen: null, descartadas: [], oportunidades: [], motivo: 'sin datos de mercado' };

  // EL VETO DE RÉGIMEN TAMBIÉN ES UNA DECISIÓN, Y HASTA ACÁ NO DEJABA RASTRO.
  // Se salía sin mirar un solo candidato, así que el día que veta —el 1-sep
  // vetó absolutamente todo— no quedaba registro de QUÉ se dejó pasar. Sin eso
  // la pregunta "¿el veto de régimen nos ahorra plata o nos la cuesta?" es
  // incontestable por construcción, igual que lo era la del score.
  //
  // Los candidatos se registran desde el radar YA CALCULADO: no cuesta ninguna
  // llamada extra medir lo que igual íbamos a descartar.
  if (CRITERIOS.regimenesVetados.includes(regimen.tipo)) {
    if (registrar) {
      for (const m of radarParaBot(12).mercado) {
        registrarCandidato({
          asset: m.asset, precio: m.precio, veredicto: 'rechazado',
          motivo: `régimen "${regimen.tipo}" vetado`, filtro: 'regimen',
          regimen: regimen.tipo, rsi14d: m.rsi14d,
          fase: m.tendencia?.estado ?? null,
          momentum30dPct: m.momentum != null ? Number((m.momentum * 100).toFixed(2)) : null,
        });
      }
    }
    return { regimen, descartadas: [], oportunidades: [], motivo: `régimen "${regimen.tipo}": es resaca de rally, no entrada fresca` };
  }

  const { mercado } = radarParaBot(12);
  if (!mercado.length) return { regimen, descartadas: [], oportunidades: [], motivo: 'sin radar: ejecuta un análisis primero' };

  const lr = getState().lastRun;
  const enCartera = new Set((lr?.sim?.holdings ?? []).map(h => h.asset));
  const yaAvisados = avisadosRecientes(CRITERIOS.horasSinRepetir);

  const oportunidades = [], descartadas = [];
  for (const m of mercado) {
    // Cada rechazo queda registrado con SU FILTRO, no solo con su texto: el
    // texto sirve para leerlo, la etiqueta sirve para agrupar cientos de casos
    // y preguntar "¿este filtro nos ahorra plata o nos la cuesta?".
    let ctx = null, salto = null;
    const rechazo = (r, filtro) => {
      descartadas.push({ asset: m.asset, motivo: r });
      if (registrar) {
        registrarCandidato({
          asset: m.asset, precio: m.precio, veredicto: 'rechazado', motivo: r, filtro,
          regimen: regimen.tipo, rsi14d: ctx?.rsi14d ?? m.rsi14d,
          fase: m.tendencia?.estado ?? null,
          momentum30dPct: ctx?.momentum30dPct
            ?? (m.momentum != null ? Number((m.momentum * 100).toFixed(2)) : null),
          distanciaMax30dPct: ctx?.distanciaMax30dPct ?? null,
          saltoVolumen: salto,
        });
      }
    };
    if (m.momentum <= 0) { rechazo('momentum negativo', 'momentum'); continue; }
    if (enCartera.has(m.asset)) { rechazo('ya está en la cartera', 'cartera'); continue; }
    if (enCuarentena(m.asset)) { rechazo('en cuarentena por corte reciente', 'cuarentena'); continue; }
    if (yaAvisados.has(m.asset)) { rechazo(`ya avisado en las últimas ${CRITERIOS.horasSinRepetir} h`, 'repetido'); continue; }

    ctx = await contextoEntrada(m.asset).catch(() => null);
    if (!ctx) { rechazo('sin contexto de mercado', 'sin-datos'); continue; }
    // techo de cordura: sobrecompra EXTREMA sigue siendo veto duro — el score
    // gradúa la zona gris (RSI 65-79), no anula la lección de ACE y RE
    if (ctx.rsi14d == null || ctx.rsi14d >= 80) {
      rechazo(`RSI14 ${ctx.rsi14d ?? '?'} ≥ 80 (sobrecompra extrema)`, 'rsi'); continue;
    }
    salto = await saltoVolumen(m.asset);
    if (salto != null && salto > CRITERIOS.saltoVolumenMax) {
      rechazo(`salto de volumen ${salto}× sobre su promedio (pump propio, no rally)`, 'volumen'); continue;
    }

    // El patrón se busca ANTES de puntuar: sin tesis reconocible no hay entrada,
    // por bueno que sea el score. Antes bastaba con "momentum positivo y RSI
    // aceptable", que no es una tesis — es la ausencia de motivos para no.
    const paraSenal = {
      momentum30dPct: ctx.momentum30dPct,
      distanciaMax30dPct: ctx.distanciaMax30dPct,
      rsi14d: ctx.rsi14d,
      fase: m.tendencia?.estado ?? null,
      saltoVolumen: salto,
    };
    const { senales, principal } = detectarSenales(paraSenal);
    if (!principal) { rechazo('ningún patrón reconocible (ni pullback, ni ruptura, ni momentum)', 'sin-patron'); continue; }

    const { score, desglose } = scoreSetup({
      rsi14d: ctx.rsi14d, rsi14h: ctx.rsi14h,
      fase: m.tendencia?.estado ?? null,
      regimen: regimen.tipo, saltoVolumen: salto,
    });
    if (score < UMBRAL_SCORE) {
      const peor = Object.entries(desglose).sort((a, b) => a[1] - b[1])[0];
      rechazo(`${SENALES[principal].nombre}: score ${score}/100 bajo el umbral ${UMBRAL_SCORE} (lo que más pesa en contra: ${peor[0]} ${peor[1]}/100)`, 'score');
      continue;
    }

    const { stopsSugeridos } = await import('./engine.mjs');
    // el techo de 30d y la señal cambian el objetivo: en pullback y momentum se
    // apoya en esa resistencia; en ruptura no hay techo visible y se proyecta
    const stops = await stopsSugeridos(m.asset, {
      distanciaTechoPct: ctx.distanciaMax30dPct, senal: principal,
    }).catch(() => null);

    // R:B como CRITERIO, no como adorno. Solo puede serlo desde que el objetivo
    // es estructural: mientras fue `|stop| x 2,5` valía 2,50 siempre.
    if (stops && stops.riesgoBeneficio < stops.rbMinimo) {
      rechazo(`${SENALES[principal].nombre}: R:B ${stops.riesgoBeneficio} bajo el mínimo ${stops.rbMinimo} — arriesga ${Math.abs(stops.limitePct)}% para ganar ${stops.objetivoPct}%`, 'rb');
      continue;
    }

    // El aceptado se registra igual que el rechazado: sin el grupo que SÍ pasó
    // no hay contra qué comparar a los descartados.
    if (registrar) {
      registrarCandidato({
        asset: m.asset, precio: m.precio, veredicto: 'aceptado', motivo: null, filtro: null,
        regimen: regimen.tipo, rsi14d: ctx.rsi14d, fase: m.tendencia?.estado ?? null,
        momentum30dPct: ctx.momentum30dPct, distanciaMax30dPct: ctx.distanciaMax30dPct,
        saltoVolumen: salto, score, senal: principal,
      });
    }

    oportunidades.push({
      score, desglose,
      senal: principal,
      senalNombre: SENALES[principal].nombre,
      senalLectura: SENALES[principal].lectura,
      senalesTodas: senales,
      fase: m.tendencia?.estado ?? null,
      asset: m.asset,
      momentum: m.momentum,
      cambio24hPct: Number((m.cambio24h * 100).toFixed(1)),
      volumen24hM: Number((m.volumen24h / 1e6).toFixed(1)),
      rsi14d: ctx.rsi14d,
      rsi14h: ctx.rsi14h,
      distanciaMax30dPct: ctx.distanciaMax30dPct,
      saltoVolumen: salto,
      stopSugeridoPct: stops?.limitePct ?? null,
      objetivoSugeridoPct: stops?.objetivoPct ?? null,
      tipoObjetivo: stops?.tipoObjetivo ?? null,
      riesgoBeneficio: stops?.riesgoBeneficio ?? null,
      volatilidadDiariaPct: stops?.volatilidadDiariaPct ?? null,
    });
  }

  oportunidades.sort((a, b) => b.score - a.score);

  // Cada aviso queda registrado: es el dato que permite probar si los criterios
  // sirven. Sin esto, los casos donde no operamos no dejan rastro.
  if (registrar) {
    for (const o of oportunidades) {
      appendAprendizaje({
        tipo: 'oportunidad', ts: new Date().toISOString(),
        asset: o.asset, regimen: regimen.tipo, criterios: CRITERIOS, deteccion: o,
      });
    }
  }
  return { regimen, oportunidades, descartadas, motivo: oportunidades.length ? null : 'ningún candidato pasó los criterios' };
}

// ---------------------------------------------------------------------------
// B · HIPÓTESIS: qué creemos, con qué evidencia, y si llegó al código
// ---------------------------------------------------------------------------

// Semilla: las afirmaciones que ya hicimos y hoy solo viven en prosa. Cada una
// declara dónde debería estar implementada, para poder detectar la deriva
// entre "lo que decimos" y "lo que el motor hace".
const SEMILLA = [
  {
    id: 'rsi-sobrecompra',
    enunciado: 'No entrar en un activo con RSI14 > 80: comprar en sobrecompra extrema tiene castigo estadístico.',
    estado: 'abierta',
    origen: '2026-08-18 (corte de GPS, RSI 90 al entrar)',
    evidencia: ['GPS entró con RSI ~90 → −26,1%', 'ACE entró sobrecomprada → −16,3%'],
    contraEvidencia: [],
    implementacion: { esperada: 'filtro en el ranking de candidatos (engine.mjs)', patron: 'rsi', enCodigo: false },
  },
  {
    id: 'ventana-momentum-30d',
    enunciado: 'La ventana de momentum de 30 días supera a la de 7 días: 7d compra pumps recientes, 30d compra tendencias.',
    estado: 'respaldada',
    origen: '2026-08-19 (backtest v2b/v2d)',
    evidencia: ['backtest 90d: v2b +34,6% vs v1 −29,5%', 'backtest 180d: v2b +54,4% vs v1 −35,4%'],
    contraEvidencia: [],
    implementacion: { esperada: 'parámetro de ventana en rebalance (engine.mjs)', patron: 'VENTANA_DIAS', enCodigo: false },
  },
  {
    id: 'frecuencia-comisiones',
    enunciado: 'Operar menos rinde más: el rebalanceo diario quema en comisiones más de lo que aporta.',
    estado: 'respaldada',
    origen: '2026-08-19 (backtest v2c/v2d)',
    evidencia: ['v1 diario: 26,1% del capital en comisiones a 180d', 'v2d semanal: 5,5% y mejor retorno'],
    contraEvidencia: [],
    implementacion: { esperada: 'cadencia de rebalanceo configurable', patron: 'REBALANCE_CADA', enCodigo: false },
  },
  {
    id: 'stops-por-volatilidad',
    enunciado: 'Los stops deben dimensionarse por la volatilidad del activo, no fijos: un −8% en algo que se mueve 17% diario salta por ruido.',
    estado: 'confirmada',
    origen: '2026-08-18 (lección GPS)',
    evidencia: ['GPS con stop fijo −8% salió a −26,1%', 'stopsSugeridos() usa 1,5× volatilidad diaria'],
    contraEvidencia: [],
    implementacion: { esperada: 'stopsSugeridos() en engine.mjs', patron: 'stopsSugeridos', enCodigo: false },
  },
  {
    id: 'brecha-stops',
    enunciado: 'Con monitoreo discreto (3 min) y equipo que duerme, los stops se pasan de largo mientras los objetivos se cumplen. En real, una OCO ejecutaría en el nivel.',
    estado: 'confirmada',
    origen: '2026-08-19 (audit de brechas)',
    evidencia: ['ACE: nivel −12% → salida −16,3% (−4,3 pp)', 'GPS: nivel −8% → salida −26,1% (−18,1 pp)', 'objetivos: SOL 0,0 pp y ETH +1,3 pp'],
    contraEvidencia: [],
    implementacion: { esperada: 'brechaPp registrada al cerrar (engine.mjs)', patron: 'brechaPp', enCodigo: false },
  },
  {
    id: 'tokenizados-volumen-finde',
    enunciado: 'Las acciones tokenizadas se detectan porque su volumen de fin de semana cae bajo el 10% del de un día hábil.',
    estado: 'respaldada',
    origen: '2026-08-19 (hallazgo CRCLB)',
    evidencia: ['CRCLB: 11,1% de volumen el finde (vs RE cripto en 70%)'],
    contraEvidencia: ['CRCLB se filtró por estar apenas sobre el umbral: el 10% no es un corte limpio'],
    implementacion: { esperada: 'detección por patrón de volumen + lista TOKENIZADOS', patron: 'TOKENIZADOS', enCodigo: false },
  },
  {
    id: 'cuarentena-recompra',
    enunciado: 'No recomprar un activo cortado por stop en los 3 días siguientes: el impulso que lo cortó suele seguir.',
    estado: 'abierta',
    origen: '2026-08-19 (audit crítico 1)',
    evidencia: ['el modelo propuso recomprar GPS y ACE el mismo día del corte'],
    contraEvidencia: [],
    implementacion: { esperada: 'enCuarentena() veta antes del ranking (engine.mjs)', patron: 'enCuarentena', enCodigo: false },
  },
  {
    id: 'sizing-riesgo-fijo',
    enunciado: 'Hay que fijar el riesgo por jugada (no el monto): con monto fijo, un stop ancho arriesga 3× más que uno estrecho sin razón.',
    estado: 'abierta',
    origen: '2026-08-19 (audit de sizing)',
    evidencia: ['riesgo real por jugada varió entre 0,20 y 0,60 USDT (3×)'],
    contraEvidencia: ['con sleeve de 20 USDT y mínimo de orden de 5, el riesgo fijo choca con el piso del exchange'],
    implementacion: { esperada: 'cálculo de monto desde riesgo objetivo', patron: 'riesgoObjetivo', enCodigo: false },
  },
  {
    id: 'umbral-plazo-por-volatilidad',
    enunciado: 'El plazo debe liquidar si el rendimiento NETO no supera la comisión ida+vuelta más 0,5x la volatilidad diaria: salir en el punto de equilibrio de un activo que oscila 4-6% al día lo decide el ruido, no la tesis.',
    estado: 'abierta',
    origen: '2026-08-22 (auditoría del motor de plazos)',
    evidencia: [
      'el umbral original era 0 y no descontaba la comisión: entre 0% y +0,20% una posición sobrevivía perdiendo plata',
      'es la misma lección de GPS (-18,1 pp) y ACE (-4,3 pp) que ya rige los stops en 1,5x la volatilidad',
    ],
    contraEvidencia: [
      'el multiplicador 0,5x es un juicio por analogía con el 1,5x de los stops, no un valor medido',
      'con n=0 cierres por plazo todavía no hay un solo caso para saber si el umbral separa bien',
    ],
    // Qué habría que mirar cuando existan datos: de las liquidadas por plazo,
    // cuántas habrían recuperado si se las dejaba correr (falsos cortes) contra
    // cuántas siguieron cayendo (cortes acertados).
    implementacion: { esperada: 'umbralPlazoPct() = 2*FEE + BANDA_RUIDO_VOL * volatilidad (engine.mjs)', patron: 'BANDA_RUIDO_VOL', enCodigo: false },
  },
  {
    id: 'score-de-confianza',
    enunciado: 'El score 0-100 (RSI 36 + fase 24 + régimen 12 + volumen 14 + RSI-1h 14, umbral 65) predice el resultado: las ofertas con score alto deben rendir mejor que las de score bajo.',
    estado: 'abierta',
    origen: '2026-08-23 (lámina 3 del póster: puntuar en vez de filtrar binario)',
    evidencia: ['el binario trataba igual RSI 70,1 y RSI 86; la semana del 21-08 rechazó 12/12 sin matices'],
    contraEvidencia: ['los pesos son un juicio por diseño, no medidos', 'con n=0 ofertas puntuadas cerradas no hay un solo caso'],
    implementacion: { esperada: 'scoreSetup() con umbral 60 en buscarOportunidades (aprendizaje.mjs)', patron: 'UMBRAL_SCORE', enCodigo: false },
  },
  {
    id: 'modelo-nunca-corrio',
    enunciado: 'Lo que estamos validando no es el modelo codificado sino el criterio discrecional: el modelo v1 no ejecutó ninguna de las jugadas.',
    estado: 'confirmada',
    origen: '2026-08-19 (audit del ledger)',
    evidencia: ['0 de 6 movimientos con categoría "plan": todos fueron jugadas manuales'],
    contraEvidencia: [],
    implementacion: { esperada: 'sub-bolsillo que el modelo opere sin intervención', patron: null, enCodigo: false },
  },
];

export function leerHipotesis() {
  const guardadas = leerJSON(HIPOTESIS);
  if (!guardadas?.hipotesis?.length) {
    // primera corrida: se siembra con lo que ya sabemos
    const inicial = { creado: new Date().toISOString(), hipotesis: SEMILLA };
    escribirAprendizaje(HIPOTESIS, inicial);
    return inicial;
  }
  // Se FUSIONA la semilla con lo guardado. Antes se devolvía el archivo tal
  // cual, así que una hipótesis nueva agregada a SEMILLA no llegaba nunca a una
  // instalación ya sembrada: se ignoraba en silencio. Lo guardado siempre gana
  // (lleva el estado y la evidencia acumulada); solo se añade lo que falta.
  const conocidas = new Set(guardadas.hipotesis.map(h => h.id));
  const nuevas = SEMILLA.filter(h => !conocidas.has(h.id));
  if (nuevas.length) {
    guardadas.hipotesis.push(...nuevas);
    escribirAprendizaje(HIPOTESIS, guardadas);
    console.log(`[APRENDIZAJE] ${nuevas.length} hipótesis nueva(s) incorporada(s): ${nuevas.map(h => h.id).join(', ')}`);
  }
  return guardadas;
}

export function actualizarHipotesis(id, cambios) {
  const data = leerHipotesis();
  const h = data.hipotesis.find(x => x.id === id);
  if (!h) throw new Error(`No existe la hipótesis "${id}"`);
  Object.assign(h, cambios, { actualizado: new Date().toISOString() });
  escribirAprendizaje(HIPOTESIS, data);
  return h;
}

export function agregarHipotesis(h) {
  const data = leerHipotesis();
  if (data.hipotesis.some(x => x.id === h.id)) throw new Error(`La hipótesis "${h.id}" ya existe`);
  data.hipotesis.push({ estado: 'abierta', evidencia: [], contraEvidencia: [], creado: new Date().toISOString(), ...h });
  escribirAprendizaje(HIPOTESIS, data);
  return h;
}

// DERIVA: lo que declaramos como regla pero el motor no hace. Es el hueco entre
// la bitácora y el código — donde vivía la regla del RSI todo este tiempo.
export function deriva() {
  // TODOS los módulos, no solo engine y server: `hora-local-no-utc` vivía en
  // telegram.mjs y el detector no lo leía, así que la daba por incumplida para
  // siempre.
  const fuente = ['engine.mjs', 'server.mjs', 'telegram.mjs', 'aprendizaje.mjs']
    .map(f => { try { return readFileSync(join(DIR, f), 'utf8'); } catch { return ''; } })
    .join('\n');
  return leerHipotesis().hipotesis.map(h => {
    const patron = h.implementacion?.patron;
    const enCodigo = patron ? fuente.includes(patron) : false;
    // `implementacion: null` = la hipótesis no se traduce en código (p. ej. una
    // regla de verificación). Sin esta distinción aparecía como deriva eterna.
    const esDeCodigo = h.implementacion != null;
    const respaldada = ['respaldada', 'confirmada'].includes(h.estado);

    // BUSCAR UN SUBSTRING PRUEBA PRESENCIA, NUNCA AUSENCIA DE IMPLEMENTACIÓN.
    //
    // Que el patrón no aparezca admite dos lecturas opuestas: el motor dejó de
    // cumplir la regla, o la hipótesis apunta a un nombre que ya no existe.
    // `VENTANA_DIAS` se renombró a `VENTANA_MODELO_DIAS` y el detector denunció
    // una regla que SÍ estaba implementada — 3 de sus 4 alarmas eran falsas, y
    // un control que grita en falso se termina ignorando.
    //
    // Llamarlo "brecha" afirmaba la primera lectura sin poder distinguirla de
    // la segunda. Se declara lo único cierto: no se pudo verificar, y alguien
    // tiene que mirar cuál de las dos es.
    return {
      id: h.id,
      estado: h.estado,
      enunciado: h.enunciado,
      esperada: h.implementacion?.esperada ?? null,
      enCodigo,
      sinVerificar: respaldada && esDeCodigo && !enCodigo,
      // por qué no se pudo: sin patrón no hay nada que buscar; con patrón, o
      // el motor no lo trae o el nombre quedó viejo
      motivo: !esDeCodigo ? null
        : patron == null ? 'la hipótesis no declara patrón que buscar'
        : enCodigo ? null
        : `"${patron}" no aparece en ningún módulo: revisar si el motor lo dejó de hacer o si el nombre cambió`,
    };
  });
}

// ---------------------------------------------------------------------------
// C · PATRONES: cruces con umbral de confianza obligatorio
// ---------------------------------------------------------------------------

function calidad(n) {
  if (n >= N_MINIMO) return { nivel: 'suficiente', nota: `n=${n}: empieza a ser señal` };
  if (n >= N_ORIENTATIVO) return { nivel: 'orientativo', nota: `n=${n}: pista, no conclusión (hacen falta ${N_MINIMO})` };
  return { nivel: 'insuficiente', nota: `n=${n}: es ruido, no señal (hacen falta ${N_MINIMO})` };
}

const prom = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

// Une cada posición cerrada con el contexto que se capturó al abrirla.
function jugadasConContexto() {
  const pos = leerJSON(POSICIONES)?.posiciones ?? [];
  const regs = leerAprendizaje();
  const decisiones = new Map(regs.filter(r => r.tipo === 'decision').map(r => [r.posicionId, r]));
  const veredictos = new Map(regs.filter(r => r.tipo === 'veredicto').map(r => [r.posicionId, r]));
  return pos.filter(p => p.estado === 'cerrada' && p.pnlPct != null).map(p => ({
    ...p,
    decision: decisiones.get(p.id) ?? null,
    veredicto: veredictos.get(p.id) ?? null,
  }));
}

// Un segmento agrupa jugadas por una característica y reporta su resultado
// junto con la calidad de la muestra. Nunca devuelve un número sin su n.
function segmentar(jugadas, nombre, clasificar) {
  const grupos = new Map();
  for (const j of jugadas) {
    const k = clasificar(j);
    if (k == null) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(j);
  }
  const filas = [...grupos].map(([grupo, js]) => ({
    grupo,
    n: js.length,
    aciertoPct: (js.filter(j => j.pnlPct > 0).length / js.length) * 100,
    resultadoProm: prom(js.map(j => j.pnlPct)),
  })).sort((a, b) => b.n - a.n);
  return { nombre, filas, total: jugadas.length, calidad: calidad(jugadas.length) };
}

export function patrones() {
  const j = jugadasConContexto();
  if (!j.length) return { jugadas: 0, calidad: calidad(0), segmentos: [] };
  return {
    jugadas: j.length,
    calidad: calidad(j.length),
    conContexto: j.filter(x => x.decision?.contexto).length,
    conVeredicto: j.filter(x => x.veredicto).length,
    segmentos: [
      segmentar(j, 'Por ancho del stop', x =>
        x.limitePct == null ? null : x.limitePct > -6 ? 'estrecho (>−6%)' : x.limitePct > -11 ? 'medio (−6 a −11%)' : 'ancho (≤−11%)'),
      segmentar(j, 'Por RSI diario al entrar', x => {
        const r = x.decision?.contexto?.rsi14d;
        return r == null ? null : r > 80 ? 'sobrecompra (>80)' : r > 60 ? 'alto (60-80)' : r > 40 ? 'neutro (40-60)' : 'bajo (<40)';
      }),
      segmentar(j, 'Por régimen de mercado', x => x.decision?.contexto?.regimen?.tipo ?? null),
      segmentar(j, 'Por quién decidió', x =>
        /plan del modelo|modelo v/i.test(x.origen ?? '') ? 'modelo' : 'discrecional'),
      segmentar(j, 'Por duración', x => {
        if (!x.abierto || !x.cerrado) return null;
        const h = (new Date(x.cerrado) - new Date(x.abierto)) / 3.6e6;
        return h < 6 ? 'menos de 6 h' : h < 24 ? '6-24 h' : h < 72 ? '1-3 días' : 'más de 3 días';
      }),
      segmentar(j, 'Por veredicto', x => x.veredicto?.veredicto ?? null),
    ].filter(s => s.filas.length),
  };
}

// ---------------------------------------------------------------------------
// EVOLUCIÓN: las tres pistas de cómo fue creciendo el proyecto
// ---------------------------------------------------------------------------

// Pista 3 (sistema): la bitácora es la única fuente de cómo evolucionó la
// plataforma. Se extraen sus entradas para poder consultarlas por tipo.
export function evolucionSistema() {
  if (!existsSync(BITACORA)) return [];
  const texto = readFileSync(BITACORA, 'utf8');
  const entradas = [];
  // `\Z` NO existe en JavaScript: es la letra Z literal. El cuerpo de cada
  // entrada se cortaba en la primera "Z" del texto — y "ZEC" aparece por todos
  // lados —, así que todo lo que viniera después quedaba invisible para el
  // extractor. Las lecciones se escriben al final de la entrada: eran justo lo
  // que se perdía. `$(?![\s\S])` sí es el fin absoluto del texto.
  const re = /^## (\d{4}-\d{2}-\d{2})([^\n]*)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  for (const m of texto.matchAll(re)) {
    const [, fecha, titulo, cuerpo] = m;
    const t = (titulo + cuerpo).toLowerCase();
    let tipo = 'nota';
    if (/\bbug\b|corrup|condición de carrera|falló|no veía/.test(t)) tipo = 'bug';
    if (/audit/.test(t)) tipo = 'audit';
    if (/jugada|corte|auto-stop|cosecha/.test(t)) tipo = 'trading';
    if (/card|dashboard|diseño|bento|rediseño|interactiv/.test(t)) tipo = 'interfaz';
    if (/backtest|modelo v|versión/.test(t)) tipo = 'modelo';
    entradas.push({
      fecha,
      titulo: titulo.replace(/^\s*—\s*/, '').trim(),
      tipo,
      lecciones: [...cuerpo.matchAll(/\*\*Lecci[oó]n[^:]*:?\*\*\s*([^\n]+)/gi)].map(x => x[1].trim()),
    });
  }
  return entradas;
}

// Pista 2 (modelo): versiones declaradas en el plan + su estado.
export function evolucionModelo() {
  const plan = join(ROOT, 'PLAN-DE-ACCION.md');
  if (!existsSync(plan)) return [];
  const texto = readFileSync(plan, 'utf8');
  const filas = [];
  // La sexta columna (sello) es opcional: las versiones anteriores al mecanismo
  // no lo tienen y se declaran con "—".
  for (const m of texto.matchAll(/^\|\s*(v\d[a-z]?)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|(?:\s*([^|]*)\|)?/gm)) {
    const sello = (m[6] ?? '').trim().replace(/`/g, '');
    filas.push({
      version: m[1], desde: m[2].trim(), cambio: m[3].trim(),
      motivo: m[4].trim(), resultado: m[5].trim(),
      sello: /^m-[0-9a-f]{8}$/.test(sello) ? sello : null,
    });
  }
  return filas;
}

// DERIVA DEL MODELO: sellos que el motor produjo y la tabla nunca declaró.
//
// Esta tabla ya se pudrió una vez —se quedó en v2a mientras el motor cambiaba
// cinco veces— y arreglarla a mano sin un mecanismo que la vigile es repetir
// exactamente el error. El registro de sellos (`data/versiones.json`) lo
// escribe el motor solo, así que sirve de contraparte: cualquier sello que haya
// operado y no esté en la tabla es documentación que faltó escribir.
export function sellosNoDeclarados() {
  const declarados = new Set(evolucionModelo().map(v => v.sello).filter(Boolean));
  const f = join(DATA, 'versiones.json');
  const registrados = existsSync(f) ? Object.entries(leerJSON(f)?.versiones ?? {}) : [];
  return registrados
    .filter(([sello]) => !declarados.has(sello))
    .map(([sello, v]) => ({ sello, desde: v.desde }));
}

// Pista 1 (trading): cómo evolucionó el resultado día a día.
export function evolucionTrading() {
  if (!existsSync(HISTORY)) return [];
  const [, ...filas] = readFileSync(HISTORY, 'utf8').trim().split('\n');
  return filas.map(l => {
    const [fecha, sim, real, btc, picks] = l.split(',');
    return {
      fecha,
      ficticia: parseFloat(sim) || null,
      real: real ? parseFloat(real) : null,
      btc: parseFloat(btc) || null,
      picks: picks ? picks.split('|') : [],
    };
  });
}

// ---------------------------------------------------------------------------
// INFORME
// ---------------------------------------------------------------------------

export function informe() {
  const movs = leerJSONL(MOVIMIENTOS);
  const porCategoria = {};
  for (const m of movs) porCategoria[m.categoria ?? 'sin-categoria'] = (porCategoria[m.categoria ?? 'sin-categoria'] ?? 0) + 1;
  return {
    generado: new Date().toISOString(),
    patrones: patrones(),
    hipotesis: leerHipotesis().hipotesis.map(h => ({
      id: h.id, estado: h.estado, enunciado: h.enunciado,
      evidencia: h.evidencia?.length ?? 0, contra: h.contraEvidencia?.length ?? 0,
    })),
    deriva: deriva().filter(d => d.sinVerificar),
    pendientes: veredictosPendientes(),
    evolucion: {
      trading: evolucionTrading(),
      modelo: evolucionModelo(),
      sistema: evolucionSistema(),
    },
    movimientosPorCategoria: porCategoria,
  };
}

// --- CLI -------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const inf = informe();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(inf, null, 2));
  } else {
    const p = inf.patrones;
    console.log('\n═══ MOTOR DE APRENDIZAJE ═══\n');

    console.log(`MUESTRA · ${p.jugadas} jugada(s) cerrada(s) — ${p.calidad.nota}`);
    if (p.jugadas) console.log(`  con contexto capturado: ${p.conContexto}/${p.jugadas} · con veredicto: ${p.conVeredicto}/${p.jugadas}`);

    if (p.segmentos.length) {
      console.log('\nPATRONES (leer con la muestra en mente)');
      for (const s of p.segmentos) {
        console.log(`\n  ${s.nombre}`);
        for (const f of s.filas) {
          console.log(`    ${f.grupo.padEnd(26)} n=${String(f.n).padStart(2)}  acierto ${f.aciertoPct.toFixed(0).padStart(3)}%  resultado ${f.resultadoProm >= 0 ? '+' : ''}${f.resultadoProm.toFixed(1)}%`);
        }
      }
    }

    console.log('\nHIPÓTESIS');
    const orden = { confirmada: 0, respaldada: 1, abierta: 2, refutada: 3 };
    for (const h of inf.hipotesis.sort((a, b) => (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9))) {
      console.log(`  [${h.estado.padEnd(11)}] ${h.id.padEnd(26)} ${h.evidencia}✓ ${h.contra}✗`);
    }

    if (inf.deriva.length) {
      console.log('\n⚠ DERIVA — lo que creemos pero el motor NO hace');
      for (const d of inf.deriva) console.log(`  · ${d.id}: falta ${d.esperada}`);
    }

    if (inf.pendientes.length) {
      console.log('\nVEREDICTOS PENDIENTES (jugadas cerradas sin lección registrada)');
      for (const v of inf.pendientes) console.log(`  · ${v.asset} (${v.id}) ${v.pnlPct >= 0 ? '+' : ''}${v.pnlPct.toFixed(1)}% — ${v.motivoCierre}`);
    }

    const ev = inf.evolucion;
    console.log(`\nEVOLUCIÓN · ${ev.trading.length} día(s) medido(s) · ${ev.modelo.length} versión(es) de modelo · ${ev.sistema.length} entrada(s) de bitácora`);
    const porTipo = {};
    for (const e of ev.sistema) porTipo[e.tipo] = (porTipo[e.tipo] ?? 0) + 1;
    console.log('  bitácora por tipo: ' + Object.entries(porTipo).map(([k, v]) => `${k} ${v}`).join(' · '));
    console.log('  movimientos por categoría: ' + Object.entries(inf.movimientosPorCategoria).map(([k, v]) => `${k} ${v}`).join(' · '));
    console.log('');
  }
}
