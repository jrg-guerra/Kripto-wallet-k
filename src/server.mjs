// Servidor local del dashboard. Solo escucha en 127.0.0.1 — nada sale de tu Mac.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { marketSnapshotParaBot, runAnalysis, getState, refreshMarket, marketHistory, aplicarPlan, chequearAlertas, ejecutarStops, jugadaManual, conCandado, estadoOcupado, crearOferta, ofertasVigentes, congelado, motivoCongelado, descongelar, tomarOferta, descartarOferta, vigilarOferta, stopsSugeridos, montoPorRiesgo, compuertaRiesgo, fijarHorizonte, seguimientoCierres, atribucionBrecha, watchlist, agregarWatch, cancelarWatch, evaluarWatchlist, marcarWatchOferta, versionMotor, registrarSnapshotDeVigilancia, radar24h, fijarTrailing } from './engine.mjs';

// --- HORA EN CADA LÍNEA DEL LOG ---------------------------------------------
//
// El log era la única traza de lo que el motor hizo sin nadie mirando —
// auto-stops, alertas, fallas— y salía sin hora. "AUTO-STOP ejecutado" sin
// timestamp no sirve para auditar nada: la pregunta siempre es *cuándo*.
//
// Hora LOCAL, no UTC: es la frontera del día en todo el resto del proyecto.
{
  const marca = () => new Date().toLocaleTimeString('es-CL', {
    hour12: false, timeZone: 'America/Santiago',
  });
  for (const nivel of ['log', 'error', 'warn']) {
    const original = console[nivel].bind(console);
    console[nivel] = (...args) => original(`[${marca()}]`, ...args);
  }
}

const DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(DIR, '..', 'public');
const PORT = 8517;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// Lee el body JSON de un POST con tope de tamaño.
const leerBody = req => new Promise((res, rej) => {
  let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
  req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { rej(new Error('JSON inválido')); } });
  req.on('error', rej);
});

