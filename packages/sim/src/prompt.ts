import { tickToDate } from '@bitopolis/shared';
import { z } from 'zod';
import { ACTION_LABELS, cleanMotivo, MOTIVO_MAX } from './decisions.ts';
import { BUILD_NAMES } from './commands.ts';
import type { Citizen, GameState, Pending } from './state.ts';
import { averageHappiness } from './tick.ts';

/**
 * Petición a la IA para un lote de decisiones (spec §9.2).
 * - Prefijo fijo primero (reglas y formato), para aprovechar el caché.
 * - Solo enums y números del motor: nunca texto libre del jugador.
 * - Salida estructurada con enum de acciones válidas; se valida con zod.
 */

export const PROMPT_VERSION = 1;

export const SYSTEM_PROMPT = `Eres el narrador de Bitópolis, un pueblo español pequeño. Interpretas a vecinos con nombre que toman UNA decisión cada uno.

Reglas:
- Para cada vecino, elige exactamente una acción de su lista "acciones". No inventes acciones.
- Decide según su personalidad (rasgos 0-100), su deseo, su miedo, su situación y sus recuerdos. La "terquedad" alta puede llevarle a decisiones poco racionales.
- "motivo": una frase corta (máx. ${MOTIVO_MAX} caracteres) en primera persona, en español de España, natural y con personalidad. Sin comillas, sin emojis, sin mencionar números de rasgos ni que eres una IA.
- Responde solo con JSON que cumpla el esquema.

Significado de las acciones:
${Object.entries(ACTION_LABELS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}
- aceptar_trabajo:<id>: aceptar ese empleo concreto.
- pedir:<cosa>: pedir al alcalde esa mejora.`;

const TRIGGER_TEXT: Record<string, string> = {
  llegada: 'acaba de mudarse al pueblo y se presenta',
  sin_trabajo: 'trabaja fuera del pueblo y hay empleos libres aquí',
  infeliz: 'está descontento con la vida en el pueblo',
  subida_impuestos: 'el alcalde acaba de subir los impuestos',
  ahorros: 'ha ahorrado bastante dinero',
  opinion: 'el alcalde pasea por el pueblo y le pregunta qué tal',
};

const band = (n: number, cuts: number[], names: string[]) => names[cuts.findIndex((c) => n < c) === -1 ? names.length - 1 : cuts.findIndex((c) => n < c)]!;

function townSummary(state: GameState) {
  const d = tickToDate(state.tick);
  const kinds = new Set(state.buildings.filter((b) => b.built).map((b) => b.kind));
  return {
    fecha: `día ${d.day}, mes ${d.month}, año ${d.year}`,
    poblacion: state.citizens.length,
    impuestos: { low: 'bajos', medium: 'medios', high: 'altos' }[state.taxLevel],
    felicidad_media: Math.round(averageHappiness(state)),
    caja_ayuntamiento: band(state.treasury, [0, 5_000, 30_000], ['en deuda', 'justa', 'normal', 'holgada']),
    servicios: ['water', 'power', 'park', 'school', 'clinic', 'shop', 'factory'].filter((k) => kinds.has(k as never)).map((k) => BUILD_NAMES[k]!.toLowerCase()),
  };
}

function citizenView(state: GameState, c: Citizen, p: Pending) {
  const job = state.buildings.find((b) => b.id === c.jobId);
  const home = state.buildings.find((b) => b.id === c.homeId);
  return {
    vecino: c.id,
    nombre: c.name,
    edad: c.age,
    rasgos: { terquedad: c.traits.terco, ahorrador: c.traits.ahorro, sociable: c.traits.social, ambicioso: c.traits.ambicion },
    deseo: c.desire.replace('_', ' '),
    miedo: c.fear,
    felicidad: Math.round(c.happiness),
    dinero: band(c.money, [300, 1_500, 4_000], ['casi nada', 'poco', 'algo', 'bastante']),
    casa: home ? (home.kind === 'house' ? 'casa municipal de alquiler' : 'piso de alquiler') : 'sin casa',
    trabajo: job ? BUILD_NAMES[job.kind]!.toLowerCase() : 'fuera del pueblo',
    recuerdos: c.memory,
    situacion: TRIGGER_TEXT[p.trigger],
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
  const actions = [...new Set(list.flatMap((x) => x.p.actions))];
  const ids = list.map((x) => x.c.id);
  const user = JSON.stringify({ pueblo: townSummary(state), vecinos: list.map((x) => citizenView(state, x.c, x.p)) });
  return {
    system: SYSTEM_PROMPT,
    user,
    citizenIds: ids,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decisiones'],
      properties: {
        decisiones: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['vecino', 'accion', 'motivo'],
            properties: {
              vecino: { type: 'integer', enum: ids },
              accion: { type: 'string', enum: actions },
              motivo: { type: 'string' },
            },
          },
        },
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
}

/** Valida la respuesta: JSON, esquema y acción permitida para cada vecino. */
export function parseDecisions(raw: string, pendings: Pending[]): ParsedDecisions {
  let data: unknown;
  try {
    const trimmed = raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, '');
    data = JSON.parse(trimmed);
  } catch {
    return { decisions: [], invalid: pendings.map((p) => p.citizenId), error: 'JSON no válido' };
  }
  const r = Response.safeParse(data);
  if (!r.success) return { decisions: [], invalid: pendings.map((p) => p.citizenId), error: 'no cumple el esquema' };
  const decisions: ParsedDecisions['decisions'] = [];
  for (const p of pendings) {
    const d = r.data.decisiones.find((x) => x.vecino === p.citizenId);
    const motivo = d ? cleanMotivo(d.motivo) : '';
    if (d && p.actions.includes(d.accion) && motivo.length > 0) decisions.push({ citizenId: p.citizenId, action: d.accion, motivo });
  }
  const ok = new Set(decisions.map((d) => d.citizenId));
  return { decisions, invalid: pendings.map((p) => p.citizenId).filter((id) => !ok.has(id)) };
}
