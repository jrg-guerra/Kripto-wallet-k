/* AFX Wallet — dashboard */
const $ = id => document.getElementById(id);
const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = n => (n >= 0 ? '+' : '') + fmt(n) + '%';
const precio = p => fmt(p, p < 1 ? 6 : 2);

const SERIES = [
  { key: 'sim', nombre: 'Billetera ficticia (estrategia)', color: '#F59E0B' },
  { key: 'real', nombre: 'Billetera real (hold)', color: '#A78BFA' },
  { key: 'btc', nombre: 'BTC', color: '#2DD4BF' },
];

// Lista de activos: N filas visibles y el resto con scroll contenido — el
// espectro completo de la billetera, sin ocultar polvo. En escritorio la lista
// además se estira para que ambas billeteras terminen a la misma altura.
const FILAS_VISIBLES = 7;

function assetList(detalle, total, filasVisibles = FILAS_VISIBLES) {
  if (!detalle.length) return '';
  const filas = assetRows(detalle, total);
  if (detalle.length <= filasVisibles) return `<div class="assets">${filas}</div>`;
  return `<div class="assets con-scroll" style="--filas:${filasVisibles}" tabindex="0" role="region" aria-label="Listado de activos, desplazable">${filas}</div>
    <div class="assets-pie" data-total="${detalle.length}"></div>`;
}

// Recalcula los pies cuando el layout cambia de tamaño. Se usa ResizeObserver
// en vez de requestAnimationFrame porque rAF NO se ejecuta en pestañas ocultas
// (y el pie quedaba vacío hasta volver a enfocar la ventana).
let _obsListas = null;
function observarListas() {
  _obsListas ??= new ResizeObserver(() => ajustarPiesDeLista());
  _obsListas.disconnect();
  for (const l of document.querySelectorAll('.assets.con-scroll')) _obsListas.observe(l);
  ajustarPiesDeLista();
}

// El pie se escribe DESPUÉS del layout: si la card se estiró y entran todas,
// no tiene sentido decir "N más al desplazar".
function ajustarPiesDeLista() {
  for (const pie of document.querySelectorAll('.assets-pie')) {
    const lista = pie.previousElementSibling;
    const total = Number(pie.dataset.total ?? 0);
    if (!lista) continue;
    const filas = [...lista.children];
    const caja = lista.getBoundingClientRect();
    const dentro = filas.filter(f => {
      const r = f.getBoundingClientRect();
      return r.top >= caja.top - 2 && r.bottom <= caja.bottom + 2;
    }).length;
    const ocultos = Math.max(0, total - dentro);
    pie.textContent = ocultos
      ? `${total} activos · ${ocultos} más al desplazar`
      : `${total} activos · todos visibles`;
    lista.classList.toggle('sin-scroll', ocultos === 0);
  }
}

// Flecha de tendencia 24h. UNA sola copia, dos usos:
//   · billeteras → con el número al lado, que es el único lugar donde se ve
//   · radar      → solo el glifo, porque la columna "24 H" ya trae el
//                  porcentaje y repetirlo dos veces en la misma fila es ruido
// Su valor ahí no es el dato (ya está en la columna) sino poder barrer la tabla
// de un vistazo: el radar viene ordenado por momentum de 30 días, así que la
// dirección de HOY es un eje distinto del orden.
function flechaTendencia(pct, { motivo = null, conNumero = true } = {}) {
  if (!Number.isFinite(pct)) return '';
  const sube = pct >= 0;
  const info = motivo ? ` data-info="${motivo.replace(/"/g, '&quot;')}"` : '';
  const numero = conNumero ? `<i>${Math.abs(pct).toFixed(1)}%</i>` : '';
  return `<span class="trend ${sube ? 'up' : 'down'}"${info}`
    + ` aria-label="${sube ? 'en alza' : 'en baja'}: ${pct.toFixed(2)}% en 24 horas">`
    + `${sube ? '▲' : '▼'}${numero}</span>`;
}

function assetRows(detalle, total, colorClassCtx) {
  const cambios = window.__r?.cambios24h ?? {};
  return detalle.map(d => {
    const share = total > 0 ? (d.usdt / total) * 100 : 0;
    // precio unitario del día (Binance, al último refresco)
    const unit = d.asset === 'USDT' ? 1 : (d.qty > 0 ? d.usdt / d.qty : null);
    const unitTxt = unit == null ? '' : ` · @ ${precio(unit)}`;
    // tendencia 24h: flecha sutil + tooltip informativo (dato, no asesoría)
    const c = d.asset === 'USDT' ? null : cambios[d.asset];
    const flecha = c ? flechaTendencia(c.pct, { motivo: c.motivo }) : '';
    return `<div class="asset-row">
      <span class="asset-badge" aria-hidden="true">${d.asset.slice(0, 4)}</span>
      <div class="info">
        <div class="name">${d.asset}${flecha}${d.bolsillo ? `<span class="chip ${d.bolsillo}">${d.bolsillo}</span>` : ''}</div>
        <div class="qty">${fmt(d.qty, 6)}${unitTxt}</div>
        <div class="share-track"><div class="share-fill" style="width:${share.toFixed(1)}%"></div></div>
      </div>
      <div class="val"><b>${fmt(d.usdt)} USDT</b><span>${share.toFixed(1)}% del total</span></div>
    </div>`;
  }).join('');
}

// SALA DE CONTROL: cuatro cifras que responden, antes de leer nada más,
// "¿cómo voy?" y "¿debo actuar?".
const ICO = {
  marcador: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 14 4-4 4 3 6-6"/>',
  alfa: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  vigilancia: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
  hoy: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  riesgo: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
};
const svgIco = k => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;

// El tile abierto persiste entre refrescos: si el usuario dejó "Vigilancia"
// desplegada, un refresco de precios no debe cerrársela en la cara.
let ctAbierto = null;

const chevron = '<svg class="ct-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

// Un tile es un botón: mismo aspecto de antes + affordance de despliegue.
const tile = (id, clase, cuerpo) => `<button type="button" class="ct ${clase}" data-ct="${id}"
  aria-expanded="${ctAbierto === id}" aria-controls="ctDetalle">${cuerpo}${chevron}</button>`;

function renderSalaControl(r) {
  const cont = $('salaControl');
  if (!cont || !r?.sim) return;
  const signo = v => (v >= 0 ? '+' : '') + fmt(v);

  // 1 · marcador: la ficticia contra el hold, que es la pregunta del proyecto
  const dif = r.real ? r.sim.valor - r.real.total : null;
  const marcador = tile('marcador', dif == null ? '' : dif >= 0 ? 'ok' : '', `
    <div class="ct-nom">${svgIco('marcador')} Marcador</div>
    <div class="ct-val ${dif == null ? '' : dif >= 0 ? 'up' : 'down'}">${dif == null ? '—' : signo(dif) + ' USDT'}</div>
    <div class="ct-sub">ficticia ${fmt(r.sim.valor)} vs hold ${r.real ? fmt(r.real.total) : '—'}</div>`);

  // 2 · alfa: lo que aporta el modelo, limpio de mercado
  const s = r.sleeveRendimiento;
  const alfa = tile('alfa', 'acento', `
    <div class="ct-nom">${svgIco('alfa')} Alfa del modelo</div>
    <div class="ct-val ${!s ? '' : s.alfaUSDT >= 0 ? 'up' : 'down'}">${s ? signo(s.alfaUSDT) + ' USDT' : '—'}</div>
    <div class="ct-sub">${s ? `${signo(s.alfaPct)} pp vs BTC · ${s.jugadas} jugada(s)` : 'sin jugadas aún'}</div>`);

  // 3 · vigilancia: ¿hay algo cruzando su nivel ahora mismo?
  const pos = r.posiciones ?? [];
  const cruces = pos.filter(p => p.senal === 'cruzo-limite' || p.senal === 'cruzo-objetivo' || p.senal === 'vencido-sin-renta');
  const cerca = pos.filter(p => p.senal === 'cerca-limite' || p.senal === 'cerca-objetivo');
  const vig = tile('vigilancia', cruces.length ? 'alerta' : pos.length ? 'ok' : '', `
    <div class="ct-nom">${svgIco('vigilancia')} Vigilancia</div>
    <div class="ct-val">${pos.length}<span style="font-size:15px;font-weight:500;color:var(--muted)"> abierta(s)</span></div>
    <div class="ct-sub">${cruces.length ? `⚠ ${cruces.map(p => p.asset).join(', ')} cruzó su nivel`
      : cerca.length ? `${cerca.map(p => p.asset).join(', ')} cerca de un nivel`
      : pos.length ? 'todas en rango' : 'sin posiciones con salida'}</div>`);

  // 4 · riesgo abierto: cuánto se pierde si todos los stops pegan a la vez.
  // Es el número que define si queda espacio para abrir otra posición.
  const g = r.riesgo;
  const riesgoAlto = g && g.pct != null && g.pct > 3;
  const riesgo = tile('riesgo', !g?.posiciones ? '' : riesgoAlto ? 'alerta' : 'ok', `
    <div class="ct-nom">${svgIco('riesgo')} Riesgo abierto</div>
    <div class="ct-val ${riesgoAlto ? 'down' : ''}">${g ? '−' + fmt(g.usdt) + ' USDT' : '—'}</div>
    <div class="ct-sub">${g ? (g.pct != null ? `${fmt(g.pct)}% del capital · ${g.posiciones} posición(es)` : `${g.posiciones} posición(es)`) : 'sin posiciones'}</div>`);

  // 5 · qué toca hoy: el estado accionable del día
  const hoy = diaLocal(Date.now());
  let titulo, detalle, clase = '';
  if (r.fecha !== hoy) { titulo = 'Ejecuta el análisis'; detalle = `el último es del ${r.fecha}`; clase = 'acento'; }
  else if (!r.aplicado && r.recomendaciones?.length) { titulo = 'Propuesta pendiente'; detalle = `${r.recomendaciones.length} operaciones esperan tu aprobación`; clase = 'acento'; }
  else if (r.aplicado) { titulo = 'Plan aplicado'; detalle = 'el día está al día'; clase = 'ok'; }
  else { titulo = 'Sin movimientos'; detalle = 'el portafolio está alineado'; clase = 'ok'; }
  const accion = tile('hoy', clase, `
    <div class="ct-nom">${svgIco('hoy')} Hoy</div>
    <div class="ct-val" style="font-size:20px">${titulo}</div>
    <div class="ct-sub">${detalle}</div>`);

  cont.innerHTML = marcador + alfa + vig + riesgo + accion +
    `<div class="ct-detalle" id="ctDetalle" role="region" hidden></div>`;

  cont.querySelectorAll('[data-ct]').forEach(b =>
    b.addEventListener('click', () => toggleDetalle(b.dataset.ct, r)));
  if (ctAbierto) pintarDetalle(ctAbierto, r, false);
}

function toggleDetalle(id, r) {
  const abrir = ctAbierto !== id;
  ctAbierto = abrir ? id : null;
  document.querySelectorAll('[data-ct]').forEach(b =>
    b.setAttribute('aria-expanded', String(b.dataset.ct === ctAbierto)));
  if (abrir) pintarDetalle(id, r, true);
  else cerrarDetalle();
}

function cerrarDetalle() {
  const d = $('ctDetalle');
  if (!d) return;
  d.hidden = true;
  d.classList.remove('abierto');
}

function pintarDetalle(id, r, animar) {
  const d = $('ctDetalle');
  if (!d) return;
  d.innerHTML = DETALLES[id]?.(r) ?? '';
  d.setAttribute('aria-label', `Detalle de ${id}`);
  // El panel escala desde el tile que lo abrió: se pasa el centro horizontal
  // del tile como origen. Sin esto parecería salir del medio de la fila.
  const tile = document.querySelector(`[data-ct="${id}"]`);
  if (tile) {
    const t = tile.getBoundingClientRect(), p = d.parentElement.getBoundingClientRect();
    d.style.setProperty('--origen-x', `${((t.left + t.width / 2 - p.left) / p.width) * 100}%`);
  }
  d.hidden = false;
  // el frame extra deja que el navegador registre hidden=false antes de animar
  if (animar) requestAnimationFrame(() => d.classList.add('abierto'));
  else d.classList.add('abierto');
}

// Fila de tabla del detalle: etiqueta, valor y una nota opcional
const filaD = (k, v, nota = '', clase = '') =>
  `<tr><th scope="row">${k}</th><td class="${clase}">${v}</td><td class="d-nota">${nota}</td></tr>`;

