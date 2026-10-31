import { COMMON_NAMES, FIRST_NAMES, SURNAMES } from './names.ts';
import { debtBand } from './household.ts';
import { CAUSE_ASK, protestFor } from './associations.ts';
import { tickToDate } from '@bitopolis/shared';
import { z } from 'zod';
import { ACTION_LABELS, cleanMotivo, MOTIVO_MAX } from './decisions.ts';
import { BUILD_NAMES } from './commands.ts';
import type { Citizen, GameState, Pending } from './state.ts';
import { GOAL_TEXT, HOOK_TEXT, hookFor, memoryText, NEED_TEXT } from './social.ts';
import { averageHappiness } from './tick.ts';
import { daysToElection, FACTION_TEXT, factionOf, politicsActive } from './politics.ts';

/**
 * Petición a la IA para un lote de decisiones (spec §9.2).
 * - Prefijo fijo primero (reglas y formato), para aprovechar el caché.
 * - Solo enums y números del motor: nunca texto libre del jugador.
 * - Salida estructurada con enum de acciones válidas; se valida con zod.
 */

export const PROMPT_VERSION = 5;

export const SYSTEM_PROMPT = `Eres el narrador de Bitópolis, un pueblo español pequeño. Interpretas a vecinos con nombre que toman UNA decisión cada uno.

Reglas:
- Para cada vecino, elige exactamente una acción de su lista "acciones". No inventes acciones.
- Decide según su personalidad (rasgos 0-100), su deseo, su miedo, su situación y sus recuerdos. La "terquedad" alta puede llevarle a decisiones poco racionales.
- "motivo": una frase corta (máx. ${MOTIVO_MAX} caracteres) en primera persona, en español de España, natural y con personalidad. Sin comillas, sin emojis, sin mencionar números de rasgos ni que eres una IA.
- Cada motivo debe ser distinto: usa su profesión, relaciones, recuerdos y el "gancho" si lo hay. Nada de cifras ni euros en el motivo.
- Habla con el "tono" de cada vecino: no todos suenan igual. El tono cambia cómo habla, no lo que sabe: sin cifras ni personas fuera de los datos.
- No menciones a nadie que no esté en los datos (ni nombres inventados).
- Responde solo con JSON que cumpla el esquema.

Ejemplos de tono (no los copies):
- "Con lo que pago de alquiler, como suba algo más me planto."
- "Mi abuela decía que un pueblo sin parque es un pueblo triste. Pues eso."
- "Que sí, que me quedo. Aquí al menos me saludan por la calle." 

Significado de las acciones:
${Object.entries(ACTION_LABELS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}
- aceptar_trabajo:<id>: aceptar ese empleo concreto.
- pedir:<cosa>: pedir al alcalde esa mejora.
- fundar:<tipo>: abrir ese negocio con sus ahorros.`;

const TRIGGER_TEXT: Record<string, string> = {
  llegada: 'acaba de mudarse al pueblo y se presenta',
  sin_trabajo: 'trabaja fuera del pueblo y hay empleos libres aquí',
  infeliz: 'está descontento con la vida en el pueblo',
  subida_impuestos: 'el alcalde acaba de subir los impuestos',
  ahorros: 'ha ahorrado bastante dinero',
  opinion: 'el alcalde pasea por el pueblo y le pregunta qué tal',
  comprar_casa: 'podría comprar la vivienda en la que vive de alquiler',
  emprender: 'tiene ahorros y hay un local comercial libre',
  elecciones: 'hay elecciones municipales en unos días y decide su voto (secreto)',
  protesta: 'su asociación de vecinos convoca una manifestación ante el ayuntamiento y decide si va',
  deudas: 'debe dinero (no le llegó para pagarlo todo) y decide qué hacer'
};

const band = (n: number, cuts: number[], names: string[]) => names[cuts.findIndex((c) => n < c) === -1 ? names.length - 1 : cuts.findIndex((c) => n < c)]!;

function townSummary(state: GameState) {
  const d = tickToDate(state.tick);
  const kinds = new Set(state.buildings.filter((b) => b.built).map((b) => b.kind));
  return {
    fecha: `día ${d.day}, mes ${d.month}, año ${d.year}`,
    poblacion: state.citizens.length,
    impuestos: state.taxesSplit ? Object.fromEntries(Object.entries(state.taxes).map(([k, v]) => [k, { low: 'bajo', medium: 'medio', high: 'alto' }[v]])) : { low: 'bajos', medium: 'medios', high: 'altos' }[state.taxLevel],
    felicidad_media: Math.round(averageHappiness(state)),
    caja_ayuntamiento: band(state.treasury, [0, 5_000, 30_000], ['en deuda', 'justa', 'normal', 'holgada']),
    servicios: ['water', 'power', 'park', 'school', 'clinic', 'police', 'bar', 'chapel', 'cemetery', 'library', 'sports', 'shop', 'factory'].filter((k) => kinds.has(k as never)).map((k) => BUILD_NAMES[k]!.toLowerCase()),
    ...(politicsActive(state) ? { politica: politicsView(state) } : {}),
  };
}

