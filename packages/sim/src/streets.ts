/**
 * 2.2: calles y plazas con nombre de vecinos. En cada pleno abierto se puede
 * dedicar una: el motor propone 3 candidatos (quien nos dejó, los mayores y
 * los muy queridos), el alcalde toca un tramo recto de carretera o la plaza y
 * paga la placa. El nombre lo pone el motor («Calle de Rosario Martín»).
 */
import { STREETS } from './balance.ts';
import { addMoment } from './album.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { addMemory } from './social.ts';
import { buildingAt, type GameState, inBounds, pushEvent, terrainAt, Tile, tileIndex } from './state.ts';
import { Terrain } from './terrain.ts';

export interface StreetName {
  /** Casilla donde se dedicó (ancla del tramo). */
  x: number;
  y: number;
  axis: 'h' | 'v' | 'plaza';
  citizenId: number;
  name: string;
  tick: number;
}

export interface StreetCandidate {
  id: number;
  name: string;
  why: string;
  kind: 'fallecido' | 'mayor' | 'querido';
}

const isRoad = (state: GameState, x: number, y: number) => inBounds(state, x, y) && state.map.tiles[tileIndex(state, x, y)] === Tile.Road && !buildingAt(state, x, y);
const isPlaza = (state: GameState, x: number, y: number) => buildingAt(state, x, y)?.kind === 'plaza';
const honored = (state: GameState) => new Set((state.streetNames ?? []).map((s) => s.citizenId));

/** Amistades y pareja de un vecino que vive. */
const loved = (state: GameState, id: number) => state.citizens.find((c) => c.id === id)?.relations.filter((r) => r.kind === 'amistad' || r.kind === 'pareja').length ?? 0;

/**
 * Los candidatos que propone el motor: quien falleció (lo más reciente
 * primero), los mayores de 70 y los muy queridos. Uno de cada si se puede.
 */
export function streetCandidates(state: GameState): StreetCandidate[] {
  const done = honored(state);
  const dead: StreetCandidate[] = (state.departed ?? [])
    .filter((d) => d.reason === 'fallecio' && !done.has(d.id))
    .sort((a, b) => b.tick - a.tick || a.id - b.id)
    .map((d) => ({ id: d.id, name: d.name, why: `Nos dejó a los ${d.age} años`, kind: 'fallecido' }));
  const alive = state.citizens.filter((c) => c.named && !done.has(c.id));
  const old: StreetCandidate[] = alive
    .filter((c) => c.age >= STREETS.oldAge)
    .sort((a, b) => b.age - a.age || a.id - b.id)
    .map((c) => ({ id: c.id, name: c.name, why: `Tiene ${c.age} años: es de los mayores del pueblo`, kind: 'mayor' }));
  const dear: StreetCandidate[] = alive
    .filter((c) => loved(state, c.id) >= STREETS.lovedFriends)
    .sort((a, b) => loved(state, b.id) - loved(state, a.id) || b.happiness - a.happiness || a.id - b.id)
    .map((c) => ({ id: c.id, name: c.name, why: `Muy querido: ${loved(state, c.id)} amistades en el pueblo`, kind: 'querido' }));
  const out: StreetCandidate[] = [];
  const put = (c: StreetCandidate | undefined) => {
    if (c && out.length < STREETS.candidates && !out.some((x) => x.id === c.id)) out.push(c);
  };
  // Uno de cada tipo y luego se rellena por orden.
  put(dead[0]);
  put(old[0]);
  put(dear[0]);
  for (const c of [...dead, ...old, ...dear]) put(c);
  return out;
}

/** Casillas del tramo recto que pasa por (x, y): la plaza sola, o la carretera en su dirección más larga. */
export function streetSegment(state: GameState, x: number, y: number): { axis: StreetName['axis']; tiles: [number, number][] } | null {
  if (isPlaza(state, x, y)) return { axis: 'plaza', tiles: [[x, y]] };
  if (!isRoad(state, x, y)) return null;
  const run = (dx: number, dy: number): [number, number][] => {
    const out: [number, number][] = [[x, y]];
    for (let k = 1; isRoad(state, x + dx * k, y + dy * k); k++) out.push([x + dx * k, y + dy * k]);
    for (let k = 1; isRoad(state, x - dx * k, y - dy * k); k++) out.unshift([x - dx * k, y - dy * k]);
    return out;
  };
  const h = run(1, 0);
  const v = run(0, 1);
  return v.length > h.length ? { axis: 'v', tiles: v } : { axis: 'h', tiles: h };
}

/** El nombre que lleva el tramo que pasa por (x, y), si lo tiene. */
export function streetNameAt(state: GameState, x: number, y: number): StreetName | undefined {
  const names = state.streetNames ?? [];
  if (!names.length) return undefined;
  const seg = streetSegment(state, x, y);
  if (!seg) return undefined;
  return names.find((n) => seg.tiles.some(([tx, ty]) => tx === n.x && ty === n.y));
}

