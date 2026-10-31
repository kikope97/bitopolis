import { tickToDate } from '@bitopolis/shared';
import { z } from 'zod';
import { CAUSE_ASK } from './associations.ts';
import { MIN_WAGE } from './balance.ts';
import { BUILD_NAMES } from './commands.ts';
import { freeShopLot } from './economy.ts';
import { debtBand, pocketOf } from './household.ts';
import { jobsOf } from './levels.ts';
import { trashStateOf } from './trash-core.ts';
import { daysToElection, FACTION_TEXT, factionOf, politicsActive } from './politics.ts';
import { brewingNow, type DirectorChoice, directorMenu, dramaBudget } from './director.ts';
import { errandCandidates } from './errands.ts';
import { weekNews } from './press.ts';
import { rankCandidates } from './rank.ts';
import { inventedName, inventedNumber, toneOf } from './prompt.ts';
import { GOAL_TEXT, HOOK_TEXT, hookFor, memoryText, NEED_TEXT, NEEDS, needsOf } from './social.ts';
import type { Citizen, GameState } from './state.ts';
import { averageHappiness } from './tick.ts';
import { GESTURES, gestureCandidates, isAiCitizen, PLANS, planText, SPEND, type TurnAct, turnMenu } from './turns.ts';

/**
 * 2.0: la petición de un turno del pueblo. Tres partes, para aprovechar la caché:
 * - `system`: reglas fijas (igual siempre).
 * - `shared`: cómo está el pueblo y qué ha hecho el alcalde (igual en todos los lotes del turno).
 * - `user`: el lote de vecinos (lo único que cambia entre lotes).
 * La salida tiene un esquema fijo (sin uniones por vecino); cada parte se valida
 * en el motor con el menú del vecino. Nunca va texto libre del jugador.
 */
export const TURN_PROMPT_VERSION = 9;

export const TURN_SYSTEM = `Eres la mente de los vecinos de Bitópolis, un pueblo español pequeño. Cada semana decides, a la vez, qué hace cada vecino de la lista. Ellos viven de verdad: trabajan, compran, se enamoran, se enfadan, ahorran o se arruinan, y reaccionan a lo que hace el alcalde (el jugador).

Para cada vecino del lote devuelve exactamente un objeto con:
- "vecino": su id.
- "accion": UNA de las acciones de su lista "acciones" (copia el texto exacto). Si no quiere hacer nada especial, "seguir". No inventes acciones.
- "gesto": con quién (id de su lista "con_quien", o 0) y qué ("ninguno", "acercarse", "enfadarse", "hacer_las_paces", "pedir_salir", "romper").
- "actitud": qué piensa del alcalde ahora, de -2 (muy en contra) a 2 (muy a favor). Tiene que salir de lo que vive: impuestos, servicios, su bolsillo, sus planes.
- "gasto": dónde compra este mes ("pueblo", "fuera" o "ahorrar"), en qué tienda del pueblo si la prefiere (id de la lista de tiendas, o 0) y si se da algún capricho ("ocio"). Comer y lo básico se pagan siempre: tú decides dónde y si hay ocio. Si nadie compra en las tiendas del pueblo, cierran y su gente se queda sin trabajo: compra en el pueblo si le va bien y le compensa.
- "plan": un ultimátum o propósito con plazo si de verdad le importa algo ("irse_si_no", "protestar_si_no", "votar_en_contra_si_no", con la "necesidad" de su lista y los "meses", de 1 a 6), o "ninguno". Úsalo con moderación: es una promesa que el pueblo recordará.
- "pensamiento": una frase en primera persona, en español de España, con su tono y su vida (máx. 140 caracteres).
- "motivo": por qué hace lo que hace esta semana, en una frase corta en primera persona (máx. 160 caracteres).
- "escudo": solo si en el pueblo hay "votacion_escudo", su voto: una "pieza" y un "lema" (ids de esa votación), según lo que le importa; si no, "" y "".
- "recuerdo": lo que apunta de esta semana para acordarse (un hecho, no un sentimiento; máx. 120 caracteres), o "" si no pasó nada. Sus notas anteriores están en "sus_notas".

Reglas:
- Decide según su personalidad (rasgos 0-100), su deseo, su miedo, su situación (dinero, deudas, trabajo, casa), sus relaciones, sus recuerdos y lo que ha hecho el alcalde. La terquedad alta puede llevar a decisiones poco racionales.
- Coherencia: recuerda lo que pensaba, sus notas y lo que hizo la semana pasada; si tenía un plan, actúa en consecuencia.
- Variedad: no todos hacen lo mismo ni suenan igual. Que pasen cosas, buenas y malas, pero creíbles. "seguir" es válido, pero en cada lote algunos vecinos deberían hacer algo (cambiar de trabajo, mudarse, abrir o cerrar un negocio, contratar, unirse a una asociación, pedir, quejarse, tener un hijo, acercarse a alguien…) si su situación lo justifica.
- No repitas lo que pensaba la semana pasada ("pensaba"): cuenta algo nuevo de su vida, del pueblo o de otro vecino.
- No repitas "pedir" lo mismo si está en "ya_pidio" hace menos de 4 semanas: espera, quéjate o ponle un plazo con "plan".
- Mira "oportunidades" del pueblo: quien está en paro, cobra poco o tiene un negocio que pierde dinero debería pensar en aceptar un trabajo, mudarse, despedir o cerrar; quien tiene dinero y ambición alta, en abrir un negocio o contratar.
- Dinero con cabeza: con deudas, sin trabajo o "no llega", el ocio sobra; con dinero de sobra, puede gastar, invertir o ayudar al negocio del pueblo.
- "robar" solo existe para quien está desesperado; es una decisión grave y rara.
- "tirar_al_monte" solo aparece si no pasa el camión de la basura y la tiene en la puerta: lo hace quien es terco o está harto; los vecinos lo ven mal. Lo normal es quejarse o pedir "recogida".
- No menciones a nadie que no esté en los datos, ni cifras inventadas, ni que eres una IA. Sin comillas ni emojis.
- Responde solo con JSON que cumpla el esquema, con un objeto por cada vecino del lote (no te dejes ninguno). Sé breve en los textos.`;