const DETALLES = {
  // Marcador → de dónde sale la diferencia, jugada cerrada por jugada cerrada
  marcador(r) {
    const dif = r.real ? r.sim.valor - r.real.total : null;
    const cerradas = (r.sleeveRendimiento?.detalle ?? []).filter(x => x.estado === 'cerrada');
    const suma = cerradas.reduce((a, x) => a + x.pnlUSDT, 0);
    return `<h3>¿Por qué la ficticia va ${dif >= 0 ? 'arriba' : 'abajo'}?</h3>
      <p class="d-intro">Ambas billeteras se valoran con los mismos precios de Binance; lo único
      que cambia es <strong>qué tiene cada una</strong>. La diferencia es el resultado acumulado
      de las jugadas que la ficticia ya cerró.</p>
      <table class="d-tabla"><tbody>
        ${filaD('Billetera ficticia', fmt(r.sim.valor) + ' USDT')}
        ${filaD('Billetera real (hold)', r.real ? fmt(r.real.total) + ' USDT' : '—')}
        ${filaD('Diferencia', (dif >= 0 ? '+' : '') + fmt(dif) + ' USDT', '', dif >= 0 ? 'up' : 'down')}
      </tbody></table>
      ${cerradas.length ? `<h4>Jugadas ya cerradas</h4>
      <table class="d-tabla"><tbody>${cerradas.map(x => filaD(
        x.asset,
        (x.pnlUSDT >= 0 ? '+' : '') + fmt(x.pnlUSDT) + ' USDT',
        `${pct(x.pnlPct)} · ${x.motivoCierre ?? ''}`,
        x.pnlUSDT >= 0 ? 'up' : 'down')).join('')}
        ${filaD('<strong>Suma</strong>', `<strong>${(suma >= 0 ? '+' : '') + fmt(suma)} USDT</strong>`, '', suma >= 0 ? 'up' : 'down')}
      </tbody></table>` : '<p class="d-vacio">Todavía no hay jugadas cerradas.</p>'}`;
  },

  // Alfa → cada jugada contra lo que esa misma plata habría hecho en BTC
  alfa(r) {
    const s = r.sleeveRendimiento;
    if (!s?.detalle?.length) return '<p class="d-vacio">Sin jugadas registradas todavía.</p>';
    return `<h3>Alfa: cada jugada contra BTC</h3>
      <p class="d-intro">El alfa aísla <strong>lo que aportó la decisión</strong>: compara cada jugada
      con lo que habría rendido esa misma plata dejada en BTC durante el mismo tiempo.
      Un alfa positivo significa que elegir ese activo fue mejor que no haber hecho nada.</p>
      <table class="d-tabla d-alfa"><thead><tr>
        <th scope="col">Activo</th><th scope="col">Jugada</th><th scope="col">BTC</th>
        <th scope="col">Alfa</th><th scope="col">Estado</th>
      </tr></thead><tbody>
      ${s.detalle.map(x => `<tr>
        <th scope="row">${x.asset}</th>
        <td class="${x.pnlPct >= 0 ? 'up' : 'down'}">${pct(x.pnlPct)}</td>
        <td class="d-nota">${pct(x.benchPct)}</td>
        <td class="${x.alfaPct >= 0 ? 'up' : 'down'}"><strong>${pct(x.alfaPct)}</strong></td>
        <td class="d-nota">${x.estado === 'cerrada' ? (x.motivoCierre ?? 'cerrada') : 'abierta'}</td>
      </tr>`).join('')}
      </tbody></table>
      <p class="d-pie">Total: <strong class="${s.alfaUSDT >= 0 ? 'up' : 'down'}">${(s.alfaUSDT >= 0 ? '+' : '') + fmt(s.alfaUSDT)} USDT</strong>
      (${(s.alfaPct >= 0 ? '+' : '') + fmt(s.alfaPct)} pp vs BTC) en ${s.jugadas} jugada(s).</p>`;
  },

  // Vigilancia → dónde está cada posición entre su límite y su objetivo
  vigilancia(r) {
    const pos = (r.posiciones ?? []).filter(p => p.estado === 'abierta');
    if (!pos.length) return '<p class="d-vacio">No hay posiciones abiertas con salida programada.</p>';
    return `<h3>Posiciones bajo vigilancia</h3>
      <p class="d-intro">El servidor revisa estos niveles <strong>cada 3 minutos</strong> y ejecuta la
      salida solo (con el equipo despierto). La barra muestra dónde está el precio
      entre su límite de pérdida y su objetivo de ganancia.</p>
      ${pos.map(p => {
        const prog = Math.max(0, Math.min(1, p.progreso ?? 0)) * 100;
        const estado = p.senal === 'cruzo-limite' ? 'cruzó su límite'
          : p.senal === 'cruzo-objetivo' ? 'cruzó su objetivo'
          : p.senal === 'vencido-sin-renta' ? `venció su plazo (${p.horizonteHoras}h) sin rentar — se liquida`
          : p.senal === 'cerca-limite' ? 'cerca del límite'
          : p.senal === 'cerca-objetivo' ? 'cerca del objetivo' : 'en rango';
        const cls = (p.senal?.startsWith('cruzo') || p.senal === 'vencido-sin-renta') ? 'alerta' : p.senal?.startsWith('cerca') ? 'aviso' : '';
        return `<div class="d-pos ${cls}">
          <div class="d-pos-top">
            <strong>${p.asset}</strong>
            <span class="${p.pnlPct >= 0 ? 'up' : 'down'}">${pct(p.pnlPct)} · ${(p.pnlUSDT >= 0 ? '+' : '') + fmt(p.pnlUSDT)} USDT</span>
          </div>
          <div class="d-barra"><span style="left:${prog}%"></span></div>
          <div class="d-pos-niveles">
            <span>límite ${precio(p.limite)}</span>
            <span class="d-nota">ahora ${precio(p.precio)} · entrada ${precio(p.entrada)}</span>
            <span>objetivo ${precio(p.objetivo)}</span>
          </div>
          <div class="d-nota">${estado}${p.horizonte ? ` · horizonte ${p.horizonte}` : ''}</div>
        </div>`;
      }).join('')}`;
  },

  // Riesgo → cuánto está en juego, cómo se han portado los stops, qué cuesta operar
  riesgo(r) {
    const g = r.riesgo, e = r.estadistica, c = r.comisiones;
    if (!g) return '<p class="d-vacio">Sin datos de riesgo todavía.</p>';
    return `<h3>Cuánto está realmente en juego</h3>
      <p class="d-intro">Si <strong>todas</strong> las posiciones abiertas cayeran hasta su límite
      al mismo tiempo, la pérdida sería la de arriba. Es el techo del daño posible hoy — y lo que
      define si queda espacio para abrir otra posición.</p>
      <table class="d-tabla"><tbody>
        ${filaD('Pérdida si pegan todos los stops', '−' + fmt(g.usdt) + ' USDT', g.pct != null ? fmt(g.pct) + '% del capital' : '', 'down')}
        ${filaD('Capital expuesto al mercado', fmt(g.expuestoUSDT) + ' USDT', g.expuestoPct != null ? fmt(g.expuestoPct) + '% del capital' : '')}
        ${g.detalle.map(d => filaD(`· ${d.asset}`, '−' + fmt(d.riesgoUSDT) + ' USDT', `stop ${d.limitePct}%`)).join('')}
      </tbody></table>
      ${e?.n ? `<h4>Cómo han salido las jugadas (n=${e.n})</h4>
      <table class="d-tabla"><tbody>
        ${filaD('Aciertos', fmt(e.winRate, 0) + '%', `${e.n} jugada(s) cerrada(s)`)}
        ${filaD('Gana en promedio', pct(e.gananciaProm), '', 'up')}
        ${filaD('Pierde en promedio', pct(e.perdidaProm), '', 'down')}
        ${filaD('Expectativa por jugada', pct(e.expectativaPct), '', e.expectativaPct >= 0 ? 'up' : 'down')}
        ${e.brechaPromPp != null ? filaD('Brecha de los stops', fmt(e.brechaPromPp) + ' pp',
          `peor caso ${fmt(e.brechaPeorPp)} pp — cuánto se pasó la salida real del nivel fijado`,
          e.brechaPromPp < 0 ? 'down' : '') : ''}
      </tbody></table>
      <p class="d-pie ${e.significativo ? '' : 'aviso-n'}">${e.significativo
        ? 'Con n≥30 estos números empiezan a ser señal y no ruido.'
        : `⚠ Con n=${e.n} esto es ruido, no señal: hacen falta 30+ jugadas para distinguir habilidad de suerte.`}</p>`
      : '<p class="d-vacio">Aún no hay jugadas cerradas para estadística.</p>'}
      ${c ? `<h4>Costo de operar</h4>
      <table class="d-tabla"><tbody>
        ${filaD('Comisiones pagadas', fmt(c.comisionesUSDT, 3) + ' USDT', `${c.operaciones} operaciones · ${fmt(c.volumenUSDT)} USDT de volumen`)}
      </tbody></table>` : ''}`;
  },

  // Hoy → qué acción corresponde, con el atajo para hacerla
  hoy(r) {
    const hoy = diaLocal(Date.now());
    const ops = r.propuesta?.operaciones ?? r.recomendaciones ?? [];
    const avisos = r.propuesta?.avisos ?? [];
    if (r.fecha !== hoy) {
      return `<h3>El análisis de hoy está pendiente</h3>
        <p class="d-intro">El último análisis es del <strong>${r.fecha}</strong>. Ejecutarlo solo
        <strong>genera una propuesta</strong>: nunca mueve la billetera por su cuenta.</p>
        <button type="button" class="d-accion" data-ir="run">Ejecutar análisis</button>`;
    }
    if (!r.aplicado && ops.length) {
      return `<h3>Propuesta esperando tu aprobación</h3>
        <p class="d-intro">${ops.length} operación(es) propuestas por el modelo. Nada se aplica
        hasta que tú lo apruebes.</p>
        <table class="d-tabla"><tbody>${ops.map(o => filaD(
          `${o.accion} ${o.asset}`, fmt(o.usdt) + ' USDT', '@ ' + precio(o.precio),
          o.accion === 'COMPRAR' ? 'up' : 'down')).join('')}</tbody></table>
        ${avisos.length ? `<h4>Avisos de impacto</h4>
          <ul class="d-avisos">${avisos.map(a => `<li class="n-${a.nivel}">${a.texto}</li>`).join('')}</ul>` : ''}
        <button type="button" class="d-accion" data-ir="b-reco">Ver la propuesta completa</button>`;
    }
    return `<h3>${r.aplicado ? 'El plan del día está aplicado' : 'Sin movimientos pendientes'}</h3>
      <p class="d-intro">${r.aplicado
        ? 'Las operaciones del modelo ya se ejecutaron en la billetera ficticia.'
        : 'El portafolio está alineado con la estrategia: no hay nada que aprobar.'}
      Las posiciones abiertas siguen vigiladas cada 3 minutos.</p>
      <button type="button" class="d-accion" data-ir="b-auto">Ver el registro del sistema</button>`;
  },
};

// Los atajos del detalle: o disparan un botón real, o llevan a su card
document.addEventListener('click', e => {
  const ir = e.target.closest('[data-ir]')?.dataset.ir;
  if (!ir) return;
  if (ir === 'run') return $('run')?.click();
  const card = document.querySelector('.' + ir);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('destacada');
    setTimeout(() => card.classList.remove('destacada'), 1600);
  }
});

// Escape cierra el detalle y devuelve el foco al tile que lo abrió
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !ctAbierto) return;
  const b = document.querySelector(`[data-ct="${ctAbierto}"]`);
  ctAbierto = null;
  cerrarDetalle();
  document.querySelectorAll('[data-ct]').forEach(x => x.setAttribute('aria-expanded', 'false'));
  b?.focus();
});

