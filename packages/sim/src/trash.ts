import { TICKS_PER_DAY } from '@bitopolis/shared';
import { TRASH } from './balance.ts';
import { hash32 } from './hash.ts';
import { levelOf } from './levels.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { addMemory } from './social.ts';
import { type Building, type Citizen, type GameState, pushEvent } from './state.ts';
import { isUnlocked } from './townhall.ts';
import { trashActive, trashPerDay, trashServed, trashStateOf } from './trash-core.ts';

export * from './trash-core.ts';

/**
 * 2.1: basura y punto limpio. Cada edificio con gente acumula basura al día.
 * El camión de cada punto limpio sale cada día por la red de carreteras y
 * recorre, de cerca a lejos, tantas casillas como da su nivel; vacía los
 * edificios que dan a esas calles. Lo que no recoge se amontona: bolsas en la
 * calle (suciedad, campo `dirt` en fields.ts) y, más arriba, ratas.
 *
 * Lo justo (decisión de la 2.1): la tasa de basuras solo se cobra a quien
 * tiene recogida. Sin camión no hay tasa, y la basura se nota.
 *
 * La basura empieza a acumularse cuando ya se puede construir el punto limpio
 * (nivel 2 y 20 vecinos), tras unos días de aviso: nadie se ensucia por un
 * servicio que aún no puede tener. Determinista: sin azar.
 */

/** Cada día (antes de los campos): se activa, recoge el camión y se acumula lo que no recoge. */
export function trashDay(state: GameState): void {
  const t = state.trash;
  if (!t) return;
  if (t.start < 0) {
    if (!isUnlocked(state, 'cleanpoint')) return;
    t.start = Math.max(state.tick + TRASH.warnDays * TICKS_PER_DAY, t.graceUntil ?? 0);
    const days = Math.round((t.start - state.tick) / TICKS_PER_DAY);
    pushEvent(state, 'warning', `Con ${state.citizens.length} vecinos, la basura empieza a ser un problema: en ${days} días se amontonará en la calle. Construye un punto limpio (Construir › Servicios)`, { notify: true });
    return;
  }
  if (state.tick < t.start) return;
  const served = trashServed(state, state.weather?.kind === 'nieve');
  const residents = new Map<number, number>();
  const workers = new Map<number, number>();
  for (const c of state.citizens) {
    if (c.homeId !== null) residents.set(c.homeId, (residents.get(c.homeId) ?? 0) + 1);
    if (c.jobId !== null) workers.set(c.jobId, (workers.get(c.jobId) ?? 0) + 1);
  }
  let newRats = 0;
  let first: Building | undefined;
  for (const b of state.buildings) {
    if (served.has(b.id)) {
      if (b.trash !== undefined) delete b.trash;
      continue;
    }
    const gen = trashPerDay(b, residents.get(b.id) ?? 0, workers.get(b.id) ?? 0);
    if (gen <= 0) continue;
    const before = b.trash ?? 0;
    b.trash = Math.min(TRASH.max, before + gen);
    if (before < TRASH.ratsAt && b.trash >= TRASH.ratsAt) {
      newRats++;
      first ??= b;
    }
  }
  if (newRats && state.tick - (t.warned ?? -1e9) >= TRASH.warnEveryDays * TICKS_PER_DAY) {
    t.warned = state.tick;
    const n = state.buildings.filter((b) => trashStateOf(b) === 'ratas').length;
    pushEvent(state, 'warning', `Hay ratas en ${n === 1 ? 'un edificio' : `${n} edificios`}: la basura lleva días sin recogerse`, first ? { ref: first.id } : {});
  }
  ruleDumping(state);
}

/* ---------------- tirar al monte ---------------- */

/** ¿Puede tirar la basura al monte? (su casa está sucia y no pasa el camión) */
export function canDump(state: GameState, c: Citizen, served?: Map<number, Building>): boolean {
  const home = state.buildings.find((b) => b.id === c.homeId);
  if (!home || (home.trash ?? 0) < TRASH.dirtyAt || !trashActive(state)) return false;
  return !(served ?? trashServed(state)).has(home.id);
}

