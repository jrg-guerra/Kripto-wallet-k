// BOT DE TELEGRAM — notificaciones al móvil y consultas de SOLO LECTURA.
//
// Reglas de este módulo, en orden de importancia:
//
//   1. Solo ejecuta OFERTAS que él mismo generó, y solo si Jorge las aprueba
//      tocando el botón. NO existe comando libre tipo "compra X": eso se
//      decide en el dashboard, con los avisos de impacto delante. Los
//      criterios del motor son el filtro — no se puede aprobar algo que el
//      motor rechazó. Toda oferta vence en 15 min (precio viejo = otra cosa).
//      La billetera REAL nunca se toca: esas órdenes las hace Jorge en Binance.
//   2. Solo responde al CHAT_ID configurado. Un bot de Telegram es público:
//      cualquiera que adivine su username puede escribirle.
//   3. Usa polling (getUpdates), no webhook: el Mac sale a buscar los
//      mensajes, así que no hace falta puerto abierto, túnel ni dominio.
//   4. Nunca tumba al servidor. Si Telegram falla, se registra y se sigue:
//      quedarse sin notificación es malo, perder la vigilancia es peor.

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { congelado, congelar as congelarMotor, descongelar } from './engine.mjs';
export { congelado, descongelar };

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
const API = 'https://api.telegram.org';

function credenciales() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return null;
  const env = {};
  for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  const token = env.TELEGRAM_BOT_TOKEN, chatId = env.TELEGRAM_CHAT_ID;
  return token && chatId ? { token, chatId } : null;
}

export const telegramActivo = () => credenciales() != null;

// --- LIMPIEZA DE LA CONVERSACIÓN -------------------------------------------
//
// Se guardan los IDs de todo lo que pasa por el chat para poder dejarlo limpio
// al salir. Telegram solo permite borrar mensajes de menos de **48 horas**, así
// que lo más viejo sobrevive — se avisa cuando pasa.

// Se recuerdan los últimos, no todos: Telegram no deja borrar nada de más de
// 48 h, así que los IDs viejos son basura que solo alarga el /salir (una
// petición HTTP secuencial por ID) y crece sin techo mientras la sesión viva.
const TOPE_MENSAJES = 300;
const _mensajes = [];
const recordar = id => {
  if (!id) return;
  _mensajes.push(id);
  if (_mensajes.length > TOPE_MENSAJES) _mensajes.splice(0, _mensajes.length - TOPE_MENSAJES);
};

async function limpiarConversacion() {
  const ids = [..._mensajes].reverse();   // del más nuevo al más viejo
  _mensajes.length = 0;
  let borrados = 0, viejos = 0;
  for (const id of ids) {
    const ok = await borrarMensaje(id);
    if (ok) borrados++; else viejos++;
  }
  return { borrados, viejos };
}

// --- envío -----------------------------------------------------------------
//
// Telegram rechaza cualquier mensaje de más de 4096 caracteres: devuelve 400 y
// NO llega nada. Un /oportunidades con muchas descartadas o un /registro largo
// entraban justo en ese caso, y el fallo era invisible.
//
// Cortar a lo bruto no sirve: si el corte cae dentro de un <blockquote>, la
// etiqueta queda abierta y Telegram responde 400 "can't parse entities" — el
// mismo resultado. Así que al partir se cierra lo que quedó abierto y se reabre
// en el trozo siguiente.

const TOPE_TEXTO = 3900;   // margen sobre 4096 para las etiquetas que se cierran y reabren

// Etiquetas abiertas y sin cerrar en un fragmento, en orden de apertura.
function etiquetasAbiertas(t) {
  const pila = [];
  for (const m of t.matchAll(/<(\/?)(b|strong|i|em|u|s|code|pre|blockquote)(\s[^>]*)?>/g)) {
    if (m[1]) {
      const i = pila.findLastIndex(x => x.tag === m[2]);
      if (i >= 0) pila.splice(i, 1);
    } else pila.push({ tag: m[2], apertura: m[0] });
  }
  return pila;
}

function trozos(texto, max = TOPE_TEXTO) {
  if (texto.length <= max) return [texto];
  const partes = [];
  let resto = texto, prefijo = '';
  while (resto.length) {
    const cabe = max - prefijo.length;
    if (resto.length <= cabe) { partes.push(prefijo + resto); break; }
    // se corta en un salto de línea para no partir una ficha por la mitad
    let corte = resto.lastIndexOf('\n', cabe);
    if (corte <= 0) corte = cabe;   // una sola línea gigante: corte duro
    const trozo = prefijo + resto.slice(0, corte);
    const pend = etiquetasAbiertas(trozo);
    partes.push(trozo + pend.map(x => `</${x.tag}>`).reverse().join(''));
    prefijo = pend.map(x => x.apertura).join('');
    resto = resto.slice(corte).replace(/^\n/, '');
  }
  return partes;
}

// expuestos solo para los tests: partir mal un mensaje es un fallo silencioso
export const _trozos = (t, max) => trozos(t, max);
export const _etiquetasAbiertas = etiquetasAbiertas;

async function postMensaje(texto, extra = {}) {
  const c = credenciales();
  if (!c) return { ok: false, motivo: 'sin credenciales' };
  try {
    const res = await fetch(`${API}/bot${c.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: c.chatId, text: texto, parse_mode: 'HTML',
        disable_web_page_preview: true, ...extra,
      }),
    });
    if (!res.ok) return { ok: false, motivo: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = await res.json();
    recordar(j.result?.message_id);
    return { ok: true, messageId: j.result?.message_id };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

// El teclado o los botones van SIEMPRE en el último trozo: quedan al final de
// lo que se lee, no en la mitad.
async function enviarPartido(texto, extra = {}) {
  const ts = trozos(String(texto ?? ''));
  let r = { ok: false, motivo: 'texto vacío' };
  for (let i = 0; i < ts.length; i++) {
    r = await postMensaje(ts[i], i === ts.length - 1 ? extra : {});
    if (!r.ok) return r;
  }
  return r;
}

export const enviar = texto => enviarPartido(texto);

// Teclado permanente: botones fijos sobre el teclado del teléfono. Solo se
// muestra con sesión abierta — un botón visible antes del login revelaría qué
// puede hacer el bot.
const TECLADO = [
  ['📊 Resumen', '🎯 Posiciones'],
  ['◆ Oportunidades', '⚠️ Riesgo'],
  ['🌐 Mercado', '🚪 Salir'],
];

// Los botones del teclado mandan su texto como mensaje: se mapean a comandos.
const DESDE_TECLADO = {
  '📊 resumen': '/resumen', '🎯 posiciones': '/posiciones',
  '◆ oportunidades': '/oportunidades', '⚠️ riesgo': '/riesgo',
  '🌐 mercado': '/mercado', '🚪 salir': '/salir',
};

export const enviarConTeclado = (texto, mostrarTeclado = true) => enviarPartido(texto, {
  reply_markup: mostrarTeclado
    ? { keyboard: TECLADO, resize_keyboard: true, is_persistent: true }
    : { remove_keyboard: true },
});

// Menú nativo de Telegram: el botón "/" muestra la lista con descripciones.
export async function registrarComandos() {
  const c = credenciales();
  if (!c) return;
  const lista = [
    ['resumen', 'Todo en un mensaje'],
    ['estado', 'Marcador y alfa contra el hold'],
    ['posiciones', 'Qué tengo abierto y su distancia a los niveles'],
    ['oportunidades', 'Candidatos que pasan los criterios'],
    ['riesgo', 'Cuánto está en juego'],
    ['mercado', 'Régimen y radar'],
    ['registro', 'Lo que el motor hizo sin mí'],
    ['seguridad', 'Estado del login y la ejecución'],
    ['congelar', 'Cortar toda ejecución ya'],
    ['salir', 'Cerrar la sesión'],
  ];
  try {
    await fetch(`${API}/bot${c.token}/setMyCommands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: lista.map(([command, description]) => ({ command, description })) }),
    });
  } catch { /* cosmético */ }
}

// Mensaje con botones. `botones` es un arreglo de filas: [[{texto, dato}]]
export const enviarConBotones = (texto, botones) => enviarPartido(texto, {
  reply_markup: { inline_keyboard: botones.map(fila => fila.map(b => ({ text: b.texto, callback_data: b.dato }))) },
});