function renderWallets(r) {
  // real
  if (r.real) {
    $('realTotal').textContent = fmt(r.real.total);
    $('realTag').textContent = r.real.fuente === 'snapshot'
      ? `snapshot ${fechaLegible(r.real.actualizado)}`
      // qué billeteras se consolidaron: Binance reparte el saldo en varias y
      // leer solo Spot dejaba el total por debajo del que muestra su web
      : `API · ${(r.real.billeteras ?? ['spot']).join(' + ')}`;
    $('realMeta').textContent = `${r.real.detalle.length} activos — así está tu dinero real hoy (hold, sin tocar).`;
    $('realAssets').innerHTML = assetList(r.real.detalle, r.real.total, 7);
  } else {
    $('realTotal').textContent = '—';
    $('realTag').textContent = 'sin conexión';
    $('realMeta').textContent = 'Conecta tu wallet (snapshot o API solo lectura) para verla aquí.';
    $('realAssets').innerHTML = '';
  }
  // ficticia
  const rend = r.sim.rendimientoPct;
  $('simTotal').textContent = fmt(r.sim.valor);
  const pill = $('simPill');
  pill.textContent = `${rend >= 0 ? '▲' : '▼'} ${pct(rend)}`;
  pill.className = 'pill ' + (rend >= 0.005 ? 'up' : rend <= -0.005 ? 'down' : 'neutral');
  $('simMeta').textContent = `Partió con ${fmt(r.sim.capitalInicial)} USDT el ${r.sim.desde}. Aquí probamos cómo incrementarla.`;

  // Bolsillos. Se dibujan TODOS los que tienen saldo, no una lista fija de tres:
  // antes el panel mostraba solo ancla/sleeve/reserva y el resto quedaba
  // invisible — con una billetera migrada eso escondía el 39% del total. Y como
  // olvidar un bolsillo nuevo es un error silencioso, al final se comprueba que
  // la suma cuadre con el valor total y se avisa si no.
  const b = r.sim.bolsillos;
  const MINIMO_VISIBLE = 0.01;   // bajo un centavo no es un bolsillo, es redondeo
  // Ancla, sleeve y reserva tienen tratamiento visual propio; cualquier OTRO
  // bolsillo se dibuja genérico. La lista viene del motor (`bolsillosDetalle`),
  // así que un bolsillo nuevo aparece solo — sin tocar el front. Antes estaban
  // nombrados a mano acá y `legado` quedó invisible: el 39% de una cartera.
  const ESPECIALES = new Set(['ancla', 'sleeve', 'reserva']);
  const ETIQUETAS = {
    legado: { nom: 'Legado', nota: 'heredado de la real · protegido' },
    polvo: { nom: 'Polvo', nota: 'residuos sin valor operativo' },
  };
  const extras = (r.sim.bolsillosDetalle ?? [])
    .filter(x => !ESPECIALES.has(x.clave) && x.usdt > MINIMO_VISIBLE)
    .map(x => ({
      clase: x.clave,
      nom: ETIQUETAS[x.clave]?.nom ?? x.clave,
      v: x.usdt,
      nota: ETIQUETAS[x.clave]?.nota ?? (x.declarado ? '' : '⚠ bolsillo sin declarar en el motor'),
    }));
  // La invariante la calcula el MOTOR, no el front: antes acá se rearmaba la
  // suma y eso es el mismo error un nivel más arriba.
  const sinDeclarar = r.sim.bolsillosNoDeclarados;

  $('simBolsillos').innerHTML = !b ? '' : `
    <div class="bolsillos">
      <div class="bolsillo ancla"><span class="b-nom">Ancla</span><b>${fmt(b.ancla)}</b><span class="b-nota">intocable por el motor</span></div>
      <div class="bolsillo sleeve ${b.sleeveExcedente > 1 ? 'excedido' : ''}">
        <span class="b-nom">Sleeve</span><b>${fmt(b.sleeve)}</b>
        <span class="b-nota">${b.sleeveOcupacionPct.toFixed(0)}% · techo ${b.sleeveLimitePct}% (${fmt(b.sleevePresupuesto)})</span>
        <div class="b-track"><div class="b-fill" style="width:${Math.min(100, (b.sleeve / (b.sleevePresupuesto || 1)) * 100).toFixed(1)}%"></div></div>
      </div>
      <div class="bolsillo reserva"><span class="b-nom">Reserva</span><b>${fmt(b.reserva)}</b><span class="b-nota">USDT · retiro y resguardo</span></div>
      ${extras.map(e => `<div class="bolsillo ${e.clase}"><span class="b-nom">${e.nom}</span><b>${fmt(e.v)}</b><span class="b-nota">${e.nota}</span></div>`).join('')}
    </div>
    ${sinDeclarar ? `<div class="aviso alto" style="margin-top:8px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg><span>Bolsillo sin declarar: <b>${sinDeclarar.claves.join(', ')}</b> con <b>${fmt(sinDeclarar.usdt)} USDT</b>. Su plata SÍ está en el total, pero hay que agregarlo a <code>BOLSILLOS</code> en el motor.</span></div>` : ''}
    ${b.sleeveExcedente > 1 ? `<div class="aviso medio" style="margin-top:8px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><span>Sleeve sobre su techo: ${fmt(b.sleeveExcedente)} USDT de excedente por cosechar a reserva.</span></div>` : ''}`;

  const detalle = [...r.sim.holdings];
  if (r.sim.cash > 0.01) detalle.push({ asset: 'USDT', qty: r.sim.cash, usdt: r.sim.cash, bolsillo: 'reserva' });
  detalle.sort((a, b2) => b2.usdt - a.usdt);
  $('simAssets').innerHTML = assetList(detalle, r.sim.valor, 5);
  observarListas();
}

function renderRecos(r) {
  const tsPlan = r.planGeneradoA ?? r.generadoA;
  const horaPlan = tsPlan ? new Date(tsPlan).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '';
  const hoy = diaLocal(Date.now());
  const vieja = r.fecha && r.fecha !== hoy;
  $('recoTag').textContent = (r.aplicado
    ? `aplicada a la billetera ficticia — ${r.fecha}`
    : `propuesta del modelo — requiere tu aprobación (${r.fecha})`)
    + (horaPlan ? ` · precios de las ${horaPlan}` : '')
    + (vieja ? ' · ⚠ de un día anterior' : '');

  // Nota de cuarentena: un pick vetado a mitad de semana deja su ranura sin usar
  // (no se reemplaza — la cadencia semanal existe para no rotar por impulso).
  const vetados = r.vetadosEstaSemana ?? [];
  const notaVeto = vetados.length
    ? `<div class="aviso medio" style="margin-bottom:8px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg><span><b>${vetados.join(', ')}</b> ${vetados.length === 1 ? 'quedó' : 'quedaron'} en cuarentena por un corte reciente: fuera de los picks y <b>sin reemplazo</b> hasta el próximo rebalanceo. Su parte del presupuesto queda sin usar.</span></div>`
    : '';

  const acciones = $('propuestaAcciones');
  if (!r.recomendaciones?.length) {
    // Vacío por cuarentena y vacío por falta de momentum son causas DISTINTAS:
    // decir "refugio en USDT" cuando fue la cuarentena es desinformar.
    const motivo = r.picks?.length ? '.'
      : vetados.length ? ' — la cuarentena dejó la semana sin picks; no se propone liquidar lo que ya tienes.'
      : ' (sin momentum positivo — refugio en USDT).';
    $('recos').innerHTML = notaVeto + `<div class="empty">Sin movimientos: el portafolio ya está alineado con la estrategia${motivo}</div>`;
    acciones.innerHTML = '';
    return;
  }

  const p = r.propuesta;
  const resumen = p
    ? `<div class="prop-resumen">Rota <b>${fmt(p.movidoUSDT)} USDT</b> (${p.movidoPct.toFixed(0)}% de la wallet) hacia <b>${r.picks.join(' · ')}</b> · comisiones ≈ ${fmt(p.comisionesEstimadas)} USDT</div>`
    : '';
  const avisos = p?.avisos?.length
    ? `<div class="avisos">${p.avisos.map(a => `<div class="aviso ${a.nivel}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><span>${a.texto}</span></div>`).join('')}</div>`
    : '';

  $('recos').innerHTML = notaVeto + resumen + avisos + '<div class="reco-list">' + r.recomendaciones.map(t => `
    <div class="reco">
      <span class="badge ${t.accion === 'COMPRAR' ? 'compra' : 'venta'}">${t.accion}</span>
      <div class="det"><b>${t.asset}</b> <span>· ${fmt(t.qty, 6)} ${t.asset} a ${precio(t.precio)} USDT</span></div>
      <span class="amt">${fmt(t.usdt)} USDT</span>
    </div>`).join('') + '</div>';

  acciones.innerHTML = r.aplicado
    ? ''
    : `<div class="prop-acciones">
        <button class="btn-aplicar" id="aplicar">Aplicar propuesta a la ficticia</button>
        <span class="prop-nota">Nada se ejecuta hasta que pulses aquí. Solo afecta la billetera ficticia.</span>
      </div>`;
  const btn = $('aplicar');
  if (btn) btn.onclick = () => aplicarPropuesta(r);
}

async function aplicarPropuesta(r) {
  const p = r.propuesta;
  const detalle = r.recomendaciones.map(t => `${t.accion} ${t.asset} ${fmt(t.usdt)} USDT`).join('\n');
  const avisos = p?.avisos?.length ? `\n\nAVISOS:\n· ${p.avisos.map(a => a.texto).join('\n· ')}` : '';
  if (!confirm(`¿Aplicar esta propuesta a la billetera FICTICIA?\n\n${detalle}${avisos}\n\n(Esto no toca tu dinero real.)`)) return;
  const btn = $('aplicar');
  btn.disabled = true; btn.textContent = 'Aplicando…';
  try {
    const data = await (await fetch('/api/aplicar-plan', { method: 'POST' })).json();
    if (data.error) alert('Error: ' + data.error);
    else renderAll(data);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Aplicar propuesta a la ficticia'; }
  }
}

// Rendimiento del SLEEVE: mide el modelo, no a BTC. Cada jugada contra lo que
// esa misma plata habría rendido quieta en bitcoin el mismo período.
function renderSleeveRendimiento(s) {
  const cont = $('sleeveRend');
  if (!cont) return;
  if (!s || !s.jugadas) { cont.innerHTML = ''; return; }
  const signo = v => (v >= 0 ? '+' : '') + fmt(v);
  const cls = v => v >= 0 ? 'up' : 'down';
  cont.innerHTML = `
    <div class="metricas">
      <div class="metrica"><span class="m-nom">Capital desplegado</span><b>${fmt(s.capitalDesplegado)} USDT</b><span class="m-nota">en ${s.jugadas} jugada(s)</span></div>
      <div class="metrica"><span class="m-nom">PnL del sleeve</span><b class="${cls(s.pnlUSDT)}">${signo(s.pnlUSDT)} USDT</b><span class="m-nota">${signo(s.pnlPct)}%</span></div>
      <div class="metrica destacada"><span class="m-nom">Alfa vs BTC</span><b class="${cls(s.alfaUSDT)}">${signo(s.alfaUSDT)} USDT</b><span class="m-nota">${signo(s.alfaPct)} pp · lo que aporta el modelo</span></div>
      <div class="metrica"><span class="m-nom">Acierto</span><b>${s.aciertoPct == null ? '—' : s.aciertoPct.toFixed(0) + '%'}</b><span class="m-nota">${s.cerradas} cerrada(s)</span></div>
    </div>
    <table style="margin-top:10px"><thead><tr><th>Jugada</th><th class="num">PnL</th><th class="num">BTC igual período</th><th class="num">Alfa</th></tr></thead><tbody>
    ${s.detalle.map(d => `<tr>
      <td><b>${d.asset}</b>${d.estado === 'cerrada' ? ` <span style="color:var(--muted);font-size:11.5px">· ${d.motivoCierre ?? 'cerrada'}</span>` : ''}</td>
      <td class="num ${cls(d.pnlPct)}">${signo(d.pnlPct)}%</td>
      <td class="num" style="color:var(--muted)">${d.benchPct == null ? '—' : signo(d.benchPct) + '%'}</td>
      <td class="num ${d.alfaPct == null ? '' : cls(d.alfaPct)}"><b>${d.alfaPct == null ? '—' : signo(d.alfaPct) + ' pp'}</b></td>
    </tr>`).join('')}
    </tbody></table>`;
}