// Precio puntual de un activo, para fijar el precio de referencia de la oferta.
const refreshPrecio = async asset => {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT`);
  const j = await r.json();
  return { prices: { [`${asset}USDT`]: parseFloat(j.price) } };
};

// ÚNICA vía para crear una oferta. El endpoint del dashboard y el monitor la
// comparten a propósito: cuando cada uno armaba la suya, el monitor se quedó
// con un contrato viejo (`tg.crearOferta`) y estuvo semanas fallando en
// silencio dentro de su `catch`. Un solo camino no puede desincronizarse.
//
// `extra` deja pasar datos que quien llama ya tiene medidos, para no volver a
// pedirlos a Binance.
// `montoUSDT = null` significa "dimensionalo vos por riesgo". Un número explícito
// lo impone (jugada manual desde el dashboard).
async function nuevaOferta(asset, montoUSDT, extra = {}) {
  const ap = await import('./aprendizaje.mjs');
  // el contexto trae el techo de 30d, que define el objetivo estructural: hay
  // que pedirlo ANTES de los stops, no en paralelo
  const ctx = await ap.contextoEntrada(asset);
  const stops = await stopsSugeridos(asset, {
    distanciaTechoPct: ctx.distanciaMax30dPct,
    // el piso sale del MISMO contexto: cero llamadas extra, igual que el techo
    distanciaPisoPct: ctx.distanciaPisoPct,
    senal: extra.senal ?? null,
  });
  const { prices } = await refreshPrecio(asset);
  const salto = extra.saltoVolumen ?? await ap.saltoVolumen(asset).catch(() => null);
  // El tamaño sale del riesgo, no de un monto fijo: con stop por volatilidad,
  // el mismo monto arriesga hasta 8x más en un activo volátil que en uno quieto.
  const sizing = montoUSDT == null ? montoPorRiesgo(stops.limitePct) : null;
  // El tope es duro y se aplica venga el monto de donde venga: una aprobación
  // desde el teléfono nunca puede comprometer más que esto.
  const monto = Math.min(TOPE_OFERTA_USDT, sizing ? sizing.montoUSDT : montoUSDT);

  // COMPUERTA: el único lugar donde nacen las ofertas es también el único donde
  // se pregunta "¿puedo abrir esto?". Los bloqueos detienen; los avisos viajan
  // con la oferta para que Jorge los vea antes de aprobar.
  // Los precios de la CARTERA COMPLETA, no solo el del activo que se compra:
  // `refreshPrecio()` trae un único símbolo, y con eso `walletValue` valoraba en
  // CERO todo lo demás. La compuerta veía una caída del 81,9% y bloqueaba TODAS
  // las ofertas automáticas. Un control alimentado con datos parciales es peor
  // que no tener control: bloquea lo bueno y da confianza falsa.
  const { prices: preciosCartera } = await marketSnapshotParaBot();
  const puerta = compuertaRiesgo({ montoUSDT: monto, limitePct: stops.limitePct,
    // el objetivo viaja a la compuerta para que el R:B mínimo rija también en
    // las ofertas pedidas a mano, no solo en las que filtra el screening
    objetivoPct: stops.objetivoPct,
    volatilidadDiariaPct: stops.volatilidadDiariaPct }, { ...preciosCartera, ...prices });
  if (!puerta.pasa) {
    const e = new Error(`riesgo: ${puerta.bloqueos.join(' · ')}`);
    e.codigo = 423;
    throw e;
  }

  const oferta = crearOferta({
    asset, montoUSDT: monto,
    limitePct: stops.limitePct, objetivoPct: stops.objetivoPct,
    precio: prices[`${asset}USDT`],
    contexto: {
      rsi14d: ctx.rsi14d, rsi14h: ctx.rsi14h, volumen24hM: ctx.volumen24hM,
      distanciaMax30dPct: ctx.distanciaMax30dPct, momentum7dPct: ctx.momentum7dPct,
      saltoVolumen: salto,
      volatilidadDiariaPct: stops.volatilidadDiariaPct,
      // contextoEntrada ya resolvió el régimen: pedirlo de nuevo era una
      // segunda pasada por todo el universo para el mismo dato
      regimen: extra.regimen ?? ctx.regimen?.tipo ?? null,
      // confianza del screening cuando la oferta nace de él (watchlist y
      // dashboard manual no puntúan: null honesto, no un número inventado)
      score: extra.score ?? null,
      // patrón que la originó: el aprendizaje compara qué señal rinde mejor
      senal: extra.senal ?? null,
      senalNombre: extra.senalNombre ?? null,
      senalLectura: extra.senalLectura ?? null,
      // plan de la entrada: de dónde sale el objetivo y qué relación ofrece
      tipoObjetivo: stops.tipoObjetivo,
      riesgoBeneficio: stops.riesgoBeneficio,
      alTechoPct: stops.alTechoPct,
      // estructura por abajo: de dónde sale el stop y dónde muere la tesis
      tipoStop: stops.tipoStop,
      alPisoPct: stops.alPisoPct,
      invalidacionPct: stops.invalidacionPct,
      // dimensionamiento: cuánto arriesga de verdad y si un tope la desvió
      riesgoRealUSDT: sizing?.riesgoRealUSDT ?? null,
      riesgoObjetivoUSDT: sizing?.riesgoObjetivoUSDT ?? null,
      acotadoPor: sizing?.acotadoPor ?? null,
      montoIdealUSDT: sizing?.montoIdealUSDT ?? null,
      avisosRiesgo: puerta.avisos.length ? puerta.avisos : null,
    },
  });
  // Se avisa al teléfono, pero la oferta ya existe en el estado: si Telegram
  // falla, sigue tomable desde el dashboard.
  try {
    const tg = await import('./telegram.mjs');
    if (tg.telegramActivo()) await tg.avisarOferta(oferta);
  } catch (e) { console.error('telegram:', e.message); }
  return oferta;
}

let _radar24 = { t: 0, data: null };

const server = createServer(async (req, res) => {
  const json = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  try {
    if (req.method === 'GET' && req.url === '/api/state') return json(200, getState());
    if (req.method === 'GET' && req.url === '/api/market-history') return json(200, await marketHistory());
    if (req.method === 'GET' && req.url === '/api/alertas') return json(200, await chequearAlertas());
    if (req.method === 'GET' && req.url === '/api/aprendizaje') {
      const { informe } = await import('./aprendizaje.mjs');
      return json(200, informe());
    }
    // Contrafactual: qué hizo el precio de los candidatos que NO compramos,
    // agrupado por el filtro que los rechazó. Sale a la red a pedir velas, así
    // que va aparte del informe y no se recalcula en cada carga del dashboard.
    if (req.method === 'GET' && req.url === '/api/candidatos') {
      const { seguimientoCandidatos } = await import('./aprendizaje.mjs');
      return json(200, await seguimientoCandidatos());
    }
    // Veredicto de una jugada cerrada: lo que convierte un resultado en lección
    if (req.method === 'POST' && req.url === '/api/veredicto') {
      try {
        const body = await leerBody(req);
        const { registrarVeredicto } = await import('./aprendizaje.mjs');
        return json(200, registrarVeredicto(body));
      } catch (e) {
        return json(e.codigo ?? 400, { error: e.message });
      }
    }
    // Análisis de las decisiones ya tomadas. Ambos pegan a Binance (velas y
    // precios), así que van en endpoints separados: si uno falla o tarda, el
    // otro se sigue viendo.
    if (req.method === 'GET' && req.url === '/api/seguimiento') {
      try { return json(200, await seguimientoCierres()); }
      catch (e) { return json(500, { error: e.message }); }
    }
    if (req.method === 'GET' && req.url === '/api/atribucion') {
      try { return json(200, await atribucionBrecha()); }
      catch (e) { return json(500, { error: e.message }); }
    }

    // SALUD DEL MOTOR. El `● en vivo` del dashboard es el WebSocket del
    // NAVEGADOR: puede estar verde con el motor muerto hace horas. Este dato ya
    // existía en `ultimaVigilada` y no salía a ningún lado — con 91% de ceguera
    // medida en 48 h, saber si el motor corrió es lo primero que hay que ver.
    if (req.method === 'GET' && req.url === '/api/estado') {
      const desdeMin = (Date.now() - ultimaVigilada) / 60000;
      return json(200, {
        ultimaVigilancia: new Date(ultimaVigilada).toISOString(),
        haceMin: Number(desdeMin.toFixed(1)),
        intervaloMin: MONITOR_MS / 60000,
        // "al día" mientras no se haya saltado más de un ciclo y medio: por
        // encima de eso el motor está dormido o atascado, no lento.
        sano: desdeMin <= (MONITOR_MS / 60000) * 1.5,
        ocupado: estadoOcupado() || null,
        congelado: congelado(),
        motivoCongelado: motivoCongelado(),
        version: await versionMotor(),
        procesoDesde: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      });
    }

    // Radar de las próximas 24 h. Caché de 5 min: son 13 llamadas a Binance y
    // el recorrido esperado no cambia de minuto a minuto.
    if (req.method === 'GET' && req.url === '/api/radar24') {
      try {
        if (_radar24.data && Date.now() - _radar24.t < 5 * 60_000) return json(200, _radar24.data);
        _radar24 = { t: Date.now(), data: await radar24h() };
        return json(200, _radar24.data);
      } catch (e) { return json(500, { error: e.message }); }
    }

    // Trailing sobre posiciones abiertas: "si se devuelve X% desde su pico, salir".
    if (req.method === 'POST' && req.url === '/api/posicion/trailing') {
      try {
        const { ids, pct } = await leerBody(req);
        if (!Array.isArray(ids) || !ids.length) return json(400, { error: 'faltan los ids' });
        return json(200, await conCandado('trailing', () => fijarTrailing(ids, pct ?? null)));
      } catch (e) { return json(e.codigo ?? 400, { error: e.message }); }
    }

    // Estado de la compuerta de riesgo, sin plan concreto: para el dashboard.
    if (req.method === 'GET' && req.url === '/api/riesgo') {
      try {
        const { prices } = await marketSnapshotParaBot();
        return json(200, compuertaRiesgo({}, prices));
      } catch (e) { return json(500, { error: e.message }); }
    }

    // --- WATCHLIST: candidatos esperando su punto de entrada -----------------
    if (req.method === 'GET' && req.url === '/api/watchlist') {
      return json(200, { entradas: watchlist() });
    }
    if (req.method === 'POST' && req.url === '/api/watchlist') {
      try {
        const { asset, condicion, zonaPct, motivo, origen = 'dashboard' } = await leerBody(req);
        if (!asset) return json(400, { error: 'falta el activo' });
        // el precio de referencia lo pone el SERVIDOR, no el cliente: así la
        // zona queda anclada a un precio real y verificable
        let precioRef = null;
        if (zonaPct != null) {
          const { prices } = await refreshPrecio(asset);
          precioRef = prices[`${asset}USDT`];
        }
        return json(200, agregarWatch({ asset, condicion, zonaPct, precioRef, motivo, origen }));
      } catch (e) { return json(e.codigo ?? 500, { error: e.message }); }
    }
    if (req.method === 'POST' && req.url === '/api/watchlist/cancelar') {
      try {
        const { id, origen = 'dashboard' } = await leerBody(req);
        return json(200, cancelarWatch(id, origen));
      } catch (e) { return json(e.codigo ?? 500, { error: e.message }); }
    }

    // --- OFERTAS: se pueden tomar desde el dashboard o desde Telegram --------
    if (req.method === 'GET' && req.url === '/api/ofertas') {
      return json(200, { ofertas: ofertasVigentes(), congelado: congelado(), motivoCongelado: motivoCongelado() });
    }

    // Reactivar la ejecución. Solo desde acá: el servidor escucha únicamente en
    // 127.0.0.1, así que llegar a este endpoint ya significa estar en el Mac.
    // Por eso Telegram puede congelar pero no descongelar.
    if (req.method === 'POST' && req.url === '/api/descongelar') {
      descongelar('dashboard');
      return json(200, { congelado: false });
    }

    if (req.method === 'POST' && req.url === '/api/oferta') {
      try {
        const { asset, montoUSDT = null } = await leerBody(req);   // null = dimensionar por riesgo
        if (!asset) return json(400, { error: 'falta el activo' });
        return json(200, { oferta: await nuevaOferta(asset, montoUSDT) });
      } catch (e) {
        return json(e.codigo ?? 500, { error: e.message });
      }
    }

    // Plazo sobre posiciones YA abiertas: si no rentan pasado el plazo, se
    // liquidan solas aunque el precio no haya tocado ni el límite ni el
    // objetivo. `ids` son los pos-XXXX devueltos al abrir la jugada.
    if (req.method === 'POST' && req.url === '/api/posicion/horizonte') {
      try {
        const { ids, horas, etiqueta } = await leerBody(req);
        if (!Array.isArray(ids) || !ids.length) return json(400, { error: 'faltan los ids de posición' });
        if (!Number.isFinite(horas) || horas <= 0) return json(400, { error: 'horas debe ser un número positivo' });
        return json(200, await conCandado('horizonte', () => fijarHorizonte(ids, horas, etiqueta)));
      } catch (e) {
        return json(e.codigo ?? 500, { error: e.message });
      }
    }

    if (req.method === 'POST' && req.url === '/api/oferta/tomar') {
      try {
        const { id, origen = 'dashboard' } = await leerBody(req);
        return json(200, await conCandado('tomar-oferta', () => tomarOferta(id, origen)));
      } catch (e) {
        return json(e.codigo ?? 500, { error: e.message });
      }
    }

    // Tercera salida: ni aprobar ni rechazar, sino pasar a vigilancia.
    if (req.method === 'POST' && req.url === '/api/oferta/vigilar') {
      try {
        const { id, origen = 'dashboard', zonaPct = null } = await leerBody(req);
        return json(200, vigilarOferta(id, { origen, zonaPct }));
      } catch (e) { return json(e.codigo ?? 500, { error: e.message }); }
    }

    if (req.method === 'POST' && req.url === '/api/oferta/descartar') {
      try {
        const { id, origen = 'dashboard' } = await leerBody(req);
        return json(200, descartarOferta(id, origen));
      } catch (e) {
        return json(e.codigo ?? 500, { error: e.message });
      }
    }

    if (req.method === 'POST' && req.url === '/api/jugada') {
      try {
        const body = await leerBody(req);
        return json(200, await conCandado('jugada', () => jugadaManual(body)));
      } catch (e) {
        return json(e.codigo ?? 400, { error: e.message });
      }
    }
    if (req.method === 'POST' && req.url === '/api/aplicar-plan') {
      try {
        return json(200, await conCandado('aplicar-plan', () => aplicarPlan()));
      } catch (e) {
        return json(e.codigo ?? 500, { error: e.message });
      }
    }
    if (req.method === 'POST' && req.url === '/api/refresh') {
      try {
        return json(200, await conCandado('refresh', () => refreshMarket()));
      } catch (e) {
        return json(e.codigo ?? 500, { error: e.message });
      }
    }
    if (req.method === 'POST' && req.url === '/api/run') {
      try {
        return json(200, await conCandado('run', () => runAnalysis()));
      } catch (e) {
        return json(e.codigo ?? 500, { error: e.message });
      }
    }
    if (req.method === 'GET') {
      const ruta = req.url.split('?')[0];
      const rel = ruta === '/' ? 'index.html' : ruta.slice(1);
      const file = normalize(join(PUBLIC, rel));
      if (file.startsWith(PUBLIC) && existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
        return res.end(readFileSync(file));
      }
    }
    json(404, { error: 'no encontrado' });
  } catch (e) {
    json(500, { error: e.message });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Kripto Wallet ya está corriendo en http://localhost:${PORT} — no hace falta iniciarlo de nuevo.`);
    process.exit(0);
  }
  throw e;
});

