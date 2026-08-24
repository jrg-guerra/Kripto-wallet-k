// VERIFICACIÓN CONTRA EL MERCADO REAL
//
//   node src/mercado.mjs
//
// No es la suite de tests. Los tests prueban LÓGICA: son deterministas, corren
// sin red en menos de un segundo y su respuesta es sí o no. Esto es otra cosa —
// mide el motor contra el mercado de verdad y reporta números para leer.
//
// Existe porque las dos tareas estaban mezcladas y ninguna quedaba bien: cuatro
// tests salían a Binance (y fallaban con la red caída, incluido el de la
// compuerta), mientras que las mediciones que de verdad importan se hacían a
// mano y se perdían.
//
// Y existe porque los mocks no alcanzan. Estas dos cosas solo aparecieron con
// datos reales, y ningún test sintético las habría visto:
//
//   · TUT clasificaba "pullback" con −80% desde su máximo — no era un retroceso,
//     era el derrumbe de un pump. Se arregló con techo al retroceso.
//   · La compuerta recibía un solo precio y valuaba la cartera en cero: veía
//     una caída del 81,9% y bloqueaba TODAS las ofertas automáticas.
//
// Solo LEE. No abre posiciones, no crea ofertas, no toca la billetera.

import { stopsSugeridos, compuertaRiesgo, marketSnapshotParaBot, montoPorRiesgo, versionMotor, clasificarTendencia } from './engine.mjs';
import { contextoEntrada, detectarSenales, scoreSetup, UMBRAL_SCORE, SENALES } from './aprendizaje.mjs';

const ACTIVOS = ['BTC', 'ETH', 'SOL', 'LINK', 'AVAX', 'DOT', 'NEAR', 'ADA', 'APT', 'FET', 'FIL', 'XRP'];

let alarmas = 0;
const alarma = txt => { alarmas++; console.log(`  ⚠ ${txt}`); };
const pct = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

console.log(`\nVerificación contra el mercado real · motor ${await versionMotor()}\n`);

// --- 1 · Señales: ¿clasifican algo absurdo? ----------------------------------
console.log('SEÑALES — el caso TUT: un derrumbe no puede ser "pullback"');
const contextos = [];
for (const a of ACTIVOS) {
  try {
    const ctx = await contextoEntrada(a);
    // La FASE no viene en contextoEntrada: la calcula momentumModelo a partir
    // de las mismas velas. Dos de los tres detectores la exigen, así que sin
    // ella el script reportaría "0 señales" siempre — una falsa alarma peor que
    // no medir nada. Se calcula acá igual que en el camino real.
    const velas = await fetch(`https://api.binance.com/api/v3/klines?symbol=${a}USDT&interval=1d&limit=31`).then(r => r.json());
    ctx.fase = clasificarTendencia(velas.map(v => parseFloat(v[4])))?.estado ?? null;
    const { principal } = detectarSenales(ctx);
    const { score } = scoreSetup(ctx);
    contextos.push({ a, ctx, principal, score });


    // La regla que TUT rompió: un "retroceso" a más de 30% del techo no es un
    // retroceso. Si el detector vuelve a dejarlo pasar, es una regresión.
    if (principal === 'pullback' && ctx.distanciaMax30dPct < -30) {
      alarma(`${a}: pullback a ${pct(ctx.distanciaMax30dPct)} del techo — eso es un derrumbe`);
    }
    // El veto de RSI>=80 vive en el screening, no en el detector: el detector
    // solo dice "hay patrón". Lo que sería regresión es que un sobrecomprado
    // llegue a ser OFERTABLE, o sea que además supere el umbral de score.
    if (principal && ctx.rsi14d >= 80 && score >= UMBRAL_SCORE) {
      alarma(`${a}: ofertable con RSI ${ctx.rsi14d} (score ${score}) — el techo de cordura no actuó`);
    }
  } catch (e) { console.log(`  ${a}: sin datos (${e.message})`); }
}
const conSenal = contextos.filter(c => c.principal);
console.log(`  ${conSenal.length}/${contextos.length} con señal · ${contextos.filter(c => c.score >= UMBRAL_SCORE).length} sobre el umbral ${UMBRAL_SCORE}`);
// Cero señales puede ser el mercado (nada entrable hoy) o los detectores
// demasiado estrictos. Sin ver la fase y el RSI no hay forma de distinguirlo,
// y "no hay ofertas" se leería como "el motor está roto".
const fases = {};
for (const c of contextos) fases[c.ctx.fase ?? '—'] = (fases[c.ctx.fase ?? '—'] ?? 0) + 1;
const rsis = contextos.map(c => c.ctx.rsi14d).filter(Number.isFinite);
console.log(`  fases: ${Object.entries(fases).map(([k, v]) => `${k} ${v}`).join(' · ')}`
  + (rsis.length ? ` · RSI ${Math.min(...rsis)}–${Math.max(...rsis)}` : ''));
