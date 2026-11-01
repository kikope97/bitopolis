import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { countsAsSports } from './landmarks.ts';
import { leaveTown } from './household.ts';
import { hash32 } from './hash.ts';
import { SOCIAL_PLACES } from './balance.ts';
import { rememberDeparted } from './family.ts';
import {
  ADULT_AGE,
  BIRTH_CHANCE_ADULT,
  BIRTH_CHANCE_COUPLE,
  DEATH_RATE_MAX,
  DEATH_RATE_PER_YEAR_OVER,
  DEATH_START_AGE,
  MUNICIPAL_PRICE_CAP,
  KID_YEARS,
  KIDS_MAX,
} from './balance.ts';
import { monthRates, sellOnDeparture, unitValue } from './economy.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance } from './prng.ts';
import { addMemory } from './social.ts';
import type { Citizen, GameState } from './state.ts';
import { pushEvent } from './state.ts';
import { freeHomes, newResident } from './tick.ts';
import { tryAmbulance } from './fire.ts';
import { tendersForget } from './tenders.ts';
import { birthFx, nurseryUse, onBirth } from './care.ts';
import { CARE } from './balance.ts';

/**
 * Ciclo vital (v1.5): cumpleaños, nacimientos, hijos que se independizan,
 * fallecimientos y herencias. Determinista (PRNG de la partida).
 */

const YEAR_TICKS = DAYS_PER_YEAR * TICKS_PER_DAY;
const first = (c: Citizen) => c.name.split(' ')[0]!;
const surname = (c: Citizen) => c.name.split(' ').slice(1, 2).join(' ') || 'García';

/** A quién pasa lo suyo: a su pareja. Si no tiene, a su familia de fuera (ronda 11: heredaban amistades). */
export function heirOf(state: GameState, c: Citizen): Citizen | undefined {
  const r = c.relations.find((x) => x.kind === 'pareja');
  return r ? state.citizens.find((x) => x.id === r.id) : undefined;
}

/** Fallece un vecino: herencia (dinero, casa, negocio y plusvalía municipal), duelo y baja. */
export function dies(state: GameState, c: Citizen): void {
  const heir = heirOf(state, c);
  // Negocios: a quien hereda o, si no hay, a un inversor de fuera.
  for (const b of state.buildings) if (b.owner === c.id) b.owner = heir ? heir.id : OUTSIDE;
  const home = state.buildings.find((b) => b.id === c.homeId);
  if (c.owns && home && heir && heir.homeId === c.homeId && !heir.owns) {
    // La casa pasa a quien vivía con él o ella; el ayuntamiento cobra la plusvalía (como en la realidad).
    // Mismo valor que en una venta (con el tope de la vivienda que fue municipal), y el heredero
    // la adquiere a ese valor: la plusvalía no se cobra dos veces (ronda 11).
    const value = c.subsidized ? Math.min(unitValue(state, home), MUNICIPAL_PRICE_CAP) : unitValue(state, home);
    const gain = Math.max(0, value - c.boughtPrice);
    heir.owns = true;
    heir.boughtPrice = value;
    heir.boughtTick = state.tick;
    heir.mortgage = c.mortgage;
    heir.mortgageTo = c.mortgageTo;
    heir.subsidized = c.subsidized;
    c.owns = false;
    c.mortgage = 0;
    transfer(state, c.id, TREASURY, Math.round(gain * monthRates(state).plusvalia), 'plusvalía');
  } else {
    sellOnDeparture(state, c);
  }
  // v1.9: herencia a beneficio de inventario: primero se pagan sus deudas con lo que deja.
  leaveTown(state, c);
  if (heir) {
    transfer(state, c.id, heir.id, c.money);
    addMemory(state, heir, 'heredo', 3, 2, [c.id]);
    const kids = c.kids ?? [];
    if (kids.length && c.relations.some((r) => r.id === heir.id && r.kind === 'pareja')) heir.kids = [...(heir.kids ?? []), ...kids].slice(0, KIDS_MAX + 2);
  } else {
    // Sin nadie en el pueblo: lo hereda la familia de fuera.
    transfer(state, c.id, OUTSIDE, c.money);
  }
  // Duelo: quien lo quería lo recuerda. Con cementerio en el pueblo, se lleva mejor (v1.7).
  const cemetery = state.buildings.some((b) => b.kind === 'cemetery' && b.built);
  const grief = cemetery ? SOCIAL_PLACES.cemeteryGrief : 1;
  for (const o of state.citizens) {
    const r = o.relations.find((x) => x.id === c.id);
    if (!r) continue;
    if (r.kind === 'pareja' || r.kind === 'amistad') addMemory(state, o, 'perdio_a', r.kind === 'pareja' ? 5 : 3, Math.round((r.kind === 'pareja' ? -7 : -4) * grief), [c.id]);
    o.relations = o.relations.filter((x) => x.id !== c.id);
  }
  state.pending = state.pending.filter((p) => p.citizenId !== c.id);
  rememberDeparted(state, c, 'fallecio');
  tendersForget(state, c.id);
  state.citizens = state.citizens.filter((x) => x !== c);
  const keeps = heir && heir.owns && heir.homeId === c.homeId ? `Su casa queda con ${first(heir)}` : heir ? `Lo suyo queda con ${first(heir)}` : 'Lo deja todo a su familia de fuera';
  pushEvent(state, 'departure', `Nos ha dejado ${c.name}, a los ${c.age} años. El pueblo le despide ${cemetery ? 'en el cementerio' : 'en la plaza'}. ${keeps}`, heir ? { ref: heir.id } : {});
  state.lastDeathTick = state.tick;
}

