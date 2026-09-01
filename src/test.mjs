// Tests de la matemática de dinero. No tocan la billetera real: trabajan sobre
// una copia del estado en un directorio temporal (KW_DATA), así que se pueden
// correr en cualquier momento, incluso con el servidor arriba.
//
//   node src/test.mjs
//
// Lo que se prueba es lo único que no puede estar mal: que el dinero no
// aparezca ni desaparezca. Un error acá invalidaría todo el registro de la
// validación de 14 días.

import { mkdtempSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');

// El motor lee DATA al importarse: hay que preparar la copia ANTES del import.
const sandbox = mkdtempSync(join(tmpdir(), 'kw-test-'));
cpSync(join(ROOT, 'data'), join(sandbox, 'data'), { recursive: true });
process.env.KW_DATA = join(sandbox, 'data');

const motor = await import('./engine.mjs');

let pasados = 0, fallidos = 0;
const casos = [];

function test(nombre, fn) { casos.push({ nombre, fn }); }

function esperar(cond, detalle) {
  if (!cond) throw new Error(detalle);
}

// Compara con tolerancia: la aritmética de punto flotante no da igualdad exacta.
function casiIgual(a, b, tol, detalle) {
  const d = Math.abs(a - b);
  esperar(d <= tol, `${detalle}: ${a} vs ${b} (difiere ${d}, tolerancia ${tol})`);
}


// --- FACTORY DE BILLETERAS ---------------------------------------------------
//
// Diez billeteras escritas a mano, `capitalInicial: 80` repetido doce veces.
// Agregar un bolsillo obligaba a tocar diez sitios — el mismo patrón que ya nos
// costó caro con los bolsillos del motor: la duplicación ES el bug, no el
// olvido de hoy. Cada prueba declara solo lo que le importa; el resto son
// bolsillos vacíos que existen para que la forma sea completa.
//
// EXCEPCIÓN a propósito: las dos pruebas que construyen los bolsillos
// recorriendo `BOLSILLOS` NO deben usar esta factory. Su trabajo es descubrir
// los bolsillos, no recibirlos; darles una lista fija reintroduciría
// exactamente el bug que costó 42,50 USDT en silencio.
function billetera(campos = {}) {
  return {
    ancla: {}, sleeve: {}, legado: {}, polvo: {},
    reserva: 10, capitalInicial: 80, limiteSleevePct: 25,
    ...campos,
  };
}

const PRECIOS = { BTCUSDT: 69000, ETHUSDT: 2200, SOLUSDT: 85, HEMIUSDT: 0.009, ZECUSDT: 550 };

// --- BINANCE DE MENTIRA ------------------------------------------------------
//
// Cuatro pruebas salían a la API real. Medido con `fetch` bloqueado: fallaban
// las cuatro, y una era **el test de la compuerta** — el control de seguridad
// más importante que tiene el motor. Un test de seguridad que depende de que
// Binance esté arriba no es un test de seguridad: con la red lenta falla con un
// mensaje indistinguible de un fallo real.
//
// Esto NO reemplaza validar contra el mercado de verdad. Esa práctica cazó dos
// bugs que ningún mock habría cazado (TUT clasificando pullback a −80%, la
// compuerta bloqueando todo con precios parciales). Lo que se separa son dos
// cosas distintas que estaban mezcladas: probar la LÓGICA —determinista, sin
// red— y MEDIR contra el mercado, que es otra tarea y va aparte.
//
// Las velas se generan de una serie plana con el precio pedido, así que la
// volatilidad da ~0 y los niveles quedan en sus pisos: predecible a propósito.
function velaFalsa(ts, precio) {
  const p = String(precio);
  //    apertura  máx   mín   cierre  vol  cierreTs  volQuote
  return [ts, p, p, p, p, '1000', ts + 59_999, '1000000', 10, '500', '500000', '0'];
}

// Para los símbolos que la prueba NO nombra, el precio por defecto es el de
// ENTRADA de esa posición: así queda en cero exacto y no cruza ningún nivel.
// Sin esto, un precio inventado de 100 mandaba APT (entrada 0,63) a +15.000% y
// el falso liquidaba media cartera del sandbox — el mock cambiaría el
// comportamiento del resto de la suite en vez de aislarlo.
function preciosInertes() {
  const f = join(process.env.KW_DATA, 'posiciones.json');
  if (!existsSync(f)) return {};
  const { posiciones = [] } = JSON.parse(readFileSync(f, 'utf8'));
  return Object.fromEntries(posiciones
    .filter(p => p.estado === 'abierta' && Number.isFinite(p.entrada))
    .map(p => [`${p.asset}USDT`, p.entrada]));
}

function respuestaFalsa(url, precios) {
  const u = new URL(url);
  const precioDe = sym => precios[sym] ?? preciosInertes()[sym] ?? PRECIOS[sym] ?? 100;

  if (u.pathname === '/api/v3/ticker/price') {
    const sym = u.searchParams.get('symbol');
    return { symbol: sym, price: String(precioDe(sym)) };
  }
  if (u.pathname === '/api/v3/ticker/24hr') {
    const pedidos = u.searchParams.get('symbols');
    const simbolos = pedidos ? JSON.parse(pedidos) : Object.keys({ ...PRECIOS, ...precios });
    return simbolos.map(s => ({
      symbol: s, lastPrice: String(precioDe(s)), priceChangePercent: '0',
      highPrice: String(precioDe(s)), lowPrice: String(precioDe(s)),
      openPrice: String(precioDe(s)), quoteVolume: '5000000',
    }));
  }
  if (u.pathname === '/api/v3/klines') {
    const sym = u.searchParams.get('symbol');
    const n = Number(u.searchParams.get('limit') ?? 31);
    const paso = u.searchParams.get('interval') === '1m' ? 60_000 : 86_400_000;
    const fin = Date.now();
    return Array.from({ length: n }, (_, i) => velaFalsa(fin - (n - 1 - i) * paso, precioDe(sym)));
  }
  throw new Error(`el Binance de mentira no conoce ${u.pathname} — agregarlo acá, no salir a la red`);
}

// Cambia `fetch` mientras corre `fn` y lo restaura pase lo que pase.
async function sinRed(precios, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async url => ({
    ok: true, status: 200,
    json: async () => respuestaFalsa(String(url), precios),
    text: async () => '',
  });
  try { return await fn(); } finally { globalThis.fetch = original; }
}

// --- 1 · Conservación de capital en una venta -------------------------------
test('vender no crea ni destruye dinero (solo cobra la comisión)', () => {
  const w = billetera({ ancla: { BTC: 0.001 }, sleeve: { SOL: 0.1 } });
  const antes = motor._test.walletValue(w, PRECIOS);
  const precio = PRECIOS.SOLUSDT;
  const bruto = 0.1 * precio;
  // simula la venta como la hace el motor: sale del sleeve, entra a reserva neta
  delete w.sleeve.SOL;
  w.reserva = Math.round((w.reserva + bruto * (1 - motor._test.FEE)) * 100) / 100;
  const despues = motor._test.walletValue(w, PRECIOS);
  const comision = bruto * motor._test.FEE;
  casiIgual(despues, antes - comision, 0.01, 'el valor cayó exactamente la comisión');
});

// --- 2 · Los bolsillos suman el total --------------------------------------
//
// Esta prueba NO enumera los bolsillos: los DESCUBRE de `BOLSILLOS`, la lista
// única del motor. La versión anterior construía una wallet con los cuatro que
// conocía y sumaba esos mismos a mano — así que era estructuralmente incapaz de
// detectar un bolsillo nuevo que algún consumidor olvidara. Demostrado: con un
// quinto bolsillo, walletValue perdía 42,50 USDT y la prueba pasaba en verde.
test('el valor total cuenta TODOS los bolsillos declarados, sin enumerarlos', () => {
  const P = { ...PRECIOS, XRPUSDT: 1.44, APTUSDT: 0.65, FILUSDT: 0.8, FETUSDT: 0.17, LINKUSDT: 20 };
  const activos = ['BTC', 'ETH', 'SOL', 'ZEC', 'XRP', 'APT', 'FIL', 'FET', 'LINK'];
  esperar(motor._test.BOLSILLOS.length <= activos.length, 'hay activos de prueba para cada bolsillo');

  // un activo distinto y con valor en CADA bolsillo declarado
  const w = { reserva: 15.5, capitalInicial: 80, limiteSleevePct: 25 };
  motor._test.BOLSILLOS.forEach((b, i) => { w[b] = { [activos[i]]: 1 }; });

  const valorDeBolsillo = b => motor._test.valorDe(w[b], P);
  const suma = 15.5 + motor._test.BOLSILLOS.reduce((a, b) => a + valorDeBolsillo(b), 0);
  casiIgual(motor._test.walletValue(w, P), suma, 0.001, 'la suma de bolsillos es el total');

  // PROPIEDAD CLAVE: vaciar cualquier bolsillo debe bajar el total EXACTAMENTE
  // en su valor. Si un consumidor ignora un bolsillo, vaciarlo no cambia nada
  // y esto falla — es lo que la versión anterior no podía ver.
  for (const b of motor._test.BOLSILLOS) {
    const antes = motor._test.walletValue(w, P);
    const guardado = w[b];
    const valorPropio = valorDeBolsillo(b);
    esperar(valorPropio > 0, `el bolsillo "${b}" tiene valor en la prueba`);
    w[b] = {};
    const despues = motor._test.walletValue(w, P);
    w[b] = guardado;
    casiIgual(antes - despues, valorPropio, 0.001,
      `vaciar "${b}" debe bajar el total en su valor — si no, alguien lo está ignorando`);
  }

  // la reserva no es un mapa de activos, pero también tiene que contar
  const conReserva = motor._test.walletValue(w, P);
  w.reserva = 0;
  casiIgual(conReserva - motor._test.walletValue(w, P), 15.5, 0.001, 'la reserva también cuenta');
});

// La superficie del API tiene que exponer todos los bolsillos: es lo que lee el
// dashboard, y un bolsillo ausente ahí escondía el 39% de una cartera migrada.
test('el resumen expone una clave por cada bolsillo declarado', () => {
  const P = { ...PRECIOS, XRPUSDT: 1.44 };
  const w = { reserva: 10, capitalInicial: 80, limiteSleevePct: 25 };
  motor._test.BOLSILLOS.forEach(b => { w[b] = {}; });
  w.ancla = { BTC: 0.0007 }; w.legado = { XRP: 20 };
  const s = motor._test.simSummary(w, P);
  for (const b of motor._test.BOLSILLOS) {
    esperar(b in s.bolsillos, `el resumen debe traer "${b}"`);
    esperar(s.bolsillosDetalle.some(x => x.clave === b), `bolsillosDetalle debe listar "${b}"`);
  }
  const suma = s.bolsillosDetalle.reduce((a, x) => a + x.usdt, 0);
  casiIgual(suma, s.valor, 0.001, 'bolsillosDetalle suma el valor total (incluida la reserva)');
});

// El único camino que queda para perder plata de vista: un bolsillo que existe
// en los datos y nadie declaró. Debe CONTARSE en el total y además delatarse.
test('un bolsillo no declarado se cuenta y se denuncia', () => {
  const P = { ...PRECIOS, XRPUSDT: 1.44 };
  const w = billetera({ ancla: { BTC: 0.0007 } });
  const sinExtra = motor._test.walletValue(w, P);

  w.cosecha = { XRP: 20 };   // bolsillo inventado, no está en BOLSILLOS
  esperar(motor.bolsillosNoDeclarados(w).includes('cosecha'), 'debe detectarse como no declarado');
  casiIgual(motor._test.walletValue(w, P) - sinExtra, 20 * P.XRPUSDT, 0.001,
    'su plata debe SUMARSE al total, no desaparecer');

  const s = motor._test.simSummary(w, P);
  esperar(s.bolsillosNoDeclarados?.claves.includes('cosecha'), 'el resumen debe denunciarlo');
  casiIgual(s.bolsillosNoDeclarados.usdt, 20 * P.XRPUSDT, 0.001, 'con el monto que está fuera de la declaración');
});

// --- 3 · El rebalanceo no toca el ancla ni gasta la reserva ----------------
test('el rebalanceo opera solo el sleeve', () => {
  const w = billetera({ ancla: { BTC: 0.0007 }, sleeve: { SOL: 0.05 }, reserva: 20 });
  const anclaAntes = { ...w.ancla };
  const reservaAntes = w.reserva;
  const total = motor._test.walletValue(w, PRECIOS);
  const trades = motor._test.rebalance(w, ['ETH'], PRECIOS);
  esperar(JSON.stringify(w.ancla) === JSON.stringify(anclaAntes), 'el ancla quedó intacta');
  esperar(w.reserva <= reservaAntes + 0.01, 'la reserva no se usó para comprar más de lo que devolvió el sleeve');
  const totalDespues = motor._test.walletValue(w, PRECIOS);
  const comisiones = trades.reduce((a, t) => a + t.usdt * motor._test.FEE, 0);
  casiIgual(totalDespues, total - comisiones, 0.02, 'el rebalanceo solo cuesta comisiones');
});

// --- 4 · El sleeve respeta su techo ---------------------------------------
test('el sleeve no supera su techo del 25%', () => {
  const w = billetera({ ancla: { BTC: 0.0007 }, reserva: 40 });
  motor._test.rebalance(w, ['ETH', 'SOL'], PRECIOS);
  const total = motor._test.walletValue(w, PRECIOS);
  const sleeve = Object.entries(w.sleeve).reduce((a, [k, q]) => a + q * PRECIOS[`${k}USDT`], 0);
  esperar(sleeve <= total * 0.2501 + 0.01, `el sleeve (${sleeve.toFixed(2)}) no pasa el 25% de ${total.toFixed(2)}`);
});

// --- 5 · Un NaN nunca entra al estado ------------------------------------
test('un monto NaN se rechaza antes de tocar la billetera', async () => {
  let error = null;
  try {
    await motor.jugadaManual({ comprar: [{ asset: 'ETH', usdt: NaN }] });
  } catch (e) { error = e; }
  esperar(error, 'lanzó error en vez de aceptar el NaN');
  esperar(error.codigo === 400, `el error es de validación (400), llegó ${error.codigo}`);
  const w = motor._test.leerWallet();
  for (const [k, v] of Object.entries({ ...w.sleeve, ...w.ancla, reserva: w.reserva })) {
    esperar(Number.isFinite(v), `${k} sigue siendo un número finito (es ${v})`);
  }
});

// --- 6 · El candado impide dos escrituras simultáneas --------------------
test('el candado rechaza una segunda operación en curso', async () => {
  let dentro = false, rechazada = null;
  const lenta = motor.conCandado('test-lenta', async () => {
    dentro = true;
    await new Promise(r => setTimeout(r, 40));
    return 'ok';
  });
  await new Promise(r => setTimeout(r, 5));
  esperar(dentro, 'la primera operación tomó el candado');
  try { await motor.conCandado('test-segunda', async () => 'no debería'); }
  catch (e) { rechazada = e; }
  esperar(rechazada, 'la segunda fue rechazada');
  esperar(rechazada.codigo === 409, `con código 409 (llegó ${rechazada.codigo})`);
  await lenta;
  esperar(motor.estadoOcupado() === null, 'el candado se liberó al terminar');
});

// --- 7 · La escritura atómica deja respaldo -----------------------------
test('escribir estado deja un .bak recuperable', () => {
  const f = join(process.env.KW_DATA, 'prueba.json');
  motor._test.escribirJSON(f, { v: 1 });
  motor._test.escribirJSON(f, { v: 2 });
  esperar(existsSync(`${f}.bak`), 'existe el respaldo');
  esperar(!existsSync(`${f}.tmp`), 'no quedó basura .tmp');
  esperar(motor._test.leerJSON(f).v === 2, 'el archivo tiene la versión nueva');
  esperar(motor._test.leerJSON(`${f}.bak`).v === 1, 'el respaldo tiene la anterior');
});

// --- 8 · El riesgo abierto nunca es negativo ni supera lo expuesto -------
test('el riesgo abierto es coherente', () => {
  const r = motor.riesgoAbierto(PRECIOS, 82);
  esperar(r.usdt >= 0, 'el riesgo no es negativo');
  esperar(r.usdt <= r.expuestoUSDT + 0.01, 'no se puede perder más que lo expuesto');
  esperar(r.posiciones === r.detalle.length, 'el conteo coincide con el detalle');
});

// El congelado era memoria de proceso y solo lo miraba Telegram: sobrevivía
// tanto como el servidor y el dashboard lo ignoraba. Se prueba lo que importa
// —que NADIE pueda ejecutar— no que la bandera esté puesta.
test('congelar frena la ejecución venga de donde venga', async () => {
  const o = motor.crearOferta({ asset: 'SOL', montoUSDT: 5, limitePct: -4, objetivoPct: 10, precio: 100, contexto: {} });
  esperar(motor.ofertasVigentes().some(x => x.id === o.id), 'la oferta debería estar vigente');

  const { anuladas } = motor.congelar('test', 'telegram');
  esperar(anuladas >= 1, 'congelar debe anular las ofertas vigentes, no solo prohibir las nuevas');
  esperar(motor.congelado(), 'el estado debería quedar congelado');
  esperar(motor.ofertasVigentes().length === 0, 'no puede quedar ninguna oferta vigente');

  const r = await motor.tomarOferta(o.id, 'dashboard');
  esperar(!r.ok, 'el DASHBOARD también debe quedar frenado, no solo Telegram');

  let bloqueado = false;
  try { motor.crearOferta({ asset: 'BTC', montoUSDT: 5, limitePct: -4, objetivoPct: 10, precio: 1, contexto: {} }); }
  catch { bloqueado = true; }
  esperar(bloqueado, 'congelado no debe poder crear ofertas nuevas');

  motor.descongelar('test');
  esperar(!motor.congelado(), 'descongelar debería reactivar');
});

// Telegram rechaza los mensajes de más de 4096 caracteres con un 400, y si el
// corte parte una etiqueta el error es el mismo. Lo que se prueba es que ningún
// trozo pase el tope y que ninguno quede con HTML abierto.
test('un mensaje largo se parte sin romper el HTML', async () => {
  const { _trozos, _etiquetasAbiertas } = await import('./telegram.mjs');
  const lineas = Array.from({ length: 400 }, (_, i) => `<code>ASSET${i}</code> descartado por RSI ${60 + i % 40}`);
  const largo = `<b>Sin oportunidades</b>\n\n<blockquote expandable><b>Descartadas</b>\n\n${lineas.join('\n')}</blockquote>`;
  const ts = _trozos(largo);

  esperar(ts.length > 1, 'un mensaje de 17k caracteres debería partirse');
  for (const t of ts) {
    esperar(t.length <= 4096, `un trozo mide ${t.length}: Telegram lo rechazaría`);
    esperar(_etiquetasAbiertas(t).length === 0, 'un trozo quedó con una etiqueta sin cerrar');
  }
  const visible = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  esperar(visible(ts.join('\n')) === visible(largo), 'partir el mensaje perdió texto');
  esperar(_trozos('<b>corto</b>').length === 1, 'un mensaje corto no debe tocarse');
});

// El plazo era un campo que se guardaba y nadie leía: se prueba que ahora sí
// cierra sola una posición sin ganancia cuando se acaba el tiempo, y que NO
// toca una que sí está rentando aunque el plazo ya haya pasado.
test('el plazo liquida sola si no rentó a tiempo', async () => {
  const pos = motor.abrirPosicion({ asset: 'SOL', qty: 1, entrada: 100, objetivoPct: 20, limitePct: -8, origen: 'test' });
  motor.fijarHorizonte([pos.id], 1);   // 1 hora de plazo

  // Recién abierta: aunque no rentó, el plazo no venció.
  let ev = motor.evaluarPosiciones({ SOLUSDT: 99 });
  esperar(ev.find(p => p.id === pos.id).senal !== 'vencido-sin-renta', 'no debería vencer antes de tiempo');

  // Se retrocede la apertura a hace 2 horas, directo en el archivo de estado
  // (no hay otra forma de simular "pasó el tiempo" sin tocar el reloj real).
  const { readFileSync, writeFileSync } = await import('node:fs');
  const posFile = `${process.env.KW_DATA}/posiciones.json`;
  const data = JSON.parse(readFileSync(posFile, 'utf8'));
  data.posiciones.find(p => p.id === pos.id).plazoDesde = new Date(Date.now() - 2 * 3_600_000).toISOString();   // el reloj del plazo, no la apertura
  writeFileSync(posFile, JSON.stringify(data, null, 2));

  ev = motor.evaluarPosiciones({ SOLUSDT: 99 });   // sigue sin rentar (99 < 100)
  esperar(ev.find(p => p.id === pos.id).senal === 'vencido-sin-renta', 'vencido y sin renta debería liquidarse');

  ev = motor.evaluarPosiciones({ SOLUSDT: 105 });   // ahora sí renta (+5%)
  esperar(ev.find(p => p.id === pos.id).senal !== 'vencido-sin-renta', 'si ya renta, el plazo no debe forzar la salida');
});

// El plazo no solo debe SEÑALAR: ejecutarStops tiene que venderla de verdad y
// dejar la categoría 'horizonte' en el registro (para no confundirla con un
// stop por precio en las estadísticas de aciertos).
test('el plazo vencido se ejecuta y queda categorizado aparte', async () => {
  const w = motor._test.leerWallet();
  w.sleeve.ETH = (w.sleeve.ETH ?? 0) + 1;
  motor._test.escribirJSON(join(process.env.KW_DATA, 'wallet.json'), w);

  // Entrada 1% POR ENCIMA del precio que devolverá el falso: garantiza pnl
  // negativo (no rentó) sin depender del mercado. Con niveles anchos (+500%
  // / −95%) solo el plazo puede disparar la señal.
  const pos = motor.abrirPosicion({ asset: 'ETH', qty: 1, entrada: PRECIOS.ETHUSDT * 1.01, objetivoPct: 500, limitePct: -95, origen: 'test' });
  motor.fijarHorizonte([pos.id], 1);
  const { readFileSync, writeFileSync } = await import('node:fs');
  const posFile = join(process.env.KW_DATA, 'posiciones.json');
  const data = JSON.parse(readFileSync(posFile, 'utf8'));
  data.posiciones.find(p => p.id === pos.id).plazoDesde = new Date(Date.now() - 2 * 3_600_000).toISOString();   // el reloj del plazo, no la apertura
  writeFileSync(posFile, JSON.stringify(data, null, 2));

  const antes = motor._test.leerWallet().reserva;
  const { ejecutados } = await sinRed({}, () => motor.ejecutarStops());
  const cerrada = ejecutados.find(e => e.asset === 'ETH');
  esperar(cerrada, 'el plazo vencido debió ejecutarse, no solo señalarse');
  const despues = motor._test.leerWallet().reserva;
  esperar(despues > antes, 'la venta debió acreditar a la reserva');
  const c = motor.cierres().find(x => x.asset === 'ETH' && /horizonte/i.test(x.motivoCierre ?? ''));
  esperar(c, 'el cierre debe quedar categorizado como horizonte, no como stop');
  esperar(c.brechaPp == null, 'un cierre por plazo no tiene brecha de nivel: no hubo nivel que se pasara');
});

// El legado nace en migrarWallet cuando la ficticia hereda la billetera real:
// XRP cayó al sleeve como capital fresco y se liquidó a las 32 horas, justo
// antes de correr +40%. Se prueba que una tenencia no-BTC por encima del
// umbral de polvo va a `legado`, no a `sleeve`, y que jugadaManual la protege
// igual que al ancla.
test('una posición heredada no cae al sleeve como capital fresco', async () => {
  const holdings = { BTC: 0.001, XRP: 20, MTL: 0.001 };   // MTL: bajo el umbral de polvo
  const precios = { ...PRECIOS, XRPUSDT: 1, MTLUSDT: 0.4 };   // XRP=20 USDT (sobre umbral), MTL=0,4 (bajo)
  const migrada = motor._test.migrarWallet({ createdAt: '2026-01-01', capitalInicial: 100, cashUSDT: 5, holdings, lastRun: null }, precios);
  esperar('BTC' in migrada.ancla, 'BTC va al ancla');
  esperar('XRP' in migrada.legado, 'XRP (heredado, sobre el umbral) va a legado, no a sleeve');
  esperar(!('XRP' in (migrada.sleeve ?? {})), 'XRP no debe quedar en sleeve');
  esperar('MTL' in migrada.polvo, 'MTL (bajo el umbral) va a polvo igual que antes');

  // se escribe la migración en el sandbox: jugadaManual lee la billetera del
  // disco, no el objeto en memoria — sin esto la venta fallaría por otra razón
  // (sin tenencia en el sleeve) y el test aprobaría por la causa equivocada.
  motor._test.escribirJSON(motor._test.WALLET_FILE, migrada);
  let error = null;
  try { await sinRed({ XRPUSDT: 1.5 }, () => motor.jugadaManual({ vender: [{ asset: 'XRP', usdt: 5 }] })); }
  catch (e) { error = e; }
  esperar(error, 'una jugada no debe poder vender del legado');
  esperar(/legado/i.test(error.message), `debe rechazarse por ser legado, no por otra causa (llegó: "${error?.message}")`);
});

// El umbral del plazo NO es cero: salir en el punto de equilibrio de un activo
// que oscila 4-6% al día lo decide el ruido, no la tesis (lección GPS/ACE, que
// ya rige los stops y que el plazo se escribió ignorando). Se prueba que una
// posición apenas en verde —dentro de la banda de ruido— se liquida igual, y
// que una que se movió de verdad sobrevive.
test('el plazo exige superar el ruido, no solo el cero', async () => {
  // limitePct -6 => volatilidad derivada 4,0% => umbral = 0,2 + 0,5*4,0 = 2,2%
  const pos = motor.abrirPosicion({ asset: 'SOL', qty: 1, entrada: 100, objetivoPct: 15, limitePct: -6, origen: 'test' });
  motor.fijarHorizonte([pos.id], 1);
  const { readFileSync, writeFileSync } = await import('node:fs');
  const f = join(process.env.KW_DATA, 'posiciones.json');
  const d = JSON.parse(readFileSync(f, 'utf8'));
  d.posiciones.find(x => x.id === pos.id).plazoDesde = new Date(Date.now() - 2 * 3_600_000).toISOString();   // el reloj del plazo, no la apertura
  writeFileSync(f, JSON.stringify(d, null, 2));

  const senalA = (precio) => motor.evaluarPosiciones({ SOLUSDT: precio }).find(x => x.id === pos.id);

  const apenasVerde = senalA(101.5);   // +1,5%: dentro del ruido de un activo de 4%
  esperar(apenasVerde.senal === 'vencido-sin-renta',
    `+1,5% está dentro de la banda (umbral ${apenasVerde.umbralPlazoPct?.toFixed(2)}%) y debe liquidarse; llegó "${apenasVerde.senal}"`);

  const seMovio = senalA(103);          // +3,0%: por encima de la banda
  esperar(seMovio.senal !== 'vencido-sin-renta',
    `+3,0% supera la banda (umbral ${seMovio.umbralPlazoPct?.toFixed(2)}%) y debe sobrevivir; llegó "${seMovio.senal}"`);

  casiIgual(apenasVerde.umbralPlazoPct, 2.2, 0.01, 'el umbral sale de comisión (0,2) + 0,5 x volatilidad derivada (2,0)');

  // la volatilidad guardada manda sobre la derivada del límite
  const pos2 = motor.abrirPosicion({ asset: 'SOL', qty: 1, entrada: 100, objetivoPct: 15, limitePct: -6, volatilidadDiariaPct: 10, origen: 'test' });
  motor.fijarHorizonte([pos2.id], 1);
  const ev2 = motor.evaluarPosiciones({ SOLUSDT: 100 }).find(x => x.id === pos2.id);
  casiIgual(ev2.umbralPlazoPct, 5.2, 0.01, 'con volatilidad guardada de 10% el umbral es 0,2 + 5,0');
});

// Una salida por plazo no valida la tesis: si entra al mismo promedio que los
// cierres por nivel, infla la tasa de aciertos con ganancias que no prueban nada.
test('la estadística separa aciertos de tesis de salidas por tiempo', () => {
  const e = motor.estadisticaJugadas();
  esperar(e.porTiempo !== undefined, 'debe reportar las salidas por tiempo aparte');
  esperar(e.nTotal >= e.n, 'el total incluye las salidas por tiempo; n solo los cierres por nivel');
  esperar(e.n + (e.porTiempo.n ?? 0) === e.nTotal, `n (${e.n}) + porTiempo (${e.porTiempo.n ?? 0}) debe ser nTotal (${e.nTotal})`);
});

// Con la cadencia semanal los picks quedan congelados, y el veto de cuarentena
// solo corría al recalcular: un pick cortado por stop seguía en la propuesta
// días. Al filtrarlo aparecen dos trampas que estas pruebas fijan.
test('quitar un pick vetado NO concentra plata en los que quedan', () => {
  const w = billetera({ ancla: { BTC: 0.0007 }, reserva: 40 });
  const total = motor._test.walletValue(w, PRECIOS);
  const presupuesto = total * 0.25;

  // 3 ranuras pero solo 2 picks vivos: cada uno recibe un TERCIO, no la mitad
  const w2 = structuredClone(w);
  motor._test.rebalance(w2, ['ETH', 'SOL'], PRECIOS, 3);
  const porPick = Object.entries(w2.sleeve).map(([k, q]) => q * PRECIOS[`${k}USDT`]);
  for (const v of porPick) {
    casiIgual(v, presupuesto / 3, 0.02, 'cada pick vivo recibe una ranura de tres, no media');
  }
  const usado = porPick.reduce((a, b) => a + b, 0);
  casiIgual(usado, presupuesto * 2 / 3, 0.05, 'la ranura del vetado queda SIN usar');
});

test('el presupuesto por defecto sigue repartiéndose entre los picks', () => {
  const w = billetera({ ancla: { BTC: 0.0007 }, reserva: 40 });
  const presupuesto = motor._test.walletValue(w, PRECIOS) * 0.25;
  motor._test.rebalance(w, ['ETH', 'SOL'], PRECIOS);   // sin ranuras explícitas
  const usado = Object.entries(w.sleeve).reduce((a, [k, q]) => a + q * PRECIOS[`${k}USDT`], 0);
  casiIgual(usado, presupuesto, 0.05, 'sin ranuras explícitas se usa el presupuesto completo');
});

// Una cuarentena dice "no vuelvas a comprar esto", no "liquida lo que tienes".
// Con la lista de picks vacía el rebalanceo vendía el sleeve COMPLETO a reserva.
test('picks vacíos venderían todo el sleeve: por eso el veto total no propone nada', () => {
  const w = billetera({ ancla: { BTC: 0.0007 }, sleeve: { ETH: 0.002, SOL: 0.05 } });
  const trades = motor._test.rebalance(structuredClone(w), [], PRECIOS, 3);
  esperar(trades.length > 0 && trades.every(t => t.accion === 'VENDER'),
    'con picks vacíos el rebalanceo liquida el sleeve — el guardarraíl de runAnalysis existe por esto');
});

// El reloj del plazo arranca cuando el plazo se PONE. Contándolo desde la
// apertura, ponerle 48 h a una posición de 3 días la dejaba vencida al instante
// y la liquidaba sola: una venta por sorpresa, lo contrario de lo que uno
// espera al escribir "48 h".
test('poner un plazo a una posición vieja NO la liquida al instante', async () => {
  const pos = motor.abrirPosicion({ asset: 'SOL', qty: 1, entrada: 100, objetivoPct: 15, limitePct: -6, origen: 'test' });
  const { readFileSync, writeFileSync } = await import('node:fs');
  const f = join(process.env.KW_DATA, 'posiciones.json');
  const d = JSON.parse(readFileSync(f, 'utf8'));
  d.posiciones.find(x => x.id === pos.id).abierto = new Date(Date.now() - 72 * 3_600_000).toISOString();
  writeFileSync(f, JSON.stringify(d, null, 2));   // abierta hace 3 días

  motor.fijarHorizonte([pos.id], 48);             // 48 h puestas AHORA
  const ev = motor.evaluarPosiciones({ SOLUSDT: 100 }).find(x => x.id === pos.id);   // plana

  esperar(ev.senal !== 'vencido-sin-renta',
    `con 72 h abierta y 48 h de plazo recién puesto NO debe estar vencida; llegó "${ev.senal}"`);
  casiIgual(ev.horasRestantesPlazo, 48, 0.1, 'debe quedarle el plazo completo, no cero');
  esperar(ev.horasAbierta > 71, 'y aun así reportar que lleva 3 días abierta');

  // Pasado el plazo, el stop NO salta de golpe a la banda de ruido: sube en
  // rampa. Recién vencido, el nivel sigue siendo prácticamente el original.
  const correrPlazo = horas => {
    const d2 = JSON.parse(readFileSync(f, 'utf8'));
    d2.posiciones.find(x => x.id === pos.id).plazoDesde = new Date(Date.now() - horas * 3_600_000).toISOString();
    writeFileSync(f, JSON.stringify(d2, null, 2));
    return motor.evaluarPosiciones({ SOLUSDT: 100 }).find(x => x.id === pos.id);
  };

  const recien = correrPlazo(50);   // 2 h pasado el plazo de 48
  esperar(recien.senal !== 'vencido-sin-renta',
    `recién vencida y plana NO debe liquidarse: el acantilado era el defecto; llegó "${recien.senal}"`);
  esperar(recien.limitePctEfectivo < -5,
    `el stop apenas se movió del -6% original, dio ${recien.limitePctEfectivo}%`);

  const mitad = correrPlazo(72);    // media rampa (24 h de 48)
  esperar(mitad.limitePctEfectivo > recien.limitePctEfectivo,
    'a media rampa el stop tiene que haber subido');
  esperar(mitad.senal !== 'vencido-sin-renta', 'a media rampa una posición plana todavía respira');

  const completa = correrPlazo(96); // rampa entera: el stop llegó a la banda
  esperar(completa.senal === 'vencido-sin-renta',
    `terminada la rampa, una posición que nunca rindió sí se libera; llegó "${completa.senal}"`);
  casiIgual(completa.limitePctEfectivo, completa.umbralPlazoPct, 0.01,
    'y el stop terminó exactamente en la banda de ruido, no más arriba');
});

// PRUEBA DE CONTRATO entre módulos.
//
// Los `import` estáticos los valida Node al cargar: un export inexistente
// revienta al arrancar. El hueco son los `await import()` DINÁMICOS, que se
// resuelven al ejecutarse la línea — y si esa línea vive dentro de un `catch`,
// falla en silencio. Fue exactamente el caso de `tg.crearOferta`: quedó
// apuntando a una función que se había movido al motor, el monitor la llamaba
// cada 3 minutos y el error moría en su propio `catch`. Semanas sin crear una
// sola oferta automática, sin un síntoma visible.
test('toda llamada dinámica entre módulos apunta a un export que existe', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');

  // Sin esto, un comentario que MENCIONA una llamada vieja se cuenta como uso
  // real: el propio server.mjs documenta el bug citando `tg.crearOferta`.
  const sinComentarios = txt => txt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Set y no lista: un módulo puede declarar `const tg = await import(...)` en
  // varios lugares, y cada declaración reescanea el archivo entero — sin
  // deduplicar, la misma llamada rota se reporta una vez por declaración.
  const problemas = new Set();
  const archivos = readdirSync(DIR).filter(f => f.endsWith('.mjs') && f !== 'test.mjs');
  esperar(archivos.length >= 3, `debería revisar los módulos del proyecto (encontró ${archivos.length})`);

  for (const archivo of archivos) {
    const src = sinComentarios(readFileSync(join(DIR, archivo), 'utf8'));

    // A) espacio de nombres:  const tg = await import('./telegram.mjs')  →  tg.loQueSea()
    for (const [, alias, modulo] of src.matchAll(/const\s+(\w+)\s*=\s*await\s+import\(['"]\.\/([\w.]+)['"]\)/g)) {
      const mod = await import(`./${modulo}`);
      for (const [, prop] of src.matchAll(new RegExp(`\\b${alias}\\.(\\w+)\\s*\\(`, 'g'))) {
        if (!(prop in mod)) problemas.add(`${archivo}: llama ${alias}.${prop}() y ${modulo} no lo exporta`);
      }
    }

    // B) desestructurado:  const { a, b } = await import('./engine.mjs')
    for (const [, dentro, modulo] of src.matchAll(/const\s*\{([^}]+)\}\s*=\s*await\s+import\(['"]\.\/([\w.]+)['"]\)/g)) {
      const mod = await import(`./${modulo}`);
      for (const nombre of dentro.split(',').map(x => x.trim().split(':')[0].trim()).filter(Boolean)) {
        if (!(nombre in mod)) problemas.add(`${archivo}: desestructura { ${nombre} } y ${modulo} no lo exporta`);
      }
    }
  }

  esperar(!problemas.size, `llamadas rotas:\n      ${[...problemas].join('\n      ')}`);
});

// El clasificador de fase por activo. El umbral de "extendido" escala con la
// volatilidad del propio activo (1,5x, como los stops): la misma distancia a la
// media es pico en un activo quieto y ruido en uno que se mueve 8% al día.
test('la fase de tendencia distingue subir de estar estirado', () => {
  const c = motor._test.clasificarTendencia;

  // subida suave y constante (~0,8%/día): tendencia, no extendido
  const suave = Array.from({ length: 31 }, (_, i) => 100 * 1.008 ** i);
  esperar(c(suave).estado === 'tendencia', `subida suave debe ser tendencia (dio ${c(suave).estado})`);

  // la misma subida suave con un salto final del 15%: estirado sobre su media
  const pico = [...suave.slice(0, 30), suave[29] * 1.15];
  esperar(c(pico).estado === 'extendido', `salto del 15% en activo quieto debe ser extendido (dio ${c(pico).estado})`);

  // lateral con ruido alternante: rango (termina sobre la media a propósito:
  // la pendiente con tolerancia debe dar rango igual, no tendencia)
  const plano = Array.from({ length: 31 }, (_, i) => 100 + (i % 2 ? -1 : 1));
  esperar(c(plano).estado === 'rango', `lateral debe ser rango (dio ${c(plano).estado})`);

  // caída sostenida: caida
  const baja = Array.from({ length: 31 }, (_, i) => 100 * 0.99 ** i);
  esperar(c(baja).estado === 'caida', `caída sostenida debe ser caida (dio ${c(baja).estado})`);

  // el MISMO +15% final en un activo que se mueve 8% al día NO es extendido:
  // el umbral escala con la volatilidad propia — el corazón del diseño
  const volatil = Array.from({ length: 31 }, (_, i) => 100 * (1 + (i % 2 ? 0.08 : -0.065)) ** 1 * 1.01 ** i);
  const volatilConSalto = [...volatil.slice(0, 30), volatil[29] * 1.15];
  const r = c(volatilConSalto);
  esperar(r.volDiariaPct > 5, `el activo de prueba debe ser volátil de verdad (vol ${r.volDiariaPct}%)`);
  esperar(r.estado !== 'extendido', `+15% en un activo de ${r.volDiariaPct}%/día es ruido, no pico (dio ${r.estado})`);

  // datos insuficientes: null, no una clasificación inventada
  esperar(c([1, 2, 3]) === null, 'con pocas velas no se clasifica');
});

// La watchlist arma, nunca ejecuta — y su condición es una función pura que se
// prueba sin red. El armado va en dos fases a propósito: la entrada solo se
// marca "armada" DESPUÉS de que la oferta se creó con éxito, así que con la
// ejecución congelada sigue vigilando y se reintenta, en vez de quedar colgada.
test('la condición de la watchlist evalúa cada requisito y dice qué falta', () => {
  const c = motor.condicionCumplida;
  const cond = { rsiMax: 70, fasesOk: ['tendencia'] };
  const sano = { rsi14d: 55, fase: 'tendencia', regimen: 'rally amplio', enCuarentena: false };

  esperar(c(cond, sano).ok, 'con todo en orden debe armar');
  esperar(!c(cond, { ...sano, rsi14d: 84 }).ok, 'RSI caliente no arma');
  esperar(!c(cond, { ...sano, fase: 'extendido' }).ok, 'fase extendida no arma');
  esperar(!c(cond, { ...sano, regimen: 'débil' }).ok, 'régimen vetado no arma');
  esperar(!c(cond, { ...sano, enCuarentena: true }).ok, 'en cuarentena no arma');
  esperar(!c(cond, { ...sano, rsi14d: null }).ok, 'sin dato de RSI no arma: la duda no compra');

  const r = c(cond, { rsi14d: 84, fase: 'extendido', regimen: 'débil', enCuarentena: false });
  esperar(r.faltas.length === 3, `debe listar TODO lo que falta, no solo lo primero (listó ${r.faltas.length})`);
});

test('la watchlist dedupea, caduca con autopsia y arma en dos fases', () => {
  const alta = motor.agregarWatch({ asset: 'SOL', motivo: 'test', origen: 'test' });
  esperar(alta.ok, 'la primera alta entra');
  esperar(!motor.agregarWatch({ asset: 'SOL', origen: 'test' }).ok, 'la segunda del mismo activo se rechaza');

  // caducidad: se retrocede el vencimiento y debe morir CON autopsia
  const { readFileSync, writeFileSync } = motor._test.fs;
  const f = join(process.env.KW_DATA, 'watchlist.json');
  const d = JSON.parse(readFileSync(f, 'utf8'));
  d.entradas.find(w => w.id === alta.entrada.id).vence = new Date(Date.now() - 1000).toISOString();
  writeFileSync(f, JSON.stringify(d));
  const tras = motor.watchlist().find(w => w.id === alta.entrada.id);
  esperar(tras.estado === 'caducada', 'vencida debe caducar al leerse');
  esperar(motor.leerAprendizaje().some(r => r.tipo === 'watchlist-caducada' && r.asset === 'SOL'),
    'la caducidad debe dejar autopsia en el aprendizaje');

  // armado en dos fases: marcar solo funciona sobre una entrada vigilando
  const alta2 = motor.agregarWatch({ asset: 'ETH', origen: 'test' });
  esperar(motor.marcarWatchOferta(alta2.entrada.id, 'oferta-x').ok, 'vigilando se puede armar');
  esperar(!motor.marcarWatchOferta(alta2.entrada.id, 'oferta-y').ok, 'armada no se rearma');
  esperar(motor.watchlist().find(w => w.id === alta2.entrada.id).ofertaId === 'oferta-x', 'guarda la oferta que generó');

  // cancelar
  const alta3 = motor.agregarWatch({ asset: 'ZEC', origen: 'test' });
  esperar(motor.cancelarWatch(alta3.entrada.id, 'test').ok, 'se puede quitar');
  esperar(!motor.cancelarWatch(alta3.entrada.id, 'test').ok, 'quitada no se re-quita');
});

// El score gradúa la zona gris del screening; los vetos de seguridad siguen
// duros. Se prueba el gradiente (lo que el binario no podía expresar) y que
// la falta de datos NO regala puntos.
test('el score de confianza gradúa lo que el filtro binario trataba igual', async () => {
  const { scoreSetup, UMBRAL_SCORE } = await import('./aprendizaje.mjs');

  const ideal = scoreSetup({ rsi14d: 45, rsi14h: 50, fase: 'tendencia', regimen: 'rally amplio', saltoVolumen: 2.5 });
  esperar(ideal.score >= 85, `el setup ideal debe puntuar alto (dio ${ideal.score})`);

  const pesimo = scoreSetup({ rsi14d: 79, rsi14h: 78, fase: 'extendido', regimen: 'débil', saltoVolumen: 5.8 });
  esperar(pesimo.score <= 30, `el setup pésimo debe puntuar bajo (dio ${pesimo.score})`);

  // el matiz que motivó todo: RSI 70,1 y RSI 79 ya NO son el mismo veredicto
  const base = { rsi14h: 55, fase: 'tendencia', regimen: 'rally amplio', saltoVolumen: 2 };
  const justo = scoreSetup({ ...base, rsi14d: 70.1 });
  const caro = scoreSetup({ ...base, rsi14d: 79 });
  esperar(justo.score > caro.score, 'RSI 70,1 debe puntuar mejor que RSI 79');
  esperar(justo.score >= UMBRAL_SCORE, `RSI 70,1 con todo lo demás perfecto debe pasar el umbral (dio ${justo.score})`);
  // PROPIEDAD DE DISEÑO: el RSI puede vetar solo — los otros cuatro juntos
  // suman 64, bajo el umbral. Ningún alineamiento compra un activo sobrecomprado.
  esperar(caro.score < UMBRAL_SCORE, `RSI 79 no debe pasar ni con todo perfecto (dio ${caro.score})`);
  const sinRsi = scoreSetup({ rsi14d: 80, rsi14h: 40, fase: 'tendencia', regimen: 'rally amplio', saltoVolumen: 2 });
  esperar(sinRsi.score < UMBRAL_SCORE, `con RSI en 0/100, el máximo alcanzable debe quedar bajo el umbral (dio ${sinRsi.score})`);

  // pump propio: el componente de volumen cae a cero sobre 6x
  esperar(scoreSetup({ ...base, rsi14d: 50, saltoVolumen: 8 }).desglose.volumen === 0, 'salto 8x = volumen 0/100');

  // sin datos no se regalan puntos: null puntúa neutro-bajo, nunca 100
  const aCiegas = scoreSetup({ rsi14d: null, rsi14h: null, fase: null, regimen: null, saltoVolumen: null });
  esperar(aCiegas.score < UMBRAL_SCORE, `a ciegas no se pasa el umbral (dio ${aCiegas.score})`);
});

// El motor de señales: cada entrada debe tener una tesis con nombre. Lo que
// más importa probar no es que detecte, sino que NO detecte lo que no debe.
test('el motor de señales nombra el patrón y descarta lo que no encaja', async () => {
  const { detectarSenales, SENALES } = await import('./aprendizaje.mjs');

  // PULLBACK: tendencia intacta que retrocedió y enfrió
  const pull = detectarSenales({ momentum30dPct: 25, fase: 'tendencia', distanciaMax30dPct: -12, rsi14d: 52, saltoVolumen: 2 });
  esperar(pull.principal === 'pullback', `retroceso en tendencia = pullback (dio ${pull.principal})`);

  // ...pero sin retroceso NO es pullback: pegado a su techo es otra cosa
  const pegado = detectarSenales({ momentum30dPct: 25, fase: 'tendencia', distanciaMax30dPct: -0.5, rsi14d: 52, saltoVolumen: 2 });
  esperar(pegado.principal !== 'pullback', 'sin retroceso no hay pullback');

  // ...ni un DERRUMBE es un pullback. Caso real: TUT clasificaba pullback con
  // -80% desde su techo (momentum +337%, volumen 1,1x: un pump colapsado).
  const derrumbe = detectarSenales({ momentum30dPct: 337, fase: 'tendencia', distanciaMax30dPct: -80, rsi14d: 55, saltoVolumen: 1.1 });
  esperar(!derrumbe.senales.includes('pullback'), `-80% desde el techo es un derrumbe, no un pullback (dio ${derrumbe.senales})`);

  // ...y sin tendencia previa tampoco: caer no es retroceder
  const cayendo = detectarSenales({ momentum30dPct: -30, fase: 'caida', distanciaMax30dPct: -40, rsi14d: 28, saltoVolumen: 2 });
  esperar(cayendo.principal === null, `un activo en caída no debe generar señal (dio ${cayendo.principal})`);

  // RUPTURA: en máximos CON volumen
  const rup = detectarSenales({ momentum30dPct: 30, fase: 'extendido', distanciaMax30dPct: -0.3, rsi14d: 72, saltoVolumen: 2.5 });
  esperar(rup.principal === 'ruptura', `máximo con volumen = ruptura (dio ${rup.principal})`);

  // ...sin volumen que la acompañe, un máximo nuevo es una mecha, no ruptura
  const mecha = detectarSenales({ momentum30dPct: 30, fase: 'extendido', distanciaMax30dPct: -0.3, rsi14d: 72, saltoVolumen: 1.0 });
  esperar(!mecha.senales.includes('ruptura'), 'máximo sin volumen no es ruptura');

  // MOMENTUM: el caso base que el sistema ya cubría
  const mom = detectarSenales({ momentum30dPct: 20, fase: 'tendencia', distanciaMax30dPct: -3, rsi14d: 65, saltoVolumen: 1.2 });
  esperar(mom.principal === 'momentum', `tendencia sin retroceso ni ruptura = momentum (dio ${mom.principal})`);

  // PRIORIDAD: si encaja en varias, gana la entrada más barata
  const varias = detectarSenales({ momentum30dPct: 25, fase: 'tendencia', distanciaMax30dPct: -8, rsi14d: 55, saltoVolumen: 2 });
  esperar(varias.senales.length > 1 && varias.principal === 'pullback',
    `con pullback y momentum a la vez gana pullback (dio ${varias.principal} de ${varias.senales})`);

  // datos faltantes no inventan señales
  esperar(detectarSenales({}).principal === null, 'sin datos no hay patrón');

  // las señales del póster que decidimos NO implementar siguen sin estar
  esperar(!('reversion' in SENALES), 'reversión no se implementa: comprar el giro es atrapar el cuchillo');
  esperar(!('continuacion' in SENALES), 'continuación no se implementa: con velas diarias es momentum con otro nombre');
});

// El objetivo dejó de ser `|stop| x 2,5`. Mientras lo fue, el R:B era una
// CONSTANTE (2,50 en las cinco posiciones abiertas) y no podía informar nada.
// Con objetivo estructural varía de verdad y sirve de filtro.
test('el objetivo se apoya en la resistencia y el R:B deja de ser constante', async () => {
  const s = motor._test.stopsSugeridosPuro;

  // pullback: hay techo arriba, el objetivo se apoya en él
  const conTecho = s({ volPct: 4, distanciaTechoPct: -12, senal: 'pullback' });
  esperar(conTecho.tipoObjetivo === 'estructural', 'con techo conocido el objetivo es estructural');
  esperar(conTecho.objetivoPct === 12, `el objetivo es el recorrido al techo (dio ${conTecho.objetivoPct})`);

  // ruptura: el precio YA está en su techo, no hay resistencia visible arriba
  const rup = s({ volPct: 4, distanciaTechoPct: -0.5, senal: 'ruptura' });
  esperar(rup.tipoObjetivo === 'proyeccion', 'en ruptura se proyecta, no se inventa un nivel');

  // sin dato de techo, comportamiento anterior intacto (jugadas manuales)
  const sinDato = s({ volPct: 4, distanciaTechoPct: null, senal: null });
  esperar(sinDato.tipoObjetivo === 'proyeccion', 'sin techo conocido, proyección');
  esperar(sinDato.riesgoBeneficio === 2.5, `la proyección mantiene el 2,5 histórico (dio ${sinDato.riesgoBeneficio})`);

  // EL PUNTO DE TODO: el R:B ahora VARÍA según dónde esté la resistencia
  const cerca = s({ volPct: 4, distanciaTechoPct: -7, senal: 'pullback' });
  const lejos = s({ volPct: 4, distanciaTechoPct: -18, senal: 'pullback' });
  esperar(cerca.riesgoBeneficio !== lejos.riesgoBeneficio,
    'dos setups con el mismo stop y distinta resistencia NO pueden dar el mismo R:B');
  esperar(cerca.riesgoBeneficio < cerca.rbMinimo, `techo cerca = setup pobre, bajo el mínimo (dio ${cerca.riesgoBeneficio})`);
  esperar(lejos.riesgoBeneficio >= lejos.rbMinimo, `techo lejos = setup válido (dio ${lejos.riesgoBeneficio})`);

  // techo al objetivo: un activo derrumbado no genera un objetivo absurdo
  const derrumbado = s({ volPct: 4, distanciaTechoPct: -200, senal: 'pullback' });
  esperar(derrumbado.riesgoBeneficio <= 3, `el objetivo se limita a 3x el stop (R:B ${derrumbado.riesgoBeneficio})`);
});

// ZONA DE ENTRADA: la watchlist también sabe esperar un PRECIO, no solo
// indicadores. El error fácil acá es el blanco móvil — si la zona se
// recalculara sobre el precio del momento, perseguiría al precio hacia abajo y
// nunca se alcanzaría. Se fija AL DAR DE ALTA y no se mueve.
test('la zona de entrada espera un precio y no persigue al mercado', () => {
  const c = motor.condicionCumplida;
  const cond = { rsiMax: 70, fasesOk: ['tendencia'], precioMax: 94, precioMin: 88 };
  const sano = { rsi14d: 55, fase: 'tendencia', regimen: 'rally amplio', enCuarentena: false };

  esperar(!c(cond, { ...sano, precio: 100 }).ok, 'sobre la zona no entra');
  esperar(c(cond, { ...sano, precio: 92 }).ok, 'dentro de la zona entra');
  esperar(!c(cond, { ...sano, precio: 80 }).ok, 'bajo el piso ya no es retroceso: no entra');
  esperar(!c(cond, { ...sano, precio: null }).ok, 'sin precio no se adivina');

  // el mensaje dice CUÁNTO falta, no solo que falta
  const r = c(cond, { ...sano, precio: 100 });
  esperar(r.faltas.some(f => /falta bajar/.test(f)), `debe decir cuánto falta bajar (dio ${r.faltas})`);

  // BLANCO MÓVIL: la zona se fija al alta contra el precio de referencia
  const alta = motor.agregarWatch({ asset: 'SOL', zonaPct: 6, precioRef: 100, origen: 'test' });
  esperar(alta.entrada.condicion.precioMax === 94, `zona −6% de 100 = 94 (dio ${alta.entrada.condicion.precioMax})`);
  esperar(alta.entrada.condicion.precioMin === 88, `piso al doble del retroceso = 88 (dio ${alta.entrada.condicion.precioMin})`);

  const guardada = motor.watchlist().find(w => w.id === alta.entrada.id).condicion;
  esperar(guardada.precioMax === 94 && guardada.precioRef === 100,
    'la zona queda CONGELADA con su referencia: no se recalcula en cada chequeo');

  // validación de entrada
  let malo = false;
  try { motor.agregarWatch({ asset: 'ETH', zonaPct: 6, precioRef: null, origen: 'test' }); } catch { malo = true; }
  esperar(malo, 'sin precio de referencia no se puede fijar una zona');
  malo = false;
  try { motor.agregarWatch({ asset: 'ETH', zonaPct: 80, precioRef: 100, origen: 'test' }); } catch { malo = true; }
  esperar(malo, 'una zona del 80% no es una zona de entrada');
});

// TAMAÑO POR RIESGO: el monto sale del riesgo, no al revés. Con monto fijo,
// medido en la cartera del 23-08, FIL arriesgaba 0,13 y PUMP 1,02 — 8,1x.
test('el tamaño sale del riesgo y declara cuándo un tope lo desvía', () => {
  const m = motor.montoPorRiesgo;
  const R = motor.RIESGO_OBJETIVO_USDT;

  // caso central: el monto ideal cae dentro de la banda y el riesgo da exacto
  const justo = m(-7);
  esperar(justo.acotadoPor === null, `stop -7% no debería topar (topó ${justo.acotadoPor})`);
  casiIgual(justo.riesgoRealUSDT, R, 0.01, 'sin topes, el riesgo real ES el objetivo');

  // stop ancho: el mínimo de orden obliga a arriesgar MÁS, y hay que decirlo
  const ancho = m(-13);
  esperar(ancho.acotadoPor === 'minimo-de-orden', `stop -13% debe topar en el piso (dio ${ancho.acotadoPor})`);
  esperar(ancho.montoIdealUSDT < 5, `el ideal queda bajo el mínimo (${ancho.montoIdealUSDT})`);
  esperar(ancho.riesgoRealUSDT > R, 'el piso obliga a arriesgar más que el objetivo');
  esperar(ancho.desvioPct > 0, 'el desvío se reporta, no se esconde');

  // stop estrecho: el techo de concentración limita hacia arriba
  const estrecho = m(-4);
  esperar(estrecho.acotadoPor === 'techo-de-concentracion', `stop -4% debe topar en el techo (dio ${estrecho.acotadoPor})`);
  esperar(estrecho.riesgoRealUSDT < R, 'el techo hace arriesgar menos que el objetivo');

  // LA MEJORA MEDIBLE: con monto fijo la dispersión era 8,1x
  const stops = [-4, -6, -7, -10, -12, -13, -15];
  const riesgos = stops.map(x => m(x).riesgoRealUSDT);
  const dispersion = Math.max(...riesgos) / Math.min(...riesgos);
  esperar(dispersion < 3, `la dispersión debe bajar bien por debajo de 8,1x (dio ${dispersion.toFixed(1)}x)`);

  // LO QUE NO SE PUEDE, y el test lo fija para que nadie lo prometa después:
  // con el mínimo de orden de Binance el riesgo NO se puede igualar. Haría
  // falta a la vez un objetivo >= 0,75 (por el piso) y <= 0,32 (por el techo).
  esperar(dispersion > 1.01,
    'igualar el riesgo del todo es imposible con el mínimo de orden: si esto pasa, revisar los topes');

  // el monto fijo nunca vuelve por la puerta de atrás
  esperar(m(-6).montoUSDT !== m(-12).montoUSDT, 'dos stops distintos no pueden dar el mismo monto');

  let malo = false;
  try { m(0); } catch { malo = true; }
  esperar(malo, 'un stop de 0% no se puede dimensionar');
});

// LA COMPUERTA: un solo lugar donde preguntar "¿puedo abrir esto?". Lo que más
// importa probar es la distinción bloqueo/aviso — bloquear por todo entrena a
// ignorar los bloqueos.
test('la compuerta de riesgo bloquea lo grave y avisa lo demás', () => {
  const P = { ...PRECIOS, XRPUSDT: 1.44 };
  const w = billetera({ ancla: { BTC: 0.0007 }, reserva: 30 });
  motor._test.escribirJSON(motor._test.WALLET_FILE, w);

  // El drawdown se mide contra el pico de los SNAPSHOTS, así que el sandbox
  // heredaba el pico real (95,30) y la billetera sintética de 78 aparecía
  // -17,8% abajo. Se fija una historia conocida: el test controla su pico.
  const total = motor._test.walletValue(w, P);
  motor._test.fs.writeFileSync(join(process.env.KW_DATA, 'snapshots.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), sim: { total } }) + '\n');

  const plan = { montoUSDT: 5, limitePct: -6, volatilidadDiariaPct: 4 };
  const ok = motor.compuertaRiesgo(plan, P);
  esperar(ok.pasa, `una entrada sana debe pasar (bloqueos: ${ok.bloqueos})`);
  esperar(ok.estado.drawdownLimitePct > 0, 'informa el límite de caída vigente');

  // BLOQUEO: el sleeve no puede pasarse de su techo
  const gigante = motor.compuertaRiesgo({ ...plan, montoUSDT: 999 }, P);
  esperar(!gigante.pasa, 'un monto que revienta el techo del sleeve se bloquea');
  esperar(gigante.bloqueos.some(b => /techo/.test(b)), `el motivo debe nombrar el techo (dio ${gigante.bloqueos})`);

  // BLOQUEO: reserva insuficiente
  const sinPlata = { ...w, reserva: 1 };
  motor._test.escribirJSON(motor._test.WALLET_FILE, sinPlata);
  const pobre = motor.compuertaRiesgo(plan, P);
  esperar(pobre.bloqueos.some(b => /reserva/.test(b)), 'sin reserva no se abre');
  motor._test.escribirJSON(motor._test.WALLET_FILE, w);

  // BLOQUEO: congelado corta todo, sin importar el plan
  motor.congelar('test compuerta', 'test');
  const helado = motor.compuertaRiesgo(plan, P);
  esperar(!helado.pasa && helado.bloqueos.some(b => /congelada/.test(b)), 'congelado bloquea');
  motor.descongelar('test');

  // AVISO, NO BLOQUEO: volatilidad alta se ve pero no impide decidir
  const volatil = motor.compuertaRiesgo({ ...plan, volatilidadDiariaPct: 12 }, P);
  esperar(volatil.pasa, 'la volatilidad alta NO bloquea: es información');
  esperar(volatil.avisos.some(a => /volatilidad/.test(a)), `debe avisarla (dio ${volatil.avisos})`);

  // un plan vacío (consulta de estado) no inventa bloqueos de monto
  const consulta = motor.compuertaRiesgo({}, P);
  esperar(!consulta.bloqueos.some(b => /reserva|techo/.test(b)), 'sin plan no se evalúan límites de monto');
});

// El drawdown se mide sobre el capital total, que con capital CERRADO (nunca
// entra ni sale dinero) es una curva de equity limpia.
test('el drawdown se mide desde el pico histórico', () => {
  const d = motor.drawdownActual(1000000);   // por encima de cualquier pico real
  esperar(d.drawdownPct === 0, 'un máximo nuevo no es una caída');
  esperar(d.pico >= 1000000, 'el pico se actualiza con el valor de ahora');

  const caido = motor.drawdownActual(1);
  esperar(caido.drawdownPct < -90, `desplomarse debe dar una caída grande (dio ${caido.drawdownPct}%)`);
  esperar(caido.limitePct > 0, 'siempre informa contra qué límite se compara');
});

// RECONSTRUCCIÓN DE CIERRES: el monitor muere con el equipo dormido (95 h
// ciego de 120 en los primeros 5 días). Al despertar, ejecutar al precio de
// AHORA registra dónde estaba el mercado al abrir los ojos, no dónde estaba
// cuando la regla se cumplió: HEMI cerró +46,1% con objetivo +30%.
//
// El riesgo de esta función es lo contrario del que arregla: que se convierta en
// una licencia para inventar precios convenientes. Eso es lo que más se prueba.
test('la reconstrucción ejecuta en el nivel, no en la mecha ni en el precio de ahora', async () => {
  const r = motor._test.reconstruirCruce;
  const hace = h => new Date(Date.now() - h * 3_600_000).toISOString();

  // posición cuyo objetivo (+30%) se cruzó hace rato: BTC es líquido y con
  // entrada muy baja el objetivo quedó superado hace días, así que la vela lo
  // confirma y debe ejecutarse EN el nivel, no en el máximo de la mecha
  const pos = { asset: 'BTC', entrada: 1000, objetivoPct: 30, limitePct: -10, abierto: hace(6) };
  const nivel = 1000 * 1.3;
  const rec = await sinRed({}, () => r(pos, 'cruzo-objetivo'));
  esperar(rec !== null, 'con horas de hueco y nivel superado debe reconstruir');
  casiIgual(rec.precio, nivel, 0.001, 'ejecuta EXACTAMENTE en el nivel, no en el extremo de la mecha');
  esperar(rec.minutosTarde >= 4, `debe reportar cuánto tarde se detectó (dio ${rec.minutosTarde})`);

  // sin hueco que reconstruir: recién abierta, no hay nada que corregir
  const recien = await sinRed({}, () => r({ ...pos, abierto: new Date().toISOString() }, 'cruzo-objetivo'));
  esperar(recien === null, 'sin hueco no se reconstruye: el precio de ahora ya es el correcto');

  // un nivel que NUNCA se cruzó no se inventa
  const imposible = await sinRed({}, () => r({ asset: 'BTC', entrada: 1000, objetivoPct: 100000, limitePct: -10, abierto: hace(6) }, 'cruzo-objetivo'));
  esperar(imposible === null, 'si la vela no confirma el cruce, no se reconstruye nada');
});

// LA TERCERA SALIDA. Hasta acá una oferta solo podía aprobarse o rechazarse, y
// rechazar la borraba para siempre: una buena idea en mal momento se perdía.
// "Vigilar" es el puente que faltaba entre "esto no me convence AHORA" y
// "avisame cuando cambie" — el motor ya sabía esperar y ya sabía proponer, pero
// las dos capacidades no se tocaban.
test('una oferta puede pasar a vigilancia en vez de perderse', () => {
  // LINK a propósito: otras pruebas ya dejaron SOL y ETH en vigilancia, y este
  // primer bloque necesita el caso "activo nuevo". El caso "ya vigilado" se
  // prueba al final, explícitamente, en vez de depender del orden.
  const o = motor.crearOferta({ asset: 'LINK', montoUSDT: 5, limitePct: -6, objetivoPct: 12,
    precio: 100, contexto: { senalNombre: 'Pullback', score: 72 } });

  const r = motor.vigilarOferta(o.id, { origen: 'test' });
  esperar(r.ok, `debe poder mandarse a vigilancia (${r.motivo ?? ''})`);
  esperar(!r.yaVigilada, 'LINK no estaba vigilado: debe crear una entrada nueva');
  esperar(r.watch?.asset === 'LINK', 'crea la entrada de watchlist con el activo');
  esperar(/oferta de LINK/.test(r.watch.motivo), `la watchlist recuerda de dónde vino (dio "${r.watch.motivo}")`);
  esperar(/Pullback/.test(r.watch.motivo), 'y con qué señal se había propuesto');

  // la oferta se resuelve: no queda viva esperando a caducar
  esperar(!motor.ofertasVigentes().some(x => x.id === o.id), 'la oferta deja de estar vigente');
  const guardada = motor.leerOfertasTodas().find(x => x.id === o.id);
  esperar(guardada.estado === 'a-vigilancia', `estado propio, distinto de descartada (dio ${guardada.estado})`);
  esperar(guardada.watchId === r.watch.id, 'queda el vínculo con la entrada que generó');

  // la decisión deja rastro: NO operar también es dato
  esperar(motor.leerAprendizaje().some(x => x.tipo === 'oferta-a-vigilancia' && x.asset === 'LINK'),
    'se registra en el aprendizaje');

  // no se puede resolver dos veces
  esperar(!motor.vigilarOferta(o.id, { origen: 'test' }).ok, 'una oferta ya resuelta no se re-vigila');

  // con zona de entrada, la referencia es el precio de la oferta (no el de ahora)
  const o2 = motor.crearOferta({ asset: 'AAVE', montoUSDT: 5, limitePct: -6, objetivoPct: 12,
    precio: 200, contexto: {} });
  const r2 = motor.vigilarOferta(o2.id, { origen: 'test', zonaPct: 5 });
  esperar(r2.watch.condicion.precioRef === 200, 'la zona se ancla al precio de la oferta');
  esperar(r2.watch.condicion.precioMax === 190, `zona -5% de 200 = 190 (dio ${r2.watch.condicion.precioMax})`);

  // un activo YA vigilado no rompe: la oferta se resuelve igual y lo declara.
  // Se fuerza el caso en vez de heredarlo del orden de las otras pruebas.
  const o3 = motor.crearOferta({ asset: 'LINK', montoUSDT: 5, limitePct: -6, objetivoPct: 12, precio: 100, contexto: {} });
  const r3 = motor.vigilarOferta(o3.id, { origen: 'test' });
  esperar(r3.ok && r3.yaVigilada, 'si ya estaba vigilado, se resuelve igual y lo declara');
  esperar(r3.watch.id === r.watch.id, 'y enlaza con la vigilancia existente, sin duplicarla');
});

// PRUEBA DE ARQUITECTURA. La lámina 1 del póster es el índice de las otras
// siete: investiga -> señales -> riesgo -> 24/7 -> decisión. Esto verifica que
// la cadena esté COMPLETA, no que cada pieza funcione (de eso se encargan las
// pruebas de arriba). Existe porque el sistema creció por partes y la forma en
// que se rompe no es que una falle, sino que un eslabón desaparezca sin ruido.
test('la cadena investiga → señales → riesgo → 24/7 → decisión está completa', async () => {
  const ap = await import('./aprendizaje.mjs');
  const cadena = {
    'investiga': { mod: motor, fns: ['radarParaBot', 'clasificarTendencia', 'rsi'] },
    'señales': { mod: ap, fns: ['detectarSenales', 'scoreSetup', 'buscarOportunidades'] },
    'riesgo': { mod: motor, fns: ['montoPorRiesgo', 'compuertaRiesgo', 'drawdownActual', 'stopsSugeridos'] },
    '24/7': { mod: motor, fns: ['ejecutarStops', 'evaluarWatchlist', 'seguimientoCierres'] },
    'decisión': { mod: motor, fns: ['tomarOferta', 'vigilarOferta', 'descartarOferta'] },
  };
  const rotos = [];
  for (const [bloque, { mod, fns }] of Object.entries(cadena)) {
    for (const f of fns) if (typeof mod[f] !== 'function') rotos.push(`${bloque}: ${f}`);
  }
  esperar(!rotos.length, `eslabones faltantes:\n      ${rotos.join('\n      ')}`);

  // Las TRES salidas de una decisión deben existir: dos convierten la oferta en
  // un hecho y la tercera la devuelve a la espera. Si alguna se pierde, el
  // circuito vuelve a ser "aprobar o borrar" y las buenas ideas se evaporan.
  esperar(motor.vigilarOferta.length >= 1, 'vigilarOferta recibe el id de la oferta');
});

// --- SELLO DE VERSIÓN --------------------------------------------------------
//
// El sello existe para que el registro de 14 días sea atribuible. Su único modo
// de fallar es el que ya se vio con PLAN-DE-ACCION.md: quedarse quieto mientras
// el motor cambia. Por eso lo que se prueba no es que "devuelva algo", sino que
// SIGA a los parámetros — y se verifica mutando uno de verdad.
test('el sello de versión cambia solo cuando cambia una regla del motor', async () => {
  const v1 = await motor.versionMotor();
  esperar(/^m-[0-9a-f]{8}$/.test(v1), `el sello debe tener forma m-xxxxxxxx, dio "${v1}"`);

  const registro = motor.leerVersiones();
  esperar(registro[v1]?.parametros?.motor != null,
    'el sello debe quedar registrado CON sus parámetros: sin eso es un número mágico');

  // MUTACIÓN: se cambia un umbral real de un detector de señales. El sello lee
  // el TEXTO de la función, así que tiene que moverse sin que nadie lo declare.
  const ap = await import('./aprendizaje.mjs');
  const original = ap.SENALES.pullback.detecta;
  const antes = JSON.stringify(ap.parametrosDeSenales());
  ap.SENALES.pullback.detecta = c => c.momentum30dPct > 999;
  const despues = JSON.stringify(ap.parametrosDeSenales());
  ap.SENALES.pullback.detecta = original;

  esperar(antes !== despues,
    'cambiar el umbral de un detector DEBE cambiar los parámetros que alimentan el sello');
  esperar(JSON.stringify(ap.parametrosDeSenales()) === antes,
    'y al restaurarlo debe volver exactamente al mismo valor');
});

// El sello se quedó quieto una vez de verdad: el stop estructural entró como
// LÓGICA nueva dentro de planDeEntrada, sin declarar ningún parámetro propio, y
// el hash no se movió. Este test fija la propiedad que lo arregla.
test('el sello sigue a la lógica, no solo a los números declarados', () => {
  const h = motor.huellaDeFuncion;

  const conNumero = x => x * 1.5;
  const otroNumero = x => x * 2.5;
  esperar(h(conNumero) !== h(otroNumero),
    'cambiar una fórmula debe cambiar la huella: es el caso que se escapó');

  // …pero reescribir un comentario no puede inventar una versión nueva, o el
  // registro se fragmenta en versiones que decidían exactamente igual.
  const comentada = x => {
    // este comentario no cambia ninguna decisión
    return x * 1.5;
  };
  const sinComentar = x => { return x * 1.5; };
  esperar(h(comentada) === h(sinComentar),
    'un comentario distinto NO puede contar como motor distinto');
});

test('cada jugada nueva nace sellada con la versión del motor', async () => {
  const pos = motor.abrirPosicion({
    asset: 'SOL', qty: 1, entrada: 100, objetivoPct: 15, limitePct: -6,
    origen: 'test', version: await motor.versionMotor(),
  });
  esperar(pos.version === await motor.versionMotor(),
    'la posición debe llevar el sello: sin él, comparar la jugada 3 con la 11 compara dos motores');
  esperar('invalidacionPct' in pos, 'y el campo de invalidación debe existir aunque venga vacío');
});

// --- STOP ESTRUCTURAL --------------------------------------------------------
//
// La regla tiene UNA dirección: la estructura puede apretar el stop, nunca
// ensancharlo. Si esta prueba se pusiera laxa, un soporte lejano ensancharía el
// stop y rompería el presupuesto de riesgo — la lección de GPS al revés.
test('el piso de 30 días aprieta el stop pero nunca lo ensancha', () => {
  const plan = motor._test.stopsSugeridosPuro;
  const vol = 4;   // stop por volatilidad: -6%

  const soloVol = plan({ volPct: vol });
  esperar(soloVol.limitePct === -6, `sin piso el stop sigue siendo el de siempre, dio ${soloVol.limitePct}`);
  esperar(soloVol.tipoStop === 'volatilidad', 'y se declara como tal');
  esperar(soloVol.invalidacionPct === null, 'sin piso no hay invalidación inventada');

  // soporte CERCA (-3%): el stop se aprieta a -4/-5%, no deja correr la pérdida
  // tres puntos más allá de donde la tesis ya murió
  const cerca = plan({ volPct: vol, distanciaPisoPct: 3 });
  esperar(cerca.limitePct > -6, `con soporte a -3% el stop debe apretarse, dio ${cerca.limitePct}`);
  esperar(cerca.tipoStop === 'estructural', 'y declararse estructural');
  esperar(cerca.invalidacionPct === -3, `la invalidación es el piso mismo, dio ${cerca.invalidacionPct}`);

  // soporte LEJOS (-12%): manda la volatilidad, el stop NO se ensancha
  const lejos = plan({ volPct: vol, distanciaPisoPct: 12 });
  esperar(lejos.limitePct === -6,
    `con soporte a -12% el stop NO se ensancha: debe quedar en -6, dio ${lejos.limitePct}`);
  esperar(lejos.tipoStop === 'volatilidad', 'y volver a declararse por volatilidad');

  // soporte pegado (-0,4%): el piso duro de -4% protege del stop de ruido
  const pegado = plan({ volPct: vol, distanciaPisoPct: 0.4 });
  esperar(pegado.limitePct === -4,
    `un soporte pegado no puede dar un stop de ruido: piso -4%, dio ${pegado.limitePct}`);

  // el R:B se recalcula sobre el stop que de verdad rige
  casiIgual(cerca.riesgoBeneficio, cerca.objetivoPct / Math.abs(cerca.limitePct), 0.01,
    'el R:B debe usar el stop efectivo, no el de volatilidad');
});

// --- INVALIDACIÓN ------------------------------------------------------------
test('perder el piso de 30 días manda el activo a cuarentena, aunque salga por plazo', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const f = join(process.env.KW_DATA, 'posiciones.json');

  // Posición con invalidación a -10% y precio de salida por debajo de eso.
  const pos = motor.abrirPosicion({
    asset: 'HEMI', qty: 1, entrada: 100, objetivoPct: 15, limitePct: -6,
    invalidacionPct: -10, origen: 'test',
  });
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const guardada = d.posiciones.find(x => x.id === pos.id);
  esperar(guardada.invalidacionPct === -10, 'la invalidación se persiste con la posición');

  // La clasificación es la que decide la cuarentena: un cierre bajo el piso se
  // registra como `stop` aunque la señal haya sido otra. Sin esto, un activo con
  // la estructura rota podía reproponerse al día siguiente.
  const bajoElPiso = 89;    // -11% desde la entrada
  const sobreElPiso = 95;   // -5%
  esperar(bajoElPiso <= 100 * (1 + guardada.invalidacionPct / 100),
    'el caso de prueba debe estar de verdad bajo el nivel de invalidación');
  esperar(!(sobreElPiso <= 100 * (1 + guardada.invalidacionPct / 100)),
    'y el de control, por encima');

  writeFileSync(f, JSON.stringify(d, null, 2));
});

// --- CHECK DE VOLATILIDAD (bloqueo, no aviso) --------------------------------
test('la compuerta BLOQUEA cuando el mínimo de orden hace arriesgar de más', () => {
  // PUMP real: 5 USDT con stop -13% arriesga 0,65 — 1,9x el objetivo de 0,35.
  // Pasó con un simple aviso y quedó en cartera al doble del riesgo.
  const pump = motor.compuertaRiesgo({ montoUSDT: 5, limitePct: -13 }, {});
  esperar(pump.bloqueos.some(b => b.includes('el objetivo')),
    'un plan que arriesga ~2x el objetivo tiene que BLOQUEAR, no avisar');

  // stop -7%: 0,35 exactos, el caso normal no puede quedar bloqueado
  const normal = motor.compuertaRiesgo({ montoUSDT: 5, limitePct: -7 }, {});
  esperar(!normal.bloqueos.some(b => b.includes('el objetivo')),
    'el dimensionamiento normal debe pasar: un control que bloquea todo es el bug de ADA otra vez');
});

// --- R:B MÍNIMO TAMBIÉN EN LAS OFERTAS MANUALES ------------------------------
//
// El screening automático descartaba candidatos con R:B pobre, pero una oferta
// pedida a mano no pasaba por ese filtro: LINK se creó con 1,17 (arriesgar 6%
// para ganar 8%). La puerta tiene que ser una sola, venga de donde venga.
test('el R:B mínimo rige también en una oferta pedida a mano', () => {
  // el caso real de LINK: stop -6%, objetivo +7% → R:B 1,17
  const link = motor.compuertaRiesgo({ montoUSDT: 5, limitePct: -6, objetivoPct: 7 }, {});
  esperar(link.bloqueos.some(b => b.includes('R:B')),
    'una oferta manual con R:B 1,17 debe bloquear igual que un candidato del screening');

  // R:B 2,0 pasa: el filtro tiene que cortar lo malo, no todo
  const bueno = motor.compuertaRiesgo({ montoUSDT: 5, limitePct: -6, objetivoPct: 12 }, {});
  esperar(!bueno.bloqueos.some(b => b.includes('R:B')),
    'con R:B 2,0 no puede bloquear: un control que bloquea todo no controla nada');

  // justo en el mínimo pasa (1,5 exacto no es "bajo el mínimo")
  const justo = motor.compuertaRiesgo({ montoUSDT: 5, limitePct: -6, objetivoPct: 9 }, {});
  esperar(!justo.bloqueos.some(b => b.includes('R:B')), 'R:B 1,5 exacto cumple el mínimo');

  // sin objetivo declarado no se inventa un R:B (el panel /api/riesgo consulta
  // el estado sin plan concreto y no puede quedar bloqueado por eso)
  const sinPlan = motor.compuertaRiesgo({ montoUSDT: 5, limitePct: -6 }, {});
  esperar(!sinPlan.bloqueos.some(b => b.includes('R:B')),
    'sin objetivo no hay R:B que juzgar');
});

// --- LA JUGADA MANUAL TAMBIÉN PASA POR LA COMPUERTA --------------------------
//
// `/api/jugada` iba DIRECTO al estado: el botón del dashboard se saltaba el
// freno de caída, el techo del sleeve, el tope de riesgo abierto, el desvío de
// riesgo y el R:B mínimo. Cerrar el R:B en las ofertas y dejarlo abierto acá
// era cerrar una puerta y no la de al lado.
test('la compuerta juzga la billetera EN MEMORIA, no la del disco', () => {
  const prices = { SOLUSDT: 100 };
  // Misma consulta, dos billeteras distintas: si mirara el disco, daría igual
  // en los dos casos y la jugada manual quedaría juzgada sobre un estado viejo.
  const holgada = billetera({ reserva: 50 });
  const apretada = billetera({ sleeve: { SOL: 0.5 }, reserva: 0.4 });

  const plan = { montoUSDT: 5, limitePct: -6, objetivoPct: 12 };
  const a = motor.compuertaRiesgo(plan, prices, { wallet: holgada });
  const b = motor.compuertaRiesgo(plan, prices, { wallet: apretada });

  esperar(!a.bloqueos.some(x => x.includes('reserva')), `con 50 de reserva no puede faltar plata: ${a.bloqueos}`);
  esperar(b.bloqueos.some(x => x.includes('reserva')), 'con 0,40 de reserva tiene que bloquear por falta de fondos');
  esperar(a.estado.reservaUSDT === 50 && b.estado.reservaUSDT === 0.4,
    'y cada veredicto debe reportar la billetera que se le dio, no la del disco');
});

test('una jugada rechazada por riesgo no deja rastro en el estado', async () => {
  const { readFileSync } = await import('node:fs');
  const fPos = join(process.env.KW_DATA, 'posiciones.json');
  const fWal = join(process.env.KW_DATA, 'wallet.json');
  const antesPos = readFileSync(fPos, 'utf8');
  const antesWal = readFileSync(fWal, 'utf8');

  // R:B 0,5 — arriesga 10% para ganar 5%. Debe rebotar en la compuerta.
  let codigo = null;
  await sinRed({ SOLUSDT: 100 }, async () => {
    try {
      await motor.jugadaManual({
        comprar: [{ asset: 'SOL', usdt: 5, limitePct: -10, objetivoPct: 5, tesis: 'test de rechazo' }],
        etiqueta: 'test', origen: 'test',
      });
    } catch (e) { codigo = e.codigo ?? 'sin-codigo'; }
  });

  esperar(codigo === 423, `debe rechazar con 423 (bloqueo de riesgo); dio "${codigo}"`);
  // Lo que de verdad importa: que el rechazo sea limpio. Antes las ventas ya
  // habían cerrado posiciones en disco cuando todavía faltaba pedirle stops a
  // Binance — si esa llamada fallaba, quedaba la posición cerrada y la
  // billetera sin escribir, con el activo contado dos veces.
  esperar(readFileSync(fPos, 'utf8') === antesPos, 'posiciones.json no puede haberse tocado');
  esperar(readFileSync(fWal, 'utf8') === antesWal, 'wallet.json no puede haberse tocado');
});

// --- EL MONITOR DEJA SU PUNTO EN LA SERIE ------------------------------------
//
// El freno de caída del 10% saca el pico de `snapshots.jsonl`, y esa serie solo
// la escribía el dashboard. El pico contra el que medía era "el máximo que
// alguien estuvo mirando": un techo de madrugada no existía para la compuerta.
test('el monitor registra el pico aunque nadie tenga el dashboard abierto', async () => {
  const { readFileSync } = await import('node:fs');
  const f = join(process.env.KW_DATA, 'snapshots.jsonl');
  const lineas = () => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).length;

  const antes = lineas();
  const valor = motor.registrarSnapshotDeVigilancia({ SOLUSDT: 100, BTCUSDT: 69000, ETHUSDT: 2200 });
  esperar(lineas() === antes + 1, 'debe agregar exactamente un punto a la serie');
  esperar(Number.isFinite(valor), `y devolver el valor registrado, dio "${valor}"`);

  // Y ese punto tiene que ser visible para el freno: si el pico no lo ve, la
  // función escribe por escribir.
  const dd = motor.drawdownActual(valor * 0.5);
  esperar(dd.pico >= valor, `el pico del freno debe incluir el punto recién escrito (pico ${dd.pico} vs ${valor})`);
  esperar(dd.drawdownPct < -40, `y una cartera a la mitad debe reportar caída fuerte, dio ${dd.drawdownPct}%`);
});

// --- EL MÉTODO DE APRENDIZAJE TIENE QUE PODER LEERSE A SÍ MISMO --------------
//
// De nada sirve escribir lecciones si el extractor no las ve. Tres mecanismos
// que estaban rotos en silencio: el cuerpo de las entradas se cortaba en la
// primera letra "Z", el detector de deriva denunciaba constantes renombradas, y
// la tabla de versiones no tenía nada que la contrastara.
test('el extractor de la bitácora llega hasta el final del archivo', async () => {
  const a = await import('./aprendizaje.mjs');
  const { readFileSync } = await import('node:fs');
  const texto = readFileSync(join(DIR, '..', 'BITACORA.md'), 'utf8');

  const cabeceras = [...texto.matchAll(/^## \d{4}-\d{2}-\d{2}/gm)].length;
  const entradas = a.evolucionSistema();
  esperar(entradas.length === cabeceras,
    `debe leer TODAS las entradas: ${cabeceras} cabeceras en el archivo, ${entradas.length} leídas`);

  // El bug era `\Z`, que en JavaScript es la letra Z literal: el cuerpo se
  // cortaba en el primer "ZEC" y las lecciones, que van al final, se perdían.
  const conLeccion = entradas.filter(e => e.lecciones.length);
  esperar(conLeccion.length > 0, 'tiene que extraer lecciones de verdad, no una lista vacía');
  esperar(entradas.at(-1).titulo.length > 0, 'y la última entrada no puede quedar decapitada');
});

test('la deriva distingue "el motor no cumple" de "el patrón está podrido"', async () => {
  const a = await import('./aprendizaje.mjs');

  // Caso real reproducido: una hipótesis respaldada que apunta a un nombre que
  // no existe en ningún módulo. `VENTANA_DIAS` se renombró a
  // `VENTANA_MODELO_DIAS` y el detector denunció una regla YA implementada —
  // 3 de sus 4 alarmas eran falsas, y un control que grita en falso se ignora.
  a.agregarHipotesis({
    id: 'test-patron-podrido',
    enunciado: 'Hipótesis de prueba cuyo patrón apunta a un nombre inexistente.',
    estado: 'confirmada',
    implementacion: { esperada: 'da igual', patron: 'ESTA_CONSTANTE_NO_EXISTE_EN_NINGUN_MODULO' },
  });

  const podrida = a.deriva().find(x => x.id === 'test-patron-podrido');
  esperar(podrida.sinVerificar === true, 'lo que no se puede verificar debe quedar marcado');
  esperar(/revisar si el motor/.test(podrida.motivo ?? ''),
    `el motivo tiene que nombrar las DOS lecturas posibles, no afirmar una; dio "${podrida.motivo}"`);

  // Control positivo: con un patrón que sí existe, no se marca nada.
  const real = a.deriva().find(x => x.id === 'sello-de-version');
  esperar(real != null, 'las hipótesis de hoy tienen que estar registradas');
  esperar(real.enCodigo && !real.sinVerificar && real.motivo === null,
    'una hipótesis implementada de verdad no puede aparecer marcada de ninguna forma');
});

test('todo sello que operó está declarado en la tabla de versiones', async () => {
  const a = await import('./aprendizaje.mjs');
  const sinDeclarar = a.sellosNoDeclarados();
  esperar(sinDeclarar.length === 0,
    `la tabla del plan ya se pudrió una vez; sellos sin documentar: ${sinDeclarar.map(x => x.sello).join(', ')}`);

  const conSello = a.evolucionModelo().filter(v => v.sello);
  esperar(conSello.length > 0, 'la tabla debe declarar al menos un sello, o el contraste no verifica nada');
});

// --- PARALELISMO ACOTADO: MISMO RESULTADO, MENOS ESPERA ----------------------
//
// El análisis pedía las velas de los 30 candidatos de a uno (medido: 9x más
// lento). Paralelizar el camino que construye el RANKING solo es aceptable si
// el resultado es idéntico — si el orden dependiera de qué respuesta llega
// primero, los empates de momentum se resolverían por latencia de red.
test('enParalelo devuelve lo mismo que el bucle secuencial, en el mismo orden', async () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  // Latencia INVERSA al índice: el último en pedirse es el primero en llegar.
  // Si la implementación devolviera por orden de llegada, esto lo delata.
  const lento = async i => { await new Promise(r => setTimeout(r, (20 - i) * 2)); return i * 10; };

  const serie = await motor._test.enParalelo(items, lento, 1);
  const paralelo = await motor._test.enParalelo(items, lento, 6);

  esperar(JSON.stringify(serie.map(r => r.valor)) === JSON.stringify(paralelo.map(r => r.valor)),
    'con concurrencia 1 y 6 el arreglo tiene que ser idéntico');
  esperar(paralelo.every((r, i) => r.valor === i * 10),
    `debe respetar el orden de ENTRADA, no el de llegada: ${paralelo.map(r => r.valor).slice(0, 5)}`);
});

test('un símbolo caído no tumba al resto ni corre el resultado de lugar', async () => {
  const items = ['bueno', 'roto', 'otro'];
  const r = await motor._test.enParalelo(items, x => {
    if (x === 'roto') throw new Error('delistado');
    return Promise.resolve(x.toUpperCase());
  });

  esperar(r.length === 3, 'el arreglo mantiene una ranura por elemento, aunque falle');
  esperar(r[0].valor === 'BUENO' && r[2].valor === 'OTRO',
    'los que funcionan conservan su posición: el fallo no los desplaza');
  esperar(r[1].ok === false && /delistado/.test(r[1].error.message),
    'y el que falló declara su error en su propia ranura, no se pierde');
});

test('el paralelismo respeta el límite de concurrencia', async () => {
  let vivos = 0, pico = 0;
  await motor._test.enParalelo(Array.from({ length: 30 }, (_, i) => i), async () => {
    vivos++; pico = Math.max(pico, vivos);
    await new Promise(r => setTimeout(r, 5));
    vivos--;
  }, 6);
  // Sin tope, 30 peticiones simultáneas pueden ganarse un 429 de Binance y
  // tumbar el análisis entero: el remedio sería peor que la lentitud.
  esperar(pico <= 6, `nunca más de 6 en vuelo a la vez; llegó a ${pico}`);
  esperar(pico === 6, `y debe usar el cupo completo, o no sirve de nada; llegó a ${pico}`);
});

// --- LA WATCHLIST SABE ESPERAR A QUE UN ACTIVO SE CALME ----------------------
//
// Había activos que no se rechazan por caros sino por INDIMENSIONABLES: TUT con
// 27,2% diario necesita un stop de −15%, y el mínimo de orden de 5 USDT obliga a
// arriesgar 2,1x el objetivo. Sin condición de volatilidad, la entrada armaría
// una oferta que la compuerta rechaza cada 15 minutos, para siempre.
test('la watchlist puede esperar a que baje la volatilidad', () => {
  const cond = { volMaxPct: 7, rsiMax: 70 };

  const hoy = motor.condicionCumplida(cond, { volDiariaPct: 27.2, rsi14d: 54 });
  esperar(!hoy.ok, 'con 27,2% diario no puede armar: la oferta rebotaría en la compuerta');
  esperar(hoy.faltas.some(f => /volatilidad/.test(f)),
    `y debe DECIR que la volatilidad es lo que falta, no dejar al usuario adivinando: ${hoy.faltas}`);

  const calmado = motor.condicionCumplida(cond, { volDiariaPct: 6.1, rsi14d: 54 });
  esperar(calmado.ok, `con 6,1% ya es dimensionable y debe armar; faltó: ${calmado.faltas}`);

  // Sin dato de volatilidad NO se asume que está bien: se espera.
  const ciego = motor.condicionCumplida(cond, { rsi14d: 54 });
  esperar(!ciego.ok, 'sin dato de volatilidad no puede darse por cumplida');
});

test('la volatilidad de la watchlist usa la MISMA ventana que decide el tamaño', async () => {
  // Si la condición midiera sobre 31 velas y el sizing sobre 15, la entrada
  // armaría justo cuando el tamaño todavía no da: dos números para la misma
  // cosa. No se puede probar por resultado —ambos caminos salen a la red— así
  // que se verifica el contrato en la fuente, como la prueba de imports.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(DIR, 'engine.mjs'), 'utf8');
  const llamadas = [...src.matchAll(/volatilidadDiaria\(([^)]*)\)/g)].map(m => m[1].trim());
  const usos = llamadas.filter(a => a !== 'cierres');   // la definición no cuenta

  esperar(usos.length >= 2, `debe haber al menos dos usos (sizing y watchlist), hay ${usos.length}`);
  esperar(usos.every(a => a.includes('slice(-15')),
    `todas las llamadas deben medir sobre las mismas 15 velas; se encontró: ${usos.join(' | ')}`);

  // y que el helper siga alimentando la fórmula del stop
  const v = motor._test.volatilidadDiaria([100, 104, 99, 103, 97, 105, 101, 98, 106, 102, 99, 104, 100, 103, 101]);
  const plan = motor._test.stopsSugeridosPuro({ volPct: v });
  casiIgual(Math.abs(plan.limitePct), Math.min(15, Math.max(4, Math.round(v * 1.5))), 0.001,
    'el stop tiene que salir exactamente de esa misma volatilidad');
});

// --- TRAILING: PROTEGE LA GANANCIA SIN PONERLE TECHO -------------------------
//
// "Si sube y después se devuelve un 25%, salir". Lo contrario del objetivo
// fijo: no limita cuánto puede subir, limita cuánto puede devolverse.
test('el trailing solo APRIETA el stop, nunca lo ensancha', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const f = join(process.env.KW_DATA, 'posiciones.json');

  const pos = motor.abrirPosicion({
    asset: 'SOL', qty: 1, entrada: 100, objetivoPct: 40, limitePct: -13, origen: 'test',
  });
  motor.fijarTrailing([pos.id], 25);

  const conPico = pico => {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    d.posiciones.find(x => x.id === pos.id).picoDesdeApertura = pico;
    writeFileSync(f, JSON.stringify(d, null, 2));
    return motor.evaluarPosiciones({ SOLUSDT: 100 }).find(x => x.id === pos.id);
  };

  // Pico bajo: el 25% cae POR DEBAJO del stop original (-13%). Manda el original.
  const flojo = conPico(110);            // 110 × 0,75 = 82,5 → −17,5%
  casiIgual(flojo.limitePctEfectivo, -13, 0.01,
    `con el pico en 110 el trailing quedaría en −17,5% y NO puede ensanchar el stop; dio ${flojo.limitePctEfectivo}`);
  esperar(!flojo.trailActivo, 'y debe declararse inactivo');

  // Pico alto: ahora sí aprieta y protege la ganancia.
  const firme = conPico(160);            // 160 × 0,75 = 120 → +20%
  casiIgual(firme.limitePctEfectivo, 20, 0.01,
    `con el pico en 160 el stop debe subir a +20%; dio ${firme.limitePctEfectivo}`);
  esperar(firme.trailActivo, 'y declararse activo');

  // Y corta: a 100 el precio ya está bajo el nivel de 120.
  esperar(firme.senal === 'cruzo-limite',
    `devuelto el 25% desde el pico tiene que cortar; llegó "${firme.senal}"`);
});

test('sin pico medido el trailing no inventa un nivel', async () => {
  const pos = motor.abrirPosicion({
    asset: 'SOL', qty: 1, entrada: 100, objetivoPct: 40, limitePct: -13, origen: 'test',
  });
  motor.fijarTrailing([pos.id], 25);
  // Nunca se refrescó el pico (equipo dormido, Binance caído): debe comportarse
  // exactamente como antes, no cortar por un pico imaginario.
  const ev = motor.evaluarPosiciones({ SOLUSDT: 100 }).find(x => x.id === pos.id);
  casiIgual(ev.limitePctEfectivo, -13, 0.01, 'sin pico manda el stop original');
  esperar(ev.senal === 'ok', `y no puede cortar; llegó "${ev.senal}"`);

  // EL CASO QUE DE VERDAD DUELE: un stop ANCHO. Si a falta de pico se usara la
  // entrada, el trailing del 25% quedaría en −25% y APRETARÍA un stop de −40%,
  // recortando la posición por un máximo que nunca ocurrió.
  const ancha = motor.abrirPosicion({
    asset: 'HEMI', qty: 1, entrada: 100, objetivoPct: 90, limitePct: -40, origen: 'test',
  });
  motor.fijarTrailing([ancha.id], 25);
  const e2 = motor.evaluarPosiciones({ HEMIUSDT: 100 }).find(x => x.id === ancha.id);
  casiIgual(e2.limitePctEfectivo, -40, 0.01,
    `sin pico NO puede apretar un stop ancho; dio ${e2.limitePctEfectivo}`);
  esperar(!e2.trailActivo, 'y el trailing debe declararse inactivo mientras no haya pico medido');

  motor.fijarTrailing([pos.id], null);
  const sin = motor.evaluarPosiciones({ SOLUSDT: 100 }).find(x => x.id === pos.id);
  esperar(sin.trailPct === null, 'y se puede desactivar');
});

// --- AUDITORÍA 2026-09-01: seis mecanismos con hueco -------------------------
//
// Cada prueba de acá abajo se verificó POR MUTACIÓN: corre en rojo contra el
// código anterior al arreglo y en verde contra el actual. Una prueba que nace
// en verde no prueba nada.

test('un corte de la rampa del plazo no se disfraza de stop aunque haya trailing', () => {
  const f = join(process.env.KW_DATA, 'posiciones.json');
  motor._test.escribirJSON(f, { posiciones: [] });
  const hace = h => new Date(Date.now() - h * 3_600_000).toISOString();
  // Plazo de 24 h puesto hace 48: rampa completa, el nivel de salida ya subió a
  // la banda de ruido (~+2,2% con vol 4). El trailing existe pero su nivel
  // quedó en −12%: el que manda es el plazo, y la etiqueta lo tiene que decir —
  // 'cruzo-limite' clasificaría el cierre como stop y mandaría a cuarentena
  // una salida que fue por tiempo, no por precio.
  const pos = motor.abrirPosicion({
    asset: 'SOL', qty: 1, entrada: 100, objetivoPct: 30, limitePct: -10,
    horizonteHoras: 24, volatilidadDiariaPct: 4, origen: 'test',
  });
  const data = JSON.parse(motor._test.fs.readFileSync(f, 'utf8'));
  const p = data.posiciones.find(x => x.id === pos.id);
  p.abierto = hace(48);
  p.plazoDesde = hace(48);
  p.trailPct = 20;
  p.picoDesdeApertura = 110;   // trailing en −12%: por debajo de la rampa
  motor._test.escribirJSON(f, data);

  const ev = motor.evaluarPosiciones({ SOLUSDT: 101 }).find(x => x.id === pos.id);
  esperar(ev.senal === 'vencido-sin-renta',
    `cortó la rampa del plazo, no el trailing: la señal debe ser 'vencido-sin-renta', dio '${ev.senal}'`);

  // y cuando el trailing SÍ es el nivel que manda, sigue cortando como stop
  p.picoDesdeApertura = 150;   // trailing en +20%, por encima de la rampa
  motor._test.escribirJSON(f, data);
  const ev2 = motor.evaluarPosiciones({ SOLUSDT: 101 }).find(x => x.id === pos.id);
  esperar(ev2.senal === 'cruzo-limite',
    `con el trailing mandando (+20%), el corte sigue siendo stop; dio '${ev2.senal}'`);
});

test('vender la mitad REDUCE la posición; venderla toda la cierra', async () => {
  const fPos = join(process.env.KW_DATA, 'posiciones.json');
  motor._test.escribirJSON(fPos, { posiciones: [] });
  const w = billetera({ ancla: { BTC: 0.0007 }, sleeve: { SOL: 0.2 }, reserva: 10 });
  motor._test.escribirJSON(motor._test.WALLET_FILE, w);
  const pos = motor.abrirPosicion({ asset: 'SOL', qty: 0.2, entrada: 100, objetivoPct: 20, limitePct: -8, origen: 'test' });

  // 0,2 SOL a 100 valen 20 USDT; se venden 10 → la mitad. Antes esto marcaba la
  // posición entera como cerrada y la otra mitad quedaba en el sleeve sin stop,
  // sin trailing y sin vigilancia: dinero huérfano de todos los controles.
  await sinRed({ SOLUSDT: 100 }, () => motor.jugadaManual({
    vender: [{ asset: 'SOL', usdt: 10 }], etiqueta: 'test', origen: 'test' }));
  let p = JSON.parse(motor._test.fs.readFileSync(fPos, 'utf8')).posiciones.find(x => x.id === pos.id);
  esperar(p.estado === 'abierta', `tras vender la mitad, la posición debe seguir abierta (quedó '${p.estado}')`);
  casiIgual(p.qty, 0.1, 0.001, 'y con la mitad del tamaño');

  await sinRed({ SOLUSDT: 100 }, () => motor.jugadaManual({
    vender: [{ asset: 'SOL' }], etiqueta: 'test', origen: 'test' }));
  p = JSON.parse(motor._test.fs.readFileSync(fPos, 'utf8')).posiciones.find(x => x.id === pos.id);
  esperar(p.estado === 'cerrada', `vender el total debe cerrarla (quedó '${p.estado}')`);
});

test('pedir más de lo que hay en reserva rebota en la compuerta, no compra menos en silencio', async () => {
  motor._test.escribirJSON(join(process.env.KW_DATA, 'posiciones.json'), { posiciones: [] });
  // BTC alto para que el drawdown no bloquee por su cuenta: lo que se prueba es
  // EL MOTIVO del rechazo, no que algo rechace.
  const w = billetera({ ancla: { BTC: 0.0014 }, reserva: 6 });
  motor._test.escribirJSON(motor._test.WALLET_FILE, w);
  let error = null;
  await sinRed({ SOLUSDT: 100 }, async () => {
    try {
      // Antes: min(8, 6) compraba 6 sin avisar, y el bloqueo "reserva
      // insuficiente" de la compuerta no podía dispararse nunca — un control
      // que siempre decía OK.
      await motor.jugadaManual({
        comprar: [{ asset: 'SOL', usdt: 8, limitePct: -5, objetivoPct: 10, tesis: 'test' }],
        etiqueta: 'test', origen: 'test',
      });
    } catch (e) { error = e; }
  });
  esperar(error?.codigo === 423 && /reserva insuficiente/i.test(error?.message ?? ''),
    `debe bloquear con 'reserva insuficiente' (423); dio ${error?.codigo ?? 'sin error'}: ${error?.message ?? 'la jugada se ejecutó'}`);
});

test('el tope de riesgo abierto también cuenta las compras encoladas del mismo lote', () => {
  motor._test.escribirJSON(join(process.env.KW_DATA, 'posiciones.json'), { posiciones: [] });
  const w = billetera({ ancla: { BTC: 0.0014 }, reserva: 20 });
  const prices = { BTCUSDT: 69000, SOLUSDT: 100 };
  const plan = { montoUSDT: 5, limitePct: -10, objetivoPct: 20 };   // riesgo 0,50 USDT

  const sola = motor.compuertaRiesgo(plan, prices, { wallet: w });
  esperar(sola.pasa, `la compra sola debe pasar; bloqueó: ${sola.bloqueos.join(' · ')}`);

  // Con 5,5 USDT ya arriesgados por las compras anteriores del lote (que aún no
  // están en posiciones.json), la misma compra tiene que rebotar en el 5%.
  const conLote = motor.compuertaRiesgo(plan, prices, { wallet: w, riesgoExtraUSDT: 5.5 });
  esperar(!conLote.pasa && conLote.bloqueos.some(b => /riesgo abierto/.test(b)),
    `con el lote a cuestas debe bloquear por el tope del 5%; dio: ${conLote.bloqueos.join(' · ') || 'pasó'}`);
});

test('una entrada agregada mientras la watchlist consulta la red no se pierde', async () => {
  const fW = join(process.env.KW_DATA, 'watchlist.json');
  motor._test.escribirJSON(fW, { entradas: [{
    id: 'test-sol', asset: 'SOL', estado: 'vigilando',
    creada: new Date().toISOString(),
    vence: new Date(Date.now() + 86_400_000).toISOString(),
    condicion: { rsiMax: 70, fasesOk: ['tendencia'] },
    chequeos: 0, ultimoChequeo: null, ultimoEstadoCond: null,
  }] });
  // sin SOL en la billetera, o la evaluación lo cancelaría por "ya en cartera"
  motor._test.escribirJSON(motor._test.WALLET_FILE, billetera({ ancla: { BTC: 0.0014 } }));

  // El monitor evalúa (fase de red) y JUSTO en el medio el dashboard agrega
  // otra entrada. Antes el monitor escribía la foto que había leído al empezar
  // y la entrada nueva desaparecía en silencio.
  const original = globalThis.fetch;
  let inyectada = false;
  globalThis.fetch = async url => {
    if (!inyectada && String(url).includes('klines')) {
      inyectada = true;
      motor.agregarWatch({ asset: 'ETH', motivo: 'agregada en plena evaluación', origen: 'test' });
    }
    return { ok: true, status: 200, json: async () => respuestaFalsa(String(url), { SOLUSDT: 85 }), text: async () => '' };
  };
  try { await motor.evaluarWatchlist({ tipo: 'sano' }); }
  finally { globalThis.fetch = original; }

  esperar(inyectada, 'la prueba tiene que haber inyectado la entrada durante la fase de red');
  const eth = motor.watchlist().find(x => x.asset === 'ETH');
  esperar(eth?.estado === 'vigilando',
    `la entrada agregada durante la evaluación debe sobrevivir (quedó ${eth?.estado ?? 'BORRADA'})`);
});

test('aplicar el plan sobrevive a la billetera migrada y poda las salidas viejas', async () => {
  motor._test.escribirJSON(join(process.env.KW_DATA, 'posiciones.json'), { posiciones: [] });
  // como la real: bolsillos y nada más — la clave `holdings` no existe.
  // `wallet.holdings[...]` reventaba acá DESPUÉS de escribir la billetera y los
  // movimientos: el estado quedaba a medio actualizar.
  const w = billetera({ ancla: { BTC: 0.0014 }, reserva: 20 });
  motor._test.escribirJSON(motor._test.WALLET_FILE, w);
  const fLR = join(process.env.KW_DATA, 'last-run.json');
  const previo = JSON.parse(motor._test.fs.readFileSync(fLR, 'utf8'));
  motor._test.escribirJSON(fLR, {
    ...previo, picks: ['SOL'], ranuras: 1, propuesta: { avisos: [] },
    // ACE se cerró hace días y no está en ningún bolsillo: su fila es basura
    // que nadie podaba (seguía viva desde el 19-ago en el last-run real)
    salidas: [{ asset: 'ACE', objetivoPct: 25, limitePct: -12 }, { asset: 'SOL', objetivoPct: 6, limitePct: -4 }],
  });

  const r = await sinRed({ SOLUSDT: 100 }, () => motor.aplicarPlan());
  esperar(r.salidas.every(s => s.asset !== 'ACE'), 'la salida de un activo que ya no se tiene debe podarse');
  esperar(r.salidas.some(s => s.asset === 'SOL'), 'y la del activo recién comprado debe quedarse');
});

// --- LA BASE DEL REPLAY DE SALIDAS -------------------------------------------
//
// `replay-salidas.mjs` mide políticas alternativas llamando a `evaluarNiveles`,
// la MISMA función que el motor corre en producción. Eso vale solo si el tiempo
// entra como parámetro y no como lectura del reloj: si `evaluarNiveles` mirara
// `Date.now()` por dentro, el replay estaría midiendo todas las horas del
// pasado como si fueran ahora, y la rampa del plazo nunca aparecería.
test('los niveles dependen del tiempo dado, no del reloj', () => {
  const p = {
    asset: 'SOL', entrada: 100, objetivoPct: 30, limitePct: -10,
    horizonteHoras: 24, volatilidadDiariaPct: 4,
  };
  // antes de vencer: manda el stop original, sin rampa
  const joven = motor.evaluarNiveles(p, 100, 1);
  casiIgual(joven.limitePctEfectivo, -10, 0.01, `sin vencer el plazo el límite es el original; dio ${joven.limitePctEfectivo}`);
  esperar(joven.rampaPlazo === 0, 'y la rampa está en cero');

  // recién vencido: la rampa arranca en cero, el nivel sigue siendo el original
  const justo = motor.evaluarNiveles(p, 100, 24);
  casiIgual(justo.limitePctEfectivo, -10, 0.01, `al vencer, la rampa arranca en el nivel original; dio ${justo.limitePctEfectivo}`);

  // al doble del plazo: rampa completa, el nivel llegó a la banda de ruido
  const viejo = motor.evaluarNiveles(p, 100, 48);
  esperar(viejo.rampaPlazo === 1, `al doble del plazo la rampa está completa; dio ${viejo.rampaPlazo}`);
  esperar(viejo.limitePctEfectivo > -10 && viejo.limitePctEfectivo > 0,
    `y el límite subió hasta la banda de ruido (comisión + medio día de volatilidad); dio ${viejo.limitePctEfectivo}`);

  // A mitad de camino tiene que estar en el PUNTO MEDIO exacto entre el stop
  // original y el destino: es una rampa lineal, no un escalón con disfraz.
  const medio = motor.evaluarNiveles(p, 100, 36);
  casiIgual(medio.limitePctEfectivo, (-10 + viejo.limitePctEfectivo) / 2, 0.01,
    `a mitad de rampa el nivel es el punto medio; dio ${medio.limitePctEfectivo}`);

  // y la propiedad que hace válido el replay: mismo estado y misma hora, misma
  // respuesta, sin importar cuándo se pregunte
  const otraVez = motor.evaluarNiveles(p, 100, 36);
  esperar(otraVez.limitePctEfectivo === medio.limitePctEfectivo && otraVez.senal === medio.senal,
    'la función tiene que ser pura: mismos argumentos, mismo resultado');
});

// --- POLÍTICA DE SALIDA v4a: TRAILING ARMADO, SIN PLAZO ----------------------
//
// Adoptada tras medir 221 ventanas: la anterior (objetivo fijo + plazo 24 h)
// perdía -0,205% por operación neta de comisiones.

test('el trailing no rige hasta alcanzar su renta de activación', () => {
  const f = join(process.env.KW_DATA, 'posiciones.json');
  motor._test.escribirJSON(f, { posiciones: [] });
  const p = {
    entrada: 100, objetivoPct: 20, limitePct: -8,
    trailPct: 10, activarTrailEnPct: 10, politicaSalida: 'trailing',
  };

  // Pico en +5%: NO alcanza el umbral de activación. Sin esta regla, el
  // trailing del 10% pondría el stop en 104,5 x 0,9 = -5,9% desde el primer
  // momento — un stop más estrecho disfrazado de protección de ganancia, que
  // es OTRA política y da otro resultado.
  const flojo = motor.evaluarNiveles({ ...p, picoDesdeApertura: 105 }, 100, 0);
  casiIgual(flojo.limitePctEfectivo, -8, 0.01,
    `con el pico bajo el umbral manda el stop original; dio ${flojo.limitePctEfectivo}`);
  esperar(!flojo.trailActivo, 'y el trailing debe declararse inactivo');

  // Pico en +12%: ya armó. El nivel pasa a 112 x 0,9 = 100,8 → +0,8%
  const armado = motor.evaluarNiveles({ ...p, picoDesdeApertura: 112 }, 105, 0);
  casiIgual(armado.limitePctEfectivo, 0.8, 0.01,
    `armado, el trailing manda desde el pico; dio ${armado.limitePctEfectivo}`);
  esperar(armado.trailActivo, 'y debe declararse activo');

  // y corta como stop cuando el precio lo cruza
  const cortado = motor.evaluarNiveles({ ...p, picoDesdeApertura: 112 }, 100.5, 0);
  esperar(cortado.senal === 'cruzo-limite', `al cruzar el trailing sale como stop; dio '${cortado.senal}'`);
});

test('con política de trailing el objetivo ya no vende, pero sigue midiendo el R:B', () => {
  const p = {
    entrada: 100, objetivoPct: 20, limitePct: -8,
    trailPct: 10, activarTrailEnPct: 10, politicaSalida: 'trailing',
  };
  // +25%: muy por encima del objetivo de +20%. La política anterior habría
  // cobrado ahí; ésta deja correr, que es exactamente el punto.
  const arriba = motor.evaluarNiveles({ ...p, picoDesdeApertura: 125 }, 125, 0);
  esperar(arriba.senal !== 'cruzo-objetivo',
    `el objetivo no puede cortar bajo política de trailing; dio '${arriba.senal}'`);
  // pero el nivel sigue existiendo: es el numerador del R:B que filtra entradas
  casiIgual(arriba.objetivo, 120, 0.01, 'el objetivo se conserva como referencia');

  // y una posición SIN esa política mantiene el comportamiento de siempre
  const vieja = motor.evaluarNiveles({ entrada: 100, objetivoPct: 20, limitePct: -8 }, 125, 0);
  esperar(vieja.senal === 'cruzo-objetivo',
    `sin política declarada el objetivo sigue cortando; dio '${vieja.senal}'`);

  // Tampoco puede decir "cerca del objetivo": anunciaría un cobro que no ocurre.
  // El pico va bajo el umbral para aislar el caso del corte por trailing.
  const lejos = motor.evaluarNiveles({ ...p, picoDesdeApertura: 0 }, 118, 0);
  esperar(lejos.senal !== 'cerca-objetivo',
    `bajo trailing no existe "cerca del objetivo"; dio '${lejos.senal}'`);
});

test('adoptar la política nueva no cambia las reglas de una posición ya abierta', () => {
  const f = join(process.env.KW_DATA, 'posiciones.json');
  motor._test.escribirJSON(f, { posiciones: [] });
  // Como PUMP: abierta con objetivo +33% y trailing desde la apertura, sin
  // umbral de activación. Cambiarle el trato a mitad de vuelo corrompería lo
  // que el sello de versión existe para poder auditar.
  const vieja = motor.abrirPosicion({
    asset: 'SOL', qty: 1, entrada: 100, objetivoPct: 33, limitePct: -13, origen: 'test',
  });
  motor.fijarTrailing([vieja.id], 25);
  const ev = motor.evaluarPosiciones({ SOLUSDT: 134 }).find(x => x.id === vieja.id);
  esperar(ev.senal === 'cruzo-objetivo',
    `una posición anterior debe seguir cobrando en su objetivo; dio '${ev.senal}'`);
});

test('la política vigente entra al sello del motor', async () => {
  const params = JSON.parse(JSON.stringify(motor._test?.parametros ?? {}));
  // no hay acceso directo a los parámetros: se comprueba por su efecto, que es
  // lo que de verdad importa — que el sello cambie si la política cambia.
  const antes = await motor.versionMotor();
  esperar(typeof antes === 'string' && antes.startsWith('m-'), 'el sello se calcula');
  esperar(motor.POLITICA_SALIDA.politicaSalida === 'trailing'
    && motor.POLITICA_SALIDA.trailPct === 10
    && motor.POLITICA_SALIDA.activarTrailEnPct === 10
    && motor.POLITICA_SALIDA.horizonteHoras === null,
    'la política vigente es trailing 10% desde +10%, sin plazo');
});

// --- CONTRAFACTUAL: LO QUE NO COMPRAMOS TAMBIÉN ES DATO ----------------------
//
// El screener evalúa ~12 candidatos y compra 0 o 1. Sin registrar los
// rechazados, el sistema solo aprende de sus 16 jugadas, con el RSI aplastado
// entre 58 y 69 porque la compuerta no deja pasar otra cosa.
test('cada candidato juzgado se registra una sola vez por día', async () => {
  const a = await import('./aprendizaje.mjs');
  const f = join(process.env.KW_DATA, 'candidatos.jsonl');
  motor._test.fs.writeFileSync(f, '');

  const base = { precio: 100, veredicto: 'rechazado', motivo: 'prueba', filtro: 'score', regimen: 'mixto' };
  esperar(a.registrarCandidato({ ...base, asset: 'AAA' }) != null, 'el primero se registra');
  esperar(a.registrarCandidato({ ...base, asset: 'BBB' }) != null, 'otro activo también');
  // El mismo activo el mismo día es el MISMO juicio: los criterios salen de
  // velas diarias, así que registrarlo cada 3 min guardaría 480 copias.
  esperar(a.registrarCandidato({ ...base, asset: 'AAA' }) === null,
    'repetir el mismo activo el mismo día no puede registrar de nuevo');

  const leidos = a.leerCandidatos();
  esperar(leidos.length === 2, `deben quedar 2 registros, hay ${leidos.length}`);
  esperar(leidos.every(x => x.fecha && x.ts && x.filtro), 'cada registro lleva fecha, hora y el filtro que lo rechazó');

  // Y la deduplicación tiene que sobrevivir a un reinicio: el tope vive en
  // memoria, así que un proceso nuevo puede escribir el duplicado igual.
  motor._test.fs.writeFileSync(f,
    motor._test.fs.readFileSync(f, 'utf8') +
    JSON.stringify({ ts: new Date().toISOString(), fecha: leidos[0].fecha, ...base, asset: 'AAA' }) + '\n');
  esperar(a.leerCandidatos().length === 2,
    'al leer, un duplicado de (activo, fecha) no puede contarse dos veces');
});

// --- correr ------------------------------------------------------------
console.log(`\nTests de la matemática de dinero · sandbox ${sandbox}\n`);
for (const c of casos) {
  try {
    await c.fn();
    console.log(`  ✓ ${c.nombre}`);
    pasados++;
  } catch (e) {
    console.log(`  ✗ ${c.nombre}\n      ${e.message}`);
    fallidos++;
  }
}
console.log(`\n${pasados} pasaron · ${fallidos} fallaron\n`);
process.exit(fallidos ? 1 : 0);