// Posiciones abiertas: entrada, precio actual, PnL y distancia a cada nivel.
function renderPosiciones(posiciones) {
  const cont = $('posiciones');
  const abiertas = (posiciones ?? []).filter(p => !p.sinPrecio);
  if (!abiertas.length) {
    cont.innerHTML = '<div class="empty">Sin posiciones con salida programada.</div>';
    $('posTag').textContent = 'vigilancia de objetivos y límites';
    return;
  }
  const cruces = abiertas.filter(p => p.senal === 'cruzo-limite' || p.senal === 'cruzo-objetivo').length;
  $('posTag').textContent = cruces
    ? `${cruces} posición(es) cruzaron su nivel — decide`
    : `${abiertas.length} abierta(s) · vigilancia activa`;

  cont.innerHTML = abiertas.map(p => {
    const clase = { 'cruzo-limite': 'peligro', 'cruzo-objetivo': 'logro', 'vencido-sin-renta': 'peligro', 'cerca-limite': 'atencion', 'cerca-objetivo': 'atencion' }[p.senal] ?? '';
    const etiqueta = {
      'cruzo-limite': '⚠ LÍMITE CRUZADO — corta o decide',
      'cruzo-objetivo': '✓ OBJETIVO ALCANZADO — puedes cobrar',
      'vencido-sin-renta': `⏳ PLAZO VENCIDO (${p.horizonteHoras}h) SIN RENTAR — se liquida`,
      'cerca-limite': 'cerca del límite',
      'cerca-objetivo': 'cerca del objetivo',
    }[p.senal] ?? 'en rango';
    const alLimite = ((p.precio / p.limite - 1) * 100);
    const alObjetivo = ((p.objetivo / p.precio - 1) * 100);
    // El nivel que de verdad va a vender NO es siempre el stop original: bajo
    // política de trailing manda `limiteEfectivo`, y mostrar el otro sería un
    // panel que informa un precio de salida que no es el que se va a ejecutar.
    const salidaVigente = q => {
      const efec = q.limiteEfectivo ?? q.limite;
      const falta = ((q.precio / efec - 1) * 100);
      if (q.trailActivo) return `trailing ${precio(efec)} (${q.limitePctEfectivo}%) · falta ${falta.toFixed(1)}%`;
      if (q.politicaSalida === 'trailing' && q.trailPct != null) {
        return `límite ${precio(efec)} (${q.limitePctEfectivo}%) · trailing ${q.trailPct}% arma en +${q.activarTrailEnPct}%`;
      }
      return `límite ${precio(efec)} (${q.limitePctEfectivo ?? q.limitePct}%) · falta ${falta.toFixed(1)}%`;
    };
    // Con política de trailing el objetivo dejó de ser una venta: es la
    // referencia estructural con la que se midió el R:B al entrar. Decir
    // "objetivo" ahí prometería un cobro que no va a ocurrir.
    const techoDeReferencia = (q, al) => q.politicaSalida === 'trailing'
      ? `techo 30d ${precio(q.objetivo)} (+${q.objetivoPct}%) · referencia, no vende`
      : `objetivo ${precio(q.objetivo)} (+${q.objetivoPct}%) · falta ${al.toFixed(1)}%`;
    return `<div class="pos ${clase}">
      <div class="pos-head">
        <span class="pos-asset">${p.asset}</span>
        <span class="pos-pnl ${p.pnlPct >= 0 ? 'up' : 'down'}">${pct(p.pnlPct)} · ${p.pnlUSDT >= 0 ? '+' : ''}${fmt(p.pnlUSDT)} USDT</span>
        <span class="pos-estado ${clase}">${etiqueta}</span>
      </div>
      <div class="pos-datos">
        entrada ${precio(p.entrada)} → ahora <b>${precio(p.precio)}</b> · ${fmt(p.valorUSDT)} USDT
        ${p.horizonte ? ` · horizonte ${p.horizonte}` : ''}
      </div>
      <div class="pos-barra" role="img" aria-label="posición entre el límite y el objetivo: ${(p.progreso * 100).toFixed(0)}%">
        <div class="pos-track"><div class="pos-marker" style="--pos:${(p.progreso * 100).toFixed(1)}%"></div></div>
        <div class="pos-niveles">
          <span class="down">${salidaVigente(p)}</span>
          <span class="up">${techoDeReferencia(p, alObjetivo)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// Banner superior cuando hay cruces vigentes (nivel 2: alerta en vivo).
function renderBannerAlertas(posiciones) {
  const cruces = (posiciones ?? []).filter(p => p.senal === 'cruzo-limite' || p.senal === 'cruzo-objetivo' || p.senal === 'vencido-sin-renta');
  const cont = $('bannerAlertas');
  if (!cruces.length) { cont.innerHTML = ''; return; }
  const clase = p => p.senal === 'cruzo-limite' ? 'peligro' : p.senal === 'vencido-sin-renta' ? 'peligro' : 'logro';
  const titulo = p => p.senal === 'cruzo-limite' ? 'cruzó su LÍMITE'
    : p.senal === 'vencido-sin-renta' ? `venció su plazo (${p.horizonteHoras}h) sin rentar`
    : 'alcanzó su OBJETIVO';
  const cola = p => p.senal === 'cruzo-limite' ? 'La regla dice cortar.'
    : p.senal === 'vencido-sin-renta' ? 'Se liquida: era de corto plazo, no para sostener.'
    : 'Puedes cobrar la ganancia a USDT.';
  cont.innerHTML = cruces.map(p => `
    <div class="banner ${clase(p)}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
      <span><b>${p.asset}</b> ${titulo(p)} —
      precio ${precio(p.precio)}, PnL ${pct(p.pnlPct)} (${p.pnlUSDT >= 0 ? '+' : ''}${fmt(p.pnlUSDT)} USDT).
      ${cola(p)}</span>
    </div>`).join('');
}

// REGISTRO DEL SISTEMA: lo que se ejecutó sin intervención de Jorge —
// auto-stops, tomas de objetivo y alertas detectadas. Separado por fecha y con
// hora, porque el valor está en saber CUÁNDO actuó mientras nadie miraba.
function esAutomatico(tipo = '') {
  return /^auto-|^corte por|^plan del modelo|cosecha autom/i.test(tipo);
}

function renderRegistroAuto(movimientos, alertas, cierres = []) {
  const cont = $('registroAuto') ?? $('autoRegistro');
  if (!cont) return;

  // eventos: movimientos automáticos + alertas que no derivaron en operación
  const eventos = [];
  for (const ev of movimientos ?? []) {
    if (!esAutomatico(ev.tipo)) continue;
    const usdt = ev.operaciones.reduce((a, o) => a + o.usdt, 0);
    const pnl = ev.tipo.match(/(-?\d+[.,]\d+)%/);
    const act = ev.operaciones[0]?.asset;
    // el cierre correspondiente: mismo activo, dentro de un minuto del evento
    const cierre = cierres.find(c => c.asset === act && c.cerrado &&
      Math.abs(new Date(c.cerrado) - new Date(ev.ts)) < 60_000);
    eventos.push({
      ts: ev.ts,
      clase: /objetivo/i.test(ev.tipo) ? 'logro' : 'stop',
      etiqueta: /objetivo/i.test(ev.tipo) ? 'OBJETIVO' : 'AUTO-STOP',
      assets: [...new Set(ev.operaciones.map(o => o.asset))].join(', '),
      detalle: ev.operaciones.map(o => `${o.accion.toLowerCase()} ${fmt(o.qty, 6)} @ ${precio(o.precio)}`).join(' · '),
      usdt,
      pnl: pnl ? parseFloat(pnl[1].replace(',', '.')) : null,
      brecha: cierre?.brechaPp ?? null,
      nivel: cierre?.nivelEsperado ?? null,
    });
  }
  for (const a of alertas ?? []) {
    if (a.ejecutado) continue;            // ya está como movimiento
    eventos.push({
      ts: a.ts,
      clase: 'aviso',
      etiqueta: 'ALERTA',
      assets: a.asset,
      detalle: a.texto ?? `${a.asset} cruzó su nivel`,
      usdt: null,
      pnl: a.pnlPct ?? null,
    });
  }

  if (!eventos.length) {
    cont.innerHTML = '<div class="empty">El sistema no ha ejecutado movimientos automáticos todavía. Aquí aparecerán los auto-stops, tomas de objetivo y alertas que ocurran mientras no estés operando.</div>';
    $('autoTag').textContent = 'lo que se ejecutó sin ti';
    return;
  }

  eventos.sort((a, b) => b.ts.localeCompare(a.ts));
  const total = eventos.filter(e => e.usdt != null).reduce((a, e) => a + e.usdt, 0);
  $('autoTag').textContent = `${eventos.length} evento(s) · ${fmt(total)} USDT movidos sin ti`;

  // agrupar por día local
  const porDia = new Map();
  for (const e of eventos) {
    const d = diaLocal(e.ts);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(e);
  }

  cont.innerHTML = [...porDia].slice(0, 5).map(([fecha, evs]) => `
    <div class="dia-bloque">
      <div class="dia-head">
        <span><b>${fecha}</b></span>
        <span class="tipo">${evs.length} evento(s) · ${fmt(evs.reduce((a, e) => a + (e.usdt ?? 0), 0))} USDT</span>
      </div>
      <table class="tabla-auto">
        <thead><tr><th>Hora</th><th>Evento</th><th>Activo</th><th class="num">PnL</th><th class="num">Brecha</th><th class="num">A reserva</th></tr></thead>
        <tbody>
        ${evs.map(e => `<tr>
          <td class="hora">${new Date(e.ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          <td><span class="badge-auto ${e.clase}">${e.etiqueta}</span></td>
          <td><b>${e.assets}</b><div class="det-auto">${e.detalle}</div></td>
          <td class="num ${e.pnl == null ? '' : e.pnl >= 0 ? 'up' : 'down'}">${e.pnl == null ? '—' : pct(e.pnl)}</td>
          <td class="num ${e.brecha == null ? '' : e.brecha < -1 ? 'down' : ''}" ${e.nivel != null ? `title="nivel fijado ${e.nivel}% · salida real ${fmt(e.pnl)}%"` : ''}>${e.brecha == null ? '—' : fmt(e.brecha, 1) + ' pp'}</td>
          <td class="num"><b>${e.usdt == null ? '—' : '+' + fmt(e.usdt)}</b></td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');
}

// De dónde salió una operación. El campo `origen` existe recién desde el
// 21-08-2026, así que los movimientos anteriores llegan sin él y NO se les
// puede inventar una superficie:
//   · un cierre por stop/objetivo/horizonte lo ejecuta el monitor por
//     definición (el texto mismo dice "auto-stop"/"auto-objetivo"), así que
//     ahí sí se puede afirmar que fue el motor;
//   · una jugada o cosecha vieja fue discrecional —de Jorge— pero por qué
//     pantalla se hizo no quedó registrado. Se marca "manual" y el tooltip
//     lo dice, en vez de atribuirla al dashboard sin pruebas.
// Hora local del movimiento. Nunca cortar el texto ISO (`ts.slice(11,16)`):
// eso devuelve UTC y en Chile son 4 h de diferencia. `h23` y no `hour12:false`,
// que en es-CL imprime 24:58 a medianoche.
const horaLocal = ts => ts
  ? new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  : '';

const ORIGENES = {
  telegram:  { clase: 'telegram',  icono: '✈', palabra: 'Telegram',   detalle: 'aprobada desde el teléfono' },
  motor:     { clase: 'motor',     icono: '⚙', palabra: 'automático', detalle: 'ejecutada sola por el monitor' },
  dashboard: { clase: 'dashboard', icono: '🖥', palabra: 'dashboard',  detalle: 'ejecutada desde el dashboard' },
};
const AUTO_POR_CATEGORIA = new Set(['stop', 'objetivo', 'horizonte']);

function origenDe(ev) {
  if (ev.origen && ORIGENES[ev.origen]) return ORIGENES[ev.origen];
  if (ev.origen) return { clase: '', icono: '?', palabra: ev.origen, detalle: 'origen no reconocido' };
  if (AUTO_POR_CATEGORIA.has(ev.categoria)) return ORIGENES.motor;
  return { clase: 'previo', icono: '✎', palabra: 'manual', detalle: 'anterior al registro de origen: decidida por Jorge, superficie sin registrar' };
}

// ¿POR QUÉ LA BRECHA? — atribuye la diferencia entre la ficticia y la real a
// las decisiones concretas que la abrieron. La real no se toca nunca, así que
// es literalmente el escenario "no hice nada": la brecha es el costo de haber
// operado. Lo que faltaba era saber QUÉ decisión la causó.
async function cargarBrecha() {
  const cont = $('brecha');
  try {
    const a = await (await fetch('/api/atribucion')).json();
    if (a.error || !a.n) { cont.innerHTML = `<div class="empty">${a.error ?? 'Sin movimientos que atribuir.'}</div>`; return; }

    const cuestan = a.filas.filter(f => f.impactoUSDT < -0.05).slice(0, 6);
    const aportan = a.filas.filter(f => f.impactoUSDT > 0.05).slice(-6).reverse();
    $('brechaTag').textContent = a.cobertturaPct != null
      ? `explica el ${Math.abs(a.cobertturaPct).toFixed(0)}% de ${fmt(a.brechaUSDT)} USDT`
      : 'cada decisión contra no haberla tomado';

    const fila = f => `<tr>
      <td>${f.fecha}</td>
      <td><span class="badge ${f.accion === 'COMPRAR' ? 'compra' : 'venta'}">${f.accion}</span></td>
      <td><b>${f.asset}</b></td>
      <td class="num">${fmt(f.entoncesUSDT)}</td>
      <td class="num">${fmt(f.hoyUSDT)}</td>
      <td class="num ${f.impactoUSDT >= 0 ? 'up' : 'down'}"><b>${f.impactoUSDT >= 0 ? '+' : ''}${fmt(f.impactoUSDT)}</b></td>
    </tr>`;
    const tabla = (titulo, filas) => !filas.length ? '' : `
      <div class="br-col">
        <h3>${titulo}</h3>
        <table><thead><tr><th>Fecha</th><th>Acción</th><th>Activo</th>
          <th class="num">Entonces</th><th class="num">Hoy vale</th><th class="num">Impacto</th></tr></thead>
        <tbody>${filas.map(fila).join('')}</tbody></table>
      </div>`;

    cont.innerHTML = `
      <p class="d-intro">Tu billetera <strong>real no se toca nunca</strong>, así que es el escenario
      «no hice nada». La brecha es el costo de haber operado — y cada fila la juzga contra
      <strong>no haber hecho esa operación</strong>, a precios de hoy.</p>
      <div class="br-cols">
        ${tabla('Lo que más costó', cuestan)}
        ${tabla('Lo que más aportó', aportan)}
      </div>
      <div class="br-cuadre">
        <span>Suma de las decisiones <b class="${a.explicadoUSDT >= 0 ? 'up' : 'down'}">${fmt(a.explicadoUSDT)}</b></span>
        <span>Brecha real <b class="${a.brechaUSDT >= 0 ? 'up' : 'down'}">${fmt(a.brechaUSDT)}</b></span>
        <span>Sin explicar <b>${fmt(a.residuoUSDT)}</b></span>
      </div>
      <p class="d-nota">El residuo no se esconde: son las comisiones (${fmt(a.comisionesUSDT, 3)} USDT),
      el redondeo de la reserva a dos decimales en cada operación, y diferencias menores de
      composición entre ambas carteras.${a.sinPrecio?.length ? ` Sin precio: ${a.sinPrecio.join(', ')}.` : ''}</p>`;
  } catch (e) {
    cont.innerHTML = `<div class="empty">No se pudo calcular: ${e.message}</div>`;
  }
}

// QUÉ PASÓ DESPUÉS DE SALIR — la única forma de saber si una salida fue buena.
// Sirve en los dos sentidos: un objetivo que sigue subiendo vendió temprano, y
// un stop que se recupera cortó una posición que iba a volver.
async function cargarSeguimiento() {
  const cont = $('seguimiento');
  try {
    const s = await (await fetch('/api/seguimiento')).json();
    if (s.error || !s.filas?.length) { cont.innerHTML = `<div class="empty">${s.error ?? 'Todavía no hay cierres que medir.'}</div>`; return; }

    $('segTag').textContent = s.n
      ? `${s.n} cierre(s) con ventana completa de ${Math.max(...s.ventanasH)} h`
      : 'midiendo los primeros cierres';

    const lectura = f => f.costoPct == null ? '<span class="muted">midiendo…</span>'
      : f.tipo === 'objetivo' ? (f.costoPct > 0 ? '<span class="down">vendió temprano</span>' : '<span class="up">salida acertada</span>')
      : f.tipo === 'stop' ? (f.costoPct > 0 ? '<span class="down">cortó una recuperación</span>' : '<span class="up">stop acertado</span>')
      : (f.costoPct > 0 ? '<span class="down">liquidó algo que subía</span>' : '<span class="up">plazo acertado</span>');
    const p = v => v == null ? '—' : `<span class="${v >= 0 ? 'down' : 'up'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;

    const resumen = ['objetivo', 'stop', 'horizonte']
      .filter(t => s[t]?.n)
      .map(t => `<div class="metrica"><span class="m-nom">Salidas por ${t}</span>
        <b class="${s[t].promedioPct >= 0 ? 'down' : 'up'}">${s[t].promedioPct >= 0 ? '+' : ''}${s[t].promedioPct.toFixed(1)}%</b>
        <span class="m-nota">${s[t].siguieronSubiendo} de ${s[t].n} siguió subiendo después</span></div>`).join('');

    cont.innerHTML = `
      <p class="d-intro">Después de cada salida, ¿el precio siguió subiendo? Si sí, la salida
      <strong>costó</strong>: por objetivo dejamos dinero en la mesa, por stop nos cortó antes
      de la recuperación. <strong>Positivo = nos costó.</strong></p>
      ${resumen ? `<div class="metricas">${resumen}</div>` : ''}
      <table><thead><tr><th>Cerrada</th><th>Activo</th><th>Salida</th><th>PnL</th>
        <th class="num">+24 h</th><th class="num">+48 h</th><th class="num">Máx.</th>
        <th class="num" title="lo que esa salida costó EN PLATA, al tamaño que de verdad se operó">Costó</th>
        <th>Lectura</th></tr></thead>
      <tbody>${s.filas.map(f => `<tr>
        <td>${(f.cerrado ?? '').slice(0, 10)}</td>
        <td><b>${f.asset}</b></td>
        <td>${f.tipo}</td>
        <td class="num ${f.pnlPct >= 0 ? 'up' : 'down'}">${f.pnlPct >= 0 ? '+' : ''}${f.pnlPct.toFixed(1)}%</td>
        <td class="num">${p(f.h24Pct)}</td>
        <td class="num">${p(f.h48Pct)}</td>
        <td class="num">${p(f.maximoPct)}</td>
        <td class="num ${f.costoUSDT == null ? '' : f.costoUSDT > 0 ? 'down' : 'up'}">${
          f.costoUSDT == null ? '—' : `${f.costoUSDT > 0 ? '+' : ''}${fmt(f.costoUSDT)}`}</td>
        <td>${lectura(f)}</td></tr>`).join('')}</tbody></table>
      ${(() => {
        const con = s.filas.filter(f => f.costoUSDT != null);
        if (!con.length) return '';
        const total = con.reduce((a, f) => a + f.costoUSDT, 0);
        const techo = con.reduce((a, f) => a + (f.maximoUSDT ?? 0), 0);
        // El porcentaje dice si la regla falla; los USDT dicen cuánto cuesta.
        // Sin el segundo no se puede decidir si vale la pena cambiarla.
        return `<p class="d-nota"><b>En plata:</b> salir cuando salimos costó
          <b class="${total > 0 ? 'down' : 'up'}">${total > 0 ? '+' : ''}${fmt(total)} USDT</b>
          netos a 48 h sobre ${con.length} cierres. Con salida perfecta el techo habría sido
          ${fmt(techo)} USDT — inalcanzable, pero marca el tamaño del problema.</p>`;
      })()}
      <p class="d-nota">${s.significativo
        ? 'Con n≥20 esto empieza a ser señal.'
        : `⚠ Con n=${s.n} es una pregunta, no una conclusión: hacen falta 20+ cierres medidos. Las que dicen «midiendo…» aún no cumplen las ${Math.max(...s.ventanasH)} h.`}</p>`;
  } catch (e) {
    cont.innerHTML = `<div class="empty">No se pudo calcular: ${e.message}</div>`;
  }
}

// Historial de movimientos: bloques por día, últimos 5 días con actividad.
// Cuántos días por página. Cuatro entra completo en la altura de la lista sin
// que el paginador se vaya de la vista.
const HIST_DIAS_POR_PAGINA = 4;
let _histPagina = 0;

function renderMovimientos(movimientos) {
  const cont = $('historial');
  if (!movimientos?.length) {
    cont.innerHTML = '<div class="empty">Aún no hay movimientos registrados.</div>';
    return;
  }
  // agrupar eventos por fecha (bloque = día)
  const porDia = new Map();
  for (const ev of movimientos) {
    if (!porDia.has(ev.fecha)) porDia.set(ev.fecha, []);
    porDia.get(ev.fecha).push(ev);
  }
  // PAGINADO POR DÍAS. Antes se recortaba a los últimos 5 y el resto
  // desaparecía sin decirlo: el historial mentía por omisión. Ahora se ven 4
  // por página y se puede llegar hasta el primer día del proyecto.
  const todos = [...porDia.keys()].sort().reverse();   // más reciente primero
  const paginas = Math.max(1, Math.ceil(todos.length / HIST_DIAS_POR_PAGINA));
  _histPagina = Math.min(_histPagina, paginas - 1);
  const desde = _histPagina * HIST_DIAS_POR_PAGINA;
  const dias = todos.slice(desde, desde + HIST_DIAS_POR_PAGINA);

  const bloques = dias.map(fecha => {
    const eventos = porDia.get(fecha);
    // Cada operación se queda con los datos de SU evento. Antes se hacía
    // `flatMap(e => e.operaciones)` y eso aplanaba el día entero: las 6
    // operaciones del 21-08 quedaban en una sola lista y las tres insignias de
    // origen se mostraban juntas en la cabecera, sin poder saber cuál venía de
    // Telegram y cuál del dashboard. El vínculo con el evento es el dato.
    const ops = eventos.flatMap(e => e.operaciones.map(o => ({
      ...o, origen: origenDe(e), tipo: e.tipo, ts: e.ts,
    })));
    const totalMovido = ops.reduce((a, o) => a + o.usdt, 0);
    const tipos = [...new Set(eventos.map(e => e.tipo))].join(' · ');
    const hora = horaLocal(eventos[eventos.length - 1]?.ts);
    return `<div class="dia-bloque">
      <div class="dia-head">
        <span><b>${fecha}</b>${hora ? ` <span class="tipo">· ${hora}</span>` : ''} <span class="tipo">· ${tipos}</span></span>
        <span class="tipo">${ops.length} ${ops.length === 1 ? 'operación' : 'operaciones'} · ${fmt(totalMovido)} USDT movidos</span>
      </div>
      ${ops.map(o => `<div class="mov-row">
        <span class="badge ${o.accion === 'COMPRAR' ? 'compra' : 'venta'}">${o.accion}</span>
        <div class="det"><b>${o.asset}</b> <span>· ${fmt(o.qty, 6)} ${o.asset} a ${precio(o.precio)} USDT</span></div>
        <span class="mov-hora">${horaLocal(o.ts) || '—'}</span>
        <span class="origen ${o.origen.clase}" title="${o.origen.detalle} — ${o.tipo}"><span class="ori-ico" aria-hidden="true">${o.origen.icono}</span><span class="ori-txt">${o.origen.palabra}</span></span>
        <span class="amt">${fmt(o.usdt)} USDT</span>
      </div>`).join('')}
    </div>`;
  }).join('');

  // El scroll vive DENTRO de la lista, no en la card: así el paginador queda
  // siempre visible y no hay que bajar hasta el final para cambiar de página.
  const rango = dias.length === 1 ? dias[0] : `${dias.at(-1)} → ${dias[0]}`;
  cont.innerHTML = `<div class="hist-lista">${bloques}</div>`
    + (paginas > 1 ? `<div class="hist-pager">
        <button class="btn-pag" data-hist="-1" ${_histPagina === 0 ? 'disabled' : ''}
          aria-label="Días más recientes">← recientes</button>
        <span>${rango} · página ${_histPagina + 1} de ${paginas} · ${todos.length} días con actividad</span>
        <button class="btn-pag" data-hist="1" ${_histPagina >= paginas - 1 ? 'disabled' : ''}
          aria-label="Días anteriores">anteriores →</button>
      </div>` : '');

  for (const b of cont.querySelectorAll('[data-hist]')) {
    b.onclick = () => {
      _histPagina += Number(b.dataset.hist);
      renderMovimientos(movimientos);
      cont.querySelector('.hist-lista')?.scrollTo({ top: 0 });
    };
  }
}

// Estado de tendencia por activo: qué fase atraviesa, no solo cuánto subió.
// "extendido" es la lectura que más plata cuida: subir mucho no invita a
// entrar — 1,5x la volatilidad sobre su media es pagar el pico (lección ACE).
const FASE = {
  tendencia: { glifo: '▲', clase: 'up',   lectura: 'sube con su media de 20d' },
  extendido: { glifo: '⚠', clase: 'warn', lectura: 'muy por encima de su media: entrar acá es pagar el pico' },
  rango:     { glifo: '◆', clase: 'mut',  lectura: 'lateral, sin dirección clara' },
  caida:     { glifo: '▼', clase: 'down', lectura: 'bajo su media de 20d y cayendo' },
};

// WATCHLIST: candidatos esperando su punto de entrada. La card solo aparece si
// hay algo que mostrar; las resueltas recientes se quedan unos días como rastro.
const CONDICION_HUMANA = c => [
  c.precioMax != null && `precio ≤ ${precio(c.precioMax)}${c.zonaPct ? ` (−${c.zonaPct}% de ${precio(c.precioRef)})` : ''}`,
  c.rsiMax != null && `RSI < ${c.rsiMax}`,
  c.fasesOk?.length && `fase ${c.fasesOk.join(' o ')}`,
  'régimen no vetado', 'fuera de cuarentena',
].filter(Boolean).join(' · ');

async function cargarWatchlist() {
  const card = $('cardWatch'), cont = $('watchlist');
  try {
    const { entradas = [] } = await (await fetch('/api/watchlist')).json();
    const vivas = entradas.filter(w => w.estado === 'vigilando');
    const resueltas = entradas.filter(w => w.estado !== 'vigilando')
      .sort((a, b) => (b.resueltaEn ?? '').localeCompare(a.resueltaEn ?? '')).slice(0, 3);
    if (!vivas.length && !resueltas.length) { card.hidden = true; return; }
    card.hidden = false;
    $('watchTag').textContent = vivas.length
      ? `${vivas.length} en espera · el monitor evalúa cada 15 min`
      : 'sin vigilancias activas';

    const dias = w => Math.max(0, Math.ceil((Date.parse(w.vence) - Date.now()) / 86400000));
    const fila = w => {
      const faltas = Array.isArray(w.ultimoEstadoCond) ? w.ultimoEstadoCond.join(' · ')
        : w.ultimoEstadoCond === 'cumplida' ? '✓ condición cumplida' : 'aún sin evaluar';
      return `<div class="watch-item ${w.estado !== 'vigilando' ? 'resuelta' : ''}">
        <span class="badge-estado ${w.estado}">${w.estado}</span>
        <b>${w.asset}</b>
        <span class="w-det">${w.motivo ? `${w.motivo} · ` : ''}se arma con: ${CONDICION_HUMANA(w.condicion)}</span>
        ${w.estado === 'vigilando' ? `<span class="w-falta">falta: ${faltas}</span>
          <span class="w-vence">caduca en ${dias(w)} d</span>
          <button class="btn-cancelar-watch" data-cancelar-watch="${w.id}">Quitar</button>` : ''}
        ${w.estado === 'armada' ? '<span class="w-det">→ generó una oferta</span>' : ''}
        ${w.estado === 'caducada' ? '<span class="w-det">caducó sin cumplirse</span>' : ''}
      </div>`;
    };
    cont.innerHTML = [...vivas, ...resueltas].map(fila).join('');
  } catch { card.hidden = true; }
}

// alta desde el radar y cancelación, por delegación
document.addEventListener('click', async e => {
  const vigilarOf = e.target.closest('[data-vigilar-oferta]');
  if (vigilarOf) {
    vigilarOf.disabled = true;
    try {
      await fetch('/api/oferta/vigilar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: vigilarOf.dataset.vigilarOferta, origen: 'dashboard' }) });
      cargarOfertas(); cargarWatchlist();
    } finally { vigilarOf.disabled = false; }
    return;
  }
  const vigilar = e.target.closest('[data-vigilar]');
  const cancelar = e.target.closest('[data-cancelar-watch]');
  if (!vigilar && !cancelar) return;
  const btn = vigilar ?? cancelar;
  btn.disabled = true;
  try {
    if (vigilar) {
      // con Alt/⌥ se pide zona de entrada en vez de solo indicadores
      const zona = vigilar.dataset.zona ? Number(vigilar.dataset.zona) : null;
      await fetch('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: vigilar.dataset.vigilar, zonaPct: zona,
          motivo: vigilar.dataset.motivo || null, origen: 'dashboard' }) });
    } else {
      await fetch('/api/watchlist/cancelar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cancelar.dataset.cancelarWatch, origen: 'dashboard' }) });
    }
    cargarWatchlist();
  } finally { btn.disabled = false; }
});

function renderMercado(r) {
  if (!r.mercado.length) return;
  $('mercado').innerHTML = '<table><thead><tr><th>Activo</th><th>Fase</th><th class="num">RSI</th><th class="num">30 días</th><th class="num">24 h</th><th class="num">Precio</th></tr></thead><tbody>' +
    r.mercado.map(m => {
      const pick = r.picks.includes(m.asset);
      const f = m.tendencia ? FASE[m.tendencia.estado] : null;
      const fase = f
        ? `<span class="fase ${f.clase}" title="${f.lectura} · ${m.tendencia.distSma20Pct >= 0 ? '+' : ''}${m.tendencia.distSma20Pct}% de su media · vol ${m.tendencia.volDiariaPct}%/día">${f.glifo} ${m.tendencia.estado}</span>`
        : '<span class="fase mut">—</span>';
      const motivoW = m.tendencia ? `desde el radar (fase ${m.tendencia.estado})` : 'desde el radar';
      return `<tr${pick ? ' class="pick"' : ''}>
        <td>${pick ? '<span class="star" aria-label="seleccionada por la estrategia">★</span>' : ''}<b>${m.asset}</b>${flechaTendencia(m.cambio24h * 100, { conNumero: false, motivo: `${m.asset}: ${pct(m.cambio24h * 100)} en 24 h` })}
          <button class="btn-vigilar" data-vigilar="${m.asset}" data-motivo="${motivoW}" title="Vigilar: crear la oferta sola cuando enfríe (RSI<70 y fase tendencia)">vigilar</button>
          <button class="btn-vigilar" data-vigilar="${m.asset}" data-zona="6" data-motivo="zona de entrada −6% ${motivoW}" title="Zona de entrada: además de enfriar, esperar a que retroceda un 6% desde el precio de ahora">−6%</button></td>
        <td>${fase}</td>
        <td class="num ${m.rsi14d >= 80 ? 'down' : m.rsi14d >= 70 ? 'warn-txt' : ''}" title="${m.rsi14d >= 80 ? 'sobrecompra extrema: veto duro' : m.rsi14d >= 70 ? 'caliente: castiga el score' : 'zona operable'}">${m.rsi14d ?? '—'}</td>
        <td class="num ${m.momentum >= 0 ? 'up' : 'down'}">${pct(m.momentum * 100)}</td>
        <td class="num ${m.cambio24h >= 0 ? 'up' : 'down'}">${pct(m.cambio24h * 100)}</td>
        <td class="num">${precio(m.precio)}</td></tr>`;
    }).join('') + '</tbody></table>';
}

function renderRuta(r) {
  const meta = 14;
  const datos = r.historia.length; // días con análisis ejecutado
  let transcurridos = datos;
  if (r.sim?.desde) {
    transcurridos = Math.max(1, Math.floor((Date.now() - new Date(r.sim.desde + 'T00:00:00')) / 86400000) + 1);
  }
  const perdidos = Math.max(0, transcurridos - datos);
  const progreso = Math.min(100, (datos / meta) * 100);
  $('ruta').innerHTML = `
    <div style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-2);margin-bottom:6px;gap:12px">
        <span>Fase 1 — validar la estrategia en simulado</span>
        <span style="font-variant-numeric:tabular-nums;text-align:right">${datos}/${meta} días con datos${perdidos ? ` <span style="color:var(--red)">· ${perdidos} día${perdidos > 1 ? 's' : ''} sin ejecutar</span>` : ''}</span>
      </div>
      <div class="share-track" style="height:6px"><div class="share-fill" style="width:${progreso}%;background:linear-gradient(90deg,var(--gold-2),var(--gold))"></div></div>
    </div>
    <div class="empty" style="padding-top:14px">
      1. <b style="color:var(--text-2)">Simular</b> — ejecuta el análisis a diario y acumula historial.<br>
      2. <b style="color:var(--text-2)">Comparar</b> — la estrategia debe ganarle al hold y a BTC de forma consistente.<br>
      3. <b style="color:var(--text-2)">Decidir</b> — si convence, replicas tú las órdenes en Binance con montos pequeños.
    </div>`;
}

// Curva suave (Catmull-Rom → Bézier): las líneas rectas entre puntos se ven
// duras; la curva transmite continuidad sin inventar datos.
function pathSuave(pts, tension = 0.4) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0]}L${pts[1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? pts[i + 1];
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2;
    d += `C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// Etiquetas del eje X sin colisiones: se descartan las que quedarían pegadas.
function etiquetasX(puntos, x, minSep) {
  const out = [];
  let ultimoX = -Infinity;
  puntos.forEach((p, i) => {
    const px = x(i);
    const esUltimo = i === puntos.length - 1;
    if (px - ultimoX >= minSep || (esUltimo && px - ultimoX >= minSep * 0.6)) {
      if (esUltimo && out.length && px - out[out.length - 1].px < minSep) out.pop();
      out.push({ px, label: p.label });
      ultimoX = px;
    }
  });
  return out;
}

// GRÁFICO DE ÁREA APILADA — composición de la billetera en el tiempo.
// Muestra el total Y de qué está hecho, en vez de N líneas planas paralelas.
function stackedAreaChart({ svgId, tipId, wrapId, legendId, puntos, series, height = 260 }) {
  const svg = $(svgId);
  $(legendId).innerHTML = series.map(s =>
    `<span><i style="background:${s.color}"></i>${s.nombre}</span>`).join('');
  const W = svg.clientWidth || 1000, H = height, M = { t: 18, r: 16, b: 28, l: 52 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!puntos.length) { svg.innerHTML = ''; return; }

  // acumulado por punto (de abajo hacia arriba, en el orden de `series`)
  const pilas = puntos.map(p => {
    let acum = 0;
    return series.map(s => { const base = acum; acum += p[s.key] ?? 0; return [base, acum]; });
  });
  const maxTotal = Math.max(...pilas.map(f => f[f.length - 1]?.[1] ?? 0), 0.01);
  const hi = maxTotal * 1.08;

  const x = i => puntos.length === 1 ? M.l + (W - M.l - M.r) / 2 : M.l + (i / (puntos.length - 1)) * (W - M.l - M.r);
  const y = v => M.t + (1 - v / hi) * (H - M.t - M.b);

  let defs = '', out = '';
  // grilla horizontal sutil
  for (let i = 0; i <= 4; i++) {
    const v = (i / 4) * hi;
    out += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,0.055)" stroke-width="1"/>`;
    out += `<text x="${M.l - 9}" y="${y(v) + 4}" text-anchor="end" font-size="10.5" fill="#7C8AA5" style="font-variant-numeric:tabular-nums">${fmt(v, 0)}</text>`;
  }

  // bandas apiladas, de la más grande (abajo) a la más chica
  series.forEach((s, si) => {
    const arriba = pilas.map((f, i) => [x(i), y(f[si][1])]);
    const abajo = pilas.map((f, i) => [x(i), y(f[si][0])]).reverse();
    const gid = `g-${svgId}-${si}`;
    defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.color}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${s.color}" stop-opacity="0.12"/></linearGradient>`;
    const dTop = pathSuave(arriba);
    const dBot = pathSuave(abajo);
    if (dTop) {
      out += `<path d="${dTop} L${abajo[0][0]},${abajo[0][1]} ${dBot.replace(/^M[\d.,-]+/, '')} Z" fill="url(#${gid})" stroke="none"/>`;
      out += `<path d="${dTop}" fill="none" stroke="${s.color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>`;
    }
  });

  // línea del total, más marcada
  const totalPts = pilas.map((f, i) => [x(i), y(f[f.length - 1][1])]);
  out += `<path d="${pathSuave(totalPts)}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1" stroke-dasharray="3 3"/>`;
  const [ux, uy] = totalPts[totalPts.length - 1];
  out += `<circle cx="${ux}" cy="${uy}" r="3.5" fill="#F8FAFC"/>`;
  out += `<text x="${ux - 6}" y="${uy - 9}" text-anchor="end" font-size="11.5" font-weight="600" fill="#F8FAFC" style="font-variant-numeric:tabular-nums">${fmt(maxTotal)} USDT</text>`;

  for (const e of etiquetasX(puntos, x, 58)) {
    out += `<text x="${e.px}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#7C8AA5">${e.label}</text>`;
  }
  out += `<line class="xhair" y1="${M.t}" y2="${H - M.b}" stroke="rgba(255,255,255,0.28)" stroke-width="1" visibility="hidden"/>`;
  svg.innerHTML = `<defs>${defs}</defs>` + out;

  const tip = $(tipId), xhair = svg.querySelector('.xhair');
  svg.onmousemove = e => {
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    let best = 0, dist = Infinity;
    puntos.forEach((p, i) => { const d = Math.abs(x(i) - mx); if (d < dist) { dist = d; best = i; } });
    const p = puntos[best];
    const total = pilas[best][pilas[best].length - 1][1];
    xhair.setAttribute('x1', x(best)); xhair.setAttribute('x2', x(best));
    xhair.setAttribute('visibility', 'visible');
    tip.style.display = 'block';
    tip.innerHTML = `<div class="t-date">${p.tipLabel ?? p.label}</div>`
      + `<div class="t-row" style="border-bottom:1px solid var(--grid-line);padding-bottom:4px;margin-bottom:4px"><span><b>Total</b></span><b>${fmt(total)} USDT</b></div>`
      + series.map(s => (p[s.key] ?? 0) < 0.005 ? '' :
        `<div class="t-row"><span><i style="background:${s.color}"></i>${s.nombre}</span><b>${fmt(p[s.key])}</b></div>`).join('');
    const wrap = $(wrapId).getBoundingClientRect();
    let tx = e.clientX - wrap.left + 16;
    if (tx + tip.offsetWidth > wrap.width) tx = e.clientX - wrap.left - tip.offsetWidth - 16;
    tip.style.left = tx + 'px';
    tip.style.top = Math.max(0, e.clientY - wrap.top - 44) + 'px';
  };
  svg.onmouseleave = () => { tip.style.display = 'none'; xhair.setAttribute('visibility', 'hidden'); };
}