// Pide un dato con campo de entrada: `force_reply` abre el teclado y
// `input_field_placeholder` le pone etiqueta. Es lo más cercano a un formulario
// que da la API, y de paso la respuesta llega en su PROPIO mensaje — así la
// clave se puede borrar sola, sin quedar pegada a un comando.
async function pedirDato(texto, etiqueta) {
  const c = credenciales();
  if (!c) return null;
  try {
    const res = await fetch(`${API}/bot${c.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: c.chatId, text: texto, parse_mode: 'HTML',
        reply_markup: { force_reply: true, input_field_placeholder: etiqueta, selective: false },
      }),
    });
    const j = await res.json();
    recordar(j.result?.message_id);
    return j.result?.message_id ?? null;
  } catch { return null; }
}

// Reescribe un mensaje ya enviado: así una oferta aprobada deja de mostrar sus
// botones y no se puede tocar dos veces.
async function editarMensaje(messageId, texto) {
  const c = credenciales();
  if (!c) return;
  try {
    await fetch(`${API}/bot${c.token}/editMessageText`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: c.chatId, message_id: messageId, text: texto, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }),
    });
  } catch { /* cosmético: si falla, el mensaje queda con botones muertos */ }
}

// Devuelve si pudo borrarlo: Telegram rechaza los de más de 48 h.
async function borrarMensaje(messageId) {
  const c = credenciales();
  if (!c || !messageId) return false;
  try {
    const res = await fetch(`${API}/bot${c.token}/deleteMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: c.chatId, message_id: messageId }),
    });
    return res.ok;
  } catch { return false; }
}

