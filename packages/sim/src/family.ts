import type { Citizen, GameState } from './state.ts';

/**
 * v1.7: árbol genealógico. Cada vecino recuerda a sus padres (los hijos que se
 * independizan en el pueblo) y de quien se va o fallece queda una ficha breve,
 * para que la familia siga completa en el árbol.
 */
export interface Departed {
  id: number;
  name: string;
  age: number;
  parents?: number[];
  partnerId?: number;
  /** Cuándo se fue. */
  tick: number;
  reason: 'fallecio' | 'se_fue';
}

const DEPARTED_MAX = 200;

/** Guarda la ficha de quien deja el pueblo (solo si tiene familia o nombre: lo que el árbol puede enseñar). */
export function rememberDeparted(state: GameState, c: Citizen, reason: Departed['reason']): void {
  if (!state.departed) return;
  const partner = c.relations.find((r) => r.kind === 'pareja')?.id;
  const hasFamily = !!c.parents?.length || partner !== undefined || state.citizens.some((x) => x.parents?.includes(c.id));
  if (!c.named && !hasFamily) return;
  state.departed.push({ id: c.id, name: c.name, age: c.age, ...(c.parents?.length ? { parents: c.parents } : {}), ...(partner !== undefined ? { partnerId: partner } : {}), tick: state.tick, reason });
  if (state.departed.length > DEPARTED_MAX) {
    // 2.2: quien tiene calle no se olvida (la placa sigue diciendo su nombre).
    const keep = new Set((state.streetNames ?? []).map((s) => s.citizenId));
    let extra = state.departed.length - DEPARTED_MAX;
    state.departed = state.departed.filter((d) => extra <= 0 || keep.has(d.id) || (extra--, false));
  }
}

export interface Kin {
  id: number;
  name: string;
  /** En el pueblo, o si se fue / falleció. */
  status: 'vive' | 'fallecio' | 'se_fue';
  age: number;
}

export interface Family {
  self: Kin;
  partner: Kin | null;
  parents: Kin[];
  siblings: Kin[];
  children: Kin[];
  grandchildren: Kin[];
  /** Hijos que aún viven en casa (sin ficha propia). */
  kidsAtHome: number;
}

function kin(state: GameState, id: number): Kin | null {
  const c = state.citizens.find((x) => x.id === id);
  if (c) return { id, name: c.name, status: 'vive', age: c.age };
  const d = state.departed?.find((x) => x.id === id);
  return d ? { id, name: d.name, status: d.reason, age: d.age } : null;
}

function parentsOf(state: GameState, id: number): number[] {
  return state.citizens.find((x) => x.id === id)?.parents ?? state.departed?.find((x) => x.id === id)?.parents ?? [];
}

function childrenOf(state: GameState, id: number): number[] {
  const living = state.citizens.filter((x) => x.parents?.includes(id)).map((x) => x.id);
  const gone = (state.departed ?? []).filter((x) => x.parents?.includes(id)).map((x) => x.id);
  return [...living, ...gone];
}

/** La familia de un vecino (vivo o que ya no está), hasta los nietos. */
export function familyOf(state: GameState, id: number): Family | null {
  const self = kin(state, id);
  if (!self) return null;
  const c = state.citizens.find((x) => x.id === id);
  // La pareja viva; si no, la que falleció o se fue (para que el viudo no se quede solo en el árbol).
  const partnerId =
    c?.relations.find((r) => r.kind === 'pareja')?.id ??
    state.departed?.find((x) => x.id === id)?.partnerId ??
    [...(state.departed ?? [])].reverse().find((x) => x.partnerId === id)?.id;
  const parents = parentsOf(state, id);
  const children = childrenOf(state, id);
  const siblings = parents.length
    ? [...new Set(parents.flatMap((p) => childrenOf(state, p)))].filter((x) => x !== id)
    : [];
  const list = (ids: number[]) => ids.map((x) => kin(state, x)).filter((k): k is Kin => !!k);
  return {
    self,
    partner: partnerId !== undefined ? kin(state, partnerId) : null,
    parents: list(parents),
    siblings: list(siblings),
    children: list(children),
    grandchildren: list(children.flatMap((ch) => childrenOf(state, ch))),
    kidsAtHome: c?.kids?.length ?? 0,
  };
}
