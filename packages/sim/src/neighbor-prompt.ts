/**
 * 2.5 (bloque J): el turno mensual de los alcaldes vecinos con IA. Una sola
 * petición al mes para todos: cada alcalde elige UNA acción de su menú (enum
 * propio en el esquema) y dice una declaración breve (≤ `COMARCA.maxSaid`),
 * validada con `parseText` (sin cifras ni nombres inventados). Los datos van
 * en bandas, nunca cifras exactas de dinero. Lo que vale entra en el motor con
 * el comando `NeighborTurn`; lo demás, por reglas (`ruleNeighborPick`).
 */
import { tickToDate } from '@bitopolis/shared';
import { COMARCA } from './balance.ts';
import { activeDeal, type NeighborPick, neighborMenu, OFFER_KINDS, OFFER_TEXT, ourAttract, PERSONALITY_TEXT, relationText, SPECIALTY_TEXT, townAttract } from './comarca.ts';
import { FACTION_TEXT, type Faction } from './politics-core.ts';
import { parseText, TEXT_SYSTEM, type TextRequest } from './prompt.ts';
import type { GameState } from './state.ts';
import { hasRiver, riverExit } from './waterworks.ts';

/** Sube si cambia el prompt o el esquema (la grabación de `ai-eval` deja de valer). */
export const NEIGHBOR_PROMPT_VERSION = 2;

/** Cabecera del mensaje (el LLM falso de los e2e la busca). */
export const NEIGHBOR_HEADER = 'Alcaldes de la comarca';

export interface NeighborRequest extends TextRequest {
  /** Pueblos preguntados y el menú de cada uno cuando se pidió. */
  menus: Record<number, string[]>;
}

const band = (v: number, cuts: number[], words: string[]) => words[cuts.filter((c) => v >= c).length]!;
const popBand = (n: number) => band(n, [50, 120, 300, 800], ['aldea muy pequeña', 'aldea', 'pueblo pequeño', 'pueblo', 'pueblo grande']);
const happyBand = (h: number) => band(h, [40, 55, 70], ['descontentos', 'regular', 'contentos', 'muy contentos']);
const cashBand = (v: number) => band(v, [0, 3_000, 10_000, 25_000], ['en números rojos', 'justa', 'saneada', 'holgada', 'muy holgada']);
const riverBand = (state: GameState) => {
  if (!hasRiver(state)) return 'sin río';
  const e = riverExit(state);
  return e > COMARCA.riverAngry ? 'muy sucio' : e > 25 ? 'algo sucio' : 'limpio';
};
const ACT_TEXT: Record<string, string> = {
  bajar_impuestos: 'bajar los impuestos de tu pueblo (atrae vecinos, cuesta caja)',
  pedir_subvencion: 'pedir a la Diputación (más parte de la bolsa comarcal)',
  criticar: 'criticar al ayuntamiento de Bitópolis (empeora la relación)',
  felicitar: 'felicitar a Bitópolis (mejora la relación)',
  invitar_feria: 'invitar a Bitópolis a la feria comarcal de tu pueblo',
  nada: 'no hacer nada este mes',
};
const actText = (a: string) => {
  const [v, k] = a.split(':');
  return v === 'ofrecer_acuerdo' ? `ofrecer a Bitópolis un acuerdo de ${OFFER_TEXT[k as keyof typeof OFFER_TEXT]}` : (ACT_TEXT[a] ?? a);
};

export const NEIGHBOR_SYSTEM = `${TEXT_SYSTEM}
- Interpretas a los alcaldes de los pueblos vecinos de Bitópolis, en la misma comarca. Cada uno elige UNA acción de su "menu" (exactamente como está escrita) y dice una declaración breve en primera persona (máx. ${COMARCA.maxSaid} caracteres) que cuadre con lo que hace.
- Actúa según su personalidad y su facción. Un alcalde con relación mala no felicita sin motivo; uno río abajo con el río muy sucio se queja.
- Las cifras y el dinero los decide el juego: no pongas números en la declaración. No nombres a nadie que no esté en los datos.
- Personalidades: el dialogante busca acuerdos y felicita; el competitivo baja impuestos y critica cuando Bitópolis le saca ventaja; el populista pide a la Diputación y critica cuando le conviene; el prudente apenas hace ruido.
- Mira "su_ultima_oferta" y "dijo_el_mes_pasado": no repitas lo mismo si Bitópolis ya dijo que no.
- Devuelve un objeto por pueblo en "alcaldes", con la clave de cada pueblo.`;

function lastOfferText(state: GameState, townId: number): string {
  const o = [...state.comarca.offers].reverse().find((x) => x.townId === townId);
  if (!o) return 'ninguna';
  const what = `acuerdo de ${OFFER_TEXT[o.kind]}`;
  return o.resolved === 'accepted' ? `${what}: Bitópolis la aceptó` : o.resolved === 'rejected' ? `${what}: Bitópolis la rechazó` : o.resolved === 'expired' ? `${what}: Bitópolis la dejó caducar` : `${what}: esperando respuesta`;
}

/**
 * Ronda 21: las declaraciones no llevan cifras, y los nombres propios (con mayúscula
 * que no empieza frase) tienen que estar en los datos: ni pueblos ni personas inventadas.
 */
