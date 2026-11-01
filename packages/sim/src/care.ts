/**
 * 2.4 (bloque A): guardería y residencia de mayores. Cuotas (`SetCareFee`),
 * natalidad con plaza, pensión mínima, mayores atendidos y la decisión
 * «llevar a la residencia o cuidar en casa». Números en `CARE` (balance.ts).
 *
 * La IA (Modo IA) elige si un hijo lleva a su padre o madre a la residencia o
 * lo cuida en casa (`careMenu`, en el menú de cada vecino); el motor decide si
 * hay plaza, cuánto cuesta y quién paga. Sin IA, deciden las reglas por rasgos
 * (`careRuleAction`).
 */
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '@bitopolis/shared';
import { CARE } from './balance.ts';
import { homesOf } from './density.ts';
import type { CommandResult } from './commands.ts';
import { charge } from './household.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance } from './prng.ts';
import { addMemory } from './social.ts';
import { isAiCitizen, type MenuItem } from './turns.ts';
import { type Building, type Citizen, type FeeLevel, type GameState, pushEvent } from './state.ts';

const YEAR = DAYS_PER_YEAR * TICKS_PER_DAY;
const first = (c: Citizen) => c.name.split(' ')[0]!;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const homeOf = (state: GameState, c: Citizen) => (c.homeId !== null ? state.buildings.find((b) => b.id === c.homeId) : undefined);

/** Lo que funciona de un tipo (lo destrozado no atiende a nadie). */
export function careBuildings(state: GameState, kind: 'nursery' | 'residence'): Building[] {
  return state.buildings.filter((b) => b.kind === kind && b.built && !b.damaged);
}

/* ---------------- cuotas ---------------- */

export function canSetCareFee(state: GameState, service: 'nursery' | 'residence', level: FeeLevel): CommandResult {
  if (!state.buildings.some((b) => b.kind === service && b.built)) return { ok: false, error: service === 'nursery' ? 'Primero hay que construir la guardería' : 'Primero hay que construir la residencia' };
  if ((service === 'nursery' ? state.care.nurseryFee : state.care.residenceFee) === level) return { ok: false, error: 'Esa cuota ya está puesta' };
  return { ok: true };
}

export function setCareFee(state: GameState, service: 'nursery' | 'residence', level: FeeLevel): void {
  if (service === 'nursery') state.care.nurseryFee = level;
  else state.care.residenceFee = level;
}

export const nurseryFee = (state: GameState): number => CARE.nursery.fee[state.care.nurseryFee];
export const residenceFee = (state: GameState): number => CARE.residence.fee[state.care.residenceFee];

/* ---------------- jubilados y pensión ---------------- */

/** Jubilado: con la edad de la pensión y sin trabajo en el pueblo (ya no va a trabajar fuera). */
export function isRetired(c: Citizen): boolean {
  return c.age >= CARE.pensionAge && c.jobId === null;
}

/** Cada mes: la pensión mínima (la paga el Estado, de fuera). Va tras las nóminas y antes del gasto. */
export function pensionsMonth(state: GameState): void {
  for (const c of state.citizens) if (isRetired(c)) transfer(state, OUTSIDE, c.id, CARE.pension);
}

/* ---------------- guardería ---------------- */

/** Plazas de guardería: cuántos niños tiene cada una y qué niños (hogar:nacimiento) tienen plaza. */
export interface NurseryUse {
  use: Map<number, number>;
  placed: Set<string>;
  /** Guardería con sitio que llega a esta casa (la más cercana), si hay. */
  free(home: Building | undefined): Building | undefined;
  take(b: Building, key: string): void;
}

const kidKey = (homeId: number, t: number) => `${homeId}:${t}`;
const isSmall = (state: GameState, t: number) => state.tick - t < CARE.nursery.maxAgeYears * YEAR;

/**
 * Reparte las plazas sin azar: por orden de vecino y de nacimiento, cada niño
 * pequeño va a la guardería con sitio más cercana a su casa (dentro del radio).
 * Un niño cuenta una vez por hogar (los dos padres lo apuntan).
 */