const band = (n: number, cuts: number[], names: string[]) => names[cuts.findIndex((c) => n < c) === -1 ? names.length - 1 : cuts.findIndex((c) => n < c)]!;
const lvl = (v: string) => ({ low: 'bajo', medium: 'medio', high: 'alto' })[v] ?? v;

/** Cómo está el pueblo (igual para todos los lotes del turno). */
export function turnShared(state: GameState): string {
  const d = tickToDate(state.tick);
  const kinds = new Set(state.buildings.filter((b) => b.built).map((b) => b.kind));
  const last = state.stats.at(-1);
  const ai = state.ai!;
  const t = ai.turn;
  const shops = state.buildings.filter((b) => b.kind === 'shop' && b.built && !b.damaged);
  const data = {
    turno: t ? { numero: t.n, tipo: t.kind === 'rapida' ? `reacción rápida a: el alcalde ${t.reason}` : 'semana' } : null,
    fecha: `día ${d.day}, mes ${d.month}, año ${d.year}`,
    poblacion: state.citizens.length,
    felicidad_media: Math.round(averageHappiness(state)),
    caja_ayuntamiento: band(state.treasury, [0, 5_000, 30_000], ['en deuda', 'justa', 'normal', 'holgada']),
    impuestos: state.taxesSplit ? { ibi: lvl(state.taxes.ibi), tasas: lvl(state.taxes.tasas), plusvalia: lvl(state.taxes.plusvalia) } : lvl(state.taxLevel),
    sueldo_minimo_empresas: `${MIN_WAGE[state.minWage ?? 'none']} € al mes`,
    servicios: ['water', 'power', 'park', 'school', 'clinic', 'police', 'bar', 'chapel', 'cemetery', 'library', 'sports', 'jail', 'cleanpoint'].filter((k) => kinds.has(k as never)).map((k) => BUILD_NAMES[k]!.toLowerCase()),
    economia: last
      ? {
          vecinos_con_deudas: last.debtors ?? 0,
          en_paro: last.jobless ?? 0,
          empresas: last.businesses ?? 0,
          empresas_que_pierden_dinero: last.losing ?? 0,
          cierres_el_mes_pasado: last.closures ?? 0,
        }
      : null,
    tiendas: shops.slice(0, 12).map((b) => ({ id: b.id, nombre: b.name ?? 'tienda', ventas_mes_pasado: b.books?.sales ?? 0 })),
    asociaciones: (state.associations ?? []).map((a) => ({ id: a.id, nombre: a.name, piden: CAUSE_ASK[a.cause], socios: a.members.length, manifestaciones_sin_respuesta: a.protests ?? 0 })),
    ...(politicsActive(state)
      ? {
          politica: {
            gobierna: state.politics.mayor === 'player' ? 'el alcalde (el jugador)' : (state.politics.party?.leaderName ?? 'el rival'),
            partido_rival: state.politics.party ? `${state.politics.party.leaderName}, «${state.politics.party.name}»` : null,
            intencion_de_voto_al_alcalde: `${state.politics.approval} %`,
            elecciones_en_dias: daysToElection(state),
          },
        }
      : {}),
    lo_que_ha_hecho_el_alcalde: ai.mayor.slice(-12).map((m) => `el alcalde ${m.text}`),
    // Solo lo que cuenta (lo que decidió la costumbre, «ahorrar» o «seguir», no dice nada).
    la_semana_pasada: ai.log.at(-1)?.source === 'ia' ? ai.log.at(-1)!.lines.slice(0, 10).map((l) => l.text) : [],
    oportunidades: opportunities(state),
    // 2.1: el pueblo sube de rango y vota el escudo (menú cerrado).
    ...(rankCandidates(state) ? { votacion_escudo: { rango: rankCandidates(state)!.rango, piezas: rankCandidates(state)!.piezas, lemas: rankCandidates(state)!.lemas } } : {}),
  };
  return `Así está el pueblo:\n${JSON.stringify(data)}`;
}