// Quita el "reloj de carga" del botón tocado y muestra un aviso emergente.
async function responderBoton(callbackId, texto, alerta = false) {
  const c = credenciales();
  if (!c) return;
  try {
    await fetch(`${API}/bot${c.token}/answerCallbackQuery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text: texto.slice(0, 200), show_alert: alerta }),
    });
  } catch { /* no crítico */ }
}

// --- lenguaje visual -------------------------------------------------------
//
// Estilo elegido por Jorge: híbrido A+C.
//   A (ficha técnica) — los datos van en bloque monoespaciado con columnas
//     alineadas. Sobrio, denso, sin emoji decorativo.
//   C (editorial) — antes del dato, una frase que dice qué significa. El
//     número solo no comunica; "el mercado está caro" sí.
//
// Sin reglas horizontales: `blockquote` separa mejor y no ensucia. Los glifos
// se usan solo cuando cargan significado (▲▼ dirección, ◆ posición en un
// rango, semáforo de RSI). Las listas largas van en `blockquote expandable`
// para que el mensaje no sea un muro.

const f = (n, d = 2) => n == null ? '—' : Number(n).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const signo = n => (n >= 0 ? '+' : '') + f(n);
const pct = n => (n >= 0 ? '+' : '') + f(n) + '%';
const precio = p => f(p, p < 1 ? 6 : 2);
// 24 h: 'p. m.' ocupa espacio y en un mensaje compacto se lee peor
const hora = ts => new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const flecha = v => v >= 0 ? '▲' : '▼';
// Todo lo que se interpola en un mensaje con parse_mode HTML se escapa: un
// nombre de activo con < o & rompería el mensaje entero (Telegram lo rechaza).
const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Cortar el texto ISO (`ts.slice(11,16)`) devuelve UTC: en Chile son 4 horas de
// diferencia, así que un corte de las 20:13 se mostraba como 00:13 y con fecha
// del día siguiente. Todo lo que ve Jorge va en hora local, igual que el resto
// del proyecto (fechaLocal en el motor).
const fechaHoraLocal = iso => new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Encabezado: título y, debajo, el contexto en cursiva.
const titulo = (t, sub) => `<b>${t}</b>` + (sub ? `\n<i>${sub}</i>` : '');

// Ficha de datos con columnas alineadas (estilo A).
const ficha = filas => '<pre>' + filas.filter(Boolean)
  .map(([k, v]) => `${String(k).padEnd(11)}${v}`).join('\n') + '</pre>';

// Contenedor con barra vertical, para destacar sin separadores crudos.
const cita = txt => `<blockquote>${txt}</blockquote>`;

// Lista larga colapsada: se abre con un toque.
const plegable = (t, lineas) => `<blockquote expandable><b>${t}</b>\n\n${lineas.join('\n')}</blockquote>`;

// Ubica un punto entre dos extremos (precio entre stop y objetivo, RSI en su
// escala). Es la única "visualización" y se lee de un vistazo.
function barraMarcador(fraccion, largo = 12) {
  const i = Math.max(0, Math.min(largo - 1, Math.round((fraccion || 0) * (largo - 1))));
  return '─'.repeat(i) + '◆' + '─'.repeat(largo - 1 - i);
}

// Semáforo de una posición. Acercarse al LÍMITE y acercarse al OBJETIVO son
// situaciones OPUESTAS: el mismo naranja de alerta para las dos hacía leer una
// posición +22% camino a cobrarse como un problema.
const LUZ = { 'cruzo-limite': '🔴', 'cerca-limite': '🟠', 'cruzo-objetivo': '✅', 'cerca-objetivo': '🎯', 'vencido-sin-renta': '⏳' };
const luzDe = p => LUZ[p.senal] ?? '🟢';

// Semáforo del RSI según lo que aprendimos: sobre 70 es zona de castigo.
function zonaRSI(rsi) {
  if (rsi == null) return { icono: '·', etiqueta: 'sin dato' };
  if (rsi >= 80) return { icono: '🔴', etiqueta: 'sobrecompra extrema' };
  if (rsi >= 70) return { icono: '🟠', etiqueta: 'sobrecomprado' };
  if (rsi >= 45) return { icono: '🟢', etiqueta: 'sano' };
  if (rsi >= 30) return { icono: '🟡', etiqueta: 'débil' };
  return { icono: '🔵', etiqueta: 'sobrevendido' };
}

// --- OFERTAS: viven en el core, no acá ------------------------------------
//
// Antes Telegram tenía su propio Map en memoria: cualquier reinicio borraba las
// ofertas y el dashboard no las veía. Ahora la oferta es estado del proyecto
// (`data/ofertas.json`) y este módulo solo la muestra y avisa al core cuándo
// tomarla. Consecuencia: la MISMA oferta se puede tomar desde el teléfono o
// desde el dashboard, y sobrevive a un reinicio.

// Tres salidas, en filas separadas: un toque impreciso no debe ejecutar una
// compra. "Vigilar" es la del medio a propósito — es la respuesta más común a
// una oferta que llega en mal momento, y antes no existía: rechazar borraba.
const botonesOferta = o => [
  [{ texto: `🟢 APROBAR · ${f(o.montoUSDT)} USDT`, dato: `ok:${o.id}` }],
  [{ texto: '🔵 VIGILAR · vuelve cuando enfríe', dato: `vg:${o.id}` }],
  [{ texto: '🔴 RECHAZAR', dato: `no:${o.id}` }],
];

// Avisa al teléfono de una oferta creada en el core.
//
// Con la sesión cerrada NO se revela nada: ni el activo, ni el monto, ni los
// niveles. Solo que hay algo esperando. Mostrar la ficha completa antes del
// login contradice todo el modelo — un teléfono ajeno vería la operación.
export async function avisarOferta(o) {
  if (!desbloqueado()) {
    return enviar([
      '🔐 <b>Hay una oferta esperando</b>',
      `<i>vence ${hora(o.vence)}</i>`,
      '',
      cita('Entrá con tu usuario y clave para verla. Escribime cualquier cosa y te abro el acceso.'),
    ].join('\n'));
  }
  return avisarOfertaCompleta(o);
}

async function avisarOfertaCompleta(o) {
  const ficha = fichaOportunidad({
    asset: o.asset,
    score: o.contexto?.score,
    senalNombre: o.contexto?.senalNombre, senalLectura: o.contexto?.senalLectura,
    tipoObjetivo: o.contexto?.tipoObjetivo, riesgoBeneficio: o.contexto?.riesgoBeneficio,
    riesgoRealUSDT: o.contexto?.riesgoRealUSDT, acotadoPor: o.contexto?.acotadoPor,
    rsi14d: o.contexto?.rsi14d, rsi14h: o.contexto?.rsi14h,
    cambio24hPct: o.contexto?.momentum7dPct ?? 0,
    volumen24hM: o.contexto?.volumen24hM,
    saltoVolumen: o.contexto?.saltoVolumen ?? null,
    distanciaMax30dPct: o.contexto?.distanciaMax30dPct,
    stopSugeridoPct: o.limitePct, objetivoSugeridoPct: o.objetivoPct,
    volatilidadDiariaPct: o.contexto?.volatilidadDiariaPct,
  }, o.contexto?.regimen ?? '—', { conMonto: o.montoUSDT });
  return enviarConBotones(
    `${ficha}\n\n⏱ <i>Vence ${hora(o.vence)} · tolerancia ${o.driftMaxPct}% de precio</i>`,
    botonesOferta(o));
}

// Ejecuta una oferta contra el core. El texto devuelto reescribe el mensaje.
async function ejecutarOferta(id) {
  if (congelado()) return { texto: '🔒 <b>Ejecución congelada</b>\nNinguna oferta se puede aprobar. Reactivar desde el dashboard.' };
  if (!desbloqueado()) return { texto: '🔐 <b>Bloqueado</b>\nEnviá <code>/login usuario clave</code> y volvé a tocar el botón.' };
  try {
    const { tomarOferta, conCandado } = await import('./engine.mjs');
    const r = await conCandado('telegram', () => tomarOferta(id, 'telegram'));
    if (!r.ok) {
      // "ya tomada" no es un error: es la protección contra el doble toque.
      // Decirlo como falla hace creer que la operación no se hizo.
      if (/tomada/.test(r.motivo ?? '')) {
        return { texto: ['✓ <b>Ya estaba ejecutada</b>', '',
          'Esta oferta se aprobó antes — el segundo toque no volvió a comprar.',
          '', cita('Mirá /posiciones o /registro para verla.')].join('\n') };
      }
      if (/descartada/.test(r.motivo ?? '')) {
        return { texto: ['✕ <b>Ya estaba descartada</b>', '', cita('No se ejecutó nada.')].join('\n') };
      }
      return { texto: ['⏱ <b>No se pudo tomar</b>', '', esc(r.motivo), '', cita('Pedí una oferta nueva o revisá el dashboard.')].join('\n') };
    }
    const ops = (r.resultado?.trades ?? []).map(t => `${t.accion} ${f(t.qty, 6)} ${t.asset} @ ${precio(t.precio)}`).join('\n');
    return { texto: [
      `✓ <b>EJECUTADA · ${esc(r.oferta.asset)}</b>`,
      `<i>desde Telegram · ${hora(Date.now())}</i>`,
      '',
      `<pre>${ops}</pre>`,
      ficha([
        ['Stop', `${r.oferta.limitePct}%`],
        ['Objetivo', `+${r.oferta.objetivoPct}%`],
        ['Precio', precio(r.oferta.precioEjecutado)],
        ['Desvío', `${r.oferta.driftPct}%`],
      ]),
      r.resultado?.avisos?.length ? `⚠ ${r.resultado.avisos.map(esc).join('\n⚠ ')}` : '',
      cita('Queda en el historial con la marca ✈ Telegram.'),
    ].filter(Boolean).join('\n') };
  } catch (e) {
    return { texto: `✕ <b>No se pudo ejecutar</b>\n${esc(e.message)}` };
  }
}

// Ni sí ni no: pasa a la watchlist con su condición y vuelve sola.
async function vigilarDesdeOferta(id) {
  try {
    const { vigilarOferta } = await import('./engine.mjs');
    const r = vigilarOferta(id, { origen: 'telegram' });
    if (!r.ok) return `✕ <b>No se pudo</b>\n${esc(r.motivo)}`;
    return [
      `◉ <b>EN VIGILANCIA · ${esc(r.oferta.asset)}</b>`,
      `<i>${hora(Date.now())}</i>`,
      '',
      r.yaVigilada
        ? 'Ya estaba en la lista de vigilancia: la oferta se cierra y sigue esperando su punto.'
        : 'No se compró nada. Queda esperando su condición y, cuando se cumpla, te llega una oferta nueva.',
      '',
      cita('Se arma con: RSI &lt; 70 · fase tendencia · régimen no vetado. Caduca en 7 días.'),
    ].join('\n');
  } catch (e) { return `✕ <b>No se pudo</b>\n${esc(e.message)}`; }
}

async function rechazarOferta(id) {
  try {
    const { descartarOferta } = await import('./engine.mjs');
    const r = descartarOferta(id, 'telegram');
    return `✕ <b>Descartada</b>\n<i>${hora(Date.now())}</i>` + (r.ok ? '' : `\n${esc(r.motivo)}`);
  } catch { return `✕ <b>Descartada</b>\n<i>${hora(Date.now())}</i>`; }
}


// --- CLAVE DE ACCESO -------------------------------------------------------
//
// El bot arranca BLOQUEADO: sin credenciales no responde nada. Protege el caso
// que la lista blanca no cubre — alguien con el teléfono desbloqueado o con la
// cuenta de Telegram tomada: para el bot, ese atacante ES Jorge.
//
// Decisiones que hacen que esto sirva de verdad:
//   · el mensaje con las credenciales se BORRA al instante; si no, queda en el
//     historial y quien tenga el Telegram lo lee subiendo la conversación;
//   · el desbloqueo VENCE a los 30 min (una sesión eterna anula la clave);
//   · en .env va `scrypt:salt:hash` de usuario+clave juntos, nunca en claro;
//   · comparación en tiempo constante y 3 intentos antes de congelar todo.

const DESBLOQUEO_MS = 30 * 60_000;
const INTENTOS_MAX = 3;
const SCRYPT = { N: 16384, r: 8, p: 1, largo: 32 };
let _desbloqueadoHasta = 0;
let _intentosFallidos = 0;

const derivar = (clave, salt) => scryptSync(String(clave), salt, SCRYPT.largo, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });

// Usuario y clave se derivan JUNTOS con un byte nulo en medio: un solo hash
// valida ambos y un error no revela cuál de los dos campos falló.
const credencial = (usuario, clave) => `${String(usuario).trim().toLowerCase()}\u0000${clave}`;

export function generarHash(usuario, clave) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${derivar(credencial(usuario, clave), salt).toString('hex')}`;
}

function claveGuardada() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return null;
  const m = readFileSync(p, 'utf8').match(/^\s*TELEGRAM_PASS\s*=\s*scrypt:([0-9a-f]{32}):([0-9a-f]{64})\s*$/m);
  return m ? { salt: Buffer.from(m[1], 'hex'), hash: Buffer.from(m[2], 'hex') } : null;
}

export const requiereClave = () => claveGuardada() != null;
export const desbloqueado = () => !requiereClave() || Date.now() < _desbloqueadoHasta;
export const bloquear = () => { _desbloqueadoHasta = 0; _intentosFallidos = 0; };
export const minutosRestantes = () => Math.max(0, Math.ceil((_desbloqueadoHasta - Date.now()) / 60000));

function verificarLogin(usuario, clave) {
  const g = claveGuardada();
  if (!g) return { ok: false, motivo: 'no hay credenciales configuradas' };
  if (!timingSafeEqual(derivar(credencial(usuario, clave), g.salt), g.hash)) {
    _intentosFallidos++;
    if (_intentosFallidos >= INTENTOS_MAX) {
      congelar(`${INTENTOS_MAX} intentos fallidos`);
      return { ok: false, congelado: true };
    }
    return { ok: false, restantes: INTENTOS_MAX - _intentosFallidos };
  }
  _intentosFallidos = 0;
  _desbloqueadoHasta = Date.now() + DESBLOQUEO_MS;
  return { ok: true };
}

// Interruptor de pánico: corta TODA la ejecución y anula las ofertas vivas. Solo
// se reactiva desde la máquina — si alguien tomó el Telegram, no debe poder
// revertirlo él mismo.
//
// El estado NO vive acá: vive en `data/seguridad.json`, dentro del motor. Acá
// era memoria de proceso, así que un reinicio lo descongelaba y el dashboard
// nunca lo consultaba. Este módulo solo agrega lo que sí es suyo: cerrar la
// sesión de Telegram al congelar.
export function congelar(motivo = 'activado desde Telegram') {
  _desbloqueadoHasta = 0;
  return congelarMotor(motivo, 'telegram');
}

// --- LOGIN POR PASOS -------------------------------------------------------

// Indicador de progreso del formulario: bloques llenos y vacíos.
const pasos = (n, total) => '▰'.repeat(n) + '▱'.repeat(total - n);

const FLUJO_MS = 10 * 60_000;
let _flujo = null;
const flujoVivo = () => _flujo && Date.now() < _flujo.vence ? _flujo : (_flujo = null);
export const _flujoDebug = () => _flujo && { paso: _flujo.paso, usuario: _flujo.usuario, vivo: Boolean(flujoVivo()) };
export const _paso = msg => pasoLogin(msg);
export const _verificar = (u, c) => verificarLogin(u, c);

export async function iniciarLogin() {
  if (!requiereClave()) return enviar('No hay credenciales configuradas: el bot responde sin login.');
  const msgId = await pedirDato([
    '🔐 <b>ACCESO</b>',
    `<code>${pasos(0, 2)}</code>  <i>paso 1 de 2 · usuario</i>`,
    '',
    '👉 <b>Escribí tu usuario</b> y enviálo como mensaje normal (sin barra).',
    '',
    cita('El bot está bloqueado: no muestra saldos ni responde consultas hasta que entres.'),
  ].join('\n'), 'Usuario');
  _flujo = { paso: 'usuario', usuario: null, msgId, vence: Date.now() + FLUJO_MS };
}

async function pasoLogin(msg) {
  const fl = flujoVivo();
  if (!fl) return false;
  const valor = msg.text.trim();
  await borrarMensaje(msg.message_id);

  if (fl.paso === 'usuario') {
    fl.usuario = valor;
    fl.paso = 'clave';
    fl.vence = Date.now() + FLUJO_MS;
    if (fl.msgId) await editarMensaje(fl.msgId, [
      '🔐 <b>ACCESO</b>', `<code>${pasos(1, 2)}</code>  <i>usuario recibido</i>`, '', cita(`<code>${esc(valor)}</code>`),
    ].join('\n'));
    fl.msgId = await pedirDato([
      '🔐 <b>ACCESO</b>',
      `<code>${pasos(1, 2)}</code>  <i>paso 2 de 2 · clave</i>`,
      '',
      '👉 <b>Ahora tu clave.</b>',
      '',
      cita('Borro tu mensaje en cuanto llegue: la clave no queda en el historial.'),
    ].join('\n'), 'Clave');
    return true;
  }

  const r = verificarLogin(fl.usuario, valor);
  if (r.ok) registrarComandos();
  const texto = r.ok
    ? ['🔓 <b>SESIÓN ABIERTA</b>', `<code>${pasos(2, 2)}</code>  <i>${esc(fl.usuario)} · ${Math.round(DESBLOQUEO_MS / 60000)} min</i>`, '',
       cita('Tocá ◆ Oportunidades para ver si hay algo para aprobar.')].join('\n')
    : r.congelado
      ? ['🔒 <b>CONGELADO</b>', '<i>demasiados intentos</i>', '', cita('La ejecución quedó cortada. Solo se reactiva desde la máquina.')].join('\n')
      : ['❌ <b>NO COINCIDE</b>', `<code>${pasos(0, 2)}</code>  <i>${r.restantes} intento(s) restante(s)</i>`, '',
         cita('Mandá cualquier mensaje para volver a empezar.')].join('\n');
  if (fl.msgId) await editarMensaje(fl.msgId, texto);
  else await enviar(texto);
  _flujo = null;
  if (r.ok) await enviarConTeclado('Tocá un botón o preguntame lo que quieras.');
  return true;
}

// --- RUTEO PROACTIVO -------------------------------------------------------
//
// Lo que hace que el bot no sea un intérprete de comandos: cada respuesta
// cierra con UNA sugerencia, la más urgente según el estado real. Una sola, no
// una lista — si sugiere cinco cosas, no sugiere nada.

async function loMasUrgente() {
  try {
    const { getState } = await import('./engine.mjs');
    const r = getState().lastRun;
    if (!r) return { texto: 'Todavía no hay un análisis. Corré uno en el dashboard.' };

    // 1 · una posición a punto de cruzar pesa más que cualquier otra cosa
    const abiertas = (r.posiciones ?? []).filter(p => p.estado === 'abierta');
    // Estar por ganar y estar por perder son situaciones OPUESTAS: mezclarlas
    // bajo "cerca de un nivel" con ícono de alarma es desinformar.
    const cruzoLim = abiertas.find(p => p.senal === 'cruzo-limite');
    if (cruzoLim) return { urgente: true, texto: `⚠️ <b>${esc(cruzoLim.asset)}</b> cruzó su LÍMITE (${pct(cruzoLim.pnlPct)}). El auto-stop debería haberla cerrado.`, cmd: '/posiciones' };
    const cruzoObj = abiertas.find(p => p.senal === 'cruzo-objetivo');
    if (cruzoObj) return { urgente: true, texto: `🎯 <b>${esc(cruzoObj.asset)}</b> alcanzó su OBJETIVO (${pct(cruzoObj.pnlPct)}). Se cobra sola.`, cmd: '/posiciones' };
    const cercaLim = abiertas.find(p => p.senal === 'cerca-limite');
    if (cercaLim) return { urgente: true, texto: `⚠️ <b>${esc(cercaLim.asset)}</b> se acerca a su límite (${pct(cercaLim.pnlPct)}).`, cmd: '/posiciones' };
    const cercaObj = abiertas.find(p => p.senal === 'cerca-objetivo');
    if (cercaObj) return { texto: `🎯 <b>${esc(cercaObj.asset)}</b> va bien: ${pct(cercaObj.pnlPct)}, cerca de su objetivo de +${cercaObj.objetivoPct}%.`, cmd: '/posiciones' };

    // 2 · exposición fuera de lo habitual
    if (r.riesgo?.pct > 3) return { texto: `Estás más expuesto de lo normal: ${f(r.riesgo.pct)}% del capital en riesgo.`, cmd: '/riesgo' };

    // 3 · el análisis quedó viejo
    const hoy = new Date().toLocaleDateString('sv-SE');
    if (r.fecha && r.fecha !== hoy) return { texto: `El último análisis es del ${r.fecha}. Conviene correrlo.`, cmd: '/mercado' };

    // 4 · hay candidatos vigentes
    const { ofertasVigentes } = await import('./engine.mjs');
    const vivas = ofertasVigentes().length;
    if (vivas) return { texto: `◆ Hay ${vivas} oferta(s) esperando tu decisión.`, cmd: '/oportunidades' };

    return { texto: abiertas.length ? 'Todo en rango. Nada que hacer ahora.' : 'Sin posiciones abiertas.' };
  } catch { return null; }
}

// Cierra cualquier respuesta con la sugerencia del momento.
async function conSugerencia(texto) {
  const s = await loMasUrgente();
  if (!s) return texto;
  return `${texto}\n\n${cita(s.texto + (s.cmd ? ` → ${s.cmd}` : ''))}`;
}

// --- FRASES ----------------------------------------------------------------
// Coincidencia por palabras clave, sin modelo: las preguntas reales son pocas
// y acotadas. Lo que no matchea cae en el caso "no te seguí" con la sugerencia.

const FRASES = [
  [/\b(hola|buenas|hey|holi|qué tal|que tal|buen día|buenos días|buenas tardes|buenas noches)\b/i, 'saludo'],
  [/\b(cómo va|como va|cómo vamos|como vamos|qué onda|que onda|novedades|todo bien)\b/i, 'resumen'],
  [/\b(cuánto tengo|cuanto tengo|saldo|plata|billetera|wallet)\b/i, 'resumen'],
  [/\b(qué compro|que compro|oportunidad|comprar|entrar)\b/i, 'oportunidades'],
  [/\b(cómo van|como van|posición|posiciones|abierto)\b/i, 'posiciones'],
  [/\b(riesgo|pierdo|perder|expuesto)\b/i, 'riesgo'],
  [/\b(mercado|btc|bitcoin|régimen|regimen)\b/i, 'mercado'],
  [/\b(ayuda|help|qué puedes|que puedes|comandos)\b/i, 'ayuda'],
  // La cortesía va ÚLTIMA a propósito: "ok", "dale" y "listo" son tan comunes
  // que estando arriba se comían la pregunta real — "ok, qué compro" contestaba
  // "Cuando quieras 👌". Solo gana cuando no hay nada más en la frase.
  [/\b(gracias|grax|dale|ok|listo|perfecto|genial)\b/i, 'cortesia'],
];

const intencion = texto => FRASES.find(([re]) => re.test(texto))?.[1] ?? null;

// --- comandos (todos de solo lectura) --------------------------------------

const COMANDOS = {
  // El comando estrella: estaba publicado en el teclado, en el menú "/" y en
  // /ayuda, pero nunca se escribió — el primer botón contestaba "No te seguí".
  // Junta lo que se pregunta de verdad: cuánto tengo, cómo van las posiciones,
  // cuánto arriesgo. Con precios vivos, porque es la foto del momento.
  '/resumen': async () => {
    const { getState, marketSnapshotParaBot, evaluarPosiciones, ofertasVigentes } = await import('./engine.mjs');
    const r = getState().lastRun;
    if (!r) return [titulo('Resumen'), '', 'Todavía no hay un análisis. Corré uno en el dashboard.'].join('\n');

    const { prices } = await marketSnapshotParaBot();
    const pos = evaluarPosiciones(prices).filter(p => p.estado === 'abierta');
    const dif = r.real ? r.sim.valor - r.real.total : null;
    const g = r.riesgo, sl = r.sleeveRendimiento;

    const lectura = dif == null
      ? 'Sin billetera real para comparar.'
      : dif >= 0
        ? `La ficticia va <b>${f(Math.abs(dif))} USDT arriba</b> del hold: las jugadas sumaron.`
        : `La ficticia va <b>${f(Math.abs(dif))} USDT abajo</b> del hold: hasta ahora las jugadas restaron.`;

    // Acercarse al LÍMITE y acercarse al OBJETIVO son situaciones opuestas.
    // Pintarlas con el mismo naranja de alerta es desinformar: una posición
    // +22% camino a cobrarse no es un aviso.
    const malas = pos.filter(p => p.senal === 'cruzo-limite' || p.senal === 'cerca-limite');
    const buenas = pos.filter(p => p.senal === 'cruzo-objetivo' || p.senal === 'cerca-objetivo');
    const vencidas = pos.filter(p => p.senal === 'vencido-sin-renta');
    const linea = p => `${luzDe(p)} <code>${esc(p.asset).padEnd(6)}</code>${pct(p.pnlPct).padStart(8)}  <i>${signo(p.pnlUSDT)}</i>`;
    const estado = [
      malas.length ? `<b>${malas.length}</b> cerca o cruzando su límite` : '',
      vencidas.length ? `<b>${vencidas.length}</b> se liquida por plazo vencido` : '',
      buenas.length ? `<b>${buenas.length}</b> camino a su objetivo` : '',
    ].filter(Boolean).join(' · ') || 'todas en rango';

    const vivas = ofertasVigentes().length;
    return [
      titulo('Resumen', `${hora(Date.now())} · análisis ${r.generadoA ? hora(r.generadoA) : r.fecha ?? '—'}`),
      '', lectura, '',
      ficha([
        ['Ficticia', `${f(r.sim.valor)} USDT`],
        ['Real', `${r.real ? f(r.real.total) : '—'} USDT`],
        ['Marcador', dif != null ? `${flecha(dif)} ${signo(dif)}` : '—'],
        sl && ['Alfa', `${signo(sl.alfaUSDT)} USDT (${signo(sl.alfaPct)} pp)`],
        g && ['Riesgo', `−${f(g.usdt)} USDT (${f(g.pct)}%)`],
      ]),
      pos.length
        ? `<b>${pos.length} posición(es)</b> · ${estado}\n` + pos.map(linea).join('\n')
        : 'Sin posiciones abiertas.',
      vivas ? `\n◆ <b>${vivas} oferta(s)</b> esperando tu decisión → /oportunidades` : '',
    ].filter(Boolean).join('\n');
  },

  '/estado': async () => {
    const { getState } = await import('./engine.mjs');
    const r = getState().lastRun;
    if (!r) return 'Todavía no hay un análisis registrado.';
    const dif = r.real ? r.sim.valor - r.real.total : null;
    const sl = r.sleeveRendimiento, g = r.riesgo;
    // la frase primero: el número solo no dice si está bien o mal
    const lectura = dif == null ? 'Sin billetera real para comparar.'
      : dif >= 0 ? `La ficticia va <b>${f(Math.abs(dif))} USDT arriba</b> del hold.`
      : `La ficticia va <b>${f(Math.abs(dif))} USDT abajo</b> del hold — la brecha es el resultado de las jugadas ya cerradas.`;
    return [
      titulo('Estado', `${hora(Date.now())} · refresco ${r.generadoA ? hora(r.generadoA) : '—'}`),
      '', lectura, '',
      ficha([
        ['Ficticia', `${f(r.sim.valor)} USDT`],
        ['Real', `${r.real ? f(r.real.total) : '—'} USDT`],
        ['Marcador', dif != null ? `${flecha(dif)} ${signo(dif)}` : '—'],
        sl && ['Alfa', `${signo(sl.alfaUSDT)} USDT (${signo(sl.alfaPct)} pp)`],
        g && ['Riesgo', `−${f(g.usdt)} USDT (${f(g.pct)}%)`],
      ]),
      sl ? `<i>El alfa compara cada jugada con esa misma plata en BTC · ${sl.jugadas} jugadas.</i>` : '',
    ].filter(Boolean).join('\n');
  },

  '/posiciones': async () => {
    const { marketSnapshotParaBot, evaluarPosiciones } = await import('./engine.mjs');
    const { prices } = await marketSnapshotParaBot();
    const pos = evaluarPosiciones(prices).filter(p => p.estado === 'abierta');
    if (!pos.length) return [titulo('Posiciones'), '', 'No hay ninguna posición abierta con salida programada.'].join('\n');
    const enLimite = pos.filter(p => p.senal === 'cruzo-limite' || p.senal === 'cerca-limite').length;
    const enObjetivo = pos.filter(p => p.senal === 'cruzo-objetivo' || p.senal === 'cerca-objetivo').length;
    const vencidas = pos.filter(p => p.senal === 'vencido-sin-renta').length;
    const lectura = enLimite
      ? `<b>${enLimite}</b> de ${pos.length} está cerca o cruzó su <b>límite</b>.`
      : vencidas
      ? `<b>${vencidas}</b> de ${pos.length} cumplió su plazo sin rentar — el motor la liquida.`
      : enObjetivo
      ? `<b>${enObjetivo}</b> de ${pos.length} va camino a su <b>objetivo</b>. Ninguna en riesgo.`
      : `Las ${pos.length} están en rango: el auto-stop no tiene nada que cortar.`;
    return [
      titulo('Posiciones', `${pos.length} abierta(s) · ${hora(Date.now())}`),
      '', lectura, '',
      ...pos.map(p => {
        return cita(`${luzDe(p)} <b>${esc(p.asset)}</b>  ${pct(p.pnlPct)}  <i>${signo(p.pnlUSDT)} USDT</i>`)
          + ficha([
            ['Límite', `${precio(p.limite)}  (${p.limitePct}%)`],
            ['Ahora', precio(p.precio)],
            ['Objetivo', `${precio(p.objetivo)}  (+${p.objetivoPct}%)`],
            ['Recorrido', barraMarcador(p.progreso)],
            p.horizonteHoras != null && ['Plazo', `${p.horasRestantesPlazo.toFixed(0)}h restantes de ${p.horizonteHoras}h`],
          ]);
      }),
      '<i>◆ marca dónde está el precio entre su límite y su objetivo.</i>',
    ].join('\n');
  },

  '/mercado': async () => {
    const { regimenMercado } = await import('./aprendizaje.mjs');
    const { radarParaBot } = await import('./engine.mjs');
    const reg = await regimenMercado();
    const { mercado, generadoA } = radarParaBot(6);
    const lectura = !reg ? '' : reg.tipo === 'rally amplio'
      ? `Sube <b>${reg.amplitudPct}%</b> del universo: es un rally de mercado, no un pump aislado.`
      : reg.tipo === 'débil' || reg.tipo === 'caída amplia'
      ? `Solo sube <b>${reg.amplitudPct}%</b> del universo: no es una entrada fresca, es resaca.`
      : `Mercado mixto (<b>${reg.amplitudPct}%</b> sube): sin dirección clara.`;
    return [
      titulo('Mercado', reg ? `${reg.tipo} · ${hora(Date.now())}` : hora(Date.now())),
      '', lectura, '',
      reg ? ficha([['BTC 24h', `${flecha(reg.btc24hPct)} ${pct(reg.btc24hPct)}`], ['BTC 7d', `${flecha(reg.btc7dPct)} ${pct(reg.btc7dPct)}`], ['Amplitud', `${reg.amplitudPct}% sube`]]) : '',
      // cambio24h viene guardado como fracción (0,15 = 15%)
      mercado.length ? plegable(`Radar · ${mercado.length} activos`,
        mercado.map(m => {
          const g = { tendencia: '▲', extendido: '⚠', rango: '◆', caida: '▼' }[m.tendencia?.estado] ?? '·';
          return `${g} <code>${esc(m.asset).padEnd(6)}</code> mom ${f(m.momentum, 2)} · ${pct(m.cambio24h * 100)} · ${f(m.volumen24h / 1e6, 0)}M`;
        })) : '',
      generadoA ? `<i>Radar del análisis de las ${hora(generadoA)}.</i>` : '',
    ].filter(Boolean).join('\n');
  },

  '/riesgo': async () => {
    const { getState } = await import('./engine.mjs');
    const r = getState().lastRun;
    const g = r?.riesgo, e = r?.estadistica, c = r?.comisiones;
    if (!g) return [titulo('Riesgo'), '', 'Sin datos de riesgo todavía.'].join('\n');
    return [
      titulo('Riesgo abierto', `${g.posiciones} posición(es) · ${hora(Date.now())}`),
      '',
      `Si <b>todas</b> las posiciones cayeran hasta su límite al mismo tiempo, perderías <b>${f(g.usdt)} USDT</b> — el ${f(g.pct)}% del capital. Ese es el techo del daño posible hoy.`,
      '',
      ficha([
        ['Pérdida', `−${f(g.usdt)} USDT`],
        ['Del capital', `${f(g.pct)}%`],
        ['Expuesto', `${f(g.expuestoUSDT)} USDT (${f(g.expuestoPct)}%)`],
        ...g.detalle.map(d => [`· ${esc(d.asset)}`, `−${f(d.riesgoUSDT)}  stop ${d.limitePct}%`]),
      ]),
      e?.n ? plegable(`Historial · ${e.n} jugadas cerradas`, [
        `<code>Aciertos   </code>${f(e.winRate, 0)}%`,
        `<code>Gana prom. </code>${pct(e.gananciaProm)}`,
        `<code>Pierde prom</code>${pct(e.perdidaProm)}`,
        `<code>Expectativa</code>${pct(e.expectativaPct)}`,
        e.brechaPromPp != null ? `<code>Brecha stop</code>${f(e.brechaPromPp)} pp (peor ${f(e.brechaPeorPp)})` : '',
        '',
        e.significativo ? '<i>Con n≥30 esto empieza a ser señal.</i>'
          : `<i>⚠ Con n=${e.n} es ruido, no señal: hacen falta 30+ jugadas para distinguir habilidad de suerte.</i>`,
      ].filter(Boolean)) : '',
      c ? `<i>Comisiones pagadas: ${f(c.comisionesUSDT, 3)} USDT en ${c.operaciones} operaciones.</i>` : '',
    ].filter(Boolean).join('\n');
  },

  '/registro': async () => {
    const { readMovimientos } = await import('./engine.mjs');
    const movs = readMovimientos().filter(m => ['stop', 'objetivo'].includes(m.categoria)).slice(-8).reverse();
    if (!movs.length) return [titulo('Registro del sistema'), '', 'El motor todavía no ha ejecutado ningún movimiento automático.'].join('\n');
    const stops = movs.filter(m => m.categoria === 'stop').length;
    return [
      titulo('Registro del sistema', `${movs.length} evento(s) · ${hora(Date.now())}`),
      '',
      `El motor ejecutó <b>${movs.length}</b> cierre(s) sin que estuvieras operando: <b>${stops}</b> por límite y <b>${movs.length - stops}</b> por objetivo.`,
      '',
      plegable('Detalle', movs.map(m =>
        `<code>${fechaHoraLocal(m.ts)}</code> ${m.categoria === 'stop' ? '▼' : '▲'} ${m.tipo.replace(/^auto-\w+: /, '')}`)),
    ].join('\n');
  },

  // Primero las ofertas vigentes (aprobables acá mismo). Si no hay, se muestra
  // el screening de criterios para saber por qué no hay nada.
  '/oportunidades': async () => {
    const { ofertasVigentes } = await import('./engine.mjs');
    const ofertas = ofertasVigentes();

    if (ofertas.length) {
      // cada oferta va en su propio mensaje, con sus botones
      for (const o of ofertas) await avisarOfertaCompleta(o);
      return null;   // ya se enviaron los mensajes
    }

    // Sin ofertas vigentes: si hubo una resuelta hace poco, decirlo — evita que
    // parezca que algo falló cuando en realidad ya se ejecutó.
    const { leerOfertasTodas } = await import('./engine.mjs');
    const reciente = (leerOfertasTodas() ?? [])
      .filter(o => o.tomadaEn && Date.now() - Date.parse(o.tomadaEn) < 30 * 60_000)
      .sort((a, b) => b.tomadaEn.localeCompare(a.tomadaEn))[0];
    if (reciente) {
      return [
        titulo(reciente.estado === 'tomada' ? 'Sin ofertas nuevas' : 'Sin ofertas nuevas', hora(Date.now())),
        '',
        reciente.estado === 'tomada'
          ? `Tu última decisión fue <b>aprobar ${esc(reciente.asset)}</b> por ${f(reciente.montoUSDT)} USDT, a las ${hora(reciente.tomadaEn)} desde ${reciente.tomadaPor}.`
          : `Tu última decisión fue <b>rechazar ${esc(reciente.asset)}</b>, a las ${hora(reciente.tomadaEn)}.`,
        '',
        cita('Mirá /posiciones para ver cómo va, o /registro para el detalle.'),
      ].join('\n');
    }

    const { buscarOportunidades } = await import('./aprendizaje.mjs');
    const { regimen, oportunidades, descartadas, motivo } = await buscarOportunidades({ registrar: false });
    if (motivo) {
      const caros = descartadas.filter(d => /RSI/.test(d.motivo)).length;
      const lectura = caros
        ? `De <b>${descartadas.length}</b> candidatos, ninguno pasó. <b>${caros}</b> quedaron fuera por sobrecompra: el mercado está caro.`
        : `De <b>${descartadas.length}</b> candidatos evaluados, ninguno pasó los criterios.`;
      return [
        titulo('Sin oportunidades', `${regimen?.tipo ?? '—'} · ${hora(Date.now())}`),
        '', descartadas.length ? lectura : motivo, '',
        descartadas.length ? plegable(`Descartadas · ${descartadas.length}`,
          descartadas.map(d => `<code>${esc(d.asset).padEnd(6)}</code> ${d.motivo}`)) : '',
      ].filter(Boolean).join('\n');
    }
    return [...oportunidades.map(o => fichaOportunidad(o, regimen.tipo)),
      '<i>Pasaron los criterios pero no hay oferta creada. Generá una desde el dashboard.</i>',
    ].join('\n\n');
  },

  '/congelar': async () => {
    const { anuladas } = congelar();
    return [titulo('Ejecución congelada'), '',
      `La sesión quedó cerrada y ${anuladas ? `se anularon <b>${anuladas}</b> oferta(s) vigente(s)` : 'no había ofertas vigentes que anular'}. Ninguna aprobación pasa: ni desde acá ni desde el dashboard.`,
      '',
      'Las alertas siguen llegando y el auto-stop sigue protegiendo lo que ya está abierto.',
      '', cita('Para reactivar hay que hacerlo <b>desde la máquina</b>: si alguien tomó tu Telegram, no debe poder revertirlo. Sobrevive a un reinicio.'),
    ].join('\n');
  },

  '/seguridad': async () => {
    const { ofertasVigentes } = await import('./engine.mjs');
    return [
      titulo('Seguridad', congelado() ? 'ejecución CONGELADA' : 'ejecución activa'),
      '',
      congelado()
        ? 'La ejecución está congelada: ninguna oferta se puede aprobar, ni desde acá ni desde el dashboard. Se reactiva solo desde la máquina.'
        : 'La ejecución está activa. Podés cortarla al instante con /congelar.',
      '',
      ficha([
        ['Login', requiereClave() ? (desbloqueado() ? `abierto ${minutosRestantes()} min` : 'BLOQUEADO') : 'sin configurar'],
        ['Ejecución', congelado() ? 'CONGELADA' : 'activa'],
        ['Ofertas', `${ofertasVigentes().length} vigente(s)`],
        ['Tope', '8,00 USDT por aprobación'],
        ['Tamaño', 'por riesgo (~0,35 USDT por jugada)'],
        ['Real', 'nunca se toca'],
      ]),
      cita('Si perdiste el teléfono: /congelar primero, después revocá el token en @BotFather.'),
    ].join('\n');
  },

  '/salir': async () => {
    bloquear();
    const { borrados, viejos } = await limpiarConversacion();
    return [
      titulo('Sesión cerrada', `${borrados} mensaje(s) borrado(s)`),
      '',
      viejos
        ? `Quedaron ${viejos} mensaje(s) de más de 48 h: Telegram no permite borrarlos. Podés hacerlo a mano con «Vaciar historial».`
        : 'La conversación quedó limpia.',
      '',
      cita('Escribime cualquier cosa para volver a entrar.'),
    ].join('\n');
  },

  '/ayuda': async () => [
    titulo('Kripto Wallet', 'consultas y alertas'),
    '',
    'Puedo mostrarte el estado y avisarte cuando algo pasa. Solo ejecuto <b>ofertas que yo mismo genero</b>, aprobadas por botón y con 15 minutos de vigencia. Tu billetera <b>real</b> no la toco: esas órdenes las haces tú en Binance.',
    '',
    ficha([
      ['/resumen', 'todo en un mensaje'],
      ['/estado', 'marcador y alfa'],
      ['/posiciones', 'distancia a los niveles'],
      ['/mercado', 'régimen y radar'],
      ['/riesgo', 'cuánto está en juego'],
      ['/oportunidades', 'candidatos que pasan'],
      ['/registro', 'lo que hice sin ti'],
      ['/seguridad', 'estado de la ejecución'],
      ['/login', 'usuario y clave'],
      ['/salir', 'cerrar la sesión'],
      ['/congelar', 'cortar toda ejecución YA'],
    ]),
  ].join('\n'),
};

COMANDOS['/start'] = COMANDOS['/ayuda'];

// expuesto para poder previsualizar los mensajes sin enviarlos
export const _comandos = COMANDOS;

// Mensaje de una oportunidad, con su ficha visual. Se usa igual desde el
// monitor (con botones) y desde /oportunidades (sin botones).
export function fichaOportunidad(o, regimen, { conMonto = null } = {}) {
  const z = zonaRSI(o.rsi14d);
  const riesgo = conMonto != null ? conMonto * Math.abs(o.stopSugeridoPct) / 100 : null;
  const rr = o.objetivoSugeridoPct / Math.abs(o.stopSugeridoPct);
  return [
    titulo(`Oportunidad · ${esc(o.asset)}`, `${regimen} · ${hora(Date.now())}`),
    '',
    o.senalNombre ? `<b>${esc(o.senalNombre)}</b> — ${esc(o.senalLectura ?? '')}` : '',
    `RSI en <b>${o.rsi14d}</b> (${z.etiqueta}), volumen del día <b>${o.saltoVolumen}×</b> su promedio.`,
    '',
    ficha([
      o.score != null && ['Confianza', `${o.score}/100  ${barraMarcador(o.score / 100, 10)}`],
      ['24h', `${flecha(o.cambio24hPct)} ${pct(o.cambio24hPct)}`],
      ['RSI 14', `${o.rsi14d}  ${barraMarcador(Math.min(1, (o.rsi14d ?? 0) / 100), 10)}`],
      ['Volumen', `${f(o.volumen24hM, 0)}M  (${o.saltoVolumen}× prom.)`],
      ['Techo 30d', pct(o.distanciaMax30dPct)],
    ]),
    ficha([
      ['Stop', `${o.stopSugeridoPct}%`],
      ['Objetivo', `+${o.objetivoSugeridoPct}%${o.tipoObjetivo === 'estructural' ? '  (techo 30d)' : o.tipoObjetivo === 'proyeccion' ? '  (proyectado)' : ''}`],
      ['Relación', `${f(o.riesgoBeneficio ?? rr, 2)} a 1`],
      ['Volatilidad', `${o.volatilidadDiariaPct}% diaria`],
      ...(conMonto != null ? [
        ['Entrada', `${f(conMonto)} USDT`],
        ['En riesgo', `−${f(o.riesgoRealUSDT ?? riesgo)} USDT${o.acotadoPor === 'minimo-de-orden' ? ' (piso de orden)' : ''}`],
      ] : []),
    ]),
    `<i>Los niveles salen de su volatilidad, no de un porcentaje fijo — esa fue la lección de GPS.</i>`,
  ].join('\n');
}

// --- polling ---------------------------------------------------------------

const ESPERA_S = 25;
let _offset = 0;
let _corriendo = false;

export async function revisarMensajes() {
  const c = credenciales();
  if (!c || _corriendo) return;
  _corriendo = true;
  try {
    // Long polling: Telegram retiene la conexión hasta 25 s esperando que
    // llegue algo, y responde en el instante en que llega. Con `timeout=0` era
    // sondeo corto — respondía cada 20 s en el peor caso y gastaba 4.320
    // peticiones al día para casi siempre no traer nada.
    const res = await fetch(
      `${API}/bot${c.token}/getUpdates?offset=${_offset}&timeout=${ESPERA_S}` +
      `&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`,
      { signal: AbortSignal.timeout((ESPERA_S + 10) * 1000) });
    if (!res.ok) return;
    const { result = [] } = await res.json();
    for (const u of result) {
      _offset = u.update_id + 1;

      // Botón tocado: se verifica QUIÉN lo tocó, no solo el chat. Un mensaje
      // reenviado a otra persona no debe poder ejecutar nada.
      if (u.callback_query) {
        const q = u.callback_query;
        if (String(q.from?.id) !== String(c.chatId)) {
          await responderBoton(q.id, 'No autorizado.', true);
          console.log(`[TELEGRAM] botón rechazado de ${q.from?.id}`);
          continue;
        }
        if (!desbloqueado()) {
          await responderBoton(q.id, 'Bloqueado: enviá /login y volvé a tocar.', true);
          continue;
        }
        const [accion, id] = String(q.data ?? '').split(':');
        if (accion === 'vg') {
          await responderBoton(q.id, 'A vigilancia.');
          await editarMensaje(q.message.message_id, await vigilarDesdeOferta(id));
        } else if (accion === 'no') {
          await responderBoton(q.id, 'Descartada.');
          await editarMensaje(q.message.message_id, await rechazarOferta(id));
        } else if (accion === 'ok') {
          await responderBoton(q.id, 'Ejecutando…');
          const r = await ejecutarOferta(id);
          await editarMensaje(q.message.message_id, r.texto);
        }
        continue;
      }

      const msg = u.message;
      if (!msg?.text) continue;
      // lista blanca PRIMERO: un bot de Telegram es público, cualquiera puede
      // escribirle. Antes se recordaba el ID antes de este filtro, y los IDs son
      // secuenciales POR CHAT: el mensaje 47 de un desconocido entraba a la
      // lista de limpieza y al hacer /salir se borraba el mensaje 47 del chat de
      // Jorge, que es otro mensaje real.
      if (String(msg.chat?.id) !== String(c.chatId)) {
        console.log(`[TELEGRAM] mensaje ignorado de chat ${msg.chat?.id}`);
        continue;
      }
      recordar(msg.message_id);   // también se limpia lo que escribe Jorge
      const partes = msg.text.trim().split(/\s+/);
      const cmd = partes[0].toLowerCase().replace(/@.*$/, '');

      // Si hay un login en curso y esto NO es un comando, es la respuesta a un
      // paso del formulario.
      if (!cmd.startsWith('/') && await pasoLogin(msg)) continue;

      // /login sin argumentos abre el formulario por pasos; con argumentos
      // funciona como atajo. En los dos casos el mensaje se borra.
      if (cmd === '/login' || cmd === '/pass') {
        await borrarMensaje(msg.message_id);
        if (!requiereClave()) { await enviar('No hay credenciales configuradas: el bot ya responde sin desbloquear.'); continue; }
        if (partes.length < 3) {
          await iniciarLogin();          // formulario por pasos
          continue;
        }
        const r = verificarLogin(partes[1], partes.slice(2).join(' '));
        await enviar(r.ok
          ? `🔓 <b>Desbloqueado</b>\nTenés ${Math.round(DESBLOQUEO_MS / 60000)} minutos. Borré el mensaje con la clave.`
          : r.congelado
            ? '🔒 <b>Congelado por intentos fallidos</b>\nSe anularon las ofertas vivas. Hay que reactivar desde la máquina.'
            // no se dice cuál de los dos campos falló: eso ayudaría a un atacante
            : `❌ <b>Credenciales incorrectas</b>\nQuedan ${r.restantes} intento(s) antes de congelar el bot.`);
        continue;
      }

      // Bloqueado: no se responde NADA, ni el estado ni la ayuda. Un atacante
      // con el teléfono no debe poder ni ver los saldos. Cualquier comando
      // abre directamente el formulario, así no hay que recordar la sintaxis.
      if (!desbloqueado()) {
        const fl = flujoVivo();
        // si el formulario ya está abierto, un comando no debe reiniciarlo:
        // solo se recuerda qué falta escribir
        if (fl && cmd !== '/login' && cmd !== '/pass') {
          await enviar(fl.paso === 'usuario'
            ? '👉 Escribí tu <b>usuario</b> como mensaje normal, sin barra.'
            : '👉 Escribí tu <b>clave</b> como mensaje normal, sin barra.');
        } else {
          await iniciarLogin();
        }
        continue;
      }

      // los botones del teclado llegan como texto: se traducen a su comando
      const cmdFinal = DESDE_TECLADO[msg.text.trim().toLowerCase()] ?? cmd;
      const handler = COMANDOS[cmdFinal];
      try {
        if (handler) {
          const respuesta = await handler();
          if (respuesta == null) continue;   // el comando ya envió sus mensajes
          // /salir esconde el teclado; el resto lo mantiene visible
          if (cmdFinal === '/salir') await enviarConTeclado(respuesta, false);
          else await enviarConTeclado(await conSugerencia(respuesta));
          continue;
        }

        // no es comando: se intenta entender la frase
        const quiso = intencion(msg.text);
        if (quiso === 'saludo') {
          const s = await loMasUrgente();
          await enviarConTeclado(await conSugerencia(
            `👋 <b>Buenas, Jorge.</b>\n<i>${hora(Date.now())}</i>` +
            (s?.urgente ? '' : '\n\nTocá un botón o preguntame.')));
        } else if (quiso === 'cortesia') {
          await enviarConTeclado('Cuando quieras. 👌');
        } else if (quiso && COMANDOS['/' + quiso]) {
          await enviarConTeclado(await conSugerencia(await COMANDOS['/' + quiso]()));
        } else {
          await enviarConTeclado(await conSugerencia(
            'No te seguí — entiendo frases cortas como «hola», «cómo va», «qué compro» o los botones de abajo.'));
        }
      } catch (e) {
        await enviar(`No pude responder: ${e.message}`);
      }
    }
  } catch (e) {
    // Con long polling, que la espera se agote sin novedades es lo NORMAL: no
    // es un error y no debe ensuciar el log cada 25 segundos.
    if (e.name !== 'TimeoutError' && e.name !== 'AbortError') console.error('telegram polling:', e.message);
  } finally {
    _corriendo = false;
  }
}

// --- consola ---------------------------------------------------------------
// node src/telegram.mjs --setup   → diagnostica y busca tu chat ID
// node src/telegram.mjs           → manda un mensaje de prueba

// Lee solo el token (para el modo setup, cuando aún no hay chat ID).
function soloToken() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return null;
  const m = readFileSync(p, 'utf8').match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(.+?)\s*$/m);
  const t = m?.[1];
  return t && !/aqui|aquí/i.test(t) ? t : null;
}