/** Política como datos del motor (v1.0): quién gobierna, quién se opone y cuándo se vota. */
function politicsView(state: GameState) {
  const p = state.politics;
  const rival = p.party ? `${p.party.leaderName}, de «${p.party.name}» (facción ${FACTION_TEXT[p.party.faction].toLowerCase()})` : null;
  return {
    gobierna: p.mayor === 'player' ? 'el alcalde actual' : rival,
    oposicion: p.mayor === 'player' ? (rival ?? 'ninguna candidatura') : 'el antiguo alcalde',
    elecciones_en_dias: daysToElection(state),
  };
}

/**
 * Tono de voz (v1.3): sale de los rasgos y, si ninguno destaca, del id. Da
 * variedad a los motivos sin texto libre: es una etiqueta del motor.
 */
export function toneOf(c: Citizen): string {
  const t = c.traits;
  const top = Math.max(t.terco, t.social, t.ahorro, t.ambicion);
  if (top >= 70) {
    if (top === t.terco) return 'cabezota, no da su brazo a torcer';
    if (top === t.social) return 'cercano y bromista';
    if (top === t.ahorro) return 'prudente, habla de ahorrar sin dar cantidades';
    return 'ambicioso y directo';
  }
  return ['tranquilo, de pocas palabras', 'irónico', 'seco pero noble', 'entrañable, habla del pueblo con cariño', 'quejica con gracia'][c.id % 5]!;
}

/**
 * ¿Menciona a una persona que no está en los datos? Solo cuentan palabras que
 * son nombres o apellidos de verdad (los del juego y los habituales en España),
 * también al principio de la frase, comparadas enteras y sin tildes (ronda 09:
 * antes, «Lunes», «Don» o «Comisaría» tiraban respuestas buenas).
 */
const fold = (w: string) => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const PERSON_NAMES = new Set([...FIRST_NAMES, ...SURNAMES, ...COMMON_NAMES].map(fold));
export function inventedName(text: string, sent: string): string | null {
  const known = new Set((sent.match(/\p{L}+/gu) ?? []).map(fold));
  for (const m of text.matchAll(/\p{Lu}\p{Ll}+/gu)) {
    const w = fold(m[0]);
    // Dentro de otra palabra («McDonald») no cuenta.
    const prev = text[m.index - 1];
    if (prev && /\p{L}/u.test(prev)) continue;
    if (PERSON_NAMES.has(w) && !known.has(w)) return m[0];
  }
  return null;
}

function citizenView(state: GameState, c: Citizen, p: Pending) {
  const job = state.buildings.find((b) => b.id === c.jobId);
  const home = state.buildings.find((b) => b.id === c.homeId);
  return {
    vecino: c.id,
    nombre: c.name,
    edad: c.age,
    ...(politicsActive(state)
      ? { faccion: FACTION_TEXT[factionOf(state, c)].toLowerCase(), faccion_pide: state.politics.factions[factionOf(state, c)].demand ?? 'nada en especial' }
      : {}),
    rasgos: { terquedad: c.traits.terco, ahorrador: c.traits.ahorro, sociable: c.traits.social, ambicioso: c.traits.ambicion },
    tono: toneOf(c),
    deseo: c.desire.replace('_', ' '),
    miedo: c.fear,
    felicidad: Math.round(c.happiness),
    dinero: band(c.money, [300, 1_500, 4_000], ['casi nada', 'poco', 'algo', 'bastante']),
    // v1.9: la deuda va por tramos, nunca la cifra.
    deuda: debtBand(c),
    ...(c.jobId === null && c.unemployedSince !== undefined ? { en_paro: true } : {}),
    casa: home ? (c.owns ? 'vivienda en propiedad' : home.kind === 'house' ? 'casa municipal de alquiler' : 'piso de alquiler') : 'sin casa',
    hipoteca: c.mortgage > 0,
    trabajo: job ? BUILD_NAMES[job.kind]!.toLowerCase() : c.unemployedSince !== undefined ? 'en paro' : 'fuera del pueblo',
    profesion: c.profession,
    meta: GOAL_TEXT[c.goal],
    // Capa 1 (hechos) y capa 2 (recuerdos): solo datos y plantillas del motor.
    relaciones: c.relations.map((r) => ({ con: state.citizens.find((x) => x.id === r.id)?.name.split(' ')[0] ?? '?', tipo: r.kind, intensidad: r.strength >= 70 ? 'fuerte' : r.strength >= 40 ? 'media' : 'leve' })),
    promesas_pendientes: state.promises.filter((p) => p.status === 'pending' && p.supporters.includes(c.id)).map((p) => NEED_TEXT[p.need]),
    recuerdos: [...c.memories].sort((a, b) => b.importance - a.importance).slice(0, 3).map((m) => memoryText(state, m)),
    gancho: hookFor(state, c.id) ? HOOK_TEXT[hookFor(state, c.id)!.kind] : null,
    situacion: TRIGGER_TEXT[p.trigger],
    ...(p.trigger === 'protesta' && protestFor(state, c)
      ? { asociacion: { piden: CAUSE_ASK[protestFor(state, c)!.cause], es_lider: protestFor(state, c)!.leaderId === c.id, socios: protestFor(state, c)!.members.length } }
      : {}),
    acciones: p.actions.map((a) => {
      const [v, arg] = a.split(':');
      if (v === 'aceptar_trabajo') {
        const b = state.buildings.find((x) => x.id === Number(arg));
        return { accion: a, detalle: `empleo en ${BUILD_NAMES[b?.kind ?? '']?.toLowerCase() ?? '?'}` };
      }
      return { accion: a };
    }),
  };
}