/** Ronda 16: lo que se puede aprovechar en el pueblo (para que haya decisiones económicas). */
function opportunities(state: GameState) {
  const used = new Map<number, number>();
  for (const x of state.citizens) if (x.jobId !== null) used.set(x.jobId, (used.get(x.jobId) ?? 0) + 1);
  const jobs = state.buildings.filter((b) => b.built && !b.damaged && Math.min(jobsOf(b), b.staff ?? Infinity) > (used.get(b.id) ?? 0));
  const homes = new Map<number, number>();
  for (const x of state.citizens) if (x.homeId !== null) homes.set(x.homeId, (homes.get(x.homeId) ?? 0) + 1);
  return {
    puestos_libres: jobs.reduce((a, b) => a + Math.min(jobsOf(b), b.staff ?? Infinity) - (used.get(b.id) ?? 0), 0),
    donde_se_contrata: jobs.slice(0, 5).map((b) => b.name ?? BUILD_NAMES[b.kind] ?? b.kind),
    viviendas_libres: state.buildings.filter((b) => b.built && (b.kind === 'house' || b.kind === 'res') && (homes.get(b.id) ?? 0) < (b.kind === 'house' ? 3 : 4)).length,
    local_comercial_libre: freeShopLot(state) !== null,
    tiendas_que_ganan_dinero: state.buildings.filter((b) => b.kind === 'shop' && b.built && (b.books?.sales ?? 0) > (b.books?.wages ?? 0) + (b.books?.taxes ?? 0)).length,
  };
}

/** Lo que este vecino ya pidió al alcalde en las últimas semanas (para no repetirse). */
function askedBefore(state: GameState, c: Citizen) {
  const out: { pidio: string; hace_semanas: number }[] = [];
  const logs = state.ai?.log ?? [];
  for (let i = logs.length - 1, weeks = 0; i >= 0 && weeks < 6; i--, weeks++) {
    for (const l of logs[i]!.lines) if (l.id === c.id && l.text.includes(' pide ')) out.push({ pidio: l.text.slice(l.text.indexOf(' pide ') + 6, l.text.indexOf(' pide ') + 70).split(';')[0]!, hace_semanas: weeks + 1 });
  }
  return out.slice(0, 3);
}

/** 2.1: cómo está la basura en su calle (solo si se nota). */
function trashBrief(state: GameState, c: Citizen): string | null {
  const home = state.buildings.find((b) => b.id === c.homeId);
  if (!home) return null;
  const st = trashStateOf(home);
  return st === 'ratas' ? 'ratas en su portal: la basura lleva semanas sin recogerse' : st === 'bolsas' ? 'bolsas de basura amontonadas en su calle' : null;
}