export function nurseryUse(state: GameState): NurseryUse {
  const nurseries = careBuildings(state, 'nursery');
  const use = new Map<number, number>();
  const placed = new Set<string>();
  const free = (home: Building | undefined) => {
    if (!home) return undefined;
    let best: Building | undefined;
    for (const n of nurseries) {
      if ((use.get(n.id) ?? 0) >= CARE.nursery.places || dist(n, home) > CARE.nursery.radius) continue;
      if (!best || dist(n, home) < dist(best, home)) best = n;
    }
    return best;
  };
  const take = (b: Building, key: string) => {
    use.set(b.id, (use.get(b.id) ?? 0) + 1);
    placed.add(key);
  };
  if (nurseries.length) {
    const seen = new Set<string>();
    for (const c of state.citizens) {
      if (c.homeId === null) continue;
      for (const t of c.kids ?? []) {
        const key = kidKey(c.homeId, t);
        if (!isSmall(state, t) || seen.has(key)) continue;
        seen.add(key);
        const n = free(homeOf(state, c));
        if (n) take(n, key);
      }
    }
  }
  return { use, placed, free, take };
}

/** Niños pequeños (menos de 3 años) de un hogar, sin repetir. */
function smallKids(state: GameState, homeId: number): number[] {
  const out = new Set<number>();
  for (const c of state.citizens) if (c.homeId === homeId) for (const t of c.kids ?? []) if (isSmall(state, t)) out.add(t);
  return [...out].sort((a, b) => a - b);
}

/**
 * Natalidad: con plaza de guardería para el bebé, ×1,5. Si nace, la plaza queda
 * apartada (`take`) para que dos bebés no cuenten con la misma.
 */
export function birthFx(state: GameState, c: Citizen, nm: NurseryUse): { fx: number; nursery?: Building } {
  const n = nm.free(homeOf(state, c));
  return n ? { fx: CARE.birthWithPlace[state.care.nurseryFee] ?? 1.5, nursery: n } : { fx: 1 };
}

export function onBirth(state: GameState, c: Citizen, nm: NurseryUse, nursery: Building | undefined): void {
  if (nursery && c.homeId !== null) nm.take(nursery, kidKey(c.homeId, state.tick));
}

/** ¿Dejó el trabajo de fuera para criar a un bebé que sigue sin plaza? (entonces no busca otro). */
export function raisingAtHome(state: GameState, c: Citizen, nm: NurseryUse): boolean {
  if (c.homeId === null) return false;
  const quit = c.memories.filter((m) => m.kind === 'deja_trabajo_crianza').at(-1);
  if (!quit) return false;
  const kids = smallKids(state, c.homeId);
  return kids.some((t) => t <= quit.tick && !nm.placed.has(kidKey(c.homeId!, t)));
}

/**
 * Cada mes, tras el paro: en las parejas con un bebé sin plaza de guardería, el
 * que menos cobra puede dejar su trabajo de fuera para cuidarlo (una vez por bebé).
 */
export function childcareMonth(state: GameState, nm: NurseryUse = nurseryUse(state)): void {
  const done = new Set<number>();
  for (const a of state.citizens) {
    if (a.homeId === null || done.has(a.homeId)) continue;
    const homeId = a.homeId;
    const kid = smallKids(state, homeId).filter((t) => !nm.placed.has(kidKey(homeId, t))).at(-1);
    if (kid === undefined || !(a.kids ?? []).includes(kid)) continue;
    const pr = a.relations.find((r) => r.kind === 'pareja');
    const b = pr ? state.citizens.find((x) => x.id === pr.id && x.homeId === homeId) : undefined;
    if (!b) continue;
    done.add(homeId);
    const couple = [a, b];
    if (couple.some((x) => x.memories.some((m) => m.kind === 'deja_trabajo_crianza' && m.tick >= kid))) continue;
    // El que menos cobra (el mes pasado); a igualdad, el de id mayor.
    const low = [...couple].sort((x, y) => (x.last?.in ?? 0) - (y.last?.in ?? 0) || y.id - x.id)[0]!;
    if (low.jobId !== null || low.unemployedSince !== undefined || isRetired(low)) continue;
    if (!chance(state.rng, CARE.quitWithoutPlace)) continue;
    low.unemployedSince = state.tick;
    low.benefitLeft = 0;
    addMemory(state, low, 'deja_trabajo_crianza', 4, -2);
    const other = low === a ? b : a;
    if (low.named || other.named) pushEvent(state, 'info', `${first(low)} deja su trabajo de fuera para cuidar del bebé: no hay plaza en la guardería`, { ref: low.id });
  }
}

