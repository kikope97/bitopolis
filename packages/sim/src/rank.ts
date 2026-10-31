import { RANK, RANKS } from './balance.ts';
import { hash32 } from './hash.ts';
import { factionOf } from './politics.ts';
import type { Faction } from './politics-core.ts';
import { type GameState, pushEvent, Tile } from './state.ts';
import { Terrain } from './terrain.ts';
import { CREST_PIECES, type CrestPiece, type CrestVote, MOTTO_IDS, MOTTOS, type Motto } from './rank-core.ts';
import { townLevel } from './townhall.ts';
import { isAiCitizen } from './turns.ts';

/**
 * 2.1: de aldea a capital comarcal. El rango es solo título y aspecto (cartel
 * en la entrada, escudo, tejados y fanfarria); lo que se puede construir sigue
 * en townhall.ts. Al subir, los vecinos votan una pieza nueva del escudo y el
 * lema entre un menú cerrado:
 * - Modo normal: votan por reglas, cada uno según su facción (`ruleBallot`).
 * - Modo IA: la votación queda abierta `RANK.voteDays` días. Lo que decidan los
 *   vecinos con IA entra con `applyCrestVote(state, papeletas)` (o el comando
 *   `ChooseCrest`); el resto vota por reglas. Si vence sin votos, reglas.
 *
 * Gancho para el prompt del turno: `rankCandidates(state)` devuelve el menú
 * cerrado (piezas y lemas con su texto) o null si no hay votación abierta.
 */

/** Papeleta de un vecino (de la IA o de las reglas). */
export interface CrestBallot {
  vecino: number;
  pieza: string;
  lema: string;
}

export { baseCrest, CREST_FIELDS, CREST_PIECES, type Crest, type CrestPiece, type CrestVote, emptyRank, MOTTO_IDS, MOTTOS, type Motto, type TownRank } from './rank-core.ts';

export const PIECE_TEXT: Record<CrestPiece, string> = {
  torre: 'una torre',
  puente: 'un puente',
  espiga: 'una espiga',
  ola: 'las ondas del agua',
  arbol: 'un árbol',
  monte: 'un monte',
  rueda: 'una rueda dentada',
  campana: 'una campana',
  libro: 'un libro abierto',
  llave: 'una llave',
  sol: 'un sol',
  estrella: 'una estrella',
};

const FACTION_PIECES: Record<Faction, CrestPiece[]> = {
  jubilados: ['torre', 'campana', 'llave', 'puente'],
  jovenes: ['estrella', 'sol', 'libro', 'rueda'],
  empresarios: ['rueda', 'llave', 'puente', 'torre'],
  ecologistas: ['arbol', 'ola', 'espiga', 'monte'],
};
const FACTION_MOTTOS: Record<Faction, Motto[]> = {
  jubilados: ['muy_leal_y_noble', 'unidos_crecemos', 'pequeno_pero_valiente', 'de_la_tierra_su_gente'],
  jovenes: ['siempre_adelante', 'pan_agua_y_fiesta', 'puertas_abiertas', 'unidos_crecemos'],
  empresarios: ['trabajo_y_concordia', 'cuentas_claras', 'siempre_adelante', 'puertas_abiertas'],
  ecologistas: ['de_la_tierra_su_gente', 'al_rio_la_vida', 'mirando_al_mar', 'lo_que_el_monte_da'],
};

export const rankLevel = (state: GameState): number => state.rank?.level ?? 0;
export const rankName = (state: GameState, level = rankLevel(state)): string => RANKS[Math.max(0, Math.min(RANKS.length - 1, level))]!.name;

/** Rango que corresponde ahora (vecinos y nivel del ayuntamiento a la vez). */
export function rankFor(state: GameState): number {
  const pop = state.citizens.length;
  const hall = townLevel(state);
  let lv = 0;
  RANKS.forEach((r, i) => {
    if (pop >= r.pop && hall >= r.townhall) lv = i;
  });
  return lv;
}