/** Una vez al año (1 de enero): cumpleaños, hijos que cumplen 18 y fallecimientos. */
export function lifeYear(state: GameState): void {
  for (const c of state.citizens) c.age++;
  // Hijos que se hacen mayores: se independizan en el pueblo si hay casa; si no, se van a estudiar fuera.
  for (const c of [...state.citizens]) {
    const kids = c.kids ?? [];
    const grown = kids.filter((t) => state.tick - t >= KID_YEARS * YEAR_TICKS);
    if (!grown.length) continue;
    c.kids = kids.filter((t) => !grown.includes(t));
    for (let i = 0; i < grown.length; i++) {
      // Ronda 13: dos apellidos, el primero de cada progenitor; y padres en el árbol.
      const partnerId = c.relations.find((r) => r.kind === 'pareja')?.id;
      const partner = state.citizens.find((x) => x.id === partnerId);
      const surnames = partner ? `${surname(c)} ${surname(partner)}` : surname(c);
      const parents = partnerId !== undefined ? [c.id, partnerId] : [c.id];
      if (freeHomes(state) > 0) {
        const kid = newResident(state, { age: ADULT_AGE, surname: surnames });
        kid.parents = parents;
        state.citizens.push(kid);
        transfer(state, c.id, kid.id, Math.min(c.money, 500));
        pushEvent(state, 'arrival', `${first(kid)}, de casa de ${first(c)}, cumple 18, se independiza y se queda en el pueblo`, { ref: kid.id });
      } else {
        // Se va, pero sigue en el árbol familiar con su nombre.
        const kid = newResident(state, { age: ADULT_AGE, surname: surnames });
        state.departed?.push({ id: kid.id, name: kid.name, age: ADULT_AGE, parents, tick: state.tick, reason: 'se_fue' });
        pushEvent(state, 'info', `${first(kid)}, de casa de ${first(c)}, cumple 18 y se va a estudiar fuera: no hay casa libre en el pueblo`, { ref: c.id });
      }
    }
  }
}

/**
 * Cada día: el dado de la vida de cada mayor se tira en «su» día del año
 * (no todos el 1 de enero) y como mucho hay una despedida por semana (ronda 11).
 */