export function recentMotivos(state: GameState, citizenId: number, n = 2): string[] {
  const out: string[] = [];
  for (let i = state.decisionLog.length - 1; i >= 0 && out.length < n; i--) {
    const d = state.decisionLog[i]!;
    if (d.citizenId === citizenId) out.push(d.motivo);
  }
  return out;
}

export interface DecisionRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  citizenIds: number[];
}

export function buildDecisionRequest(state: GameState, pendings: Pending[]): DecisionRequest {
  const list = pendings
    .map((p) => ({ p, c: state.citizens.find((c) => c.id === p.citizenId) }))
    .filter((x): x is { p: Pending; c: Citizen } => !!x.c);
  const ids = list.map((x) => x.c.id);
  // Prefijo fijo (reglas + estado del pueblo del día) y al final lo variable.
  const system = `${SYSTEM_PROMPT}\n\nEstado del pueblo hoy: ${JSON.stringify(townSummary(state))}`;
  const user = JSON.stringify({ vecinos: list.map((x) => citizenView(state, x.c, x.p)) });
  // Esquema por vecino: cada uno solo puede elegir entre SUS acciones.
  const perCitizen = list.map((x) => ({
    type: 'object',
    additionalProperties: false,
    required: ['vecino', 'accion', 'motivo'],
    properties: {
      vecino: { type: 'integer', enum: [x.c.id] },
      accion: { type: 'string', enum: x.p.actions },
      motivo: { type: 'string' },
    },
  }));
  return {
    system,
    user,
    citizenIds: ids,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decisiones'],
      properties: {
        decisiones: { type: 'array', items: perCitizen.length === 1 ? perCitizen[0]! : { anyOf: perCitizen } },
      },
    },
  };
}

const Response = z.object({
  decisiones: z.array(z.object({ vecino: z.number().int(), accion: z.string(), motivo: z.string() })),
});

export interface ParsedDecisions {
  decisions: { citizenId: number; action: string; motivo: string }[];
  /** Vecinos con respuesta inválida o ausente. */
  invalid: number[];
  error?: string;
  /** Causa de cada inválido (para medir). */
  reasons: Record<string, number>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-záéíóúñü ]/g, '').replace(/\s+/g, ' ').trim();

/** Valida la respuesta: JSON, esquema y acción permitida para cada vecino. */
/** `known`: el texto enviado (prompt); si se pasa, se rechazan motivos con nombres que no salen en él. */
export function parseDecisions(raw: string, pendings: Pending[], recent: Record<number, string[]> = {}, allowRepeat = false, known?: string): ParsedDecisions {
  const all = pendings.map((p) => p.citizenId);
  let data: unknown;
  try {
    const trimmed = raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, '');
    data = JSON.parse(trimmed);
  } catch {
    return { decisions: [], invalid: all, error: 'JSON no válido', reasons: { json: all.length } };
  }
  const r = Response.safeParse(data);
  if (!r.success) return { decisions: [], invalid: all, error: 'no cumple el esquema', reasons: { esquema: all.length } };
  const decisions: ParsedDecisions['decisions'] = [];
  const reasons: Record<string, number> = {};
  const bad = (k: string) => (reasons[k] = (reasons[k] ?? 0) + 1);
  for (const p of pendings) {
    const d = r.data.decisiones.find((x) => x.vecino === p.citizenId);
    if (!d) {
      bad('falta_vecino');
      continue;
    }
    if (!p.actions.includes(d.accion)) {
      bad('accion_no_permitida');
      continue;
    }
    const motivo = cleanMotivo(d.motivo);
    if (motivo.length < 4) bad('motivo_vacio');
    else if (/[0-9€]/.test(motivo)) bad('motivo_con_cifras');
    else if (!allowRepeat && (recent[p.citizenId] ?? []).some((m) => norm(m) === norm(motivo))) bad('motivo_repetido');
    else if (known !== undefined && inventedName(motivo, known)) bad('nombre_inventado');
    else decisions.push({ citizenId: p.citizenId, action: d.accion, motivo });
  }
  const ok = new Set(decisions.map((d) => d.citizenId));
  const invalid = all.filter((id) => !ok.has(id));
  return { decisions, invalid, reasons, ...(invalid.length ? { error: Object.keys(reasons).join(', ') } : {}) };
}

