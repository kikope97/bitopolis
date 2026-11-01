/**
 * 2.4 (bloque D): el pleno hablado. Hasta 4 vecinos con nombre intervienen
 * (quien pide, la oposición si pregunta, uno a favor y uno en contra). El motor
 * decide quién habla y con qué postura (`plenoSpeakers` en social.ts); la IA
 * solo redacta una línea por vecino (≤ 140), validada con `parseText`. El texto
 * no entra en el estado ni en el hash: el cliente lo pide y lo muestra.
 * Respaldo: plantillas con `NEED_TEXT` y `toneOf`.
 */
import { PLENO_TALK } from './balance.ts';
import { hash32 } from './hash.ts';
import { parseText, TEXT_SYSTEM, type TextRequest, toneOf } from './prompt.ts';
import { memoryText, NEED_TEXT, type Need, PLENO_STANCES, type PlenoRole, type PlenoSpeaker, type PlenoStance, professionOf } from './social.ts';
import type { Citizen, GameState } from './state.ts';

/** Lo que hace falta del pleno (vale el `state.pleno` del motor o lo que manda el cliente al servidor). */
export interface PlenoTalkInput {
  tick: number;
  petitions: { id: number; citizenId: number; need: Need; yes: number; no: number; opposition?: boolean }[];
  /** Opcional como en `Pleno` (un pleno de antes de la 2.4 no tiene quien hable). */
  speakers?: Pick<PlenoSpeaker, 'id' | 'role' | 'postura' | 'petitionId'>[];
}
type Speaker = NonNullable<PlenoTalkInput['speakers']>[number];

export interface PlenoLine {
  id: number;
  role: PlenoRole;
  postura: PlenoStance;
  linea: string;
  source: 'ia' | 'reglas';
}

export interface PlenoRequest extends TextRequest {
  ids: number[];
}

const ROLE_TEXT: Record<PlenoRole, string> = {
  pide: 'hace la petición',
  oposicion: 'pregunta en nombre de la oposición',
  a_favor: 'apoya la petición',
  en_contra: 'está en contra de la petición',
};

const first = (c: Citizen | undefined) => c?.name.split(' ')[0] ?? 'el vecino';

/** Petición a la IA: solo datos del motor (ids, enums, plantillas). Nunca texto del jugador. */
export function buildPlenoRequest(state: GameState, pleno: PlenoTalkInput): PlenoRequest {
  const speakers = (pleno.speakers ?? []).map((s) => ({ s, c: state.citizens.find((x) => x.id === s.id && x.named) })).filter((x): x is { s: Speaker; c: Citizen } => !!x.c);
  const party = state.politics.party;
  const data = {
    peticiones: pleno.petitions.map((p) => ({
      la_pide: state.citizens.find((c) => c.id === p.citizenId)?.name ?? 'un vecino',
      pide: NEED_TEXT[p.need],
      votos_a_favor: p.yes,
      votos_en_contra: p.no,
      ...(p.opposition && party ? { oposicion: `«${party.name}»` } : {}),
    })),
    intervenciones: speakers.map(({ s, c }) => {
      const p = pleno.petitions.find((x) => x.id === s.petitionId);
      return {
        vecino: c.id,
        nombre: c.name,
        edad: c.age,
        profesion: professionOf(c),
        papel: ROLE_TEXT[s.role],
        postura: s.postura,
        sobre: p ? NEED_TEXT[p.need] : 'el pueblo',
        tono: toneOf(c),
        felicidad: Math.round(c.happiness),
        recuerdos: [...c.memories].sort((a, b) => b.importance - a.importance).slice(0, 2).map((m) => memoryText(state, m)),
      };
    }),
  };
  const ids = speakers.map((x) => x.c.id);
  return {
    system: `${TEXT_SYSTEM}
- Es el pleno municipal del pueblo. Escribe lo que dice en voz alta cada vecino de "intervenciones", en primera persona, en una frase (máx. ${PLENO_TALK.maxLine} caracteres), con su tono y su postura ("a_favor", "en_contra" o "matiz").
- Cada uno habla de lo que dice "sobre". No prometas nada en nombre del alcalde ni cuentes cómo acaba la votación.
- Un objeto por vecino, con su "vecino" (id) y su "postura".`,
    user: JSON.stringify(data),
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['intervenciones'],
      properties: {
        intervenciones: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['vecino', 'postura', 'linea'],
            properties: { vecino: { type: 'integer', enum: ids.length ? ids : [0] }, postura: { type: 'string', enum: [...PLENO_STANCES] }, linea: { type: 'string' } },
          },
        },
      },
    },
    max: PLENO_TALK.maxLine * Math.max(1, ids.length),
    ids,
  };
}

