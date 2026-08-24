// Backtester propio sobre datos REALES de Binance.
//
// Por qué existe: el skill `backtesting-trading-strategies` usa yfinance /
// coingecko y no puede traer los pares USDT de Binance donde opera nuestra
// estrategia (ACE, GPS, EDEN…). Sin esto, la regla "backtest obligatorio antes
// de cambiar el modelo" (PLAN-DE-ACCION.md) sería inejecutable.
//
// Uso:
//   node src/backtest.mjs                          # modelo v1 vs alternativas
//   node src/backtest.mjs --dias 90 --picks 3 --ventana 7 --rebalance 1

const API = 'https://api.binance.com';
const STABLES = new Set(['USDT','USDC','FDUSD','TUSD','DAI','BUSD','USDP','USD1','XUSD','EUR','EURI','AEUR']);
const TOKENIZADOS = new Set(['SNXXB','SNDKB','SPCXB','MUB','KORUB']);
const FEE = 0.001;

async function pub(path, params = {}) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

// Universo: los N pares USDT con más volumen, sin stables ni tokenizados.
async function universo(n = 30) {
  const tickers = await pub('/api/v3/ticker/24hr');
  return tickers
    .filter(t => t.symbol.endsWith('USDT'))
    .filter(t => !STABLES.has(t.symbol.slice(0, -4)) && !TOKENIZADOS.has(t.symbol.slice(0, -4)))
    .filter(t => parseFloat(t.lastPrice) > 0)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, n)
    .map(t => t.symbol);
}

// Series de cierre diario alineadas por fecha.
async function seriesDiarias(simbolos, dias) {
  const series = {};
  for (const s of simbolos) {
    try {
      const kl = await pub('/api/v3/klines', { symbol: s, interval: '1d', limit: dias + 70 });
      if (kl.length < dias + 45) continue;
      series[s.slice(0, -4)] = kl.map(k => ({ t: k[0], close: parseFloat(k[4]) }));
    } catch { /* símbolo sin historia suficiente: fuera */ }
  }
  return series;
}

// Simula la estrategia: cada `rebalanceCada` días compra los `picks` activos
// con mayor retorno en la `ventana` previa, en pesos iguales, cobrando FEE.
function simular(series, { dias, ventana, picks, rebalanceCada, filtroRSI = null }) {
  const activos = Object.keys(series);
  const largo = Math.min(...activos.map(a => series[a].length));
  const inicio = largo - dias;
  if (inicio < ventana + 15) throw new Error('Historia insuficiente para esos parámetros');

  let capital = 100;                 // base 100 para comparar
  let cartera = {};                  // asset -> unidades
  const curva = [];
  let operaciones = 0, comisiones = 0;

  const rsi14 = (a, i) => {
    let g = 0, l = 0;
    for (let k = i - 14; k < i; k++) {
      const d = series[a][k + 1].close - series[a][k].close;
      if (d > 0) g += d; else l -= d;
    }
    return l === 0 ? 100 : 100 - 100 / (1 + (g / 14) / (l / 14));
  };

  for (let i = inicio; i < largo; i++) {
    const valor = Object.entries(cartera).reduce((a, [as, u]) => a + u * series[as][i].close, capital);

    if ((i - inicio) % rebalanceCada === 0) {
      const ranking = activos
        .map(a => ({ a, m: series[a][i].close / series[a][i - ventana].close - 1, rsi: rsi14(a, i) }))
        .filter(x => x.m > 0)
        .filter(x => filtroRSI == null || x.rsi <= filtroRSI)
        .sort((x, y) => y.m - x.m)
        .slice(0, picks)
        .map(x => x.a);

      // liquidar todo y recomprar los elegidos (pesos iguales)
      let efectivo = capital;
      for (const [as, u] of Object.entries(cartera)) {
        const bruto = u * series[as][i].close;
        efectivo += bruto * (1 - FEE);
        comisiones += bruto * FEE;
        operaciones++;
      }
      cartera = {};
      if (ranking.length) {
        const porPick = efectivo / ranking.length;
        for (const a of ranking) {
          cartera[a] = (porPick * (1 - FEE)) / series[a][i].close;
          comisiones += porPick * FEE;
          operaciones++;
        }
        capital = 0;
      } else {
        capital = efectivo;          // sin momentum positivo: refugio en USDT
      }
    }
    curva.push(Object.entries(cartera).reduce((a, [as, u]) => a + u * series[as][i].close, capital));
  }

  const final = curva[curva.length - 1];
  let pico = curva[0], drawdown = 0;
  for (const v of curva) { pico = Math.max(pico, v); drawdown = Math.min(drawdown, v / pico - 1); }
  const rets = curva.slice(1).map((v, k) => v / curva[k] - 1);
  const media = rets.reduce((a, b) => a + b, 0) / rets.length;
  const desv = Math.sqrt(rets.reduce((a, r) => a + (r - media) ** 2, 0) / rets.length);
  return {
    retornoPct: final - 100,
    drawdownPct: drawdown * 100,
    sharpe: desv > 0 ? (media / desv) * Math.sqrt(365) : 0,
    operaciones, comisionesPct: comisiones,
    curva,
  };
}

