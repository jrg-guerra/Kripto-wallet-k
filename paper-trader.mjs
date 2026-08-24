#!/usr/bin/env node
// CLI: corre un análisis y lo imprime. La lógica vive en engine.mjs.
// Para el dashboard usa: node server.mjs  →  http://localhost:8517
import { runAnalysis } from './src/engine.mjs';

const r = await runAnalysis();

console.log(`\n=== Paper Trader — ${r.fecha} ===`);
console.log('(simulación: este programa nunca envía órdenes reales)\n');
if (r.conectadoBinance) {
  console.log(r.realError ? `Wallet real: error — ${r.realError}` : `Wallet REAL vía API (solo lectura): ${r.real.total.toFixed(2)} USDT`);
} else if (r.real?.fuente === 'snapshot') {
  console.log(`Wallet REAL (snapshot del ${r.real.actualizado}): ${r.real.total.toFixed(2)} USDT`);
} else {
  console.log('Sin API key en .env — modo 100% simulado.');
}

console.log('\nTop momentum 7 días:');
for (const m of r.mercado.slice(0, 8)) {
  const flag = r.picks.includes(m.asset) ? ' <— pick' : '';
  console.log(`   ${m.asset.padEnd(8)} ${(m.momentum * 100).toFixed(2).padStart(8)}%${flag}`);
}

console.log(`\n${r.aplicado ? 'Operaciones simuladas aplicadas hoy:' : 'Sugerencia (hoy ya se rebalanceó, no aplicado):'}`);
if (!r.recomendaciones.length) console.log('   Sin cambios.');
for (const t of r.recomendaciones) {
  console.log(`   ${t.accion} ${t.asset}: ${t.usdt.toFixed(2)} USDT (${t.qty.toFixed(6)} ${t.asset})`);
}

console.log('\n--- Estado ---');
console.log(`Simulada: ${r.sim.valor.toFixed(2)} USDT (${r.sim.rendimientoPct >= 0 ? '+' : ''}${r.sim.rendimientoPct.toFixed(2)}% desde ${r.sim.desde})`);
console.log(`   Cash: ${r.sim.cash.toFixed(2)} USDT`);
for (const h of r.sim.holdings) {
  console.log(`   ${h.asset.padEnd(6)} ${h.qty.toFixed(6).padStart(16)}  ≈ ${h.usdt.toFixed(2)} USDT`);
}
if (r.real) console.log(`Real:     ${r.real.total.toFixed(2)} USDT`);
console.log();
