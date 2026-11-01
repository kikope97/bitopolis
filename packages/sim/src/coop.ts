/**
 * 2.5 (bloque G): cooperativa agraria (`coop`). Pueden ser socios los vecinos
 * con finca (su dueño o quien la trabaja). La cooperativa vende la cosecha de
 * los socios más cara (+15 %; con la almazara o la bodega, nivel 2, +25 %): la
 * diferencia la paga el comprador de fuera y entra en la caja de la
 * cooperativa, igual que la cuota de cada socio (con `charge()`: lo impagado
 * queda como deuda). Al cerrar el año lo reparte todo a partes iguales con
 * `transfer`. Una parte de cada cosecha queda como excedente (`stock`): lo puede
 * comprar la comarca (`sellCoopSurplus`) y, si no, se vende fuera a final de año.
 *
 * IA: `hacerse_socio` / `darse_de_baja` en el menú del vecino (`coopMenu`); por
 * reglas, según sus rasgos (`coopRuleAction`). El presidente sale de una
 * votación determinista entre los socios según su actitud hacia el alcalde.
 * Números en `COOP` (balance.ts).
 */
import { TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import { COOP, DEBT } from './balance.ts';
import { FARM_NAME, harvestMonthOf, isFarm } from './farm.ts';
import { hash32 } from './hash.ts';
import { totalDebt } from './household.ts';
import { levelOf } from './levels.ts';
import { OUTSIDE, transfer } from './money.ts';
import type { Building, Citizen, GameState } from './state.ts';
import { pushEvent } from './state.ts';

/** Lo que se ofrece en el menú de la IA (mismo tipo que `MenuItem` de turns.ts). */
interface CoopMenuItem {
  accion: string;
  detalle?: string;
}

const key = (id: number) => String(id);
const first = (c: Citizen) => c.name.split(' ')[0]!;

/** La cooperativa del pueblo (terminada); `working`: además, sin destrozar. */
export function coopBuilding(state: GameState, working = false): Building | undefined {
  return state.buildings.find((b) => b.kind === 'coop' && b.built && (!working || !b.damaged));
}

/** Finca del vecino: la suya (dueño) o en la que trabaja. */
export function farmOf(state: GameState, c: Citizen): Building | undefined {
  return state.buildings.find((b) => isFarm(b) && b.built && (b.owner === c.id || c.jobId === b.id));
}

export const isMember = (state: GameState, c: Citizen): boolean => state.coop.members.includes(c.id);

/** Sobreprecio de la cosecha de los socios (0,15; con la almazara o la bodega, 0,25). */
export function coopPriceFx(state: GameState): number {
  const b = coopBuilding(state, true);
  if (!b) return 0;
  return levelOf(b) >= 2 ? COOP.priceFxLevel2 : COOP.priceFx;
}

/** Nombre del nivel 2 según lo que cultivan los socios: almazara (olivar), bodega (viñedo) o las dos. */
export function coopLevelName(state: GameState): string {
  const crops = new Set(state.coop.members.map((id) => state.citizens.find((c) => c.id === id)).map((c) => (c ? farmOf(state, c)?.crop : undefined)));
  const olive = crops.has('olivar');
  const wine = crops.has('vinedo');
  return olive && !wine ? 'almazara' : wine && !olive ? 'bodega' : olive && wine ? 'almazara y bodega' : 'almazara o bodega';
}

/** ¿Puede hacerse socio? (hay cooperativa, tiene finca y no lo es ya) */
export function canJoinCoop(state: GameState, c: Citizen): boolean {
  return !!coopBuilding(state, true) && !isMember(state, c) && !!farmOf(state, c);
}

/** ¿Puede darse de baja? (es socio desde hace `COOP.minMonths` meses) */
export function canLeaveCoop(state: GameState, c: Citizen): boolean {
  if (!isMember(state, c)) return false;
  const since = state.coop.joined?.[key(c.id)] ?? -1e9;
  return state.tick - since >= COOP.minMonths * TICKS_PER_MONTH;
}

export function joinCoop(state: GameState, c: Citizen): string {
  if (!canJoinCoop(state, c)) return 'no puede hacerse socio de la cooperativa';
  state.coop.members.push(c.id);
  state.coop.joined = { ...(state.coop.joined ?? {}), [key(c.id)]: state.tick };
  if (state.coop.presidentId === null) electPresident(state, false);
  pushEvent(state, 'business', `${c.name} se hace socio de la cooperativa agraria`, { ref: c.id });
  return 'se hace socio de la cooperativa';
}

/** Baja (por su voluntad o, con `why`, porque deja de cumplir: sin finca o sin pagar). */
export function leaveCoop(state: GameState, c: Citizen | number, why?: string): string {
  const id = typeof c === 'number' ? c : c.id;
  if (!state.coop.members.includes(id)) return 'no era socio de la cooperativa';
  state.coop.members = state.coop.members.filter((x) => x !== id);
  if (state.coop.joined) delete state.coop.joined[key(id)];
  if (state.coop.arrears) delete state.coop.arrears[key(id)];
  const who = typeof c === 'number' ? state.citizens.find((x) => x.id === id) : c;
  if (who) pushEvent(state, 'business', why ? `La cooperativa da de baja a ${who.name}: ${why}` : `${who.name} se da de baja de la cooperativa`, { ref: who.id });
  if (state.coop.presidentId === id) {
    state.coop.presidentId = null;
    electPresident(state, true);
  }
  return 'se da de baja de la cooperativa';
}

/* ---------------- IA y reglas ---------------- */

/** Lo que puede elegir la IA (al final del menú de `turnMenu`). */
export function coopMenu(state: GameState, c: Citizen): CoopMenuItem[] {
  const pct = Math.round(coopPriceFx(state) * 100);
  const last = state.coop.perMember !== undefined ? `; en el último reparto tocaron ${state.coop.perMember} € por socio` : '';
  if (canJoinCoop(state, c)) return [{ accion: 'hacerse_socio', detalle: `hacerse socio de la cooperativa agraria: vende su cosecha un ${pct} % más cara y paga ${COOP.fee} € al mes${last}` }];
  if (canLeaveCoop(state, c)) return [{ accion: 'darse_de_baja', detalle: `darse de baja de la cooperativa (deja de pagar ${COOP.fee} € al mes y se queda sin reparto${last})` }];
  return [];
}

/** Las dos acciones de la IA (`extraAction` de turns.ts). Null si no es suya. */
export function coopAction(state: GameState, c: Citizen, verb: string): string | null {
  if (verb === 'hacerse_socio') return joinCoop(state, c);
  if (verb === 'darse_de_baja') return canLeaveCoop(state, c) ? leaveCoop(state, c) : 'al final sigue en la cooperativa';
  return null;
}

/** Sin IA: se apunta quien es sociable o ahorrador y puede pagar; se va el muy terco o quien no llega. Sin dados (hash). */
export function coopRuleAction(state: GameState, c: Citizen): string | null {
  // Un vecino lo piensa una vez al mes (siempre el mismo día para él).
  const month = Math.floor(state.tick / TICKS_PER_MONTH);
  if (hash32(state.seed, c.id, month, 51) % 4 !== 0) return null;
  if (canJoinCoop(state, c)) {
    const keen = c.traits.social >= COOP.joinSocial || c.traits.ahorro >= COOP.joinSaver;
    const can = c.money >= COOP.fee * COOP.joinMoneyFees && totalDebt(c) < DEBT.noticeable;
    return keen && can ? 'hacerse_socio' : null;
  }
  if (canLeaveCoop(state, c)) {
    const broke = c.money < COOP.fee && totalDebt(c) >= DEBT.noticeable;
    const stubborn = c.traits.terco >= COOP.leaveTerco && !state.coop.perMember;
    return broke || stubborn ? 'darse_de_baja' : null;
  }
  return null;
}

/** Vecinos que deciden por reglas cada mes: los que no piensan con IA (los de IA lo hacen en su turno). */
function decidesByRules(state: GameState, c: Citizen): boolean {
  return !(state.aiMode && c.named && !!state.ai && state.ai.share > 0);
}

/* ---------------- presidente ---------------- */

/**
 * Votación determinista: cada socio vota al otro socio con la actitud hacia el
 * alcalde más parecida a la suya (empate: el más sociable, luego el más
 * antiguo); gana quien más votos tiene (mismos desempates).
 */
export function coopVote(state: GameState): { id: number; votes: number }[] {
  const members = state.coop.members.map((id) => state.citizens.find((c) => c.id === id)).filter((c): c is Citizen => !!c);
  const att = (c: Citizen) => c.attitude ?? 0;
  const better = (a: Citizen, b: Citizen) => b.traits.social - a.traits.social || a.id - b.id;
  const votes = new Map<number, number>(members.map((c) => [c.id, 0]));
  for (const v of members) {
    const options = members.length > 1 ? members.filter((c) => c !== v) : members;
    const pick = [...options].sort((a, b) => Math.abs(att(a) - att(v)) - Math.abs(att(b) - att(v)) || better(a, b))[0]!;
    votes.set(pick.id, votes.get(pick.id)! + 1);
  }
  return members
    .sort((a, b) => votes.get(b.id)! - votes.get(a.id)! || better(a, b))
    .map((c) => ({ id: c.id, votes: votes.get(c.id)! }));
}

export function electPresident(state: GameState, announce = true): void {
  const winner = coopVote(state)[0];
  const prev = state.coop.presidentId;
  state.coop.presidentId = winner ? winner.id : null;
  if (!winner || !announce || winner.id === prev) return;
  const c = state.citizens.find((x) => x.id === winner.id)!;
  const n = state.coop.members.length;
  pushEvent(state, 'info', n > 1 ? `La cooperativa elige presidente a ${c.name} (${winner.votes} de ${n} votos)` : `${first(c)} preside la cooperativa (es su único socio)`, { ref: c.id });
}

/* ---------------- fin de mes ---------------- */

/**
 * Tras la venta de las cosechas (`farmMonth`) y antes de las nóminas: bajas de
 * quien ya no tiene finca o se ha ido, el sobreprecio de las cosechas de los
 * socios (de fuera a la cooperativa), las decisiones por reglas y, al cerrar
 * diciembre, el reparto y la elección de presidente.
 */
export function coopMonth(state: GameState): void {
  const coop = state.coop;
  if (!coop) return;
  const b = coopBuilding(state);
  if (!b) {
    // Sin cooperativa (derribada o nunca hecha): no hay socios.
    if (coop.members.length || coop.presidentId !== null) {
      coop.members = [];
      coop.presidentId = null;
      delete coop.joined;
      delete coop.arrears;
    }
    return;
  }
  for (const id of [...coop.members]) {
    const c = state.citizens.find((x) => x.id === id);
    if (!c) leaveCoop(state, id);
    else if (!farmOf(state, c)) leaveCoop(state, c, 'ya no tiene finca');
  }
  const d = tickToDate(state.tick - 1);
  if (!b.damaged) {
    // El sobreprecio: lo que vendió este mes cada finca de un socio (`b.sales` aún no se ha puesto a cero).
    const fx = coopPriceFx(state);
    const farms = new Set(coop.members.map((id) => farmOf(state, state.citizens.find((c) => c.id === id)!)?.id));
    for (const f of state.buildings) {
      if (!farms.has(f.id) || !f.crop || harvestMonthOf(f.crop) !== d.month || f.harvested !== d.year || !(f.sales! > 0)) continue;
      const extra = transfer(state, OUTSIDE, b.id, Math.round(f.sales! * fx));
      coop.yearBonus = (coop.yearBonus ?? 0) + extra;
      coop.stock = (coop.stock ?? 0) + Math.round(f.sales! * COOP.surplusShare);
      if (extra > 0) pushEvent(state, 'business', `La cooperativa vende la cosecha de ${f.name ?? FARM_NAME[f.crop]} un ${Math.round(fx * 100)} % más cara: ${extra} € más para el reparto`, { ref: b.id });
    }
    for (const c of state.citizens) {
      if (!decidesByRules(state, c)) continue;
      const act = coopRuleAction(state, c);
      if (act) coopAction(state, c, act);
    }
  }
  if (d.month === 12) {
    shareOut(state, b, d.year);
    electPresident(state);
  }
}

/** Cuota de cada socio (tras la vivienda y los tributos). Lo que no paga, deuda; tras `COOP.dropAfter` meses, baja. */
export function coopFees(state: GameState): void {
  const b = coopBuilding(state, true);
  if (!b || !state.coop.members.length) return;
  const arrears = { ...(state.coop.arrears ?? {}) };
  for (const id of [...state.coop.members]) {
    const c = state.citizens.find((x) => x.id === id);
    if (!c) continue;
    // Ronda 21: sin deuda con el banco: `arrears` lleva la cuenta y da de baja a los 3 meses.
    const paid = transfer(state, c.id, b.id, COOP.fee, 'cooperativa');
    if (paid >= COOP.fee) delete arrears[key(id)];
    else arrears[key(id)] = (arrears[key(id)] ?? 0) + 1;
  }
  state.coop.arrears = arrears;
  for (const [id, months] of Object.entries(arrears)) {
    if (months >= COOP.dropAfter) leaveCoop(state, Number(id), `lleva ${months} meses sin pagar la cuota`);
  }
  if (!Object.keys(state.coop.arrears ?? {}).length) delete state.coop.arrears;
}

/** Reparto del año: lo que queda del excedente se vende fuera y la caja se reparte a partes iguales. */
function shareOut(state: GameState, b: Building, year: number): void {
  const coop = state.coop;
  if (coop.stock) {
    transfer(state, OUTSIDE, b.id, Math.round(coop.stock * COOP.surplusOutsideFx));
    coop.stock = 0;
  }
  const members = coop.members.filter((id) => state.citizens.some((c) => c.id === id));
  coop.shareYear = year;
  coop.yearBonus = 0;
  if (!members.length) {
    coop.lastShare = 0;
    coop.perMember = 0;
    return;
  }
  const each = Math.floor(b.cash / members.length);
  let total = 0;
  for (const id of members) total += transfer(state, b.id, id, each);
  coop.lastShare = total;
  coop.perMember = each;
  if (total > 0) pushEvent(state, 'milestone', `Reparto de la cooperativa: ${total} € entre ${members.length === 1 ? 'su socio' : `sus ${members.length} socios`} (${each} € cada uno)`, { ref: b.id });
}

/* ---------------- excedentes (para la comarca) ---------------- */

/** Excedente de cosecha sin vender (euros de producto). */
export function coopSurplus(state: GameState): number {
  return coopBuilding(state, true) ? (state.coop.stock ?? 0) : 0;
}

/**
 * Vende el excedente (o `amount` de él) a un comprador de fuera del pueblo (un
 * pueblo vecino, comarca.ts) a `priceFx` de su valor. El dinero entra en la
 * caja de la cooperativa y va al reparto. Devuelve lo cobrado.
 */
export function sellCoopSurplus(state: GameState, priceFx = 1, amount?: number): number {
  const b = coopBuilding(state, true);
  const stock = state.coop.stock ?? 0;
  if (!b || stock <= 0) return 0;
  const sold = Math.max(0, Math.min(stock, Math.floor(amount ?? stock)));
  state.coop.stock = stock - sold;
  return transfer(state, OUTSIDE, b.id, Math.round(sold * priceFx));
}

/* ---------------- invariantes ---------------- */

export function coopInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const coop = state.coop;
  if (!coop) return errors;
  if (new Set(coop.members).size !== coop.members.length) errors.push('socio repetido en la cooperativa');
  if (coop.presidentId !== null && !coop.members.includes(coop.presidentId)) errors.push('el presidente de la cooperativa no es socio');
  if ((coop.stock ?? 0) < 0) errors.push('excedente negativo en la cooperativa');
  return errors;
}