// Benchmark: comprar y mantener BTC en la misma ventana.
function holdBTC(series, dias) {
  const s = series.BTC;
  if (!s) return null;
  const largo = s.length, inicio = largo - dias;
  const curva = s.slice(inicio).map(x => (x.close / s[inicio].close) * 100);
  const final = curva[curva.length - 1];
  let pico = curva[0], dd = 0;
  for (const v of curva) { pico = Math.max(pico, v); dd = Math.min(dd, v / pico - 1); }
  return { retornoPct: final - 100, drawdownPct: dd * 100 };
}

// --- CLI ---
const arg = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};

const DIAS = arg('dias', 90);
console.log(`Backtest sobre datos reales de Binance · últimos ${DIAS} días\n`);
console.log('Descargando universo e historia…');
const simbolos = await universo(arg('universo', 30));
const series = await seriesDiarias(simbolos, DIAS);
console.log(`${Object.keys(series).length} activos con historia suficiente\n`);

const variantes = [
  { nombre: 'v1 actual (top3, 7d, diario)', ventana: 7, picks: 3, rebalanceCada: 1 },
  { nombre: 'v2a sin sobrecompra (RSI<75)', ventana: 7, picks: 3, rebalanceCada: 1, filtroRSI: 75 },
  { nombre: 'v2b ventana 30d',             ventana: 30, picks: 3, rebalanceCada: 1 },
  { nombre: 'v2c rebalanceo semanal',      ventana: 7, picks: 3, rebalanceCada: 7 },
  { nombre: 'v2d 30d + semanal',           ventana: 30, picks: 3, rebalanceCada: 7 },
  { nombre: 'v2e 2 picks',                 ventana: 7, picks: 2, rebalanceCada: 1 },
];

console.log('VARIANTE                        RETORNO   DRAWDOWN   SHARPE   OPS   COMISIONES');
for (const v of variantes) {
  try {
    const r = simular(series, { dias: DIAS, ...v });
    console.log(
      v.nombre.padEnd(32),
      `${r.retornoPct >= 0 ? '+' : ''}${r.retornoPct.toFixed(1)}%`.padStart(8),
      `${r.drawdownPct.toFixed(1)}%`.padStart(10),
      r.sharpe.toFixed(2).padStart(8),
      String(r.operaciones).padStart(5),
      `${r.comisionesPct.toFixed(1)}%`.padStart(12));
  } catch (e) {
    console.log(v.nombre.padEnd(32), ' error:', e.message);
  }
}

const bh = holdBTC(series, DIAS);
if (bh) {
  console.log('\nBENCHMARK');
  console.log('hold BTC'.padEnd(32), `${bh.retornoPct >= 0 ? '+' : ''}${bh.retornoPct.toFixed(1)}%`.padStart(8), `${bh.drawdownPct.toFixed(1)}%`.padStart(10));
}
console.log('\nNota: rendimiento pasado sobre el universo ACTUAL de mayor volumen.');
console.log('Tiene sesgo de supervivencia: los activos que hoy tienen volumen alto');
console.log('suelen ser los que ya subieron. Leer como comparación ENTRE variantes,');
console.log('no como rendimiento esperado.');