function citizenBrief(state: GameState, c: Citizen) {
  const job = state.buildings.find((b) => b.id === c.jobId);
  const home = state.buildings.find((b) => b.id === c.homeId);
  const lastLine = [...(state.ai?.log ?? [])].reverse().flatMap((l) => l.lines).find((l) => l.id === c.id);
  const hook = hookFor(state, c.id);
  return {
    vecino: c.id,
    nombre: c.name,
    edad: c.age,
    profesion: c.profession,
    rasgos: { terquedad: c.traits.terco, ahorrador: c.traits.ahorro, sociable: c.traits.social, ambicioso: c.traits.ambicion },
    tono: toneOf(c),
    deseo: c.desire.replace('_', ' '),
    miedo: c.fear,
    meta: GOAL_TEXT[c.goal],
    ...(politicsActive(state) ? { faccion: FACTION_TEXT[factionOf(state, c)].toLowerCase() } : {}),
    felicidad: Math.round(c.happiness),
    bolsillo: pocketOf(c).replace('_', ' '),
    dinero: band(c.money, [300, 1_500, 4_000], ['casi nada', 'poco', 'algo', 'bastante']),
    deuda: debtBand(c),
    ...(c.last ? { mes_pasado: { entro: c.last.in, salio: c.last.out } } : {}),
    trabajo: job ? (job.name ?? BUILD_NAMES[job.kind] ?? job.kind) : c.unemployedSince !== undefined ? 'en paro' : 'fuera del pueblo',
    casa: home ? (c.owns ? 'vivienda en propiedad' : home.kind === 'house' ? 'casa municipal de alquiler' : 'piso de alquiler') : 'sin casa',
    hijos: c.kids?.length ?? 0,
    ...(trashBrief(state, c) ? { basura: trashBrief(state, c) } : {}),

    recuerdos: [...c.memories].sort((a, b) => b.importance - a.importance).slice(0, 3).map((m) => memoryText(state, m)),
    ...(hook ? { gancho: HOOK_TEXT[hook.kind] } : {}),
    ...(c.thought ? { pensaba: c.thought } : {}),
    ...(c.notes?.length ? { sus_notas: c.notes.map((n) => n.text) } : {}),
    ...(lastLine ? { la_semana_pasada: lastLine.text } : {}),
    ...(c.plan ? { su_plan: planText(c.plan) } : {}),
    actitud_anterior: c.attitude ?? 0,
    necesidades: needsOf(state, c).slice(0, 3),
    acciones: turnMenu(state, c).map((m) => (m.detalle ? `${m.accion} (${m.detalle})` : m.accion)),
    ...(askedBefore(state, c).length ? { ya_pidio: askedBefore(state, c) } : {}),
    // Ronda 16: una sola lista de gente (antes «relaciones» y «con_quien» repetían a los mismos).
    con_quien: gestureCandidates(state, c).map((x) => {
      const r = c.relations.find((y) => y.id === x.id);
      return { id: x.id, nombre: x.name, relacion: r?.kind ?? 'conocido', ...(r ? { intensidad: r.strength >= 70 ? 'fuerte' : r.strength >= 40 ? 'media' : 'leve' } : {}) };
    }),
  };
}