/* ---------------- residencia y mayores ---------------- */

export function residencePlaces(state: GameState): number {
  const n = careBuildings(state, 'residence').length;
  return n ? n * CARE.residence.places + (state.care.extraPlaces ?? 0) : 0;
}

export function residenceFree(state: GameState): number {
  return Math.max(0, residencePlaces(state) - state.citizens.filter((c) => c.care === 'residencia').length);
}

/** Mayor atendido (en la residencia o cuidado en casa por un hijo): no se va por infelicidad. */
export function attended(c: Citizen): boolean {
  return c.age >= CARE.elderAge && !!c.care;
}

/** Hijos que viven en el pueblo. */
export function childrenOf(state: GameState, p: Citizen): Citizen[] {
  return state.citizens.filter((c) => c.parents?.includes(p.id));
}

/**
 * ¿Vive solo? Sin pareja en el pueblo y sin familia (padres o hijos) en su casa;
 * los vecinos de otro piso del mismo bloque no cuentan.
 */
function livesAlone(state: GameState, p: Citizen): boolean {
  if (p.homeId === null) return false;
  const partner = p.relations.find((r) => r.kind === 'pareja');
  if (partner && state.citizens.some((x) => x.id === partner.id)) return false;
  return !state.citizens.some((x) => x !== p && x.homeId === p.homeId && (x.parents?.includes(p.id) || p.parents?.includes(x.id)));
}

/** Quien cuida en casa a este mayor: el hijo que vive con él o, si no, el primero. */
export function carerOf(state: GameState, p: Citizen): Citizen | undefined {
  if (p.care !== 'casa') return undefined;
  const kids = childrenOf(state, p);
  return kids.find((k) => k.homeId !== null && k.homeId === p.homeId) ?? kids[0];
}

/** Padre o madre (≥ 75, sin atención, solo o viviendo con él) por el que este vecino tiene que decidir. */
export function careParent(state: GameState, c: Citizen): Citizen | undefined {
  if (c.age < 18 || !c.parents?.length) return undefined;
  if (state.citizens.some((p) => p.care === 'casa' && carerOf(state, p) === c)) return undefined;
  return state.citizens.find((p) => c.parents!.includes(p.id) && p.age >= CARE.homeCare.parentAge && !p.care && (livesAlone(state, p) || p.homeId === c.homeId));
}

function roomAt(state: GameState, homeId: number | null): boolean {
  if (homeId === null) return false;
  const h = state.buildings.find((b) => b.id === homeId);
  return !!h && h.built && !h.damaged && homesOf(h) > state.citizens.filter((x) => x.homeId === homeId).length;
}

/** Acciones del menú de la IA (al final del menú): plazas y cuota reales. */
export function careMenu(state: GameState, c: Citizen): MenuItem[] {
  const p = careParent(state, c);
  if (!p) return [];
  const out: MenuItem[] = [];
  const free = residenceFree(state);
  if (free > 0) {
    const fee = residenceFee(state);
    out.push({ accion: `llevar_a_residencia:${p.id}`, detalle: `llevar a ${first(p)} (${p.age} años) a la residencia: ${free === 1 ? 'queda 1 plaza' : `quedan ${free} plazas`}, cuota ${fee} €/mes (la paga su pensión; si no llega, usted)` });
  }
  const moves = p.homeId !== c.homeId && !p.owns && roomAt(state, c.homeId);
  out.push({ accion: `cuidar_en_casa:${p.id}`, detalle: `cuidar a ${first(p)} (${p.age} años) en casa${moves ? ' (se viene a vivir con usted)' : ''}: trabajará menos (un ${Math.round(CARE.homeCare.wageCut * 100)} % menos de sueldo) y le costará ánimo, pero os unirá` });
  return out;
}