// Renderizador genérico de gráfico de líneas sobre SVG.
// puntos: [{ label, <serie.key>: valor|null }]
function lineChart({ svgId, tipId, wrapId, legendId, puntos, series, height = 280, yFmt = v => v.toFixed(0), tipFmt = v => v.toFixed(1) }) {
  const svg = $(svgId);
  if (legendId) $(legendId).innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${s.nombre}</span>`).join('');
  const W = svg.clientWidth || 1000, H = height, M = { t: 16, r: 28, b: 30, l: 56 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!puntos.length) { svg.innerHTML = ''; return; }

  const vals = puntos.flatMap(p => series.map(s => p[s.key]).filter(v => v != null));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 0.5) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;

  const x = i => puntos.length === 1 ? (M.l + (W - M.l - M.r) / 2) : M.l + (i / (puntos.length - 1)) * (W - M.l - M.r);
  const y = v => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);

  let out = '';
  for (let i = 0; i <= 4; i++) {
    const v = lo + (i / 4) * (hi - lo);
    out += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
    out += `<text x="${M.l - 9}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#7C8AA5" style="font-variant-numeric:tabular-nums">${yFmt(v)}</text>`;
  }
  for (const e of etiquetasX(puntos, x, 58)) {
    out += `<text x="${e.px}" y="${H - 9}" text-anchor="middle" font-size="10.5" fill="#7C8AA5">${e.label}</text>`;
  }

  for (const s of series) {
    const pts = puntos.map((p, i) => p[s.key] == null ? null : [x(i), y(p[s.key])]).filter(Boolean);
    if (!pts.length) continue;
    if (pts.length > 1) {
      out += `<path d="${pathSuave(pts)}" fill="none" stroke="${s.color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    // marcadores: series nuevas (pocos puntos) se marcan enteras; las largas
    // marcan su INICIO (punto de entrada) y su último valor.
    const marcas = pts.length <= 8 ? pts : [pts[0], pts[pts.length - 1]];
    for (const [px, py] of marcas) {
      out += `<circle cx="${px}" cy="${py}" r="4" fill="${s.color}" stroke="#0F172A" stroke-width="1.75"/>`;
    }
    // si la serie parte después del inicio del gráfico, es una posición nueva:
    // se marca su entrada con un anillo para que se distinga a simple vista
    const primeraIdx = puntos.findIndex(p => p[s.key] != null);
    if (primeraIdx > 0 && pts.length > 1) {
      out += `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="7" fill="none" stroke="${s.color}" stroke-width="1.5" opacity="0.6"/>`;
    }
  }
  out += `<line class="xhair" y1="${M.t}" y2="${H - M.b}" stroke="rgba(255,255,255,0.25)" stroke-width="1" visibility="hidden"/>`;
  svg.innerHTML = out;

  const tip = $(tipId), xhair = svg.querySelector('.xhair');
  svg.onmousemove = e => {
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    let best = 0, dist = Infinity;
    puntos.forEach((p, i) => { const d = Math.abs(x(i) - mx); if (d < dist) { dist = d; best = i; } });
    const p = puntos[best];
    xhair.setAttribute('x1', x(best)); xhair.setAttribute('x2', x(best));
    xhair.setAttribute('visibility', 'visible');
    tip.style.display = 'block';
    tip.innerHTML = `<div class="t-date">${p.tipLabel ?? p.label}</div>` + series.map(s => p[s.key] == null ? '' :
      `<div class="t-row"><span><i style="background:${s.color}"></i>${s.nombre.split(' (')[0]}</span><b>${tipFmt(p[s.key])}</b></div>`).join('');
    const wrap = $(wrapId).getBoundingClientRect();
    let tx = e.clientX - wrap.left + 16;
    if (tx + tip.offsetWidth > wrap.width) tx = e.clientX - wrap.left - tip.offsetWidth - 16;
    tip.style.left = tx + 'px';
    tip.style.top = Math.max(0, e.clientY - wrap.top - 44) + 'px';
  };
  svg.onmouseleave = () => { tip.style.display = 'none'; xhair.setAttribute('visibility', 'hidden'); };
}