function candidateName(state: GameState, id: number): string | undefined {
  return state.citizens.find((c) => c.id === id)?.name ?? state.departed?.find((d) => d.id === id)?.name;
}

export function canDedicateStreet(state: GameState, citizenId: number, x: number, y: number): { ok: true } | { ok: false; error: string } {
  const st = state.pleno?.street;
  if (!state.pleno || !st) return { ok: false, error: 'Las calles se dedican en un pleno abierto' };
  if (st.done) return { ok: false, error: 'En este pleno ya se ha dedicado una calle' };
  if (!st.candidates.includes(citizenId) || !candidateName(state, citizenId)) return { ok: false, error: 'Ese vecino no está entre los candidatos' };
  if (!inBounds(state, x, y)) return { ok: false, error: 'Fuera del mapa' };
  const seg = streetSegment(state, x, y);
  if (!seg) return { ok: false, error: 'Toca una carretera o la Plaza Mayor' };
  if (streetNameAt(state, x, y)) return { ok: false, error: 'Ese tramo ya tiene nombre' };
  if (state.treasury < STREETS.plaque) return { ok: false, error: `La placa cuesta ${STREETS.plaque} €` };
  return { ok: true };
}

/** El nombre del motor: «Calle de …», «Plaza de …» o «Puente de …» (sobre el río). */
export function streetTitle(state: GameState, axis: StreetName['axis'], x: number, y: number, name: string): string {
  if (axis === 'plaza') return `Plaza de ${name}`;
  return `${terrainAt(state, x, y) === Terrain.River ? 'Puente' : 'Calle'} de ${name}`;
}

/** Dedica el tramo: placa, nombre, efectos en la gente y foto al álbum. */
export function dedicateStreet(state: GameState, citizenId: number, x: number, y: number): StreetName {
  const seg = streetSegment(state, x, y)!;
  const person = candidateName(state, citizenId)!;
  transfer(state, TREASURY, OUTSIDE, STREETS.plaque, 'homenajes');
  const s: StreetName = { x, y, axis: seg.axis, citizenId, name: streetTitle(state, seg.axis, x, y, person), tick: state.tick };
  (state.streetNames ??= []).push(s);
  state.pleno!.street!.done = true;
  // Quien le quería (amistad, pareja, familia o quien guarda su recuerdo) se alegra; quien se llevaba mal, no.
  const dep = state.departed?.find((d) => d.id === citizenId);
  for (const c of state.citizens) {
    const r = c.relations.find((q) => q.id === citizenId);
    const family = c.parents?.includes(citizenId) || dep?.parents?.includes(c.id) || dep?.partnerId === c.id || (dep?.parents?.length && c.parents?.some((p) => dep.parents!.includes(p)));
    const remembers = c.memories.some((m) => m.about.includes(citizenId) && m.valence < 0 && (m.kind === 'perdio_a' || m.kind === 'se_fue_amigo'));
    if (c.id === citizenId || family || remembers || r?.kind === 'amistad' || r?.kind === 'pareja') {
      c.happiness = Math.min(100, c.happiness + STREETS.friendHappiness);
      if (c.named) addMemory(state, c, 'homenaje', 3, 3, c.id === citizenId ? [] : [citizenId]);
    } else if (r?.kind === 'rivalidad' || r?.kind === 'rencor') c.grudge = Math.min(40, c.grudge + STREETS.rivalGrudge);
  }
  pushEvent(state, 'milestone', `El pueblo dedica la ${s.name}`, { ref: citizenId });
  addMoment(state, 'calle', `Se descubre la placa de la ${s.name}`, { x, y });
  return s;
}

/** Al derribar una casilla: el tramo que pasaba por ahí pierde su nombre. */
export function forgetStreet(state: GameState, x: number, y: number): void {
  const names = state.streetNames;
  if (!names?.length) return;
  const n = streetNameAt(state, x, y);
  if (n) state.streetNames = names.filter((s) => s !== n);
}

/** Invariantes: sobre carretera o plaza, una por casilla y de alguien que vive o vivió aquí. */
export function streetErrors(state: GameState): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  for (const s of state.streetNames ?? []) {
    const ok = s.axis === 'plaza' ? isPlaza(state, s.x, s.y) : isRoad(state, s.x, s.y);
    if (!ok) errors.push(`calle «${s.name}» fuera de carretera o plaza`);
    const i = s.y * state.map.w + s.x;
    if (seen.has(i)) errors.push(`dos nombres en la casilla ${s.x},${s.y}`);
    seen.add(i);
    if (!candidateName(state, s.citizenId)) errors.push(`calle «${s.name}» de un vecino desconocido`);
  }
  return errors;
}