/** Por reglas (Modo normal o si la IA no responde): según sus rasgos. */
export function careRuleAction(state: GameState, c: Citizen): string | null {
  const p = careParent(state, c);
  if (!p) return null;
  const free = residenceFree(state) > 0;
  // Ahorrador o ambicioso (y con plaza): la residencia. Sociable: en casa. Si no hay plaza, solo lo cuida el sociable.
  if (free && (c.traits.ahorro >= 50 || c.traits.ambicion >= 60 || c.traits.social < 40)) return `llevar_a_residencia:${p.id}`;
  if (c.traits.social >= 40) return `cuidar_en_casa:${p.id}`;
  return free ? `llevar_a_residencia:${p.id}` : null;
}

/** El hijo lleva a su padre o madre a la residencia (si hay plaza). Devuelve el efecto. */
export function takeToResidence(state: GameState, child: Citizen, p: Citizen | undefined): string {
  if (!p || careParent(state, child) !== p) return 'al final no lleva a nadie a la residencia';
  if (residenceFree(state) <= 0) return 'quería llevar a su padre a la residencia, pero no queda plaza';
  p.care = 'residencia';
  addMemory(state, p, 'a_la_residencia', 4, 1);
  addMemory(state, child, 'a_la_residencia', 3, 0, [p.id]);
  return `lleva a ${first(p)} a la residencia`;
}

/** El hijo cuida en casa a su padre o madre (se muda con él si cabe y no tiene casa propia). */
export function careAtHome(state: GameState, child: Citizen, p: Citizen | undefined): string {
  if (!p || careParent(state, child) !== p) return 'al final no cuida a nadie en casa';
  p.care = 'casa';
  const moves = p.homeId !== child.homeId && !p.owns && roomAt(state, child.homeId);
  if (moves) {
    p.homeId = child.homeId;
    p.rentArrears = 0;
  }
  addMemory(state, child, 'cuida_padre', 4, CARE.homeCare.relation, [p.id]);
  addMemory(state, p, 'cuida_padre', 4, CARE.homeCare.relation);
  return `cuida a ${first(p)} en casa${moves ? ' (se lo lleva a vivir con él)' : ''}`;
}

/** Aplica una acción de cuidados (IA o reglas). Null si no es de cuidados. */
export function careAction(state: GameState, c: Citizen, verb: string, arg: string | undefined): string | null {
  const p = state.citizens.find((x) => x.id === Number(arg));
  if (verb === 'llevar_a_residencia') return takeToResidence(state, c, p);
  if (verb === 'cuidar_en_casa') return careAtHome(state, c, p);
  return null;
}

/**
 * Cada mes, tras la vivienda y los tributos: plazas de la residencia (si se
 * pierde una, sale el último en entrar… el más joven), quién cuida a quién,
 * las decisiones por reglas de los vecinos sin IA, el ingreso de los mayores
 * que viven solos sin hijos en el pueblo, y las cuotas (con `charge`: lo que no
 * se pueda pagar queda como deuda con el ayuntamiento).
 */
