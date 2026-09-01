// REPLAY DE POLÍTICAS DE SALIDA sobre las posiciones REALES del proyecto.
//
// Por qué existe. El seguimiento post-cierre midió que salir temprano costó
// +3,48 USDT mientras el motor entero ganaba +3,32: la fuga más grande del
// sistema está en CUÁNDO SE SALE, no en qué se compra. Pero antes de cambiar
// una regla de salida hay que poder medir la alternativa, y `backtest.mjs` solo
// sabe simular SELECCIÓN (qué comprar sobre el universo), no salidas.
//
// Esto toma cada posición que existió de verdad —su entrada, su hora, su
// tamaño— y replaya sobre las velas posteriores qué habría hecho cada política.
//
// NO reimplementa las reglas: llama a `evaluarNiveles` del motor, que es la
// misma función que corre en producción. Un backtest con su propia copia de las
// reglas valida un sistema que no es el que opera — y esa duplicación es
// exactamente el error que este proyecto ya pagó caro.
//
// LO QUE ESTE REPLAY NO PUEDE DECIR:
//   · No sabe el orden dentro de una vela de 1 h. Convención conservadora: si
//     en la misma vela se tocan el stop y el objetivo, gana el stop.
//   · El pico del trailing se actualiza DESPUÉS de evaluar la salida, para no
//     regalarse un trailing que se armó con el máximo de la misma vela.
//   · n=16 posiciones. Es una comparación entre políticas sobre las mismas
//     trayectorias, no un rendimiento esperado.
//
// Uso:
//   node src/replay-salidas.mjs
//   node src/replay-salidas.mjs --horizonte 480   # horas de ventana máxima

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluarNiveles } from './engine.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.KW_DATA || join(DIR, '..', 'data');
const API = 'https://api.binance.com';
const FEE = 0.001;

const arg = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};

// Ventana máxima de replay. Una política que aguanta más que esto se reporta
// como "sin salir" y se valoriza al cierre del horizonte: inventarle una salida
// mejor sería regalarle rendimiento a la política más paciente.
const HORIZONTE_H = arg('horizonte', 720);   // 30 días

async function pub(path, params = {}) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

// --- POLÍTICAS ---------------------------------------------------------------
//
// Cada una devuelve una posición con los niveles cambiados. Todo lo demás
// (entrada, volatilidad, plazo) se conserva: se compara UNA variable a la vez.

// Cada política declara TODOS los campos que gobiernan la salida, sin heredar
// ninguno. Heredar era una trampa esperando: desde que la política vigente pasó
// a ser trailing, un `{...p, objetivoPct: 25}` habría arrastrado
// `politicaSalida: 'trailing'` y el objetivo de +25% no habría cortado nunca —
// la variante diría una cosa y mediría otra.
const salidaPorObjetivo = { politicaSalida: null, trailPct: null, activarTrailEnPct: null };
const salidaPorTrailing = pct => ({ politicaSalida: 'trailing', trailPct: pct, activarTrailEnPct: 10 });
const PLAZO_LEGADO_H = 24;

const POLITICAS = [
  {
    id: 'actual',
    nombre: 'Vigente (v4a)',
    // En el modo de posiciones reales significa "con las reglas que la posición
    // tenía grabadas"; en el histórico, la política que el motor aplica hoy,
    // porque las entradas se construyen con `POLITICA_SALIDA`.
    aplicar: p => ({ ...p }),
  },
  {
    id: 'objetivoPlazo',
    nombre: 'Objetivo fijo + plazo (pre-v4a)',
    // La política que se reemplazó. Se conserva como referencia: sin ella no se
    // podría comprobar más adelante si el cambio valió la pena.
    aplicar: p => ({ ...p, ...salidaPorObjetivo, horizonteHoras: PLAZO_LEGADO_H }),
  },
  {
    id: 'objetivo25',
    nombre: 'Objetivo +25% + plazo',
    aplicar: p => ({ ...p, ...salidaPorObjetivo, objetivoPct: 25, horizonteHoras: PLAZO_LEGADO_H }),
  },
  {
    id: 'trailing10',
    nombre: 'Trailing 10% + plazo',
    aplicar: p => ({ ...p, ...salidaPorTrailing(10), horizonteHoras: PLAZO_LEGADO_H }),
  },
  {
    id: 'trailing20',
    nombre: 'Trailing 20% sin plazo',
    aplicar: p => ({ ...p, ...salidaPorTrailing(20), horizonteHoras: null }),
  },
  {
    id: 'sinPlazo',
    nombre: 'Objetivo fijo sin plazo',
    aplicar: p => ({ ...p, ...salidaPorObjetivo, horizonteHoras: null }),
  },
];