// --- Vigilancia de posiciones (nivel 3): chequeo periódico aunque el
// dashboard esté cerrado. Notifica en macOS cuando una posición cruza su
// objetivo o su límite. NO opera: solo avisa.
const MONITOR_MS = 3 * 60_000;

function notificarMac(titulo, mensaje) {
  const esc = t => String(t).replace(/["\\]/g, '\\$&');
  execFile('osascript', ['-e', `display notification "${esc(mensaje)}" with title "${esc(titulo)}" sound name "Ping"`],
    err => { if (err) console.error('notificación macOS:', err.message); });
}

// Reparte a los dos canales: macOS sirve mientras el Mac está abierto, Telegram
// llega al teléfono. Telegram nunca puede tumbar la vigilancia, así que su
// error se registra y se sigue.
function notificar(titulo, mensaje) {
  notificarMac(titulo, mensaje);
  import('./telegram.mjs')
    .then(t => t.telegramActivo() && t.enviar(`<b>${titulo}</b>\n${mensaje}`))
    .then(r => { if (r && !r.ok) console.error('telegram:', r.motivo); })
    .catch(e => console.error('telegram:', e.message));
}

// Monto fijo de las ofertas: acotarlo es parte de la salvaguarda — una
// aprobación desde el teléfono nunca puede comprometer más que esto.
// Tope duro de una aprobación desde el teléfono. Ya no es "el monto" (eso lo
// dimensiona el riesgo) sino el LÍMITE que ninguna oferta puede pasar: es la
// salvaguarda de que un toque en el móvil nunca comprometa más que esto.
const TOPE_OFERTA_USDT = 8;
const avisadosPeligro = new Set();
const WATCH_MS = 15 * 60_000;
let _ultimoWatch = 0;
// Cada cuánto el MONITOR deja un punto en la serie. 15 min y no 3: alcanza para
// que el pico de la cartera quede registrado aunque nadie mire, sin inflar el
// archivo (96 líneas al día en vez de 480).
const SNAPSHOT_MS = 15 * 60_000;
let _ultimoSnapshot = 0;

// Los bloques del monitor van envueltos en `catch` a propósito: que fallen las
// oportunidades no puede tumbar la vigilancia de los stops. Pero el `catch`
// escribía en una consola que nadie lee, y así el monitor estuvo semanas sin
// poder crear una sola oferta —llamaba a una función que ya no existía— sin que
// se notara. Un fallo silencioso vale menos que un fallo escandaloso: ahora
// avisa al Mac, una vez por error distinto para no convertirse en ruido.
const _fallasAvisadas = new Set();
function avisarFalla(etapa, e) {
  console.error(`${etapa}:`, e.message);
  const clave = `${etapa}|${e.message}`;
  if (_fallasAvisadas.has(clave)) return;
  _fallasAvisadas.add(clave);
  notificarMac(`⚙ Falla en ${etapa}`, `${e.message} — revisa el log del servidor.`);
}

let ultimaVigilada = Date.now();
async function vigilar() {
  // si pasó mucho más que el intervalo, el equipo estuvo dormido:
  // avisar cuánto tiempo las posiciones quedaron sin ojos
  const gapMs = Date.now() - ultimaVigilada;
  if (gapMs > MONITOR_MS * 3) {
    const min = Math.round(gapMs / 60000);
    console.log(`[VIGILANCIA] ${min} min sin correr (equipo dormido); revisando posiciones ahora`);
    notificar('Kripto Wallet — vigilancia reanudada', `Estuvo ${min} min sin ojos; revisando posiciones ahora.`);
  }
  ultimaVigilada = Date.now();
  // El monitor comparte el candado con los endpoints: sin esto, una jugada y
  // un auto-stop simultáneos se sobrescriben el saldo. Si hay algo en curso,
  // no se insiste: en 3 minutos vuelve a mirar.
  if (estadoOcupado()) {
    console.log(`[VIGILANCIA] pospuesta: ${estadoOcupado()} en curso`);
    return;
  }
  try {
    // NIVEL 4: el corte se ejecuta solo, en la billetera ficticia.
    const { ejecutados } = await conCandado('vigilancia', () => ejecutarStops());
    for (const e of ejecutados) {
      const esStop = e.tipo.startsWith('stop');
      const texto = `${e.asset} ${e.pnlPct >= 0 ? '+' : ''}${e.pnlPct.toFixed(1)}% → ${e.netoUSDT.toFixed(2)} USDT a reserva`;
      console.log(`[AUTO-${esStop ? 'STOP' : 'OBJETIVO'}] ${texto}`);
      notificar(esStop ? '⚠ Auto-stop ejecutado (ficticia)' : '✓ Objetivo cobrado (ficticia)', texto);
    }
    // OPORTUNIDADES: los criterios que aplicábamos a mano, ahora automáticos.
    // Van después de los stops porque un cruce siempre pesa más que una idea.
    try {
      const { buscarOportunidades } = await import('./aprendizaje.mjs');
      const { oportunidades, regimen } = await buscarOportunidades();
      const tg = await import('./telegram.mjs');
      for (const o of oportunidades) {
        console.log(`[OPORTUNIDAD] ${o.asset} RSI ${o.rsi14d} salto ${o.saltoVolumen}x`);
        notificarMac('◆ Posible oportunidad', `${o.asset} · RSI ${o.rsi14d} · revisa Telegram`);
        if (!tg.telegramActivo()) continue;
        // Con la ejecución congelada se avisa igual, pero sin oferta que tomar:
        // saber que había algo importa, poder aprobarlo no.
        if (tg.congelado()) {
          await tg.enviar(tg.fichaOportunidad(o, regimen.tipo)
            + '\n\n🔒 <i>Ejecución congelada: revísalo en el dashboard.</i>');
          continue;
        }
        // La oferta lleva monto y niveles ya fijados: aprobar es aceptar ESTO,
        // no abrir la puerta a improvisar una operación desde el teléfono.
        // `nuevaOferta` la persiste y ya avisa al teléfono con sus botones.
        await nuevaOferta(o.asset, null, {
          saltoVolumen: o.saltoVolumen, regimen: regimen.tipo, score: o.score,
          senal: o.senal, senalNombre: o.senalNombre, senalLectura: o.senalLectura,
        });
      }
    } catch (e) { avisarFalla('oportunidades', e); }

    // WATCHLIST: cada 15 min (no cada 3: son 1-2 llamadas por activo vigilado y
    // el punto de entrada no se escapa en minutos). Si una entrada cumple su
    // condición, se crea la oferta — y solo si la creación tuvo éxito la
    // entrada se marca armada: con la ejecución congelada, sigue vigilando.
    try {
      if (Date.now() - _ultimoWatch > WATCH_MS) {
        _ultimoWatch = Date.now();
        const { regimenMercado } = await import('./aprendizaje.mjs');
        const reg = await regimenMercado();
        const { listas } = await evaluarWatchlist(reg);
        for (const w of listas) {
          try {
            const oferta = await nuevaOferta(w.asset, null, { regimen: reg?.tipo });
            marcarWatchOferta(w.id, oferta.id);
            notificar('◆ Watchlist armada', `${w.asset} cumplió su condición: hay una oferta esperando tu decisión.`);
          } catch (e) { avisarFalla(`watchlist ${w.asset}`, e); }
        }
      }
    } catch (e) { avisarFalla('watchlist', e); }

    // SERIE DE LA CARTERA. La escribía solo el dashboard, así que el pico que
    // usa el freno de caída era "el máximo que Jorge estuvo mirando": un techo
    // alcanzado de madrugada no existía y la caída desde él no activaba nada.
    // Ahora el monitor deja su punto aunque no haya nadie.
    try {
      if (Date.now() - _ultimoSnapshot > SNAPSHOT_MS) {
        _ultimoSnapshot = Date.now();
        const { prices } = await marketSnapshotParaBot();
        registrarSnapshotDeVigilancia(prices);
      }
    } catch (e) { avisarFalla('snapshot de vigilancia', e); }

    // PELIGRO: posición acercándose a su límite. El auto-stop la va a cortar
    // en el nivel, pero acá se ofrece salir ANTES si Jorge sabe algo que el
    // sistema no. Se avisa una sola vez por posición.
    try {
      const tg = await import('./telegram.mjs');
      if (tg.telegramActivo()) {
        const { marketSnapshotParaBot, evaluarPosiciones } = await import('./engine.mjs');
        const { prices } = await marketSnapshotParaBot();
        for (const p of evaluarPosiciones(prices)) {
          if (p.senal !== 'cerca-limite' || avisadosPeligro.has(p.asset)) continue;
          avisadosPeligro.add(p.asset);
          // Aviso INFORMATIVO, sin botón. Pedía una oferta de salida que el core
          // nunca supo crear, y aunque se implementara sería un botón para
          // vender antes del nivel: discrecionalidad pura, lo que el modelo
          // intenta quitar. Los 6 movimientos del historial fueron
          // discrecionales y ninguno del modelo — no hace falta otra puerta.
          // El auto-stop corta en el nivel; si Jorge sabe algo que el sistema
          // no, lo hace en el dashboard con los avisos de impacto delante.
          await tg.enviar([
            `⚠️ <b>PELIGRO · ${p.asset}</b>`,
            '',
            `Cayó a <b>${p.pnlPct.toFixed(1)}%</b> — se acerca a su límite de ${p.limitePct}%.`,
            `<code>${'─'.repeat(Math.max(0, Math.round((p.progreso ?? 0) * 11)))}◆</code>`,
            `límite ${p.limite.toPrecision(6)} · ahora ${p.precio.toPrecision(6)}`,
            '',
            'El auto-stop lo cortará solo en el nivel. Esto es solo para que lo sepas.',
          ].join('\n'));
        }
        // si una posición se recupera, vuelve a ser avisable
        const enPeligro = new Set(evaluarPosiciones(prices).filter(p => p.senal === 'cerca-limite').map(p => p.asset));
        for (const a of avisadosPeligro) if (!enPeligro.has(a)) avisadosPeligro.delete(a);
      }
    } catch (e) { avisarFalla('aviso de peligro', e); }

    // posiciones que cruzaron pero no se pudieron ejecutar quedan como aviso
    const { nuevas } = await chequearAlertas();
    for (const a of nuevas.filter(n => !ejecutados.some(e => e.asset === n.asset))) {
      console.log(`[ALERTA] ${a.texto}`);
      notificar(
        a.senal === 'cruzo-limite' ? '⚠ Kripto Wallet — límite cruzado' : '✓ Kripto Wallet — objetivo alcanzado',
        a.texto);
    }
  } catch (e) {
    console.error('vigilancia:', e.message);
  }
}

setInterval(vigilar, MONITOR_MS).unref?.();

// El bot revisa mensajes más seguido que la vigilancia: una consulta desde el
// teléfono no debería esperar 3 minutos. Es polling liviano (getUpdates con
// timeout 0) y no toca el estado, así que no necesita el candado.
// El bot usa long polling: la petición se queda esperando hasta 25 s y vuelve
// en el instante en que llega un mensaje. Por eso el intervalo es corto — no
// sondea cada 2 s, solo reabre la espera en cuanto la anterior terminó. El
// propio `revisarMensajes` ignora la llamada si ya hay una en vuelo.
const BOT_MS = 2_000;
setInterval(async () => {
  try {
    const t = await import('./telegram.mjs');
    if (t.telegramActivo()) await t.revisarMensajes();
  } catch (e) { console.error('telegram:', e.message); }
}, BOT_MS).unref?.();

// El menú "/" se publica al arrancar. Antes solo se registraba al acertar el
// login, así que un bot recién instalado mostraba la lista vacía.
import('./telegram.mjs')
  .then(t => t.telegramActivo() && t.registrarComandos())
  .catch(e => console.error('telegram:', e.message));

setTimeout(vigilar, 5_000); // primer chequeo al arrancar

// --- MUERTE RUIDOSA ----------------------------------------------------------
//
// Un error no capturado mataba el proceso en silencio: el motor dejaba de
// vigilar y Jorge se enteraba al abrir el dashboard, horas después.
//
// NO se traga el error. Un motor que maneja plata con el estado a medio
// escribir es peor que uno caído: si algo llegó hasta acá, es que ninguna de
// las defensas de arriba supo qué hacer con ello. Se registra, se avisa a los
// dos canales y se sale con código 1.
//
// El candado (`conCandado`) garantiza que no había dos escrituras en vuelo, y
// la escritura atómica que ningún archivo quedó a medias. Salir es seguro.
let _muriendo = false;
function morirRuidosamente(causa, e) {
  if (_muriendo) return;          // un segundo error mientras se avisa no debe reentrar
  _muriendo = true;
  const detalle = e?.stack ?? e?.message ?? String(e);
  console.error(`FATAL · ${causa}:`, detalle);
  notificar('☠️ Kripto Wallet se detuvo',
    `${causa}: ${e?.message ?? e}. El motor dejó de vigilar — reinícialo con run-server.sh.`);
  // margen para que salgan la notificación de macOS y el mensaje de Telegram
  setTimeout(() => process.exit(1), 2000);
}

process.on('uncaughtException', e => morirRuidosamente('excepción no capturada', e));
process.on('unhandledRejection', e => morirRuidosamente('promesa rechazada sin catch', e));

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Kripto Wallet dashboard: http://localhost:${PORT}`);
});