// Gráfico 1: índice base 100 (estrategia vs hold vs BTC), un punto por día.
function renderChart(historia) {
  const base = {};
  const puntos = historia.map(h => {
    const fila = { label: h.fecha.slice(5), tipLabel: h.fecha };
    for (const s of SERIES) {
      const v = h[s.key];
      if (v == null || isNaN(v)) { fila[s.key] = null; continue; }
      if (base[s.key] == null) base[s.key] = v;
      fila[s.key] = (v / base[s.key]) * 100;
    }
    return fila;
  });
  lineChart({ svgId: 'chart', tipId: 'tooltip', wrapId: 'chartwrap', legendId: 'legend', puntos, series: SERIES });
}

// Gráficos separados por billetera: una línea de color por cada cripto.
const PALETA = ['#F59E0B', '#A78BFA', '#2DD4BF', '#60A5FA', '#F472B6', '#34D399', '#FBBF24', '#F87171', '#C084FC', '#94A3B8'];
const _colores = new Map();
function colorDe(asset) {
  if (!_colores.has(asset)) _colores.set(asset, PALETA[_colores.size % PALETA.length]);
  return _colores.get(asset);
}

// Fecha YYYY-MM-DD en hora local del navegador (coherente con el motor).
function diaLocal(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderWalletCharts(snapshots) {
  snapshots = (snapshots || []).filter(s => s.sim && typeof s.sim === 'object').slice(-120);
  const varios_dias = new Set(snapshots.map(s => diaLocal(s.ts))).size > 1;
  const etiquetas = snapshots.map(s => {
    const hora = new Date(s.ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    return { label: varios_dias ? diaLocal(s.ts).slice(5) : hora, tip: `${diaLocal(s.ts)} ${hora}` };
  });

  const chartDe = (key, svgId, tipId, wrapId, legendId) => {
    const conDatos = snapshots.filter(s => s[key]);
    if (!conDatos.length) { $(svgId).innerHTML = ''; $(legendId).innerHTML = ''; return; }
    const ultimo = conDatos[conDatos.length - 1][key].activos;
    const union = new Set();
    conDatos.forEach(s => Object.keys(s[key].activos).forEach(a => union.add(a)));
    const activos = [...union]
      .sort((a, b) => (ultimo[b] ?? 0) - (ultimo[a] ?? 0))
      .slice(0, 6);
    const puntos = snapshots.map((s, i) => {
      const p = { label: etiquetas[i].label, tipLabel: etiquetas[i].tip };
      for (const a of activos) p[a] = s[key]?.activos?.[a] ?? null;
      return p;
    });
    stackedAreaChart({
      svgId, tipId, wrapId, legendId,
      puntos,
      // de mayor a menor: la base de la pila es la posición más grande
      series: activos.map(a => ({ key: a, nombre: a, color: colorDe(a) })),
      height: 250,
    });
  };

  // la real primero para que sus criptos fijen sus colores y se repitan igual en la ficticia
  chartDe('real', 'chartReal', 'tooltipReal', 'chartwrapReal', 'legendReal');
  chartDe('sim', 'chartSim', 'tooltipSim', 'chartwrapSim', 'legendSim');
}

// Mercado real: criptos principales, 7 días, base 100 (datos en vivo de Binance).
const MAJOR_COLORS = { BTC: '#F59E0B', ETH: '#A78BFA', BNB: '#FBBF24', SOL: '#F472B6', XRP: '#60A5FA' };
let _mercadoCache = null;

function renderMarketChart(series) {
  if (!series) return;
  _mercadoCache = series;
  const nombres = Object.keys(series);
  if (!nombres.length) return;
  const n = Math.min(...nombres.map(k => series[k].length));
  if (!n) return;
  const puntos = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(series[nombres[0]][i].ts);
    const p = {
      label: d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }),
      tipLabel: d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    };
    for (const k of nombres) p[k] = (series[k][i].close / series[k][0].close) * 100;
    puntos.push(p);
  }
  lineChart({
    svgId: 'chartMkt', tipId: 'tooltipMkt', wrapId: 'chartwrapMkt', legendId: 'legendMkt',
    puntos,
    series: nombres.map(k => ({ key: k, nombre: k, color: MAJOR_COLORS[k] ?? '#94A3B8' })),
    height: 260,
    yFmt: v => v.toFixed(1), tipFmt: v => v.toFixed(2),
  });
}

async function cargarMercado() {
  try {
    const series = await (await fetch('/api/market-history')).json();
    if (!series.error) renderMarketChart(series);
  } catch { /* sin red: se reintenta en el próximo refresco */ }
}