/* ---------------- textos premium (v0.4) ---------------- */

export const TEXT_SYSTEM = `Eres la voz de Bitópolis, un pueblo español pequeño. Escribes en español de España, cercano y con humor suave.
Reglas:
- Usa solo los datos que te dan (JSON del juego). No inventes cifras, nombres ni edificios.
- Sin markdown, sin emojis, sin comillas al principio o al final.
- Responde solo con JSON que cumpla el esquema.`;

const TEXT_SCHEMA = (max: number) => ({
  type: 'object',
  additionalProperties: false,
  required: ['texto'],
  properties: { texto: { type: 'string', description: `máximo ${max} caracteres` } },
});

export interface TextRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  max: number;
}

export function buildTalkRequest(state: GameState, c: Citizen, question: 'como_estas' | 'que_necesitas' | 'me_votarias'): TextRequest {
  const q = { como_estas: '¿Cómo estás?', que_necesitas: '¿Qué necesitas?', me_votarias: '¿Me votarías?' }[question];
  const p: Pending = { citizenId: c.id, trigger: 'opinion', actions: [], createdTick: state.tick, dueTick: state.tick };
  const v = citizenView(state, c, p);
  const { acciones: _a, situacion: _s, ...rest } = v;
  void _a;
  void _s;
  return {
    system: `${TEXT_SYSTEM}\n- Hablas como el vecino, en primera persona, en 1 o 2 frases (máx. 220 caracteres).\n\nEstado del pueblo: ${JSON.stringify(townSummary(state))}`,
    user: JSON.stringify({ vecino: rest, pregunta_del_alcalde: q }),
    schema: TEXT_SCHEMA(220),
    max: 220,
  };
}

export function buildAdvisorRequest(state: GameState, facts: Record<string, unknown>, question: 'como_va' | 'que_cambiarias'): TextRequest {
  const q = question === 'como_va' ? '¿Cómo va el pueblo?' : '¿Qué cambiarías?';
  return {
    system: `${TEXT_SYSTEM}\n- Eres el consejero del alcalde: concreto, en 2 o 3 frases (máx. 400 caracteres), con los datos reales.`,
    user: JSON.stringify({ datos: facts, pregunta: q }),
    schema: TEXT_SCHEMA(400),
    max: 400,
  };
}

export function buildChronicleRequest(state: GameState, facts: Record<string, unknown>, events: string[]): TextRequest {
  return {
    system: `${TEXT_SYSTEM}\n- Eres el cronista del pueblo: escribe la crónica del mes en un párrafo (máx. 700 caracteres) con la voz de los vecinos.`,
    user: JSON.stringify({ datos: facts, sucesos_del_mes: events.slice(-25) }),
    schema: TEXT_SCHEMA(700),
    max: 700,
  };
}

/** Valida un texto premium: JSON, longitud y cifras que existan en los datos. */
export function parseText(raw: string, req: TextRequest): string | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
  } catch {
    return null;
  }
  const t = (data as { texto?: unknown })?.texto;
  if (typeof t !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = t.replace(/[\u0000-\u001f<>`*_#]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 4 || text.length > req.max + 40) return null;
  // Lista blanca: toda cifra del texto tiene que ser, exactamente, una de los datos enviados
  // (no de las reglas: «220 caracteres» no autoriza a decir «20»).
  const sent = req.user + '\n' + req.system.split('\n').filter((l) => !l.startsWith('- ') && !TEXT_SYSTEM.includes(l)).join('\n');
  const allowed = new Set<string>();
  for (const m of sent.match(/\d+(?:\.\d+)?/g) ?? []) {
    const v = Number(m);
    allowed.add(String(v)).add(String(Math.round(v))).add(String(Math.trunc(v)));
  }
  for (const n of text.match(/\d[\d.,]*/g) ?? []) {
    // «5.354» es 5354 y «64,5» es 64.5.
    const v = Number(n.replace(/[.,]$/, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    if (!allowed.has(String(v))) return null;
  }
  // Nada de vecinos ni sitios inventados.
  if (inventedName(text, req.user + '\n' + req.system)) return null;
  return text;
}
