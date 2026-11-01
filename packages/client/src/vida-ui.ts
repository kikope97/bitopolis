/**
 * 2.4 «Vida»: lo que enseñan las fichas de la estación de autobuses, la
 * guardería, la residencia, la depuradora, las placas y el molino. Cada
 * cuota y el billete van con 3 botones de 44 px y «a quién afecta».
 */
import { DAYS_PER_YEAR, TICKS_PER_DAY, tickToDate, type Command } from '@bitopolis/shared';
import {
  type Building,
  type BusFare,
  CARE,
  type Citizen,
  type FeeLevel,
  type GameState,
  hasRiver,
  maintenanceOf,
  nurseryUse,
  renewableCapacity,
  renewableFx,
  residencePlaces,
  riders,
  riverExit,
  riverLoad,
  riverNear,
  seasonOf,
  TRANSIT,
  WATERWORKS,
} from '@bitopolis/sim';
import { money, plural } from './i18n.ts';
import { pixelIcon } from './icons.ts';
import { h } from './ui.ts';

type Cmd = (c: Command) => Promise<boolean>;

export const VIDA_KINDS: readonly string[] = ['busstation', 'nursery', 'residence', 'sewage', 'solar', 'wind'];

/** Palabras del río (los mismos tramos que la capa «Río»). */
export function riverWord(v: number): string {
  return v < 25 ? 'limpio' : v < 50 ? 'algo turbio' : v < 75 ? 'sucio' : 'muy sucio';
}

const FARE_NAME: Record<BusFare, string> = { gratis: 'Gratis', normal: 'Normal', caro: 'Caro' };
const FEE_NAME: Record<FeeLevel, string> = { gratis: 'Gratis', reducida: 'Reducida', normal: 'Normal' };