/** Tira la basura de su casa al monte: la casa queda limpia, sube la contaminación cerca y está mal visto. */
export function dumpTrash(state: GameState, c: Citizen): string {
  const home = state.buildings.find((b) => b.id === c.homeId);
  if (!home || (home.trash ?? 0) <= 0) return 'no tiene basura que tirar';
  delete home.trash;
  const { w, h } = state.map;
  const r = TRASH.dumpRadius;
  for (let y = Math.max(0, home.y - r); y <= Math.min(h - 1, home.y + r); y++) {
    for (let x = Math.max(0, home.x - r); x <= Math.min(w - 1, home.x + r); x++) {
      const d = Math.abs(x - home.x) + Math.abs(y - home.y);
      if (d > r) continue;
      const i = y * w + x;
      state.fields.pollution[i] = Math.min(100, Math.round((state.fields.pollution[i] ?? 0) + TRASH.dumpPollution * (1 - d / (r + 1))));
    }
  }
  if (c.named) addMemory(state, c, 'tiro_basura', 2, 0);
  // Está mal visto: los vecinos con nombre de cerca se acuerdan.
  for (const x of state.citizens) {
    if (x === c || !x.named) continue;
    const xh = state.buildings.find((b) => b.id === x.homeId);
    if (xh && Math.abs(xh.x - home.x) + Math.abs(xh.y - home.y) <= 4) addMemory(state, x, 'vio_tirar_basura', 2, -1, [c.id]);
  }
  pushEvent(state, 'info', `${c.name} tira la basura al monte: no pasa el camión por su calle`, { ref: home.id });
  return 'tira la basura al monte (no pasa el camión)';
}

/** Por reglas (vecinos sin IA): con ratas en casa, el más terco la tira al monte de vez en cuando. */
function ruleDumping(state: GameState): void {
  const day = Math.floor(state.tick / TICKS_PER_DAY);
  const aiOn = state.aiMode && !!state.ai && state.ai.share > 0;
  for (const b of state.buildings) {
    if ((b.trash ?? 0) < TRASH.ratsAt) continue;
    if (hash32(state.seed, b.id, day) % TRASH.dumpEvery !== 0) continue;
    const who = state.citizens
      .filter((c) => c.homeId === b.id && c.traits.terco >= TRASH.dumpTerco && !(aiOn && c.named))
      .sort((a, z) => z.traits.terco - a.traits.terco || a.id - z.id)[0];
    if (who) dumpTrash(state, who);
  }
}

/* ---------------- mes ---------------- */

/** Nivel 3 (compostaje): el abono se vende fuera. */
export function compostMonth(state: GameState, served: Map<number, Building>): void {
  let people = 0;
  for (const c of state.citizens) {
    const p = c.homeId !== null ? served.get(c.homeId) : undefined;
    if (p && levelOf(p) >= 3) people++;
  }
  if (people > 0) transfer(state, OUTSIDE, TREASURY, people * TRASH.compostPerResident, 'abono');
}

/** Para la interfaz: cuántos edificios con gente tienen recogida, bolsas o ratas. */
export function trashSummary(state: GameState): { served: number; unserved: number; bolsas: number; ratas: number } {
  const served = trashServed(state);
  let s = 0;
  let u = 0;
  let bolsas = 0;
  let ratas = 0;
  const people = new Set<number>();
  for (const c of state.citizens) {
    if (c.homeId !== null) people.add(c.homeId);
    if (c.jobId !== null) people.add(c.jobId);
  }
  for (const b of state.buildings) {
    if (!b.built || !people.has(b.id)) continue;
    if (served.has(b.id)) s++;
    else u++;
    const st = trashStateOf(b);
    if (st === 'bolsas') bolsas++;
    else if (st === 'ratas') ratas++;
  }
  return { served: s, unserved: u, bolsas, ratas };
}