/**
 * Valida la respuesta: cada línea con `parseText` (cifras solo de los datos,
 * sin nombres inventados), ≤ `PLENO_TALK.maxLine`, un vecino del pleno con su
 * postura. Lo que no vale se descarta (ese vecino habla por plantilla).
 */
export function parsePleno(raw: string, req: PlenoRequest, pleno: PlenoTalkInput): { id: number; postura: PlenoStance; linea: string }[] {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
  } catch {
    return [];
  }
  const list = (data as { intervenciones?: unknown })?.intervenciones;
  if (!Array.isArray(list)) return [];
  const out: { id: number; postura: PlenoStance; linea: string }[] = [];
  const one: TextRequest = { ...req, max: PLENO_TALK.maxLine };
  for (const item of list) {
    const { vecino, postura, linea } = (item ?? {}) as { vecino?: unknown; postura?: unknown; linea?: unknown };
    const s = (pleno.speakers ?? []).find((x) => x.id === vecino);
    if (!s || !req.ids.includes(s.id) || out.some((x) => x.id === s.id) || postura !== s.postura || typeof linea !== 'string') continue;
    const text = parseText(JSON.stringify({ texto: linea }), one);
    if (!text || text.length > PLENO_TALK.maxLine) continue;
    out.push({ id: s.id, postura: s.postura, linea: text });
  }
  return out;
}

/* ---------------- respaldo: plantillas ---------------- */

/** Cómo arranca cada tono (etiqueta de `toneOf`). */
function opener(c: Citizen): string {
  const t = toneOf(c);
  if (t.startsWith('cabezota')) return 'Lo diré las veces que haga falta: ';
  if (t.startsWith('cercano')) return 'Buenas a todos. ';
  if (t.startsWith('prudente')) return 'Con calma y sin gastar de más: ';
  if (t.startsWith('ambicioso')) return 'Seamos claros: ';
  if (t.startsWith('irónico')) return 'Qué sorpresa, otro pleno. ';
  if (t.startsWith('entrañable')) return 'Por el bien del pueblo, ';
  if (t.startsWith('quejica')) return 'Como nadie hace caso, lo repito: ';
  return '';
}

const TEMPLATES: Record<PlenoRole, string[]> = {
  pide: ['vengo a pedir {need}. Lo necesitamos ya.', 'pido {need}. No es un capricho, es lo que falta.', 'traigo una petición sencilla: {need}.'],
  oposicion: ['{party} pregunta al alcalde cuándo va a haber {need}.', 'desde {party} queremos saber por qué seguimos sin {need}.'],
  a_favor: ['apoyo a {asker}: hace falta {need} y lo sabe todo el pueblo.', 'estoy con {asker}. Sin {need} esto no avanza.'],
  en_contra: ['yo no lo veo. Antes de {need} hay otras cosas que arreglar.', 'no estoy de acuerdo con pedir {need} ahora mismo.'],
};

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** La línea de un vecino por plantilla (determinista). */
export function plenoRuleLine(state: GameState, pleno: PlenoTalkInput, s: Speaker): string {
  const c = state.citizens.find((x) => x.id === s.id);
  const p = pleno.petitions.find((x) => x.id === s.petitionId);
  const need = p ? NEED_TEXT[p.need] : 'mejoras para el pueblo';
  const asker = first(state.citizens.find((x) => x.id === p?.citizenId));
  const party = state.politics.party ? `«${state.politics.party.name}»` : 'la oposición';
  const list = TEMPLATES[s.role];
  const body = list[hash32(s.id, pleno.tick, 5) % list.length]!.replace('{need}', need).replace('{asker}', asker).replace('{party}', party);
  const open = c ? opener(c) : '';
  const line = open ? `${open}${body}` : cap(body);
  return line.length <= PLENO_TALK.maxLine ? line : cap(body).slice(0, PLENO_TALK.maxLine);
}

/** Todas las intervenciones: las de la IA que valgan y, para el resto, la plantilla. */
export function plenoLines(state: GameState, pleno: PlenoTalkInput, ai: { id: number; linea: string }[] = []): PlenoLine[] {
  return (pleno.speakers ?? [])
    .filter((s) => state.citizens.some((c) => c.id === s.id))
    .map((s) => {
      const a = ai.find((x) => x.id === s.id);
      return { id: s.id, role: s.role, postura: s.postura, linea: a?.linea ?? plenoRuleLine(state, pleno, s), source: a ? ('ia' as const) : ('reglas' as const) };
    });
}