for (const c of conSenal) {
  console.log(`    ${c.a.padEnd(5)} ${SENALES[c.principal].nombre.padEnd(9)} score ${String(c.score).padStart(3)} · RSI ${c.ctx.rsi14d} · techo ${pct(c.ctx.distanciaMax30dPct)}`);
}

// --- 2 · Planes: niveles y R:B sobre precios de hoy --------------------------
console.log('\nPLANES — stop, objetivo y R:B con la estructura real');
let pasanRB = 0, estructurales = 0;
for (const { a, ctx } of contextos) {
  try {
    const s = await stopsSugeridos(a, {
      distanciaTechoPct: ctx.distanciaMax30dPct, distanciaPisoPct: ctx.distanciaPisoPct,
    });
    if (s.riesgoBeneficio >= s.rbMinimo) pasanRB++;
    if (s.tipoStop === 'estructural') estructurales++;

    // Invariantes que ninguna combinación de mercado puede romper.
    if (s.limitePct > -4 || s.limitePct < -15) alarma(`${a}: stop ${s.limitePct}% fuera de [−15, −4]`);
    if (s.tipoStop === 'estructural' && s.limitePct < s.limiteVolatilidadPct) {
      alarma(`${a}: la estructura ENSANCHÓ el stop (${s.limiteVolatilidadPct}% → ${s.limitePct}%) — solo puede apretarlo`);
    }
    if (s.invalidacionPct != null && s.invalidacionPct >= 0) alarma(`${a}: invalidación ${s.invalidacionPct}% no es un nivel bajo la entrada`);

    console.log(`  ${a.padEnd(5)} stop ${String(s.limitePct).padStart(3)}% (${s.tipoStop.slice(0, 4)}) · obj +${String(s.objetivoPct).padStart(2)}% (${s.tipoObjetivo.slice(0, 4)}) · R:B ${String(s.riesgoBeneficio).padStart(4)}${s.riesgoBeneficio < s.rbMinimo ? '  ← bajo el mínimo' : ''}`);
  } catch (e) { console.log(`  ${a}: ${e.message}`); }
}
console.log(`  ${pasanRB}/${contextos.length} pasan el R:B mínimo · ${estructurales} con stop estructural`);
if (pasanRB === 0) alarma('NINGUNO pasa el R:B: revisar si es el mercado o el filtro (el bug de ADA fue así)');

// --- 3 · Compuerta con la cartera completa -----------------------------------
console.log('\nCOMPUERTA — con precios de toda la cartera, no de un símbolo');
const { prices } = await marketSnapshotParaBot();
const estado = compuertaRiesgo({}, prices);
const e = estado.estado;
console.log(`  cartera ${e.picoUSDT} pico · caída ${e.drawdownPct}% (límite ${e.drawdownLimitePct}%)`);
console.log(`  sleeve ${e.sleeveUSDT}/${e.sleevePresupuestoUSDT} · riesgo abierto ${e.riesgoAbiertoUSDT} (${e.riesgoAbiertoPct}% de ${e.riesgoAbiertoMaxPct}%) · reserva ${e.reservaUSDT}`);

// El bug de ADA: con precios parciales la cartera valía cero y la compuerta
// veía una caída del 81,9%. Si vuelve a pasar, se ve acá primero.
if (e.drawdownPct < -50) alarma(`caída del ${e.drawdownPct}% — sospechoso: ¿la cartera se está valuando completa?`);

const plan = montoPorRiesgo(-7);
const prueba = compuertaRiesgo({ montoUSDT: plan.montoUSDT, limitePct: -7, objetivoPct: 14 }, prices);
console.log(`  plan tipo (${plan.montoUSDT} USDT, stop −7%, R:B 2,0): ${prueba.pasa ? 'PASA' : 'BLOQUEA — ' + prueba.bloqueos.join(' · ')}`);
if (!prueba.pasa && !prueba.bloqueos.some(b => /sleeve|reserva|congelada/.test(b))) {
  alarma('un plan sano se bloquea por algo que no es falta de espacio ni de plata');
}

// --- resultado ---------------------------------------------------------------
console.log(`\n${alarmas ? `${alarmas} alarma(s) — revisar arriba` : 'sin alarmas'}\n`);
process.exit(alarmas ? 1 : 0);