/** Qué falta para el siguiente rango (para la interfaz), o null si ya es el último. */
export function nextRank(state: GameState): { name: string; pop: number; townhall: number; missingPop: number; missingHall: number } | null {
  const r = RANKS[rankLevel(state) + 1];
  if (!r) return null;
  return { name: r.name, pop: r.pop, townhall: r.townhall, missingPop: Math.max(0, r.pop - state.citizens.length), missingHall: Math.max(0, r.townhall - townLevel(state)) };
}

function terrainHas(state: GameState): { river: boolean; sea: boolean; hill: boolean; bridge: boolean } {
  const t = state.map.terrain ?? [];
  let river = false;
  let sea = false;
  let hill = false;
  let bridge = false;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === Terrain.River) {
      river = true;
      if (state.map.tiles[i] === Tile.Road) bridge = true;
    } else if (t[i] === Terrain.Sea) sea = true;
    else if (t[i] === Terrain.Hill) hill = true;
  }
  return { river, sea, hill, bridge };
}

/** Piezas que tienen sentido en este pueblo (por terreno y por lo construido), sin las que ya tiene. */
function pieceOptions(state: GameState, rank: number): CrestPiece[] {
  const t = terrainHas(state);
  const has = (k: string) => state.buildings.some((b) => b.kind === k && b.built);
  const scored: [CrestPiece, number][] = [];
  const add = (p: CrestPiece, ok: boolean, score: number) => {
    if (ok) scored.push([p, score]);
  };
  // Lo construido pesa más que el terreno, y el terreno más que lo genérico.
  add('puente', t.bridge, 3);
  add('rueda', has('factory'), 3);
  add('campana', has('chapel'), 3);
  add('libro', has('library') || has('school'), 2);
  add('llave', has('police') || has('jail'), 2);
  add('arbol', has('park'), 2);
  add('ola', t.river || t.sea, 1);
  add('monte', t.hill, 1);
  add('torre', townLevel(state) >= 3, 1);
  add('estrella', rank >= 3, 1);
  add('espiga', true, 0);
  add('sol', true, 0);
  const have = new Set(state.rank?.crest.pieces ?? []);
  return scored
    .filter(([p]) => !have.has(p))
    .sort((a, b) => b[1] - a[1] || hash32(state.seed, rank, CREST_PIECES.indexOf(a[0])) - hash32(state.seed, rank, CREST_PIECES.indexOf(b[0])))
    .map(([p]) => p);
}

function mottoOptions(state: GameState, rank: number): Motto[] {
  const t = terrainHas(state);
  const ok: Record<Motto, boolean> = {
    trabajo_y_concordia: true,
    pan_agua_y_fiesta: true,
    pequeno_pero_valiente: rank <= 2,
    de_la_tierra_su_gente: true,
    siempre_adelante: true,
    unidos_crecemos: true,
    al_rio_la_vida: t.river,
    mirando_al_mar: t.sea,
    lo_que_el_monte_da: t.hill,
    muy_leal_y_noble: rank >= 2,
    puertas_abiertas: true,
    cuentas_claras: true,
  };
  const current = state.rank?.crest.motto;
  return MOTTO_IDS.filter((m) => ok[m] && m !== current).sort((a, b) => hash32(state.seed, rank, 31, MOTTO_IDS.indexOf(a)) - hash32(state.seed, rank, 31, MOTTO_IDS.indexOf(b)));
}

/**
 * Gancho para la IA: menú cerrado de la votación abierta (o null). Las ids son
 * las que valen en `applyCrestVote` / `ChooseCrest`.
 */
export function rankCandidates(state: GameState): { rango: string; piezas: { id: CrestPiece; texto: string }[]; lemas: { id: Motto; texto: string }[]; vence: number } | null {
  const v = state.rank?.vote;
  if (!v) return null;
  return {
    rango: rankName(state, v.rank),
    piezas: v.pieces.map((id) => ({ id, texto: PIECE_TEXT[id] })),
    lemas: v.mottos.map((id) => ({ id, texto: MOTTOS[id] })),
    vence: v.due,
  };
}