// --- REPLAY ------------------------------------------------------------------

function replay(pos, velas, politica) {
  const p = politica.aplicar(pos);
  const t0 = Date.parse(pos.abierto);
  // El plazo corre desde donde corría de verdad (ver `plazoDesde` en el motor).
  const tPlazo = Date.parse(pos.plazoDesde ?? pos.abierto);
  let pico = 0;

  for (const v of velas) {
    const ts = Number(v[0]);
    const alto = parseFloat(v[2]), bajo = parseFloat(v[3]), cierre = parseFloat(v[4]);
    const horasDePlazo = (ts - tPlazo) / 3_600_000;
    // El pico entra con lo acumulado ANTES de esta vela: usar el máximo de la
    // vela en curso para armar el trailing y además cortar con su mínimo sería
    // asumir que el alto vino primero, que es justo lo que no se sabe.
    const estado = { ...p, picoDesdeApertura: pico > 0 ? pico : undefined };

    // 1) primero lo malo: stop, trailing y plazo se evalúan contra el MÍNIMO
    const abajo = evaluarNiveles(estado, bajo, horasDePlazo);
    if (abajo.senal === 'cruzo-limite' || abajo.senal === 'vencido-sin-renta') {
      return salida(pos, abajo.limiteEfectivo, ts, t0, abajo.senal);
    }
    // 2) después lo bueno: el objetivo se evalúa contra el MÁXIMO
    const arriba = evaluarNiveles(estado, alto, horasDePlazo);
    if (arriba.senal === 'cruzo-objetivo') {
      return salida(pos, arriba.objetivo, ts, t0, 'cruzo-objetivo');
    }

    // 3) recién ahora el pico incorpora esta vela, y solo si el trailing ya se
    //    activó (la política puede pedir que arranque a partir de cierta renta)
    if (p.trailPct != null) {
      const umbral = p.activarTrailEnPct != null
        ? pos.entrada * (1 + p.activarTrailEnPct / 100) : 0;
      if (alto >= umbral) pico = Math.max(pico, alto);
    }
    var ultimo = cierre;   // para valorizar el caso "sin salir"
  }
  return salida(pos, ultimo ?? pos.entrada, null, t0, 'sin-salir');
}

function salida(pos, precio, ts, t0, senal) {
  const bruto = pos.qty * precio;
  return {
    senal, precio,
    horas: ts ? (ts - t0) / 3_600_000 : null,
    pnlPct: (precio / pos.entrada - 1) * 100,
    // NETO DE COMISIÓN DE IDA Y VUELTA. El motor cobra FEE al comprar y al
    // vender, así que el retorno real es (salida/entrada) x (1-FEE)^2. Con la
    // media de la política actual pegada a cero, los 0,2% del ida y vuelta son
    // la diferencia entre "no gana nada" y "pierde plata": comparar en bruto
    // habría dado vuelta la conclusión.
    pnlPctNeto: ((precio / pos.entrada) * (1 - FEE) ** 2 - 1) * 100,
    pnlUSDT: bruto * (1 - FEE) - pos.qty * pos.entrada,
  };
}

// --- MODO HISTÓRICO ----------------------------------------------------------
//
// 16 posiciones alcanzan para saber que hay que cambiar la política, no para
// elegir cuál. Este modo genera ENTRADAS SINTÉTICAS sobre meses de historia,
// con los mismos criterios que aplica el screener en vivo —señal reconocible,
// score sobre el umbral, RSI bajo el techo de cordura, régimen no vetado, R:B
// mínimo— y replaya las mismas políticas sobre cada una.
//
// Importante: importa `detectarSenales`, `scoreSetup`, `CRITERIOS`,
// `planDeEntrada` y `volatilidadDiaria` de los módulos reales. Copiar esos
// criterios habría medido políticas de salida sobre las entradas de OTRO
// sistema, y la conclusión no transferiría al motor que opera.
//
// SESGOS QUE NO SE PUEDEN QUITAR, y hay que leer con ellos puestos:
//   · Supervivencia: el universo son los pares con más volumen HOY, que suelen
//     ser los que ya subieron. Sirve para comparar políticas ENTRE SÍ sobre las
//     mismas trayectorias, no para estimar rendimiento futuro.
//   · Las entradas se evalúan al cierre diario; el motor real mira cada 3 min.
//   · La salida se replaya sobre velas de 4 h: dentro de una vela no se sabe el
//     orden, y rige la misma convención conservadora (gana el stop).