export function lifeDay(state: GameState): void {
  if (state.citizens.length <= 2 || state.tick - (state.lastDeathTick ?? -1e9) < 7 * TICKS_PER_DAY) return;
  const dayOfYear = Math.floor(state.tick / TICKS_PER_DAY) % DAYS_PER_YEAR;
  // Los líderes políticos no: la política tiene su propio ciclo.
  const protectedIds = new Set([state.politics.party?.leaderId, typeof state.politics.mayor === 'number' ? state.politics.mayor : undefined]);
  for (const c of state.citizens) {
    if (c.age < DEATH_START_AGE || protectedIds.has(c.id) || hash32(state.seed, c.id) % DAYS_PER_YEAR !== dayOfYear) continue;
    // v1.7: con polideportivo cerca de casa, los mayores se cuidan más.
    const home = state.buildings.find((b) => b.id === c.homeId);
    const fit = home && state.buildings.some((b) => countsAsSports(b) && b.built && Math.abs(b.x - home.x) + Math.abs(b.y - home.y) <= 8);
    // 2.4: en la residencia, bien atendidos (×0,8).
    const p = Math.min(DEATH_RATE_MAX, (c.age - DEATH_START_AGE + 2) * DEATH_RATE_PER_YEAR_OVER) * (fit ? 1 - SOCIAL_PLACES.sportsHealth : 1) * (c.care === 'residencia' ? CARE.residenceDeathFx : 1);
    if (chance(state.rng, p)) {
      // 2.1: es una urgencia; con ambulancia que llegue a tiempo, la despedida se pospone (un año).
      if (tryAmbulance(state, c)) return;
      dies(state, c);
      return;
    }
  }
}

/** Cada mes: nacimientos (parejas que viven juntas y, en general, adultos jóvenes). */
export function lifeMonth(state: GameState): void {
  // 2.4: con plaza de guardería, más bebés (×1,5); la plaza queda para el bebé.
  const nm = nurseryUse(state);
  for (const a of state.citizens) {
    if (!a.named) continue;
    for (const r of a.relations) {
      if (r.kind !== 'pareja' || r.id < a.id) continue; // cada pareja una vez
      const b = state.citizens.find((x) => x.id === r.id);
      if (!b || b.homeId === null || b.homeId !== a.homeId) continue;
      // Los dos con 20–45 años y 18 meses desde el último bebé (ronda 11: había bebés a los 50 y seguidos).
      const kids = a.kids ?? [];
      if (Math.min(a.age, b.age) < 20 || Math.max(a.age, b.age) > 45 || kids.length >= KIDS_MAX) continue;
      if (kids.length && state.tick - kids.at(-1)! < 18 * TICKS_PER_MONTH) continue;
      const nb = birthFx(state, a, nm);
      if (!chance(state.rng, BIRTH_CHANCE_COUPLE * nb.fx)) continue;
      a.kids = [...(a.kids ?? []), state.tick];
      onBirth(state, a, nm, nb.nursery);
      addMemory(state, a, 'nacio_hijo', 5, 5);
      addMemory(state, b, 'nacio_hijo', 5, 5);
      pushEvent(state, 'arrival', `¡Llega un bebé a casa de ${first(a)} y ${first(b)}!`, { ref: a.id });
    }
  }
  for (const c of state.citizens) {
    if (c.named || c.homeId === null || c.age < 20 || c.age > 42 || (c.kids ?? []).length >= KIDS_MAX) continue;
    if ((c.kids ?? []).length && state.tick - c.kids!.at(-1)! < 18 * TICKS_PER_MONTH) continue;
    const nb = birthFx(state, c, nm);
    if (chance(state.rng, BIRTH_CHANCE_ADULT * nb.fx)) {
      c.kids = [...(c.kids ?? []), state.tick];
      onBirth(state, c, nm, nb.nursery);
    }
  }
}

/** Niños del pueblo (cuentan para el colegio y en el censo). */
export function kidsCount(state: GameState): number {
  return state.citizens.reduce((n, c) => n + (c.kids?.length ?? 0), 0);
}
