/**
 * 2.5 (bloque F): fichas de la vivienda protegida (quién vive, el alquiler y el
 * sorteo) y de los bloques de la zona R con densidad (cuánto pueden crecer y por qué no).
 */
import { type Building, type Citizen, DENSITY, densityAt, type GameState, homesOf, incomeOf, VPO, vpoPool } from '@bitopolis/sim';
import { money, plural } from './i18n.ts';
import { pixelIcon } from './icons.ts';
import { h } from './ui.ts';

const DENSITY_NAME = ['baja', 'media', 'alta'];

/** Contenido de la ficha (o nada si no es VPO ni un bloque de la zona R). */
export function viviendaBox(state: GameState, b: Building, list: (cs: Citizen[]) => HTMLElement): HTMLElement | null {
  if (!b.built) return null;
  if (b.kind === 'vpo') return vpoBox(state, b, list);
  if (b.kind === 'res') return blockBox(state, b);
  return null;
}

function vpoBox(state: GameState, b: Building, list: (cs: Citizen[]) => HTMLElement): HTMLElement {
  const inside = state.citizens.filter((c) => c.homeId === b.id);
  const free = Math.max(0, homesOf(b) - inside.length);
  const owed = inside.reduce((t, c) => t + (c.debt?.town ?? 0), 0);
  const asked = state.citizens.filter((c) => c.vpoAsk !== undefined && c.homeId !== b.id).length;
  const box = h('section', { class: 'level-box vida-box', 'data-vivienda': 'vpo' });
  box.append(
    h('h3', {}, pixelIcon('town'), ' Pisos'),
    b.damaged ? h('p', { class: 'pol-tag' }, 'Mientras esté destrozada no entra nadie nuevo.') : '',
    h('p', { 'data-vpo-used': String(inside.length) }, h('strong', {}, `${inside.length} de ${homesOf(b)} ocupados`), ` · ${plural(free, 'libre', 'libres')}. Alquiler: ${money(VPO.rent)} al mes cada vecino.`),
    h(
      'p',
      { class: 'affects' },
      `A quién afecta: pagan ${plural(inside.length, 'vecino', 'vecinos')} (${money(VPO.rent * inside.length)} al mes para la caja); lo que no puedan pagar queda como deuda con el ayuntamiento${owed ? ` (ahora deben ${money(owed)})` : ''}.`,
    ),
  );
  if (free > 0) {
    const pool = vpoPool(state);
    box.append(
      h(
        'p',
        { class: 'muted small' },
        `Sorteo a principio de mes entre ${plural(pool.length, 'vecino', 'vecinos')}: ${asked ? `${plural(asked, 'lo ha pedido', 'lo han pedido')} y ` : ''}los ${VPO.pool} que menos ganan${pool[0] ? ` (desde ${money(incomeOf(pool[0]))} al mes)` : ''}.`,
      ),
    );
  }
  if (inside.length) {
    box.append(h('h3', {}, 'Viven aquí'), list(inside));
    const debtors = inside.filter((c) => (c.debt?.town ?? 0) > 0);
    if (debtors.length) box.append(h('p', { class: 'pocket-warn' }, `€ Deben el alquiler: ${debtors.map((c) => `${c.name.split(' ')[0]} (${money(c.debt!.town)})`).join(', ')}`));
  }
  return box;
}

function blockBox(state: GameState, b: Building): HTMLElement | null {
  const want = densityAt(state, b.x, b.y);
  const now = b.dense ?? 0;
  if (!want && !now) return null;
  const land = state.fields.land[b.y * state.map.w + b.x] ?? 0;
  const box = h('section', { class: 'level-box vida-box', 'data-vivienda': 'densidad' });
  // Ronda 21: lo que tiene, lo que se pidió y, condición a condición, lo que le falta para crecer.
  box.append(h('h3', {}, pixelIcon('town'), ` Densidad pedida: ${DENSITY_NAME[want]}`), h('p', {}, 'Ahora: ', h('strong', {}, `${homesOf(b)} viviendas`), ` (${DENSITY_NAME[now]})`));
  if (want > now) {
    const okLand = land > DENSITY.minLand;
    const okDem = state.demand.R > DENSITY.minDemandR;
    box.append(
      h('p', { class: 'small' }, `Para crecer a ${DENSITY.homes[now + 1]} viviendas:`),
      h(
        'ul',
        { class: 'reqs' },
        h('li', { class: okLand ? 'ok' : 'no' }, `${okLand ? '✓' : '✗'} Valor del suelo ${land} (necesita más de ${DENSITY.minLand}; sube con servicios y parques)`),
        h('li', { class: okDem ? 'ok' : 'no' }, `${okDem ? '✓' : '✗'} Demanda de vivienda ${state.demand.R} (necesita más de ${DENSITY.minDemandR})`),
      ),
      okLand && okDem ? h('p', { class: 'muted small' }, 'Crecerá en unos días.') : '',
    );
  }
  if (now) box.append(h('p', { class: 'muted small' }, `Más vecinos, más ruido: +${DENSITY.noisePerLevel * now} en su calle.`));
  return box;
}