// Formatea "2026-08-18" o "2026-08-18T16:44" como fecha legible (con hora si la trae).
function fechaLegible(s) {
  if (!s) return '';
  if (!s.includes('T')) return s;
  const d = new Date(s);
  return `${diaLocal(d)} ${d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderAll(r) {
  const conn = $('conn');
  // hora del último dato de precios: las cripto se mueven minuto a minuto
  const horaDatos = r.generadoA
    ? ` · datos de las ${new Date(r.generadoA).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`
    : '';
  let texto, clase = '';
  if (r.conectadoBinance && !r.realError) { texto = 'Binance conectado vía API (solo lectura)' + horaDatos; clase = ' ok'; }
  else if (r.realError) texto = 'Error leyendo Binance: ' + r.realError;
  else if (r.real && r.real.fuente === 'snapshot') {
    const base = r.real.actualizado.includes('T') ? r.real.actualizado : r.real.actualizado + 'T00:00:00';
    const diasSnap = Math.floor((Date.now() - new Date(base)) / 86400000);
    if (diasSnap >= 3) {
      texto = `Snapshot de Binance de hace ${diasSnap} días — si compraste o vendiste, pídeme actualizarlo` + horaDatos;
      clase = ' warn';
    } else {
      texto = `Snapshot del ${fechaLegible(r.real.actualizado)}${horaDatos}`;
      clase = ' ok';
    }
  } else texto = 'Modo 100% simulado — sin conexión a wallet real' + horaDatos;
  $('connText').textContent = texto;
  conn.className = 'status' + clase;
  renderSalaControl(r);
  renderWallets(r);
  renderRecos(r);
  renderPosiciones(r.posiciones);
  renderBannerAlertas(r.posiciones);
  renderSleeveRendimiento(r.sleeveRendimiento);
  renderRegistroAuto(r.movimientos, r.alertas, r.cierres);
  cargarOfertas();
  cargarAprendizaje();
  // Estas dos pegan a Binance (velas y precios sueltos), así que van sin await:
  // que tarden no debe frenar el pintado del resto del dashboard.
  cargarBrecha();
  cargarSeguimiento();
  cargarWatchlist();
  renderMovimientos(r.movimientos);
  renderMercado(r);
  renderRuta(r);
  renderChart(r.historia);
  renderWalletCharts(r.snapshots);
  cargarEstadoMotor();
  cargarRadar24();
}

// RADAR 24 H. Lo que se movió hoy entre las monedas de más volumen, y cuánto
// puede moverse mañana.
//
// NO tiene columna de dirección a propósito. Se midió con 1.000 velas horarias
// de las 13 monedas de mayor volumen: momentum 6h acierta 48,3%, momentum 24h
// 50,0%, posición en el rango 51,5% — y comprar cualquier cosa al azar, 51,1%.
// Ninguna le gana al azar. Una flecha de "va a subir" sería un número inventado
// con cara de dato, y el riesgo no es que falle: es que se le crea.
//
// Lo que sí está calibrado es la MAGNITUD: ±1σ contiene el 68,5% de los
// movimientos reales a 24 h (teórico 68%, n=2.015).
async function cargarRadar24() {
  const el = $('mercado24');
  if (!el) return;
  try {
    const r = await (await fetch('/api/radar24')).json();
    if (!r.filas?.length) { el.className = 'empty'; el.textContent = 'Sin datos.'; return; }
    el.className = '';

    const filas = r.filas.map(f => {
      const rec = f.sinDatos
        ? '<span class="mut">—</span>'
        : `<span class="recorrido"><b>±${fmt(f.recorridoPct, 1)}%</b><span>±${fmt(f.recorridoUSDT, 2)}</span></span>`;
      const rango = f.posicionRango == null
        ? '<span class="mut">—</span>'
        : `<div class="rango24" title="el precio está al ${f.posicionRango}% del rango de las últimas 24 h (0 = mínimo, 100 = máximo)"><i style="left:${f.posicionRango}%"></i></div>`;
      const banda = f.sinDatos ? '<span class="mut">—</span>'
        : `<span class="mut" style="font-variant-numeric:tabular-nums">${precio(f.rangoMin)} – ${precio(f.rangoMax)}</span>`;
      return `<tr>
        <td><b>${f.asset}</b>${flechaTendencia(f.cambio24hPct, { conNumero: false, motivo: `${f.asset}: ${pct(f.cambio24hPct)} en 24 h` })}</td>
        <td class="num ${f.cambio24hPct >= 0 ? 'up' : 'down'}">${pct(f.cambio24hPct)}</td>
        <td class="num">${fmt(f.volumen24hM, 0)} M</td>
        <td class="num">${rec}</td>
        <td>${rango}</td>
        <td class="num">${banda}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `<table><thead><tr>
        <th>Activo</th><th class="num">24 h</th><th class="num">Volumen</th>
        <th class="num" title="cuánto se mueve típicamente en 24 h, hacia arriba o hacia abajo, y cuánto es eso sobre una posición de ${r.montoReferenciaUSDT} USDT">Recorrido ±24 h</th>
        <th title="dónde está el precio dentro del rango del día">Rango del día</th>
        <th class="num" title="banda donde cae el precio 2 de cada 3 veces">Zona probable</th>
      </tr></thead><tbody>${filas}</tbody></table>
      <p class="radar24-pie"><b>Qué es el recorrido:</b> cuánto se mueve el activo en 24 h,
      arriba <i>o</i> abajo — es la amplitud, no una dirección. La zona probable acierta
      2 de cada 3 veces; el tercio restante se sale, y en cripto se sale más lejos de lo
      que la estadística supone.<br>
      <b>No hay columna de "va a subir" porque se midió y no existe:</b> ninguna señal
      probada a 24 h le gana a comprar al azar (51,1%). Lo que sirve este radar es para
      dimensionar — un activo que se mueve ±19% no admite el mismo tamaño que uno de ±1,3%.</p>`;
  } catch {
    el.className = 'empty';
    el.textContent = 'No se pudo cargar el radar de 24 h.';
  }
}

// SALUD DEL MOTOR. El `● en vivo` de al lado es el WebSocket del NAVEGADOR:
// puede estar verde con el motor muerto hace horas. Esto dice si el motor —el
// que ejecuta los stops— realmente corrió, y con qué versión de sus reglas.
async function cargarEstadoMotor() {
  const el = $('motorEstado');
  if (!el) return;
  try {
    const e = await (await fetch('/api/estado')).json();
    const hace = e.haceMin < 1 ? 'recién'
      : e.haceMin < 60 ? `hace ${Math.round(e.haceMin)} min`
      : `hace ${(e.haceMin / 60).toFixed(1)} h`;
    const estado = e.congelado ? 'congelado' : e.sano ? 'al día' : 'dormido';
    el.className = 'motor-estado ' + (e.congelado ? 'warn' : e.sano ? 'ok' : 'mal');
    el.innerHTML = `<span class="dot"></span>motor ${estado} · vigiló ${hace}`
      + `<span class="motor-version" title="sello de las reglas con que decide: cambia solo si cambia un parámetro">${e.version}</span>`;
    el.title = e.congelado
      ? `Ejecución congelada: ${e.motivoCongelado ?? 'sin motivo'}`
      : `Última vigilancia ${new Date(e.ultimaVigilancia).toLocaleString('es-CL')} · revisa cada ${e.intervaloMin} min`;
  } catch {
    el.className = 'motor-estado mal';
    el.innerHTML = '<span class="dot"></span>motor sin respuesta';
  }
}

async function cargarEstado() {
  try {
    const st = await (await fetch('/api/state')).json();
    if (st.lastRun) renderAll({ ...st.lastRun, historia: st.historia, snapshots: st.snapshots, movimientos: st.movimientos, alertas: st.alertas });
  } catch { /* primer uso sin datos */ }
}

async function accion(botonId, labelId, textoEspera, textoNormal, url, tambienMercado) {
  const btn = $(botonId), otro = botonId === 'run' ? $('refresh') : $('run');
  btn.disabled = true; otro.disabled = true;
  $(labelId).textContent = textoEspera;
  try {
    const data = await (await fetch(url, { method: 'POST' })).json();
    if (data.error) alert('Error: ' + data.error);
    else {
      renderAll(data);
      if (tambienMercado) cargarMercado();
    }
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false; otro.disabled = false;
    $(labelId).textContent = textoNormal;
  }
}

$('run').onclick = () => accion('run', 'runLabel', 'Analizando mercado…', 'Ejecutar análisis', '/api/run', true);
$('refresh').onclick = () => accion('refresh', 'refreshLabel', 'Actualizando…', 'Actualizar mercado', '/api/refresh', true);

addEventListener('resize', () => {
  if (!window.__r) return;
  renderChart(window.__r.historia);
  renderWalletCharts(window.__r.snapshots);
});
const _renderAll = renderAll;
renderAll = r => { window.__r = r; _renderAll(r); };

// Tarjetas colapsables: clic en el título pliega/despliega; el estado se recuerda.
function setupCollapse() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('kw-collapsed') || '{}'); } catch { /* estado corrupto: ignorar */ }
  document.querySelectorAll('.card').forEach(card => {
    const h2 = card.querySelector('h2');
    if (!h2 || card.dataset.collapsible) return;
    card.dataset.collapsible = '1';

    const body = document.createElement('div');
    body.className = 'card-body';
    const inner = document.createElement('div');
    inner.className = 'card-body-inner';
    body.appendChild(inner);
    while (h2.nextSibling) inner.appendChild(h2.nextSibling);
    card.appendChild(body);

    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('class', 'chev');
    chev.setAttribute('width', '16'); chev.setAttribute('height', '16');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('fill', 'none'); chev.setAttribute('stroke', 'currentColor');
    chev.setAttribute('stroke-width', '2'); chev.setAttribute('stroke-linecap', 'round'); chev.setAttribute('stroke-linejoin', 'round');
    chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML = '<path d="m6 9 6 6 6-6"/>';
    h2.appendChild(chev);

    h2.classList.add('toggle');
    h2.setAttribute('role', 'button');
    h2.tabIndex = 0;
    const id = h2.id || card.className;

    // `height` no transiciona hacia `auto`: los dos extremos tienen que ser
    // números. El alto natural se mide soltando la card un instante — el
    // `scrollHeight` del interior miente cuando adentro hay listas con scroll
    // propio (medía 126 px de una card de 597). Al terminar de expandir se
    // libera a '' para que la card siga creciendo con los precios en vivo.
    const aplicar = (colapsada, animar = false) => {
      const marcar = () => {
        card.classList.toggle('collapsed', colapsada);
        h2.setAttribute('aria-expanded', String(!colapsada));
      };
      if (!animar) {
        marcar();
        body.style.height = colapsada ? '0px' : '';
        return;
      }
      const desde = body.getBoundingClientRect().height;
      card.classList.remove('collapsed');   // suelta para medir el alto real
      body.style.height = '';
      const natural = body.getBoundingClientRect().height;
      marcar();
      body.style.height = `${desde}px`;
      void body.offsetHeight;               // reflow: fija el punto de partida
      body.style.height = colapsada ? '0px' : `${natural}px`;
      if (colapsada) return;
      body.addEventListener('transitionend', function libera(e) {
        if (e.propertyName !== 'height') return;
        body.style.height = '';
        body.removeEventListener('transitionend', libera);
      });
    };
    // En móvil el dashboard medía 10 pantallas de scroll: las cards de consulta
    // arrancan colapsadas la PRIMERA vez (después manda lo que Jorge elija).
    const COLAPSADAS_EN_MOVIL = ['h-mkt', 'h-hist', 'h-plan', 'h-chart', 'h-mercado', 'h-evo-real', 'h-evo-sim'];
    const primeraVez = !(id in saved);
    const porDefecto = primeraVez && innerWidth < 768 && COLAPSADAS_EN_MOVIL.includes(id);
    aplicar(Boolean(saved[id] ?? porDefecto));

    const alternar = () => {
      const colapsada = !card.classList.contains('collapsed');
      aplicar(colapsada, true);   // solo el clic anima; el estado inicial no
      saved[id] = colapsada;
      localStorage.setItem('kw-collapsed', JSON.stringify(saved));
    };
    h2.addEventListener('click', alternar);
    h2.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); }
    });
  });
}

addEventListener('resize', () => {
  if (_mercadoCache) renderMarketChart(_mercadoCache);
  ajustarPiesDeLista();
});

// ---------------------------------------------------------------------------
// Precios en TIEMPO REAL vía WebSocket de Binance (miniTicker por símbolo).
// Actualiza los valores de ambas billeteras al ritmo que dicta Binance,
// sin tocar los archivos de datos (los registros siguen siendo por botón).
// ---------------------------------------------------------------------------
let _ws = null;
let _wsAssets = '';
const _livePrices = {};
let _repintadoPendiente = false;

function activosEnJuego() {
  const r = window.__r;
  if (!r) return [];
  const set = new Set();
  r.real?.detalle?.forEach(d => { if (d.asset !== 'USDT') set.add(d.asset); });
  r.sim?.holdings?.forEach(h => { if (h.asset !== 'USDT') set.add(h.asset); });
  return [...set];
}

function aplicarPreciosVivos() {
  const r = window.__r;
  if (!r) return;
  if (r.real) {
    for (const d of r.real.detalle) {
      const p = _livePrices[d.asset + 'USDT'];
      if (p && d.asset !== 'USDT') d.usdt = d.qty * p;
    }
    r.real.total = r.real.detalle.reduce((a, d) => a + d.usdt, 0);
  }
  if (r.sim) {
    for (const h of r.sim.holdings) {
      const p = _livePrices[h.asset + 'USDT'];
      if (p) h.usdt = h.qty * p;
    }
    r.sim.valor = r.sim.cash + r.sim.holdings.reduce((a, h) => a + h.usdt, 0);
    r.sim.rendimientoPct = (r.sim.valor / r.sim.capitalInicial - 1) * 100;
    // Los bolsillos también: antes solo se recalculaba el total y las tarjetas
    // de bolsillo se quedaban con la foto del servidor. Con el precio moviéndose
    // el encabezado decía 95,06 y los bolsillos sumaban 94,75 — el desfase
    // crecía con el mercado y no se notaba porque no había con qué compararlo.
    const b = r.sim.bolsillos;
    if (b) {
      // las claves salen de lo que el motor declaró, no de una lista fija acá
      const claves = (r.sim.bolsillosDetalle ?? []).map(x => x.clave).filter(k => k !== 'reserva');
      const porBolsillo = Object.fromEntries(claves.map(k => [k, 0]));
      for (const h of r.sim.holdings) if (h.bolsillo in porBolsillo) porBolsillo[h.bolsillo] += h.usdt;
      Object.assign(b, porBolsillo, { reserva: r.sim.cash });
      // y el detalle también, que es lo que el render recorre
      if (r.sim.bolsillosDetalle) {
        for (const x of r.sim.bolsillosDetalle) {
          x.usdt = x.clave === 'reserva' ? r.sim.cash : (porBolsillo[x.clave] ?? 0);
        }
      }
      // el techo del sleeve es un % del total, así que se mueve con él
      b.sleevePresupuesto = r.sim.valor * (b.sleeveLimitePct / 100);
      b.sleeveOcupacionPct = r.sim.valor > 0 ? (b.sleeve / r.sim.valor) * 100 : 0;
      b.sleeveExcedente = Math.max(0, b.sleeve - b.sleevePresupuesto);
      b.sleeveDisponible = Math.max(0, b.sleevePresupuesto - b.sleeve);
    }
  }
  // reevaluar las posiciones con el precio en vivo: la alerta es instantánea
  if (r.posiciones?.length) {
    for (const p of r.posiciones) {
      const precio = _livePrices[p.asset + 'USDT'];
      if (!precio) continue;
      p.precio = precio;
      p.pnlPct = (precio / p.entrada - 1) * 100;
      p.pnlUSDT = p.qty * (precio - p.entrada);
      p.valorUSDT = p.qty * precio;
      p.progreso = Math.max(0, Math.min(1, (precio - p.limite) / (p.objetivo - p.limite)));
      p.senal = precio >= p.objetivo ? 'cruzo-objetivo'
        : precio <= p.limite ? 'cruzo-limite'
        : p.pnlPct >= p.objetivoPct * 0.7 ? 'cerca-objetivo'
        : p.pnlPct <= p.limitePct * 0.7 ? 'cerca-limite' : 'ok';
    }
    renderPosiciones(r.posiciones);
    renderBannerAlertas(r.posiciones);
  }
  renderSalaControl(r);
  renderWallets(r);
}

