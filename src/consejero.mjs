// CONSEJERO — Claude leyendo la evidencia que el motor ya registró.
//
// QUÉ HACE Y QUÉ NO. Este módulo no decide nada: redacta borradores sobre
// hechos ya ocurridos y los deja esperando que Jorge los confirme. En concreto:
//
//   · veredictos de jugadas CERRADAS (13 de 16 no tienen ninguno, y el bucle de
//     aprendizaje está muerto ahí porque escribirlos a mano es tedioso)
//   · contradicciones entre las hipótesis abiertas
//   · el argumento EN CONTRA de una oferta, antes de aprobarla
//
// LO QUE NO HACE, POR DISEÑO:
//   · No entra al camino del dinero. La compuerta sigue siendo JavaScript
//     determinista. Un modelo de lenguaje falla exactamente como fallaron los
//     controles podridos que auditamos: **sigue diciendo OK, con mejor prosa**.
//     Es la peor clase posible de control.
//   · No predice precios. Ya está medido dos veces que no hay señal de
//     dirección (backtest de 2.000 casos: 51,1% para comprar al azar, ninguna
//     señal le gana). Pedirle un pronóstico sería fabricar un número con cara
//     de dato.
//   · No escribe en el registro. Devuelve borradores; el veredicto lo registra
//     Jorge por el endpoint de siempre.
//
// EL TEXTO QUE LEE ES DATO, NO INSTRUCCIÓN. Las tesis y los motivos los escribe
// Jorge, pero el nombre de un activo o una nota podrían contener cualquier
// cosa. La respuesta se valida contra la lista cerrada de veredictos y se
// descarta si no encaja: nada de lo que diga el modelo se ejecuta.
//
// Sin `ANTHROPIC_API_KEY` en el .env, todo esto queda inerte y el resto del
// sistema funciona igual. La key la pega Jorge, nunca el asistente.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
const DATA = process.env.KW_DATA || join(ROOT, 'data');
const API = 'https://api.anthropic.com/v1/messages';

// Sonnet por defecto: la tarea es de JUICIO (distinguir una tesis equivocada de
// una tesis correcta mal ejecutada), no de resumen. Se puede bajar a Haiku con
// KW_MODELO si el costo importara — con estos volúmenes son centavos al mes.
const MODELO = process.env.KW_MODELO || 'claude-sonnet-5';
const MAX_TOKENS = 1200;
// Tope por invocación. No es por costo —son centavos— sino porque un borrador
// que Jorge no va a leer hoy es ruido: mejor pocos y revisados.
const MAX_POR_TANDA = 5;

function leerEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

// La key puede venir del entorno o del .env. El entorno primero: así los tests
// pueden ejercitar el camino completo sin tocar el .env real, y así se puede
// correr con una key distinta sin editar archivos.
const claveAPI = () => process.env.ANTHROPIC_API_KEY || leerEnv().ANTHROPIC_API_KEY;

export function disponible() {
  const k = claveAPI();
  return Boolean(k && k.length > 20 && !/aqui|xxx|tu_/i.test(k));
}