export function inventedProper(text: string, user: string): boolean {
  if (/\d/.test(text)) return true;
  const words = text.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]!;
    const w = words[i]!.replace(/^[«"¿¡(]+|[».,;:!?")]+$/g, '');
    if (!/^[A-ZÁÉÍÓÚÑ]/.test(w) || /[.!?:]$/.test(prev)) continue;
    if (!user.includes(w)) return true;
  }
  return false;
}

/** Petición mensual: solo datos del motor en bandas, nunca texto del jugador. */
export function buildNeighborRequest(state: GameState): NeighborRequest {
  const towns = state.comarca.towns;
  const ours = ourAttract(state);
  const menus: Record<number, string[]> = {};
  const d = tickToDate(state.tick);
  const happy = state.citizens.length ? state.citizens.reduce((a, c) => a + c.happiness, 0) / state.citizens.length : 0;
  const deals = OFFER_KINDS.filter((k) => activeDeal(state, k)).map((k) => OFFER_TEXT[k]);
  const data = {
    mes: d.month,
    comarca: state.region?.phase === 'crisis' ? 'crisis en la comarca' : state.region?.phase === 'bonanza' ? 'bonanza en la comarca' : 'tiempos normales',
    bitopolis: {
      tamano: popBand(state.citizens.length),
      vecinos_contentos: happyBand(happy),
      caja: cashBand(state.treasury),
      impuestos: state.taxLevel === 'low' ? 'bajos' : state.taxLevel === 'high' ? 'altos' : 'normales',
      rio_a_la_salida: riverBand(state),
      acuerdos_en_vigor: deals,
    },
    pueblos: towns.map((t) => {
      const menu = neighborMenu(state, t);
      menus[t.id] = menu;
      const gap = townAttract(state, t) - ours;
      return {
        clave: `pueblo_${t.id}`,
        pueblo: t.name,
        alcalde: t.mayor.name,
        faccion: FACTION_TEXT[t.mayor.faction as Faction]?.toLowerCase() ?? t.mayor.faction,
        personalidad: PERSONALITY_TEXT[t.mayor.personality],
        vive_de: SPECIALTY_TEXT[t.specialty],
        tamano: popBand(t.pop),
        vecinos_contentos: happyBand(t.happiness),
        caja: cashBand(t.treasury),
        relacion_con_bitopolis: relationText(t.relation),
        atrae_vecinos: gap > COMARCA.pullGap ? 'mucho más que Bitópolis' : gap > 0 ? 'algo más que Bitópolis' : 'menos que Bitópolis',
        rio_abajo: !!t.downstream,
        ultima_accion: t.lastAct ? actText(t.lastAct) : 'ninguna',
        // Ronda 21: qué pasó con su última oferta y lo que dijo (para no repetirse a ciegas).
        su_ultima_oferta: lastOfferText(state, t.id),
        dijo_el_mes_pasado: t.said ?? '',
        menu: menu.map((a) => ({ accion: a, que_es: actText(a) })),
      };
    }),
  };
  const props: Record<string, unknown> = {};
  for (const t of towns) {
    props[`pueblo_${t.id}`] = {
      type: 'object',
      properties: { accion: { type: 'string', enum: menus[t.id] }, declaracion: { type: 'string' } },
      required: ['accion', 'declaracion'],
      additionalProperties: false,
    };
  }
  return {
    system: NEIGHBOR_SYSTEM,
    user: `${NEIGHBOR_HEADER}\n${JSON.stringify(data)}`,
    schema: {
      type: 'object',
      properties: { alcaldes: { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false } },
      required: ['alcaldes'],
      additionalProperties: false,
    },
    max: COMARCA.maxSaid,
    menus,
  };
}

/**
 * Valida la respuesta: por pueblo, acción del menú y declaración que pase
 * `parseText` (≤ `COMARCA.maxSaid`, sin cifras ni nombres inventados). Lo que no
 * valga se descarta (ese alcalde decide por reglas, con su plantilla si solo
 * falla la declaración).
 */
export function parseNeighbors(raw: string, req: NeighborRequest): { picks: NeighborPick[]; invalid: number[] } {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
  } catch {
    return { picks: [], invalid: Object.keys(req.menus).map(Number) };
  }
  const al = (data as { alcaldes?: Record<string, { accion?: unknown; declaracion?: unknown }> })?.alcaldes ?? {};
  const picks: NeighborPick[] = [];
  const invalid: number[] = [];
  for (const [id, menu] of Object.entries(req.menus)) {
    const p = al[`pueblo_${id}`];
    if (!p || typeof p.accion !== 'string' || !menu.includes(p.accion)) {
      invalid.push(Number(id));
      continue;
    }
    const said0 = typeof p.declaracion === 'string' ? parseText(JSON.stringify({ texto: p.declaracion }), req) : null;
    const said = said0 && !inventedProper(said0, req.user) ? said0 : null;
    // Una declaración que no vale va vacía: el motor pone la plantilla.
    picks.push({ pueblo: Number(id), accion: p.accion, declaracion: said && said.length <= COMARCA.maxSaid ? said : '' });
  }
  return { picks, invalid };
}