function programarRepintado() {
  if (_repintadoPendiente) return;
  _repintadoPendiente = true;
  setTimeout(() => { _repintadoPendiente = false; aplicarPreciosVivos(); }, 1000);
}

function conectarStream() {
  const assets = activosEnJuego();
  const clave = assets.sort().join(',');
  if (!assets.length || clave === _wsAssets) return;
  _wsAssets = clave;
  if (_ws) { _ws.onclose = null; _ws.close(); }
  const streams = assets.map(a => a.toLowerCase() + 'usdt@miniTicker').join('/');
  _ws = new WebSocket('wss://stream.binance.com:9443/stream?streams=' + streams);
  _ws.onopen = () => { $('liveBadge').style.display = 'inline'; };
  _ws.onmessage = e => {
    const m = JSON.parse(e.data).data;
    if (m?.s && m?.c) {
      _livePrices[m.s] = parseFloat(m.c);
      // actualizar la tendencia 24h en vivo (flecha ▲/▼ por moneda)
      const asset = m.s.slice(0, -4);
      const cambio = window.__r?.cambios24h?.[asset];
      if (cambio && m.o) cambio.pct = (parseFloat(m.c) / parseFloat(m.o) - 1) * 100;
      programarRepintado();
    }
  };
  _ws.onclose = () => {
    $('liveBadge').style.display = 'none';
    _wsAssets = '';
    setTimeout(conectarStream, 5000); // reconexión automática
  };
}

// reconectar el stream cada vez que cambian los datos (p. ej. tras una jugada)
const _renderAll2 = renderAll;
renderAll = r => { _renderAll2(r); conectarStream(); };

// Tooltip propio para las flechas de tendencia (el nativo del navegador es
// lento y poco visible). Aparece al instante al pasar el mouse o al tocar.
const _trendTip = document.createElement('div');
_trendTip.className = 'tooltip trend-tip';
document.body.appendChild(_trendTip);

function mostrarTrendTip(el) {
  _trendTip.textContent = el.dataset.info;
  _trendTip.style.display = 'block';
  const r = el.getBoundingClientRect();
  const w = Math.min(300, innerWidth - 24);
  _trendTip.style.maxWidth = w + 'px';
  let x = r.left;
  if (x + _trendTip.offsetWidth > innerWidth - 12) x = innerWidth - _trendTip.offsetWidth - 12;
  _trendTip.style.left = Math.max(12, x) + 'px';
  const abajo = r.bottom + 8;
  _trendTip.style.top = (abajo + _trendTip.offsetHeight > innerHeight - 8
    ? r.top - _trendTip.offsetHeight - 8
    : abajo) + 'px';
}

document.addEventListener('mouseover', e => {
  const t = e.target.closest?.('.trend');
  if (t?.dataset.info) mostrarTrendTip(t);
  else _trendTip.style.display = 'none';
});
document.addEventListener('click', e => {
  const t = e.target.closest?.('.trend');
  if (t?.dataset.info) { e.stopPropagation(); mostrarTrendTip(t); }
  else _trendTip.style.display = 'none';
}, true);
addEventListener('scroll', () => { _trendTip.style.display = 'none'; }, true);

setupCollapse();
cargarEstado();
cargarMercado();

// --- Motor de aprendizaje ---------------------------------------------------
// Va por su propio endpoint (lee la bitácora y el plan, no solo el estado), así
// que no viaja en cada refresco de precios: se pide una vez por render.
let _apreCache = null;

async function cargarAprendizaje() {
  const cont = $('aprendizaje');
  if (!cont) return;
  try {
    const inf = await fetch('/api/aprendizaje').then(x => x.json());
    _apreCache = inf;
    renderAprendizaje(inf);
  } catch (e) {
    cont.innerHTML = `<div class="empty">No se pudo leer el motor de aprendizaje: ${e.message}</div>`;
  }
}

function renderAprendizaje(inf) {
  const cont = $('aprendizaje');
  const p = inf.patrones, ev = inf.evolucion;
  const hip = inf.hipotesis ?? [];
  const confirmadas = hip.filter(h => h.estado === 'confirmada' || h.estado === 'respaldada').length;
  $('apreTag').textContent = `${confirmadas}/${hip.length} hipótesis con respaldo · ${p.jugadas} jugada(s)`;

  // La calidad de la muestra va PRIMERO: cualquier patrón de abajo se lee con
  // esto en mente, o se convierte en superstición.
  const muestra = `<div class="apre-muestra ${p.calidad.nivel}">
    <b>Muestra:</b> ${p.calidad.nota}${p.jugadas ? ` · contexto capturado en ${p.conContexto}/${p.jugadas}, veredicto en ${p.conVeredicto}/${p.jugadas}` : ''}
  </div>`;

  const orden = { confirmada: 0, respaldada: 1, abierta: 2, refutada: 3 };
  const hipotesis = `<div class="apre-seccion"><h3>Hipótesis del proyecto</h3>
    ${[...hip].sort((a, b) => (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9)).map(h => `
      <div class="hip">
        <span class="hip-estado ${h.estado}">${h.estado}</span>
        <span class="hip-texto">${h.enunciado}</span>
        <span class="hip-ev" title="evidencia a favor / en contra">${h.evidencia}✓ ${h.contra}✗</span>
      </div>`).join('')}
  </div>`;

  // Lo más accionable de todo: lo que creemos respaldado y el motor no aplica.
  const deriva = inf.deriva?.length ? `<div class="apre-deriva">
    <b>⚠ Deriva — lo que creemos pero el motor todavía no hace</b>
    <ul>${inf.deriva.map(d => `<li>${d.enunciado}<br><span class="d-nota">falta: ${d.esperada ?? 'implementación'}</span></li>`).join('')}</ul>
  </div>` : '';

  const pendientes = inf.pendientes?.length ? `<div class="apre-seccion">
    <h3>Veredictos pendientes</h3>
    <div class="apre-pend">${inf.pendientes.length} jugada(s) cerrada(s) sin lección registrada:
      ${inf.pendientes.map(v => `<b>${v.asset}</b> (${pct(v.pnlPct)})`).join(' · ')}.
      Sin el veredicto, el resultado queda sin el "por qué".</div>
  </div>` : '';

  const segmentos = p.segmentos?.length ? `<div class="apre-seccion">
    <h3>Patrones por segmento</h3>
    <table class="d-tabla"><thead><tr><th>Segmento</th><th>Grupo</th><th class="num">n</th><th class="num">Acierto</th><th class="num">Resultado</th></tr></thead>
    <tbody>${p.segmentos.flatMap(s => s.filas.map((f, i) => `<tr>
      <th scope="row">${i === 0 ? s.nombre : ''}</th>
      <td>${f.grupo}</td>
      <td class="num">${f.n}</td>
      <td class="num">${f.aciertoPct.toFixed(0)}%</td>
      <td class="num ${f.resultadoProm >= 0 ? 'up' : 'down'}">${pct(f.resultadoProm)}</td>
    </tr>`)).join('')}</tbody></table>
  </div>` : '';

  const porTipo = {};
  for (const e of ev.sistema ?? []) porTipo[e.tipo] = (porTipo[e.tipo] ?? 0) + 1;
  const evolucion = `<div class="apre-seccion"><h3>Evolución del proyecto</h3>
    <div class="apre-pistas">
      <div class="apre-pista"><b>${ev.trading?.length ?? 0}</b><span>día(s) de trading medidos</span></div>
      <div class="apre-pista"><b>${ev.modelo?.length ?? 0}</b><span>versión(es) del modelo</span></div>
      <div class="apre-pista"><b>${ev.sistema?.length ?? 0}</b><span>hitos del sistema</span></div>
    </div>
    <div class="apre-pend" style="margin-top:10px">Hitos por tipo: ${Object.entries(porTipo).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}.
    Movimientos por categoría: ${Object.entries(inf.movimientosPorCategoria ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}.</div>
  </div>`;

  // muestra y deriva van a ancho completo (son la advertencia y lo accionable);
  // el resto se reparte en dos columnas
  cont.innerHTML = muestra + deriva +
    `<div class="apre-cols"><div>${hipotesis}</div><div>${segmentos}${pendientes}${evolucion}</div></div>`;
}


// --- Ofertas vigentes -------------------------------------------------------
// La MISMA oferta que llega a Telegram. Vive en el estado del proyecto, así que
// se puede tomar desde donde sea y sobrevive a un reinicio del servidor.

async function cargarOfertas() {
  const card = $('cardOfertas'), cont = $('ofertas');
  if (!cont) return;
  try {
    const { ofertas } = await fetch('/api/ofertas').then(x => x.json());
    if (!ofertas?.length) { card.hidden = true; return; }
    card.hidden = false;
    $('ofertaTag').textContent = `${ofertas.length} vigente(s) · también en Telegram`;
    cont.innerHTML = ofertas.map(o => {
      const c = o.contexto ?? {};
      const riesgo = o.montoUSDT * Math.abs(o.limitePct) / 100;
      const min = Math.max(0, Math.round((Date.parse(o.vence) - Date.now()) / 60000));
      return `<div class="oferta">
        <div class="oferta-top">
          <b>${o.asset}</b>
          ${c.senalNombre ? `<span class="badge-senal">${c.senalNombre}</span>` : ''}
          <span class="tipo">${c.score != null ? `confianza ${c.score}/100 · ` : ''}RSI ${c.rsi14d ?? '—'} · ${c.regimen ?? '—'}</span>
          <span class="tipo" style="margin-left:auto">vence en ${min} min</span>
        </div>
        <div class="oferta-datos">
          <span>entrada <b>${fmt(o.montoUSDT)}</b> USDT</span>
          <span>stop <b class="down">${o.limitePct}%</b></span>
          <span>objetivo <b class="up">+${o.objetivoPct}%</b>${c.tipoObjetivo === 'estructural' ? ' <span class="d-nota">techo 30d</span>' : c.tipoObjetivo === 'proyeccion' ? ' <span class="d-nota">proyectado</span>' : ''}</span>
          ${c.riesgoBeneficio ? `<span>R:B <b>${c.riesgoBeneficio}</b> a 1</span>` : ''}
          <span>en riesgo <b class="down">−${fmt(c.riesgoRealUSDT ?? riesgo)}</b> USDT${c.riesgoObjetivoUSDT ? ` <span class="d-nota">objetivo ${fmt(c.riesgoObjetivoUSDT)}</span>` : ''}</span>
          ${c.acotadoPor === 'minimo-de-orden' ? `<span class="d-nota" style="flex-basis:100%">⚠ el mínimo de orden de Binance (5 USDT) obliga a arriesgar más que el objetivo: el monto ideal era ${fmt(c.montoIdealUSDT)} USDT</span>` : ''}
          ${c.acotadoPor === 'techo-de-concentracion' ? `<span class="d-nota" style="flex-basis:100%">acotada por el techo de concentración: el monto ideal era ${fmt(c.montoIdealUSDT)} USDT</span>` : ''}
          ${c.senalLectura ? `<span class="d-nota" style="flex-basis:100%">${c.senalLectura}</span>` : ''}
          <span class="d-nota">precio de referencia ${precio(o.precioAlCrear)} · tolerancia ${o.driftMaxPct}%</span>
        </div>
        <div class="oferta-acciones">
          <button class="btn-aprobar" data-tomar="${o.id}">✓ Aprobar ${fmt(o.montoUSDT)} USDT</button>
          <button class="btn-vigilar-oferta" data-vigilar-oferta="${o.id}" title="Ni sí ni no: pasa a la watchlist y vuelve sola cuando su condición se cumpla">◉ Vigilar</button>
          <button class="btn-rechazar" data-descartar="${o.id}">✕ Rechazar</button>
        </div>
      </div>`;
    }).join('');
  } catch { card.hidden = true; }
}

// Tomar o descartar una oferta desde el dashboard: el origen queda registrado.
document.addEventListener('click', async e => {
  const tomar = e.target.closest('[data-tomar]')?.dataset.tomar;
  const descartar = e.target.closest('[data-descartar]')?.dataset.descartar;
  if (!tomar && !descartar) return;
  const btn = e.target.closest('button');
  btn.disabled = true;
  btn.textContent = tomar ? 'Ejecutando…' : 'Descartando…';
  try {
    const ruta = tomar ? '/api/oferta/tomar' : '/api/oferta/descartar';
    const r = await fetch(ruta, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tomar ?? descartar, origen: 'dashboard' }),
    }).then(x => x.json());
    if (r.ok === false) alert(`No se pudo: ${r.motivo ?? r.error}`);
    await cargarEstado();    // refresca todo: wallet, historial y ofertas
  } catch (err) {
    alert(`Error: ${err.message}`);
    btn.disabled = false;
  }
});