// Diagnóstico paso a paso: dice exactamente qué falta en vez de fallar seco.
async function setup() {
  const token = soloToken();
  if (!token) {
    console.log(`
✗ Falta el token.

  1. En Telegram busca @BotFather → /newbot → sigue los pasos.
  2. Copia el token (formato 1234567890:AA...).
  3. Pégalo en .env, en la línea:  TELEGRAM_BOT_TOKEN=
  4. Vuelve a correr:  node src/telegram.mjs --setup
`);
    return 1;
  }

  // 1) ¿el token es válido? getMe lo confirma sin efectos secundarios
  let bot;
  try {
    const res = await fetch(`${API}/bot${token}/getMe`);
    const j = await res.json();
    if (!j.ok) {
      console.log(`\n✗ El token no es válido (Telegram responde: ${j.description}).`);
      console.log('  Revisa que lo copiaste completo, sin espacios ni la palabra "bot" adelante.\n');
      return 1;
    }
    bot = j.result;
    console.log(`\n✓ Token válido — bot @${bot.username} ("${bot.first_name}")`);
  } catch (e) {
    console.log(`\n✗ No pude contactar a Telegram: ${e.message}\n`);
    return 1;
  }

  // 2) ¿hay un webhook puesto? bloquearía getUpdates con un 409
  try {
    const w = await (await fetch(`${API}/bot${token}/getWebhookInfo`)).json();
    if (w.ok && w.result?.url) {
      console.log(`\n⚠ Hay un webhook configurado (${w.result.url}): eso impide leer mensajes por polling.`);
      console.log(`  Quítalo abriendo:  ${API}/bot<TOKEN>/deleteWebhook\n`);
      return 1;
    }
  } catch { /* no crítico */ }

  // 3) buscar el chat ID en los mensajes recibidos
  const res = await fetch(`${API}/bot${token}/getUpdates`);
  const j = await res.json();
  if (!j.ok) {
    console.log(`\n✗ getUpdates falló: ${j.description}\n`);
    return 1;
  }
  const chats = new Map();
  for (const u of j.result ?? []) {
    const c = u.message?.chat ?? u.edited_message?.chat;
    if (c) chats.set(c.id, c);
  }

  if (!chats.size) {
    console.log(`
⚠ El bot funciona, pero todavía no recibió ningún mensaje.

  Abre Telegram, busca  @${bot.username}  y escríbele cualquier cosa ("hola").
  Después vuelve a correr:  node src/telegram.mjs --setup

  Nota: los mensajes se consumen al leerlos. Si ya le escribiste y abriste
  getUpdates en el navegador, ese mensaje ya se gastó — mándale otro.
`);
    return 1;
  }

  console.log('\n✓ Mensajes encontrados. Tu chat ID:\n');
  for (const [id, c] of chats) {
    const quien = [c.first_name, c.username && `@${c.username}`].filter(Boolean).join(' ');
    console.log(`    TELEGRAM_CHAT_ID=${id}      ← ${quien || c.type}`);
  }
  console.log(`
  Pega esa línea en .env (reemplazando la que está vacía) y prueba con:
     node src/telegram.mjs
`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--login') || process.argv.includes('--pass')) {
    // Se leen por stdin: no quedan en el historial de la shell ni en los
    // argumentos del proceso (visibles con `ps`). Se acumulan en una cola
    // porque stdin puede entregar varias líneas en un solo chunk.
    const cola = [];
    const esperando = [];
    process.stdin.setEncoding('utf8');
    let resto = '';
    process.stdin.on('data', c => {
      resto += c;
      let i;
      while ((i = resto.indexOf('\n')) >= 0) {
        const linea = resto.slice(0, i).trim();
        resto = resto.slice(i + 1);
        if (esperando.length) esperando.shift()(linea);
        else cola.push(linea);
      }
    });
    const leer = etiqueta => new Promise(r => {
      process.stdout.write(etiqueta);
      if (cola.length) return r(cola.shift());
      esperando.push(r);
    });
    const usuario = await leer('Usuario: ');
    const clave = await leer('Clave: ');
    if (usuario.length < 3 || clave.length < 6) {
      console.log('\n✗ Usuario de 3+ caracteres y clave de 6+.');
      process.exit(1);
    }
    console.log(`\nPegá esta línea en .env (reemplazando la anterior):\n\nTELEGRAM_PASS=${generarHash(usuario, clave)}\n`);
    process.exit(0);
  }
  if (process.argv.includes('--setup')) {
    process.exit(await setup());
  }
  if (!telegramActivo()) {
    console.log('✗ Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env');
    console.log('  Corre:  node src/telegram.mjs --setup');
    process.exit(1);
  }
  const r = await enviar('✓ <b>Kripto Wallet</b> conectado.\nEscribe /ayuda para ver los comandos.');
  console.log(r.ok ? '✓ Mensaje enviado' : `✗ Falló: ${r.motivo}`);
  process.exit(r.ok ? 0 : 1);
}