/** Papeleta por reglas: lo que prefiere su facción, si está en el menú; si no, una al azar fija. */
export function ruleBallot(state: GameState, c: GameState['citizens'][number], v: CrestVote): CrestBallot {
  const f = factionOf(state, c);
  const pieza = FACTION_PIECES[f].find((p) => v.pieces.includes(p)) ?? v.pieces[hash32(c.id, v.rank, 3) % v.pieces.length]!;
  const lema = FACTION_MOTTOS[f].find((m) => v.mottos.includes(m)) ?? v.mottos[hash32(c.id, v.rank, 5) % v.mottos.length]!;
  return { vecino: c.id, pieza, lema };
}

function winner<T extends string>(options: T[], votes: string[]): T {
  const n = new Map<string, number>();
  for (const v of votes) n.set(v, (n.get(v) ?? 0) + 1);
  // Empate: la que va antes en el menú.
  let best = options[0]!;
  for (const o of options) if ((n.get(o) ?? 0) > (n.get(best) ?? 0)) best = o;
  return best;
}

/** ¿Vale esta papeleta? (vecino que piensa con IA y piezas del menú). */
export function validBallot(state: GameState, b: CrestBallot): boolean {
  const v = state.rank?.vote;
  if (!v) return false;
  const c = state.citizens.find((x) => x.id === b.vecino);
  return !!c && isAiCitizen(state, c) && v.pieces.includes(b.pieza as CrestPiece) && v.mottos.includes(b.lema as Motto);
}

/**
 * Cierra la votación: cuentan las papeletas válidas de la IA y el resto de
 * vecinos vota por reglas. Devuelve lo elegido (o null si no había votación).
 */
export function applyCrestVote(state: GameState, ballots: CrestBallot[] = []): { pieza: CrestPiece; lema: Motto; votosIa: number } | null {
  const r = state.rank;
  const v = r?.vote;
  if (!r || !v) return null;
  const ai = new Map<number, CrestBallot>();
  for (const b of ballots) if (validBallot(state, b) && !ai.has(b.vecino)) ai.set(b.vecino, b);
  const all = state.citizens.map((c) => ai.get(c.id) ?? ruleBallot(state, c, v));
  const pieza = winner(v.pieces, all.map((b) => b.pieza));
  const lema = winner(v.mottos, all.map((b) => b.lema));
  r.crest.pieces.push(pieza);
  r.crest.motto = lema;
  r.vote = null;
  const share = all.length ? Math.round((100 * all.filter((b) => b.pieza === pieza).length) / all.length) : 0;
  pushEvent(state, 'milestone', `El escudo estrena ${PIECE_TEXT[pieza]} (${share} % de los votos) y el lema «${MOTTOS[lema]}»`);
  return { pieza, lema, votosIa: ai.size };
}

function openVote(state: GameState, rank: number): void {
  const r = state.rank!;
  const pieces = pieceOptions(state, rank).slice(0, RANK.pieceChoices);
  const mottos = mottoOptions(state, rank).slice(0, RANK.mottoChoices);
  if (!pieces.length || !mottos.length) return;
  r.vote = { rank, opened: state.tick, due: state.tick + RANK.voteDays * 24, pieces, mottos };
  // Modo IA: votan los vecinos en sus turnos; Modo normal: votan ya, por reglas.
  if (!(state.aiMode && state.ai && state.ai.share > 0)) applyCrestVote(state);
}

/** Cada día: subidas de rango y votaciones que vencen. */
export function rankDay(state: GameState): void {
  const r = state.rank;
  if (!r) return;
  if (r.vote && state.tick >= r.vote.due) applyCrestVote(state);
  const target = rankFor(state);
  if (target <= r.level) return;
  // Una votación abierta se cierra antes de celebrar el rango nuevo.
  if (r.vote) applyCrestVote(state);
  r.level = Math.min(target, r.level + 1);
  r.since = state.tick;
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  pushEvent(state, 'milestone', `¡Bitópolis ya es ${rankName(state).toLowerCase() === 'capital comarcal' ? 'la capital comarcal' : rankName(state).toLowerCase()}! Hay cartel nuevo en la entrada y los vecinos votan el escudo`, hall ? { ref: hall.id } : {});
  openVote(state, r.level);
}