/** Esquema fijo de la respuesta (el mismo en todos los lotes: no rompe la caché). */
export const TURN_SCHEMA = {
  type: 'object',
  properties: {
    decisiones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          vecino: { type: 'integer' },
          accion: { type: 'string' },
          gesto: {
            type: 'object',
            properties: { con: { type: 'integer' }, tipo: { type: 'string', enum: [...GESTURES] } },
            required: ['con', 'tipo'],
            additionalProperties: false,
          },
          actitud: { type: 'integer' },
          gasto: {
            type: 'object',
            properties: { donde: { type: 'string', enum: [...SPEND] }, tienda: { type: 'integer' }, ocio: { type: 'boolean' } },
            required: ['donde', 'tienda', 'ocio'],
            additionalProperties: false,
          },
          plan: {
            type: 'object',
            properties: { tipo: { type: 'string', enum: [...PLANS] }, necesidad: { type: 'string', enum: ['', ...NEEDS] }, meses: { type: 'integer' } },
            required: ['tipo', 'necesidad', 'meses'],
            additionalProperties: false,
          },
          pensamiento: { type: 'string' },
          motivo: { type: 'string' },
          recuerdo: { type: 'string' },
          escudo: { type: 'object', properties: { pieza: { type: 'string' }, lema: { type: 'string' } }, required: ['pieza', 'lema'], additionalProperties: false },
        },
        required: ['vecino', 'accion', 'gesto', 'actitud', 'gasto', 'plan', 'pensamiento', 'motivo', 'recuerdo', 'escudo'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisiones'],
  additionalProperties: false,
} as const;

export interface TurnRequest {
  system: string;
  shared: string;
  user: string;
  schema: Record<string, unknown>;
  ids: number[];
}

/** Vecinos con IA del turno abierto, en lotes. */
export function turnBatches(state: GameState, size: number): number[][] {
  const t = state.ai?.turn;
  if (!t) return [];
  const ids = t.ids.filter((id) => {
    const c = state.citizens.find((x) => x.id === id);
    return c && isAiCitizen(state, c);
  });
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export function buildTurnRequest(state: GameState, ids: number[], shared = turnShared(state)): TurnRequest {
  const batch = ids.map((id) => state.citizens.find((c) => c.id === id)).filter((c): c is Citizen => !!c);
  const user = `Lote de vecinos (decide para cada uno; ${batch.length} en total):\n${JSON.stringify(batch.map((c) => citizenBrief(state, c)))}`;
  return { system: TURN_SYSTEM, shared, user, schema: TURN_SCHEMA as unknown as Record<string, unknown>, ids: batch.map((c) => c.id) };
}

const ActSchema = z.object({
  vecino: z.number().int(),
  accion: z.string().max(60),
  gesto: z.object({ con: z.number().int(), tipo: z.string().max(30) }),
  actitud: z.number(),
  gasto: z.object({ donde: z.string().max(20), tienda: z.number().int(), ocio: z.boolean() }),
  plan: z.object({ tipo: z.string().max(40), necesidad: z.string().max(30), meses: z.number() }),
  pensamiento: z.string().max(600),
  motivo: z.string().max(600),
  recuerdo: z.string().max(600).optional(),
  escudo: z.object({ pieza: z.string().max(40), lema: z.string().max(60) }).optional(),
});

const clean = (s: string, max: number) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>`*_#"«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Lee la respuesta de un lote. Devuelve las decisiones bien formadas (las que
 * el motor validará con el menú) y los ids que faltan o no valen.
 * Un nombre inventado borra el texto (no la decisión).
 */
export function parseTurn(text: string, ids: number[], sent: string): { acts: TurnAct[]; missing: number[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { acts: [], missing: ids };
  }
  const list = (raw as { decisiones?: unknown })?.decisiones;
  if (!Array.isArray(list)) return { acts: [], missing: ids };
  const acts: TurnAct[] = [];
  for (const item of list) {
    const r = ActSchema.safeParse(item);
    if (!r.success || !ids.includes(r.data.vecino) || acts.some((a) => a.vecino === r.data.vecino)) continue;
    const a = r.data;
    // El esquema del comando admite «verbo» o «verbo:arg» en minúsculas: se quita el detalle que copie el modelo.
    const accion = (a.accion.split(' ')[0] ?? 'seguir').toLowerCase();
    let pensamiento = clean(a.pensamiento, 160);
    let motivo = clean(a.motivo, 160);
    // Ni nombres ni cifras que no estén en los datos (ronda 16).
    const bad = (t: string) => !!inventedName(t, sent) || inventedNumber(t, sent);
    if (bad(pensamiento)) pensamiento = '';
    if (bad(motivo)) motivo = '';
    let recuerdo = clean(a.recuerdo ?? '', 120);
    if (bad(recuerdo)) recuerdo = '';
    acts.push({
      vecino: a.vecino,
      accion: /^[a-z_]+(:[a-z0-9_]+)?$/.test(accion) ? accion : 'seguir',
      gesto: { con: a.gesto.con, tipo: a.gesto.tipo },
      actitud: Math.max(-2, Math.min(2, Math.round(a.actitud))),
      gasto: a.gasto,
      plan: { tipo: a.plan.tipo, necesidad: a.plan.necesidad, meses: Math.max(0, Math.min(12, Math.round(a.plan.meses))) },
      pensamiento,
      motivo,
      ...(recuerdo ? { recuerdo } : {}),
      ...(a.escudo && /^[a-z_]+$/.test(a.escudo.pieza) && /^[a-z_]+$/.test(a.escudo.lema) ? { escudo: { pieza: a.escudo.pieza, lema: a.escudo.lema } } : {}),
    });
  }
  return { acts, missing: ids.filter((id) => !acts.some((a) => a.vecino === id)) };
}

/** Texto de las necesidades para los planes (para la interfaz). */
export const PLAN_NEED_TEXT = NEED_TEXT;

/* ---------------- director del pueblo (2.0) ---------------- */

export const DIRECTOR_SYSTEM = `Eres el director de Bitópolis, un pueblo español pequeño en un juego de alcalde. Cada semana decides qué pasa en el pueblo además de lo que hacen los vecinos: eliges entre los sucesos posibles que te da el juego (todos son reales: quién, dónde y por qué), el foco de la semana y escribes la crónica.

Devuelve:
- "sucesos": los que pasan esta semana (0 a 3), cada uno con su "id" del menú y un "motivo" corto de por qué ahora.
- "avisos": sucesos del menú que empiezan a cocerse (0 a 3), para que el alcalde pueda reaccionar a tiempo. Un suceso malo ("malo": true) solo puede pasar si ya estaba avisado ("avisado": true); si no, avísalo primero.
- "foco": el tema de la semana en una frase corta (máx. 100 caracteres).
- "cronica": 2 o 3 frases en español de España, como el periódico del pueblo, sobre lo que ha hecho el alcalde, cómo está el pueblo y lo que pasa esta semana (máx. 400 caracteres).
- "titulares": los 3 titulares de El Eco de Bitópolis, uno por sección ("sucesos", "cartas" al director, "anuncios"), cada uno sobre una de las "noticias" (su id en "sobre", o "" si es de los sucesos que eliges) y con un "texto" de periódico de pueblo (máx. 110 caracteres). En "cartas", la voz de un vecino.
- "encargo": si encaja con la semana, uno de "encargos_posibles" ("id") con la "carta" (máx. 220 caracteres, en primera persona, firmada por quien lo pide) con la que se lo pide al alcalde; si no, id "" y carta "".

Reglas:
- Sé justo: respeta "presupuesto_drama" (cuántos sucesos malos caben). Un pueblo contento no tiene disturbios; si el alcalde lo hace bien, que pasen también cosas buenas.
- Que tenga sentido: cada suceso sale de lo que ha hecho el alcalde y de cómo están los vecinos. Mejor pocos sucesos con historia que muchos sueltos. Si no pasa nada interesante, lista vacía.
- No menciones a nadie ni nada que no esté en los datos, ni cifras inventadas, ni que eres una IA. Sin comillas ni emojis.
- Responde solo con JSON que cumpla el esquema.`;

export const DIRECTOR_SCHEMA = {
  type: 'object',
  properties: {
    sucesos: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, motivo: { type: 'string' } }, required: ['id', 'motivo'], additionalProperties: false },
    },
    avisos: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, motivo: { type: 'string' } }, required: ['id', 'motivo'], additionalProperties: false },
    },
    foco: { type: 'string' },
    cronica: { type: 'string' },
    titulares: {
      type: 'array',
      items: { type: 'object', properties: { seccion: { type: 'string', enum: ['sucesos', 'cartas', 'anuncios'] }, sobre: { type: 'string' }, texto: { type: 'string' } }, required: ['seccion', 'sobre', 'texto'], additionalProperties: false },
    },
    encargo: { type: 'object', properties: { id: { type: 'string' }, carta: { type: 'string' } }, required: ['id', 'carta'], additionalProperties: false },
  },
  required: ['sucesos', 'avisos', 'foco', 'cronica', 'titulares', 'encargo'],
  additionalProperties: false,
} as const;

export interface DirectorRequest {
  system: string;
  shared: string;
  user: string;
  schema: Record<string, unknown>;
  ids: string[];
  /** 2.1: noticias de la semana (id «nX» → vecino o edificio) y encargos posibles. */
  news: { id: string; ref?: number }[];
  errands: string[];
}

/** La petición del director: el mismo bloque común del turno y el menú de sucesos. */
export function buildDirectorRequest(state: GameState, shared = turnShared(state)): DirectorRequest {
  const menu = directorMenu(state);
  const brewing = brewingNow(state, menu);
  const budget = dramaBudget(state, menu);
  const news = weekNews(state);
  const errands = errandCandidates(state).slice(0, 4);
  const paceTicks = Math.max(1, (state.ai?.paceDays ?? 7) * 24);
  const data = {
    presupuesto_drama: { sucesos_malos_que_caben: budget.bad, por_que: budget.why },
    se_esta_cociendo: brewing.map((b) => ({ id: b.id, texto: b.text, hace_turnos: Math.max(0, Math.round((state.tick - b.since) / paceTicks)) })),
    menu: menu.map((m) => ({ id: m.id, tipo: m.kind, malo: m.bad, avisado: brewing.some((b) => b.id === m.id), texto: m.text, por_que: m.why })),
    noticias: news.map((n) => ({ id: n.id, seccion: n.section, texto: n.text })),
    encargos_posibles: errands.map((e) => ({ id: e.key, lo_pide: state.citizens.find((c) => c.id === e.by)?.name ?? 'el pueblo', que: e.text })),
  };
  const user = `Director de la semana (elige entre el menú):\n${JSON.stringify(data)}`;
  return {
    system: DIRECTOR_SYSTEM,
    shared,
    user,
    schema: DIRECTOR_SCHEMA as unknown as Record<string, unknown>,
    ids: menu.map((m) => m.id),
    news: news.map((n) => ({ id: n.id, ...(n.ref !== undefined ? { ref: n.ref } : {}) })),
    errands: errands.map((e) => e.key),
  };
}

const PickSchema = z.object({ id: z.string().max(60), motivo: z.string().max(600) });
const DirectorOut = z.object({
  sucesos: z.array(PickSchema).max(10),
  avisos: z.array(PickSchema).max(10),
  foco: z.string().max(600),
  cronica: z.string().max(2000),
  titulares: z.array(z.object({ seccion: z.string().max(20), sobre: z.string().max(20), texto: z.string().max(600) })).max(6).optional(),
  encargo: z.object({ id: z.string().max(60), carta: z.string().max(1000) }).optional(),
});

/** Lee la respuesta del director: solo ids del menú y textos sin nombres inventados. Null si no vale. */
export function parseDirector(text: string, ids: string[], sent: string, extra: { news?: { id: string; ref?: number }[]; errands?: string[] } = {}): { director: DirectorChoice; focus: string; chronicle: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = DirectorOut.safeParse(raw);
  if (!r.success) return null;
  const pick = (list: { id: string; motivo: string }[]) => {
    const out: { id: string; motivo: string }[] = [];
    for (const p of list) {
      if (!ids.includes(p.id) || out.some((x) => x.id === p.id) || out.length >= 3) continue;
      const motivo = clean(p.motivo, 160);
      out.push({ id: p.id, motivo: inventedName(motivo, sent) || inventedNumber(motivo, sent) ? '' : motivo });
    }
    return out;
  };
  const focus = clean(r.data.foco, 120);
  const chronicle = clean(r.data.cronica, 500);
  const bad = (t: string) => !!inventedName(t, sent) || inventedNumber(t, sent);
  // 2.1: titulares (una por sección, texto filtrado) y el encargo con su carta.
  const titulares: NonNullable<DirectorChoice['titulares']> = [];
  for (const t of r.data.titulares ?? []) {
    if (!['sucesos', 'cartas', 'anuncios'].includes(t.seccion) || titulares.some((x) => x.seccion === t.seccion)) continue;
    const texto = clean(t.texto, 140);
    if (texto.length < 6 || bad(texto)) continue;
    const ref = extra.news?.find((n) => n.id === t.sobre)?.ref;
    titulares.push({ seccion: t.seccion as 'sucesos' | 'cartas' | 'anuncios', texto, ...(ref !== undefined ? { sobre: ref } : {}) });
  }
  const carta = clean(r.data.encargo?.carta ?? '', 260);
  const encargo = r.data.encargo?.id && extra.errands?.includes(r.data.encargo.id) ? { id: r.data.encargo.id, carta: bad(carta) ? '' : carta } : undefined;
  return {
    director: { sucesos: pick(r.data.sucesos), avisos: pick(r.data.avisos), ...(titulares.length ? { titulares } : {}), ...(encargo ? { encargo } : {}) },
    focus: bad(focus) ? '' : focus,
    chronicle: bad(chronicle) ? '' : chronicle,
  };
}