// Llamada cruda. Devuelve el texto; quien llama decide qué hacer con él.
async function preguntar(system, prompt) {
  if (!disponible()) {
    const e = new Error('Falta ANTHROPIC_API_KEY en el .env (la pega Jorge; ver .env.example)');
    e.codigo = 503;
    throw e;
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': claveAPI(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

// El modelo devuelve prosa alrededor del JSON más veces de las que uno querría.
// Se extrae el primer objeto balanceado en vez de confiar en que la respuesta
// entera sea JSON: es la diferencia entre un borrador y una excepción.
function extraerJSON(texto) {
  const i = texto.indexOf('{');
  if (i < 0) return null;
  let nivel = 0;
  for (let j = i; j < texto.length; j++) {
    if (texto[j] === '{') nivel++;
    else if (texto[j] === '}' && --nivel === 0) {
      try { return JSON.parse(texto.slice(i, j + 1)); } catch { return null; }
    }
  }
  return null;
}

const leerJSONL = f => existsSync(f)
  ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// --- PASO 10 · VEREDICTOS ASISTIDOS ------------------------------------------

const SYSTEM_VEREDICTO = `Eres un analista revisando operaciones YA CERRADAS de un simulador de paper trading. Tu trabajo es clasificar qué se aprende de cada una, no recomendar operaciones ni predecir precios.

La distinción que importa —y es la razón de existir de esta tarea— es entre:
- "tesis-correcta": el razonamiento de entrada era bueno y el resultado lo confirmó.
- "tesis-correcta-mala-ejecucion": el razonamiento era bueno pero la salida lo arruinó (salió demasiado pronto, el stop era muy estrecho, el plazo la cortó). Se detecta mirando qué hizo el precio DESPUÉS de vender.
- "tesis-equivocada": el razonamiento de entrada no se sostenía.
- "ruido-de-mercado": ni una cosa ni la otra; el movimiento no tuvo relación con la tesis.

Estas cuatro se corrigen de formas opuestas, y confundir las dos primeras es el error caro: lleva a cambiar el criterio de entrada cuando el problema era la salida.

Responde SOLO con un objeto JSON:
{"veredicto": "<una de las cuatro>", "leccion": "<una frase, concreta, sobre qué cambiar o confirmar>", "confianza": "alta|media|baja", "porQue": "<dos frases citando los números que la sostienen>"}

Si los datos no alcanzan para distinguir, usa confianza "baja" y dilo en porQue. No inventes causas que los datos no muestren.`;

// Arma la evidencia de UNA jugada: entrada, salida, y qué pasó después.
function evidenciaDe(pos, decisiones, seguimiento) {
  const d = decisiones.get(pos.id) ?? null;
  const s = seguimiento[pos.id] ?? null;
  const ctx = d?.contexto ?? {};
  const horas = pos.cerrado && pos.abierto
    ? ((Date.parse(pos.cerrado) - Date.parse(pos.abierto)) / 3_600_000).toFixed(0) : null;
  return {
    id: pos.id, asset: pos.asset,
    entrada: pos.entrada, salida: pos.precioSalida,
    resultadoPct: pos.pnlPct != null ? Number(pos.pnlPct.toFixed(2)) : null,
    motivoCierre: pos.motivoCierre, horasAbierta: horas,
    nivelesFijados: { objetivoPct: pos.objetivoPct, limitePct: pos.limitePct, plazoHoras: pos.horizonteHoras ?? null },
    tesisDeclarada: d?.tesis ?? null,
    scoreAlEntrar: d?.score ?? null,
    senal: d?.senalNombre ?? d?.senal ?? null,
    contextoAlEntrar: {
      rsi14d: ctx.rsi14d ?? null, momentum30dPct: ctx.momentum30dPct ?? null,
      regimen: ctx.regimen?.tipo ?? ctx.regimen ?? null,
      volatilidadDiariaPct: ctx.volatilidadDiariaPct ?? null,
      distanciaAlTecho30dPct: ctx.distanciaMax30dPct ?? null,
    },
    // LO DECISIVO para separar "tesis correcta" de "mala ejecución"
    despuesDeVender: s ? {
      a24hPct: s.h24Pct != null ? Number(s.h24Pct.toFixed(2)) : null,
      a48hPct: s.h48Pct != null ? Number(s.h48Pct.toFixed(2)) : null,
      maximoPct: s.maximoPct != null ? Number(s.maximoPct.toFixed(2)) : null,
    } : null,
    motorQueDecidio: pos.version ?? null,
  };
}

// Devuelve BORRADORES. No registra nada: el veredicto lo confirma Jorge.
export async function borradoresDeVeredicto({ limite = MAX_POR_TANDA } = {}) {
  const pos = JSON.parse(readFileSync(join(DATA, 'posiciones.json'), 'utf8')).posiciones;
  const regs = leerJSONL(join(DATA, 'aprendizaje.jsonl'));
  const conVeredicto = new Set(regs.filter(r => r.tipo === 'veredicto').map(r => r.posicionId));
  const decisiones = new Map(regs.filter(r => r.tipo === 'decision').map(r => [r.posicionId, r]));
  const seguimiento = existsSync(join(DATA, 'seguimiento.json'))
    ? JSON.parse(readFileSync(join(DATA, 'seguimiento.json'), 'utf8')) : {};

  const pendientes = pos
    .filter(p => p.estado === 'cerrada' && p.pnlPct != null && !conVeredicto.has(p.id))
    .sort((a, b) => (b.cerrado ?? '').localeCompare(a.cerrado ?? ''))
    .slice(0, limite);

  if (!pendientes.length) return { borradores: [], pendientesTotal: 0 };

  const VEREDICTOS = ['tesis-correcta', 'tesis-correcta-mala-ejecucion', 'tesis-equivocada', 'ruido-de-mercado'];
  const borradores = [];
  for (const p of pendientes) {
    const ev = evidenciaDe(p, decisiones, seguimiento);
    try {
      const texto = await preguntar(SYSTEM_VEREDICTO,
        `Operación cerrada a revisar:\n\n${JSON.stringify(ev, null, 2)}`);
      const j = extraerJSON(texto);
      // Validación dura contra la lista cerrada: si el modelo inventa una
      // categoría, el borrador se marca inválido en vez de colarse al registro.
      const valido = j && VEREDICTOS.includes(j.veredicto);
      borradores.push({
        posicionId: p.id, asset: p.asset, resultadoPct: ev.resultadoPct,
        motivoCierre: p.motivoCierre,
        veredicto: valido ? j.veredicto : null,
        leccion: valido ? String(j.leccion ?? '').slice(0, 400) : null,
        confianza: valido ? j.confianza ?? null : null,
        porQue: valido ? String(j.porQue ?? '').slice(0, 600) : null,
        invalido: !valido ? `respuesta fuera del formato: ${texto.slice(0, 200)}` : null,
        evidencia: ev,
        modelo: MODELO,
      });
    } catch (e) {
      borradores.push({ posicionId: p.id, asset: p.asset, error: e.message });
    }
  }
  const totalPendientes = pos.filter(p => p.estado === 'cerrada' && p.pnlPct != null && !conVeredicto.has(p.id)).length;
  return {
    borradores,
    pendientesTotal: totalPendientes,
    quedan: Math.max(0, totalPendientes - borradores.length),
    // Se dice explícito porque es la propiedad que hace seguro a todo esto.
    nota: 'Son BORRADORES. Ninguno se registró: confirmá o corregí cada uno con POST /api/veredicto.',
  };
}

// --- PASO 11 · CURADOR DE HIPÓTESIS ------------------------------------------

const SYSTEM_HIPOTESIS = `Eres un revisor del registro de hipótesis de un sistema de trading simulado. Recibes las hipótesis con su estado y su evidencia.

Buscas SOLO tres cosas:
1. CONTRADICCIONES: dos hipótesis que no pueden ser ambas ciertas.
2. DESACTUALIZADAS: una hipótesis cuyo mecanismo ya no existe en el sistema, o cuya evidencia apunta ahora en contra de lo que afirma.
3. DUPLICADAS: dos que dicen lo mismo con otras palabras.

No propongas hipótesis nuevas ni evalúes si la estrategia es buena. Si no encuentras nada de las tres categorías, dilo: un revisor que siempre encuentra algo no sirve.

Responde SOLO con JSON:
{"hallazgos": [{"tipo": "contradiccion|desactualizada|duplicada", "ids": ["..."], "explicacion": "<dos frases>", "sugerencia": "<qué haría>"}]}`;

export async function curarHipotesis() {
  const f = join(DATA, 'hipotesis.json');
  if (!existsSync(f)) return { hallazgos: [], n: 0 };
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const hs = (d.hipotesis ?? d).map(h => ({
    id: h.id, estado: h.estado, enunciado: h.enunciado,
    evidencia: (h.evidencia ?? []).slice(0, 4),
    contraevidencia: (h.contraevidencia ?? []).slice(0, 3),
    resolucion: h.resolucion ?? null,
  }));
  const texto = await preguntar(SYSTEM_HIPOTESIS, JSON.stringify(hs, null, 2));
  const j = extraerJSON(texto);
  return {
    n: hs.length,
    hallazgos: Array.isArray(j?.hallazgos) ? j.hallazgos.slice(0, 12) : [],
    crudo: j ? null : texto.slice(0, 400),
    modelo: MODELO,
    nota: 'Revisión asistida: ningún estado se cambió. Las hipótesis se editan a mano.',
  };
}

// --- PASO 11b · ABOGADO DEL DIABLO -------------------------------------------

const SYSTEM_ABOGADO = `Argumentas EN CONTRA de una operación propuesta, usando el historial de operaciones parecidas que recibes. No decides: das el mejor argumento contrario para que una persona decida mejor.

No predices el precio —está medido que ninguna señal de dirección supera al azar en este mercado— así que no digas si va a subir o bajar. Argumenta sobre el SETUP y sobre lo que pasó en casos parecidos.

Responde SOLO con JSON:
{"enContra": ["<argumento con el dato que lo sostiene>", "..."], "aFavor": ["<lo más fuerte del otro lado, para no ser un espantapájaros>"], "casosParecidos": "<qué pasó en el historial parecido, con números>", "loQueNoSePuedeSaber": "<qué falta para decidir bien>"}`;

export async function abogadoDelDiablo(oferta) {
  const pos = existsSync(join(DATA, 'posiciones.json'))
    ? JSON.parse(readFileSync(join(DATA, 'posiciones.json'), 'utf8')).posiciones : [];
  const cerradas = pos.filter(p => p.estado === 'cerrada' && p.pnlPct != null).map(p => ({
    asset: p.asset, resultadoPct: Number((p.pnlPct ?? 0).toFixed(1)),
    motivoCierre: p.motivoCierre, objetivoPct: p.objetivoPct, limitePct: p.limitePct,
  }));
  const texto = await preguntar(SYSTEM_ABOGADO, JSON.stringify({
    propuesta: oferta, historialCerrado: cerradas,
  }, null, 2));
  const j = extraerJSON(texto);
  return { ...(j ?? { crudo: texto.slice(0, 600) }), modelo: MODELO };
}

export const _test = { extraerJSON, evidenciaDe, MAX_POR_TANDA };