/** Tres botones (radio) a lo ancho; `data-<attr>` lleva el valor para los e2e. */
function seg<T extends string>(label: string, attr: string, values: readonly T[], current: T, text: (v: T) => string, pick: (v: T) => void): HTMLElement {
  const box = h('div', { class: 'seg vida-seg', role: 'radiogroup', 'aria-label': label });
  for (const v of values) {
    const on = v === current;
    const b = h('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(on), [`data-${attr}`]: v }, text(v));
    b.addEventListener('click', () => {
      if (!on) pick(v);
    });
    box.append(b);
  }
  return box;
}

/** Contenido de la ficha (o nada si no es un edificio de la 2.4 o aún está en obra). */
export function vidaBox(state: GameState, b: Building, command: Cmd, list: (cs: Citizen[]) => HTMLElement): HTMLElement | null {
  if (!VIDA_KINDS.includes(b.kind) || !b.built) return null;
  const box = h('section', { class: 'level-box vida-box', 'data-vida': b.kind });
  const off = b.damaged ? h('p', { class: 'pol-tag' }, 'Mientras esté destrozado no funciona.') : '';
  switch (b.kind) {
    case 'busstation': {
      const fare = state.transit.fare;
      const now = riders(state);
      const last = state.transit.riders;
      const monthly = (f: BusFare) => TRANSIT.fare[f] * TRANSIT.workDays;
      box.append(
        h('h3', {}, pixelIcon('bus'), ' Autobús'),
        off,
        h('p', {}, h('strong', {}, `Usuarios del mes: ${last ?? now}`), last !== undefined && last !== now ? ` (ahora, ${now})` : '', '. Llega a todo el pueblo: quien trabaja fuera va en autobús y conserva mejor el trabajo.'),
        h('p', {}, h('strong', {}, 'Billete'), ` · ${FARE_NAME[fare].toLowerCase()}`),
        seg('Billete del autobús', 'fare', ['gratis', 'normal', 'caro'] as const, fare, (f) => (f === 'gratis' ? 'Gratis' : `${FARE_NAME[f]} · ${TRANSIT.fare[f]} €`), (f) => void command({ type: 'SetBusFare', fare: f })),
        h(
          'p',
          { class: 'affects' },
          `A quién afecta: ${plural(now, 'vecino va', 'vecinos van')} en autobús a trabajar fuera. ${monthly(fare) ? `Cada uno paga ${money(monthly(fare))} al mes (${TRANSIT.workDays} días de ida); al ayuntamiento le entran ${money(monthly(fare) * now)}.` : 'Ahora no pagan nada.'}${fare === 'caro' ? ` Con el billete caro están más descontentos (${TRANSIT.dearMood} de felicidad).` : ''} El Consorcio paga la mitad del mantenimiento (${money(Math.round(maintenanceOf(b) * TRANSIT.consortium))} al mes).`,
        ),
      );
      return box;
    }
    case 'nursery': {
      const nm = nurseryUse(state);
      const used = nm.use.get(b.id) ?? 0;
      const free = Math.max(0, CARE.nursery.places - used);
      const small = smallKidsWithout(state, nm.placed);
      const fee = state.care.nurseryFee;
      box.append(
        h('h3', {}, pixelIcon('cradle'), ' Plazas'),
        off,
        h('p', {}, h('strong', {}, `${used} de ${CARE.nursery.places} ocupadas`), ` · ${plural(free, 'libre', 'libres')}. Recoge a los niños de 0 a ${CARE.nursery.maxAgeYears} años que viven a ${CARE.nursery.radius} casillas o menos.`),
        small ? h('p', { class: 'pocket-warn' }, `${plural(small, 'niño pequeño se queda', 'niños pequeños se quedan')} sin plaza: en esas casas, uno de los padres puede dejar el trabajo.`) : '',
        h('p', {}, h('strong', {}, 'Cuota'), ` · ${FEE_NAME[fee].toLowerCase()}`),
        seg('Cuota de la guardería', 'fee', ['gratis', 'reducida', 'normal'] as const, fee, (l) => (l === 'gratis' ? 'Gratis' : `${FEE_NAME[l]} · ${CARE.nursery.fee[l]} €`), (l) => void command({ type: 'SetCareFee', service: 'nursery', level: l })),
        h('p', { class: 'affects' }, `A quién afecta: ${plural(used, 'familia con plaza paga', 'familias con plaza pagan')} ${money(CARE.nursery.fee[fee])} al mes por niño${CARE.nursery.fee[fee] ? ' (si no llegan, queda como deuda)' : ''}. Con plaza nacen más niños (×${String(CARE.birthWithPlace).replace('.', ',')}). Gratis, el ayuntamiento lo paga todo.`),
      );
      return box;
    }
    case 'residence': {
      const inside = state.citizens.filter((c) => c.care === 'residencia');
      const places = residencePlaces(state);
      const fee = state.care.residenceFee;
      const many = places > CARE.residence.places;
      box.append(
        h('h3', {}, pixelIcon('cane'), ' Plazas'),
        off,
        h('p', {}, h('strong', {}, `${inside.length} de ${places} ocupadas`), many ? ' (entre todas las residencias)' : '', ` · ${plural(Math.max(0, places - inside.length), 'libre', 'libres')}. Entran los mayores que viven solos: no se van del pueblo y viven más.`),
        h('p', {}, h('strong', {}, 'Cuota'), ` · ${FEE_NAME[fee].toLowerCase()}`),
        seg('Cuota de la residencia', 'fee', ['gratis', 'reducida', 'normal'] as const, fee, (l) => (l === 'gratis' ? 'Gratis' : `${FEE_NAME[l]} · ${CARE.residence.fee[l]} €`), (l) => void command({ type: 'SetCareFee', service: 'residence', level: l })),
        h('p', { class: 'affects' }, `A quién afecta: ${plural(inside.length, 'mayor paga', 'mayores pagan')} ${money(CARE.residence.fee[fee])} al mes con su pensión (${money(CARE.pension)}); lo que no tengan lo pone un hijo o queda como deuda. Al ayuntamiento le entran ${money(CARE.residence.fee[fee] * inside.length)} al mes.`),
      );
      if (inside.length) box.append(h('h3', {}, 'Viven aquí'), list(inside));
      return box;
    }
    case 'sewage': {
      const load = riverLoad(state);
      const exit = riverExit(state);
      const here = riverNear(state, b.x, b.y, WATERWORKS.reach);
      box.append(
        h('h3', {}, pixelIcon('dirtydrop'), ' Lo que trata'),
        off,
        hasRiver(state)
          ? h('p', {}, h('strong', {}, `Limpia lo que echan ${plural(load.treated, 'edificio', 'edificios')}`), ` de los ${load.dumpers} que vierten al río (cada depuradora, hasta ${WATERWORKS.sewage.buildings}, de aguas arriba). Les quita el ${Math.round(WATERWORKS.sewage.clean * 100)} % de la suciedad.`)
          : h('p', {}, 'No hay río: no tiene nada que limpiar.'),
        h('p', {}, h('strong', {}, `El río a la salida del pueblo: ${riverWord(exit)}`), ` (${exit} de 100). Junto a la depuradora, ${riverWord(here)}.`),
        exit > WATERWORKS.fineAt ? h('p', { class: 'pocket-warn' }, `Sale tan sucio que llega una multa cada trimestre (${money(WATERWORKS.fine)}).`) : '',
        h('p', { class: 'muted small' }, 'Mira la capa «Río» para ver cada tramo.'),
      );
      return box;
    }
    case 'solar':
    case 'wind': {
      const cap = renewableCapacity(b.kind);
      const today = Math.round(cap * renewableFx(state, b.kind));
      const season = seasonOf(tickToDate(state.tick).month);
      const weather = state.weather?.kind;
      const rows: [string, number, boolean][] =
        b.kind === 'solar'
          ? [
              ['Primavera, verano y otoño', cap, season !== 'invierno' && weather !== 'nieve'],
              ['Invierno', Math.round(cap * WATERWORKS.solar.winter), season === 'invierno' && weather !== 'nieve'],
              ['Con nieve', Math.round(cap * WATERWORKS.solar.snow), weather === 'nieve'],
            ]
          : [
              ['Todo el año', cap, weather !== 'tormenta'],
              ['Con tormenta (más viento)', Math.round(cap * WATERWORKS.wind.storm), weather === 'tormenta'],
            ];
      box.append(
        h('h3', {}, pixelIcon(b.kind === 'solar' ? 'sun' : 'windmill'), ' La luz que da'),
        off,
        h('p', {}, h('strong', {}, `Hoy: luz para ${plural(today, 'edificio', 'edificios')}`), ' por la red de calles, sin humo.'),
        h('ul', { class: 'accounts vida-seasons' }, ...rows.map(([name, n, now]) => h('li', { class: now ? 'now' : '' }, h('span', {}, now ? h('strong', {}, `${name} (ahora)`) : name), h('span', {}, plural(n, 'edificio', 'edificios'))))),
        b.kind === 'wind' ? h('p', { class: 'affects' }, `A quién afecta: hace ruido a ${WATERWORKS.wind.noiseRadius} casillas; a los jubilados de cerca les molesta. Los ecologistas lo agradecen.`) : h('p', { class: 'affects' }, 'A quién afecta: a nadie le molesta, y los ecologistas lo agradecen.'),
      );
      return box;
    }
  }
  return null;
}

const YEAR = DAYS_PER_YEAR * TICKS_PER_DAY;
/** Niños pequeños (sin repetir por hogar) que no tienen plaza. */
function smallKidsWithout(state: GameState, placed: Set<string>): number {
  const seen = new Set<string>();
  let n = 0;
  for (const c of state.citizens) {
    if (c.homeId === null) continue;
    for (const t of c.kids ?? []) {
      const key = `${c.homeId}:${t}`;
      if (seen.has(key) || state.tick - t >= CARE.nursery.maxAgeYears * YEAR) continue;
      seen.add(key);
      if (!placed.has(key)) n++;
    }
  }
  return n;
}