export function careMonth(state: GameState, nm: NurseryUse = nurseryUse(state)): void {
  // Sin plazas suficientes (residencia destrozada o derribada): salen los más jóvenes.
  const residents = state.citizens.filter((c) => c.care === 'residencia').sort((a, b) => b.age - a.age || a.id - b.id);
  for (const c of residents.slice(residencePlaces(state))) {
    delete c.care;
    if (c.named) pushEvent(state, 'warning', `${c.name} tiene que dejar la residencia: no hay plazas`, { ref: c.id });
  }
  // Quien cuidaba en casa ya no está: el mayor se queda sin atención.
  for (const p of state.citizens) if (p.care === 'casa' && !carerOf(state, p)) delete p.care;
  // Hijos sin IA: deciden por reglas.
  for (const c of state.citizens) {
    if (isAiCitizen(state, c)) continue;
    const act = careRuleAction(state, c);
    if (!act) continue;
    const [verb, arg] = act.split(':');
    const effect = careAction(state, c, verb!, arg);
    if (c.named && effect && !effect.startsWith('al final') && !effect.startsWith('quería')) pushEvent(state, 'decision', `${c.name} ${effect}`, { ref: c.id });
  }
  // Mayores que viven solos y sin hijos en el pueblo: entran si hay plaza (los más mayores primero) y la pueden pagar.
  const fee = residenceFee(state);
  const alone = state.citizens
    .filter((p) => p.age >= CARE.elderAge && !p.care && livesAlone(state, p) && !childrenOf(state, p).length && (p.age >= CARE.homeCare.parentAge || p.happiness < CARE.residence.unhappyEnter))
    // Ronda 20: con la cuota alta (más de media pensión) solo entra quien tiene ahorros.
    .filter((p) => fee <= CARE.pension * 0.5 || p.money >= fee * CARE.residence.savingsMonths)
    .sort((a, b) => b.age - a.age || a.id - b.id);
  for (const p of alone) {
    if (residenceFree(state) <= 0) break;
    p.care = 'residencia';
    addMemory(state, p, 'a_la_residencia', 4, 1);
    if (p.named) pushEvent(state, 'info', `${p.name} entra en la residencia`, { ref: p.id });
  }
  // Cuotas de la guardería: paga quien tiene apuntado al niño (el de id menor del hogar).
  const nFee = nurseryFee(state);
  if (nFee > 0 && nm.placed.size) {
    const paid = new Set<string>();
    for (const c of state.citizens) {
      if (c.homeId === null) continue;
      for (const t of c.kids ?? []) {
        const key = kidKey(c.homeId, t);
        if (!nm.placed.has(key) || paid.has(key)) continue;
        paid.add(key);
        charge(state, c, TREASURY, nFee, 'guardería');
      }
    }
  }
  // Cuotas de la residencia: el mayor con lo que tenga; lo que falte, un hijo (o deuda del propio mayor).
  if (fee > 0) {
    for (const p of state.citizens.filter((c) => c.care === 'residencia')) {
      const own = transfer(state, p.id, TREASURY, fee, 'residencia');
      const rest = fee - own;
      if (rest <= 0) continue;
      const child = childrenOf(state, p).sort((a, b) => b.money - a.money || a.id - b.id)[0];
      charge(state, child ?? p, TREASURY, rest, 'residencia');
    }
  }
  // Cuidar en casa: el hijo trabaja menos (deja de ganar una parte de lo que entra este mes).
  for (const p of state.citizens) {
    const carer = carerOf(state, p);
    if (!carer) continue;
    const cut = Math.round((carer.flow?.[0] ?? 0) * CARE.homeCare.wageCut);
    if (cut > 0) transfer(state, carer.id, OUTSIDE, cut);
  }
}

/** Lo que pesa en el ánimo (tick.ts, `happinessFactors`). */
export function careMood(state: GameState, c: Citizen): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  if (isRetired(c)) out.push({ label: 'Jubilado (cobra la pensión)', value: 0 });
  if (attended(c)) out.push({ label: c.care === 'residencia' ? 'Bien atendido en la residencia' : 'Bien atendido en casa por su familia', value: CARE.caredMood });
  // Solo y sin nadie: se nota cuando ya hay residencia en el pueblo (y no tiene plaza).
  else if (c.age >= CARE.homeCare.parentAge && livesAlone(state, c) && careBuildings(state, 'residence').length) out.push({ label: 'Mayor, solo y sin nadie que le atienda', value: CARE.aloneMood });
  if (state.citizens.some((p) => p.care === 'casa' && carerOf(state, p) === c)) out.push({ label: 'Cuida de su padre o su madre en casa', value: CARE.homeCare.mood });
  return out;
}