async function enTandas(items, fn, limite = 5) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
  }));
  return out;
}

async function modoHistorico() {
  const { detectarSenales, scoreSetup, UMBRAL_SCORE, CRITERIOS } = await import('./aprendizaje.mjs');
  const { planDeEntrada, volatilidadDiaria, rsi, clasificarTendencia, POLITICA_SALIDA } = await import('./engine.mjs');

  const N_UNIVERSO = arg('universo', 40);
  const STABLES = new Set(['USDT','USDC','FDUSD','TUSD','DAI','BUSD','USDP','USD1','XUSD','EUR','EURI','AEUR']);

  console.log(`Replay histórico · universo ${N_UNIVERSO} · horizonte ${HORIZONTE_H} h\n`);
  const tickers = await pub('/api/v3/ticker/24hr');
  const simbolos = tickers
    .filter(t => t.symbol.endsWith('USDT'))
    .filter(t => !STABLES.has(t.symbol.slice(0, -4)))
    .filter(t => !/(UP|DOWN|BULL|BEAR)$/.test(t.symbol.slice(0, -4)))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, N_UNIVERSO)
    .map(t => t.symbol);

  console.log('Descargando historia…');
  // Régimen histórico: se reconstruye de los mismos 5 de referencia que usa
  // `regimenMercado`, contando cuántos subieron ese día.
  const REFS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
  const refSeries = {};
  for (const s of REFS) {
    const k = await pub('/api/v3/klines', { symbol: s, interval: '1d', limit: 300 }).catch(() => null);
    if (k) refSeries[s] = new Map(k.map(x => [Math.floor(x[0] / 86_400_000), parseFloat(x[4])]));
  }
  const regimenDe = dia => {
    let suben = 0, total = 0;
    for (const s of REFS) {
      const m = refSeries[s]; if (!m) continue;
      const hoy = m.get(dia), ayer = m.get(dia - 1);
      if (hoy == null || ayer == null) continue;
      total++; if (hoy > ayer) suben++;
    }
    if (!total) return null;
    const a = suben / total;
    return a >= 0.8 ? 'rally amplio' : a >= 0.5 ? 'mixto' : a >= 0.2 ? 'débil' : 'caída amplia';
  };

  const datos = await enTandas(simbolos, async s => ({
    símbolo: s,
    diarias: await pub('/api/v3/klines', { symbol: s, interval: '1d', limit: 300 }),
    cuatroH: await pub('/api/v3/klines', { symbol: s, interval: '4h', limit: 1000 }),
  }));
  const utiles = datos.filter(d => d && d.diarias?.length > 60 && d.cuatroH?.length > 100);
  console.log(`${utiles.length} activos con historia suficiente\n`);

  // --- generar entradas con los criterios reales ---
  const entradas = [];
  const rechazos = new Map();
  const rechazo = m => rechazos.set(m, (rechazos.get(m) ?? 0) + 1);

  for (const d of utiles) {
    const asset = d.símbolo.slice(0, -4);
    const cierres = d.diarias.map(x => parseFloat(x[4]));
    const altos = d.diarias.map(x => parseFloat(x[2]));
    const bajos = d.diarias.map(x => parseFloat(x[3]));
    const vols = d.diarias.map(x => parseFloat(x[7]));
    // solo se puede entrar donde haya velas de 4 h por delante para replayar
    const inicio4h = Number(d.cuatroH[0][0]);
    const fin4h = Number(d.cuatroH.at(-1)[0]);

    for (let i = 31; i < d.diarias.length - 1; i++) {
      const ts = Number(d.diarias[i][6]);        // cierre de esa vela diaria
      if (ts < inicio4h) continue;
      // dejar horizonte por delante: si no, se premia a la política que corta antes
      if (ts > fin4h - HORIZONTE_H * 3_600_000) continue;

      const ventana = cierres.slice(i - 30, i + 1);          // 31 cierres
      const rsi14d = rsi(ventana);
      if (rsi14d == null || rsi14d >= 80) { rechazo('RSI ≥ 80 (sobrecompra extrema)'); continue; }

      const regimen = regimenDe(Math.floor(ts / 86_400_000));
      if (!regimen) { rechazo('sin régimen'); continue; }
      if (CRITERIOS.regimenesVetados.includes(regimen)) { rechazo(`régimen ${regimen} vetado`); continue; }

      const fase = clasificarTendencia(ventana)?.estado ?? null;
      const precio = cierres[i];
      const max30 = Math.max(...altos.slice(i - 30, i + 1));
      const distanciaMax30dPct = (precio / max30 - 1) * 100;
      const momentum30dPct = (precio / cierres[i - 30] - 1) * 100;

      // salto de volumen: misma aritmética que `saltoVolumenDe`
      const v8 = vols.slice(i - 8, i).filter(v => v > 0);
      let salto = null;
      if (v8.length >= 4) {
        const prev = v8.slice(0, -1);
        const media = prev.reduce((a, b) => a + b, 0) / prev.length;
        salto = media ? Number((v8.at(-1) / media).toFixed(1)) : null;
      }
      if (salto != null && salto > CRITERIOS.saltoVolumenMax) { rechazo('salto de volumen: pump propio'); continue; }

      const { principal } = detectarSenales({ momentum30dPct, distanciaMax30dPct, rsi14d, fase, saltoVolumen: salto });
      if (!principal) { rechazo('ningún patrón reconocible'); continue; }

      const { score } = scoreSetup({ rsi14d, rsi14h: null, fase, regimen, saltoVolumen: salto });
      if (score < UMBRAL_SCORE) { rechazo(`score bajo ${UMBRAL_SCORE}`); continue; }

      // piso del retroceso en curso, igual que en `stopsSugeridos`
      const iTecho = altos.slice(i - 30, i + 1).indexOf(max30) + (i - 30);
      const pisoRetroceso = Math.min(...bajos.slice(iTecho, i + 1));
      const distanciaPisoPct = pisoRetroceso > 0 && precio > pisoRetroceso
        ? (precio / pisoRetroceso - 1) * 100 : null;

      const volPct = volatilidadDiaria(cierres.slice(i - 14, i + 1));
      if (!(volPct > 0)) { rechazo('sin volatilidad medible'); continue; }
      const plan = planDeEntrada({ volPct, distanciaTechoPct: distanciaMax30dPct, distanciaPisoPct, senal: principal });
      if (plan.riesgoBeneficio < plan.rbMinimo) { rechazo(`R:B bajo ${plan.rbMinimo}`); continue; }

      entradas.push({
        pos: {
          asset, entrada: precio, qty: 5 / precio,       // 5 USDT nocional, para comparar
          abierto: new Date(ts).toISOString(),
          objetivoPct: plan.objetivoPct, limitePct: plan.limitePct,
          volatilidadDiariaPct: plan.volatilidadDiariaPct,
          // La entrada nace con la política VIGENTE del motor, leída de su
          // constante. Fijarla acá a mano dejaría el backtest comparando
          // contra un "actual" que dejó de existir en cuanto la política
          // cambiara — el instrumento de medición desincronizado del sistema.
          ...POLITICA_SALIDA,
        },
        senal: principal, score, regimen,
        velas: d.cuatroH.filter(v => Number(v[0]) >= ts).slice(0, Math.ceil(HORIZONTE_H / 4)),
      });
    }
  }

  console.log(`=== ENTRADAS GENERADAS: ${entradas.length} ===\n`);
  console.log('Por qué se descartó el resto (los criterios del screener, aplicados a cada día):');
  for (const [m, n] of [...rechazos].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${String(n).padStart(6)}  ${m}`);
  }
  const porSenal = new Map();
  for (const e of entradas) porSenal.set(e.senal, (porSenal.get(e.senal) ?? 0) + 1);
  console.log('\nEntradas por patrón:', [...porSenal].map(([k, v]) => `${k} ${v}`).join(' · '));

  if (entradas.length < 30) {
    console.log('\nMuy pocas entradas para comparar. Prueba --universo 80.');
    return;
  }

  // --- replayar cada política ---
  console.log('\n=== POLÍTICAS SOBRE LAS ENTRADAS HISTÓRICAS ===\n');
  console.log('Rendimiento MEDIO por operación, NETO de comisiones (ida y vuelta).');
  console.log('Excluye las que no salieron dentro del horizonte; ABIERTAS dice cuántas.\n');
  console.log('POLÍTICA                          MEDIO   MEDIANA   ACIERTO   HORAS   %/100h   ABIERTAS');

  const tabla = [];
  for (const pol of POLITICAS) {
    const filas = entradas.map(e => replay(e.pos, e.velas, pol));
    const cerradas = filas.filter(f => f.senal !== 'sin-salir');
    const base = cerradas.length ? cerradas : filas;
    // NETO de comisiones: ver la nota en `salida()`
    const rets = base.map(f => f.pnlPctNeto).sort((a, b) => a - b);
    const medio = rets.reduce((a, b) => a + b, 0) / rets.length;
    const mediana = rets[Math.floor(rets.length / 2)];
    const acierto = (base.filter(f => f.pnlPctNeto > 0).length / base.length) * 100;
    const horas = base.filter(f => f.horas != null);
    const horasMedia = horas.length ? horas.reduce((a, f) => a + f.horas, 0) / horas.length : null;
    tabla.push({ pol, medio, mediana, acierto, horasMedia, rets, abiertas: filas.length - cerradas.length, n: base.length });
    console.log(
      pol.nombre.padEnd(32),
      `${medio >= 0 ? '+' : ''}${medio.toFixed(3)}%`.padStart(8),
      `${mediana >= 0 ? '+' : ''}${mediana.toFixed(2)}%`.padStart(9),
      `${acierto.toFixed(0)}%`.padStart(9),
      (horasMedia != null ? horasMedia.toFixed(0) : '—').padStart(7),
      // Rendimiento por hora de capital comprometido. Con un sleeve acotado,
      // una política que rinde el doble pero ocupa el triple de tiempo NO es
      // el doble de buena: la plata inmovilizada no puede tomar otra entrada.
      // Solo manda cuando hay más oportunidades que capital; hoy el sleeve va
      // al 21% de su presupuesto, así que hoy NO es el criterio que decide.
      (horasMedia ? `${(medio / horasMedia * 100 >= 0 ? '+' : '')}${(medio / horasMedia * 100).toFixed(3)}` : '—').padStart(8),
      String(filas.length - cerradas.length).padStart(10));
  }

  const actual = tabla.find(t => t.pol.id === 'actual');
  console.log('\n=== DIFERENCIA CONTRA LA POLÍTICA ACTUAL ===\n');
  // Solo en puntos porcentuales. El cociente contra la actual no se muestra a
  // propósito: su media es prácticamente cero, y dividir por cero da múltiplos
  // enormes que parecen un hallazgo y son una división mal planteada.
  for (const t of tabla.filter(x => x.pol.id !== 'actual').sort((a, b) => b.medio - a.medio)) {
    const d = t.medio - actual.medio;
    console.log(`  ${t.pol.nombre.padEnd(30)} ${d >= 0 ? '+' : ''}${d.toFixed(3)} pp por operación`);
  }

  // --- ¿SOBREVIVE SIN SUS MEJORES ACIERTOS? ---
  //
  // Una media positiva sostenida por tres operaciones no es una política, es
  // suerte con formato de tabla. Se recalcula quitando el 5% superior: si la
  // ventaja desaparece, la política depende de outliers y no se puede adoptar
  // con la confianza que sugiere el promedio.
  console.log('\n=== ROBUSTEZ: MEDIA SIN EL 5% MEJOR ===\n');
  console.log('POLÍTICA                          COMPLETA   SIN TOP 5%   PEOR OP   MEJOR OP');
  for (const t of tabla) {
    const rets = [...t.rets];
    const corte = Math.max(1, Math.floor(rets.length * 0.05));
    const podado = rets.slice(0, rets.length - corte);
    const mediaPodada = podado.reduce((a, b) => a + b, 0) / podado.length;
    console.log(
      t.pol.nombre.padEnd(32),
      `${t.medio >= 0 ? '+' : ''}${t.medio.toFixed(3)}%`.padStart(9),
      `${mediaPodada >= 0 ? '+' : ''}${mediaPodada.toFixed(3)}%`.padStart(12),
      `${rets[0].toFixed(1)}%`.padStart(9),
      `+${rets.at(-1).toFixed(1)}%`.padStart(10));
  }

  console.log(`\nn = ${actual.n} operaciones cerradas sobre ${utiles.length} activos.`);
  console.log('Sesgo de supervivencia: el universo son los pares de mayor volumen HOY.');
  console.log('Leer como comparación ENTRE políticas, no como rendimiento esperado.');
}

if (process.argv.includes('--historico')) {
  await modoHistorico();
  process.exit(0);
}

// --- DATOS (modo posiciones reales) ------------------------------------------

const posiciones = JSON.parse(readFileSync(join(DATA, 'posiciones.json'), 'utf8')).posiciones
  .filter(p => p.estado === 'cerrada' && p.entrada > 0 && p.qty > 0 && p.abierto);

if (!posiciones.length) {
  console.log('No hay posiciones cerradas para replayar.');
  process.exit(0);
}

console.log(`Replay de políticas de salida · ${posiciones.length} posiciones reales`);
console.log(`Horizonte máximo: ${HORIZONTE_H} h (${(HORIZONTE_H / 24).toFixed(0)} días)\n`);
console.log('Descargando velas horarias…');

const trayectorias = [];
for (const p of posiciones) {
  try {
    const velas = await pub('/api/v3/klines', {
      symbol: `${p.asset}USDT`, interval: '1h',
      startTime: Date.parse(p.abierto), limit: Math.min(1000, HORIZONTE_H),
    });
    if (velas.length < 2) { console.log(`  ${p.asset}: sin velas suficientes, fuera`); continue; }
    trayectorias.push({ pos: p, velas });
  } catch (e) {
    console.log(`  ${p.asset}: ${e.message} — fuera`);
  }
}
console.log(`${trayectorias.length} trayectorias listas\n`);

// --- 1 · ¿EL REPLAY REPRODUCE LA REALIDAD? -----------------------------------
//
// La comprobación que hace honesto a todo lo demás. Si replayar la política
// ACTUAL no se parece a lo que de verdad pasó, el replay miente y ninguna
// comparación posterior vale. La diferencia esperada tiene nombre: el motor
// estuvo ciego el 79% del tiempo en los primeros días, así que sus salidas
// reales llegaron tarde. El replay ejecuta EN el nivel, como una OCO.

const realUSDT = trayectorias.reduce((a, t) =>
  a + t.pos.qty * ((t.pos.precioSalida ?? t.pos.entrada) - t.pos.entrada), 0);

const resultados = new Map();
for (const pol of POLITICAS) {
  const filas = trayectorias.map(t => ({ ...replay(t.pos, t.velas, pol), asset: t.pos.asset, pos: t.pos }));
  resultados.set(pol.id, filas);
}

const idealActual = resultados.get('actual').reduce((a, f) => a + f.pnlUSDT, 0);
console.log('=== 1 · VALIDACIÓN DEL REPLAY ===\n');
console.log(`  resultado REAL de esas posiciones      ${realUSDT >= 0 ? '+' : ''}${realUSDT.toFixed(2)} USDT`);
console.log(`  replay de la política ACTUAL (ideal)   ${idealActual >= 0 ? '+' : ''}${idealActual.toFixed(2)} USDT`);
console.log(`  diferencia                             ${(idealActual - realUSDT) >= 0 ? '+' : ''}${(idealActual - realUSDT).toFixed(2)} USDT`);
const manuales = trayectorias.filter(t => /manual/i.test(t.pos.motivoCierre ?? '')).map(t => t.pos.asset);
console.log('\n  La diferencia es el efecto NETO de haber ejecutado tarde. El replay');
console.log('  corta en el nivel exacto, como una OCO; el motor real cortó cuando');
console.log('  despertó. Llegar tarde perjudicó los stops (ACE salió a -16% con el');
console.log('  stop en -12%) pero BENEFICIÓ a los ganadores, que se pasaron de largo');
console.log('  su objetivo — HEMI cerró en +46% con objetivo en +30%. El saldo dice');
console.log('  cuál de los dos efectos pesó más, y es el mismo hallazgo del');
console.log('  seguimiento post-cierre: el techo del objetivo cuesta más que el');
console.log('  deslizamiento de los stops.');
if (manuales.length) {
  console.log(`\n  Ojo: ${manuales.join(', ')} cerraron por decisión tuya, no por una regla.`);
  console.log('  Su columna "real" no es el resultado de ninguna política.\n');
} else { console.log(''); }

// --- 2 · COMPARACIÓN ENTRE POLÍTICAS -----------------------------------------
//
// Acá sí es manzanas con manzanas: todas las políticas se replayan con la misma
// ejecución idealizada sobre las mismas trayectorias. La ceguera del monitor
// afecta a todas por igual y deja de ser un factor.

console.log('=== 2 · POLÍTICAS, SOBRE LAS MISMAS TRAYECTORIAS ===\n');
console.log('La columna CERRADO es la única comparable de verdad: son salidas que');
console.log('la regla disparó. ABIERTO son posiciones que al final del horizonte');
console.log('seguían vivas, valorizadas a ese precio — ganancia en el papel, y a');
console.log('una fecha arbitraria. Una política que aguanta más siempre se ve');
console.log('mejor ahí, y además ocupa el capital más tiempo, que el replay no cobra.\n');
console.log('POLÍTICA                          TOTAL    CERRADO   ABIERTO   obj  stop plazo abiertas');
for (const pol of POLITICAS) {
  const filas = resultados.get(pol.id);
  const tot = filas.reduce((a, f) => a + f.pnlUSDT, 0);
  const cerrado = filas.filter(f => f.senal !== 'sin-salir').reduce((a, f) => a + f.pnlUSDT, 0);
  const abierto = tot - cerrado;
  const cuenta = s => filas.filter(f => f.senal === s).length;
  const signo = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  console.log(
    pol.nombre.padEnd(32),
    signo(tot).padStart(7),
    signo(cerrado).padStart(10),
    signo(abierto).padStart(10),
    String(cuenta('cruzo-objetivo')).padStart(4),
    String(cuenta('cruzo-limite')).padStart(5),
    String(cuenta('vencido-sin-renta')).padStart(5),
    String(cuenta('sin-salir')).padStart(8));
}

// --- 3 · DETALLE POR POSICIÓN ------------------------------------------------

console.log('\n=== 3 · DETALLE: ACTUAL vs LA MEJOR ALTERNATIVA ===\n');
// Se elige por CERRADO, no por total. Ordenar por total premiaría a la política
// que dejó más posiciones abiertas al cierre del horizonte — plusvalía en el
// papel a una fecha arbitraria. Es el mismo número que engañaría al leer la
// tabla de arriba de corrido.
const mejor = POLITICAS
  .map(p => ({
    p,
    tot: resultados.get(p.id).filter(f => f.senal !== 'sin-salir').reduce((a, f) => a + f.pnlUSDT, 0),
  }))
  .filter(x => x.p.id !== 'actual')
  .sort((a, b) => b.tot - a.tot)[0];

console.log(`Alternativa con mejor resultado: ${mejor.p.nombre}\n`);
console.log('activo'.padEnd(8) + 'real'.padStart(9) + 'actual'.padStart(10) + 'alterna'.padStart(10) + 'delta'.padStart(9) + '  salida alterna');
const act = resultados.get('actual'), alt = resultados.get(mejor.p.id);
for (let i = 0; i < act.length; i++) {
  const real = act[i].pos.qty * ((act[i].pos.precioSalida ?? act[i].pos.entrada) - act[i].pos.entrada);
  console.log(
    act[i].asset.padEnd(8),
    `${real >= 0 ? '+' : ''}${real.toFixed(2)}`.padStart(9),
    `${act[i].pnlUSDT >= 0 ? '+' : ''}${act[i].pnlUSDT.toFixed(2)}`.padStart(10),
    `${alt[i].pnlUSDT >= 0 ? '+' : ''}${alt[i].pnlUSDT.toFixed(2)}`.padStart(10),
    `${(alt[i].pnlUSDT - act[i].pnlUSDT) >= 0 ? '+' : ''}${(alt[i].pnlUSDT - act[i].pnlUSDT).toFixed(2)}`.padStart(9),
    ` ${alt[i].senal}${alt[i].horas != null ? ` a las ${alt[i].horas.toFixed(0)} h` : ''}`);
}

console.log(`\nn = ${trayectorias.length} posiciones. Bajo el umbral de significancia (20):`);
console.log('es una comparación entre políticas sobre las MISMAS trayectorias, no');
console.log('un rendimiento esperado. Un solo activo puede mover el total entero.');
