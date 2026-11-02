/**
 * 2.6 «Lo básico» (bloque B): lo que explica el núcleo del juego en la
 * interfaz. Por qué no crece un solar (ficha del solar y hoja de demanda), de
 * qué sale la demanda, la carga de las bombas y centrales (ficha y avisos) y lo
 * que cuesta al mes una obra. Todo sale del motor (nucleo.ts).
 */
import type { BuildKind } from '@bitopolis/shared';
import {
  BUILD_NAMES,
  type Building,
  demandFactors,
  type GameState,
  isRenewable,
  lotStatus,
  lotsLine,
  lotSummary,
  maintenanceByKind,
  monthlyCostOf,
  monthlyCostText,
  type NetKind,
  networkLoad,
  type NetworkLoad,
  netOfBuilding,
  ZONE_GROWTH,
} from '@bitopolis/sim';
import { money, plural } from './i18n.ts';
import { h } from './ui.ts';

/** El reparto de agua y luz del estado que se ve (uno por estado: el worker manda uno nuevo cada vez). */
const loads = new WeakMap<GameState, NetworkLoad>();
export function loadOf(state: GameState): NetworkLoad {
  let l = loads.get(state);
  if (!l) {
    l = networkLoad(state);
    loads.set(state, l);
  }
  return l;
}
const summaries = new WeakMap<GameState, ReturnType<typeof lotSummary>>();
export function lotsOf(state: GameState): ReturnType<typeof lotSummary> {
  let s = summaries.get(state);
  if (!s) {
    s = lotSummary(state, loadOf(state));
    summaries.set(state, s);
  }
  return s;
}

/** Ficha del solar: por qué crece o no y qué hacer (o nada si no es un solar de R, C o I). */
export function lotBox(state: GameState, x: number, y: number): HTMLElement | '' {
  const s = lotStatus(state, x, y, loadOf(state));
  if (!s) return '';
  const box = h('div', { class: `lot-box ${s.grows ? 'ok' : 'no'}`, 'data-test': 'lot-status', 'data-reason': s.reason });
  box.append(
    h('p', {}, h('strong', {}, s.grows ? '✓ ' : '⚠ '), h('strong', {}, s.grows ? 'Puede crecer. ' : `No crece: ${s.text.charAt(0).toLowerCase()}${s.text.slice(1)}. `), s.action),
  );
  // Si hay más de un motivo, los demás (lo de la zona entera) en una línea.
  const more = s.reasons.slice(1);
  if (more.length) {
    const other = more.map((r) => (r === 'demanda' ? `la demanda ${s.zone} es baja (${state.demand[s.zone]}; hace falta más de ${ZONE_GROWTH.minDemand})` : r === 'casas_libres' ? 'sobran casas libres' : r)).join('; ');
    box.append(h('p', { class: 'muted small' }, `Además, ${other}.`));
  }
  if (s.note) box.append(h('p', { class: 'muted small' }, s.note));
  return box;
}

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

/** Hoja de demanda: «4 solares no pueden crecer: sin luz» y, plegado, de qué sale el número. */
export function demandExtra(state: GameState, zone: 'R' | 'C' | 'I'): HTMLElement[] {
  const out: HTMLElement[] = [];
  const line = lotsLine(lotsOf(state)[zone]);
  if (line) out.push(h('p', { class: 'pocket-warn small', 'data-test': `lots-${zone}` }, `${zone} ${signed(state.demand[zone])}, pero ${line}. Toca un solar para ver qué le falta.`));
  const f = demandFactors(state)[zone];
  if (f.length) {
    const total = Math.round(f.reduce((a, x) => a + x.value, 0));
    const clamped = Math.max(-100, Math.min(100, total));
    out.push(
      h(
        'details',
        { class: 'demand-factors', 'data-test': `factors-${zone}` },
        h('summary', {}, `De qué sale ${zone} ${signed(state.demand[zone])}`),
        h(
          'ul',
          { class: 'accounts' },
          ...f.map((x) => h('li', { class: Math.round(x.value) < 0 ? 'neg' : 'pos' }, h('span', {}, x.label), h('span', { class: 'num' }, signed(Math.round(x.value))))),
          clamped !== total ? h('li', { class: 'muted' }, h('span', {}, 'Tope (de −100 a +100)'), h('span', {}, signed(clamped))) : '',
          // Una obra o un cambio de hoy: el número de la franja se pone al día al cerrar el día.
          clamped !== state.demand[zone] ? h('li', { class: 'muted' }, h('span', {}, 'Al cerrar el día quedará en'), h('span', {}, signed(clamped))) : '',
        ),
        h('p', { class: 'muted small' }, `Con más de ${ZONE_GROWTH.minDemand} se construye en la zona ${zone}${zone === 'R' ? ` (si quedan menos de ${ZONE_GROWTH.maxFreeHomes} casas libres)` : ''}.`),
      ),
    );
  }
  return out;
}

const NET_WORD: Record<NetKind, { what: string; plant: string }> = {
  water: { what: 'agua', plant: 'La bomba' },
  power: { what: 'luz', plant: 'La central' },
};

/** Ficha de la bomba o la central: cuánto da y a cuántos, con su red. */
export function plantLoadBox(state: GameState, b: Building): HTMLElement | null {
  const kind: NetKind | null = b.kind === 'water' ? 'water' : b.kind === 'power' || isRenewable(b.kind) ? 'power' : null;
  if (!kind || !b.built) return null;
  const load = loadOf(state);
  const p = load.plants.get(b.id);
  if (!p) return null;
  const net = netOfBuilding(state, load, b, kind);
  const w = NET_WORD[kind];
  const box = h('section', { class: 'level-box', 'data-test': 'plant-load', 'data-used': String(p.served), 'data-capacity': String(p.capacity) });
  if (!net) {
    box.append(h('p', { class: 'pocket-warn' }, `⚠ No toca ninguna carretera: no da ${w.what} a nadie. Ponle una carretera al lado.`));
    return box;
  }
  const want = net.served + net.left.length;
  const several = net.plants.length > 1;
  const today = p.capacity !== p.nominal ? ` (hoy ${p.capacity} de ${p.nominal} por el tiempo)` : '';
  box.append(
    h('p', {}, h('strong', {}, several ? `Su red: da ${w.what} a ${net.served} de ${want}` : `Da ${w.what} a ${p.served} de ${p.capacity} edificios${today}`)),
  );
  const bar = h('span', { class: 'bar-fill' });
  bar.style.width = `${Math.min(100, Math.round((100 * want) / Math.max(1, net.capacity)))}%`;
  box.append(h('span', { class: `bar load-bar${want > net.capacity ? ' over' : ''}`, 'aria-hidden': 'true' }, bar));
  if (several) box.append(h('p', { class: 'muted small' }, `Esta da a ${p.served} de ${p.capacity}${today}; en su red hay ${plural(net.plants.length, 'planta', 'plantas')} que dan para ${net.capacity}.`));
  if (net.left.length) {
    box.append(h('p', { class: 'pocket-warn' }, `⚠ Piden ${w.what} ${want} de ${net.capacity}: ${plural(net.left.length, 'edificio se queda', 'edificios se quedan')} sin ${w.what}. Los más lejanos por carretera son los primeros en quedarse sin. Construye otra ${kind === 'water' ? 'bomba' : 'central'} o mejórala.`));
  } else {
    const room = net.capacity - net.served;
    box.append(h('p', { class: 'muted small' }, `Margen: ${plural(room, 'edificio más', 'edificios más')}.${kind === 'water' ? ' Con calor, la bomba da un 10 % menos.' : ' Con nieve, la central da un 15 % menos.'}`));
  }
  return box;
}

/** «te quedan 3»: el margen de las redes de agua y luz para la ayuda de las herramientas Agua y Luz. */
export function networkRoom(state: GameState, kind: NetKind): string {
  const load = loadOf(state);
  const nets = [...load.nets.values()].filter((n) => n.kind === kind);
  const w = NET_WORD[kind];
  if (!nets.length) return `Aún no hay ${w.what} en el pueblo.`;
  const capacity = nets.reduce((a, n) => a + n.capacity, 0);
  const served = nets.reduce((a, n) => a + n.served, 0);
  const left = nets.reduce((a, n) => a + n.left.length, 0);
  if (left) return `Ahora: ${served + left} edificios piden ${w.what} y hay para ${capacity}: ${left} sin ${w.what}.`;
  return `Ahora: ${served} de ${capacity}, te ${capacity - served === 1 ? 'queda 1' : `quedan ${capacity - served}`}.`;
}

/** Avisos de las redes (una vez por planta): al 90 % y cuando alguien se queda sin servicio. */
const warned = new Map<string, number>();
export function networkWarnings(state: GameState, say: (text: string, kind: 'warn' | 'info', ref: Building) => void): void {
  const load = loadOf(state);
  for (const [, net] of load.nets) {
    const first = state.buildings.find((b) => b.id === net.plants[0]);
    if (!first || net.capacity <= 0) continue;
    const key = `${net.kind}:${net.plants.join(',')}`;
    const w = NET_WORD[net.kind];
    const want = net.served + net.left.length;
    const level = net.left.length ? 2 : want >= ZONE_GROWTH.plantWarnAt * net.capacity ? 1 : 0;
    const before = warned.get(key) ?? 0;
    // Al bajar del 80 % se olvida el aviso (si vuelve a llenarse, se avisa otra vez).
    if (level === 0 && want < 0.8 * net.capacity) warned.delete(key);
    if (level <= before) continue;
    warned.set(key, level);
    if (level === 2) say(`${w.plant} no da para todos: ${plural(net.left.length, 'edificio se queda', 'edificios se quedan')} sin ${w.what} (${want} de ${net.capacity}). Toca para verla.`, 'warn', first);
    else say(`${w.plant} va al ${Math.round((100 * want) / net.capacity)} %: ${want} de ${net.capacity}. Pronto hará falta otra.`, 'info', first);
  }
}

/** «+430 €/mes» para la bandeja; con `long`, «(mantenimiento y 3 sueldos)». */
export function monthlyText(kind: BuildKind | undefined, state: GameState, long = false): string {
  if (!kind || kind === 'road') return '';
  return monthlyCostText(kind, money, state, long);
}

/** Lo que cuesta al mes, explicado (para el lector de pantalla y la ayuda). */
export function monthlyHelp(kind: BuildKind, state: GameState): string {
  const c = monthlyCostOf(kind, state);
  if (!c.total) return 'No cuesta nada al mes.';
  return `Al mes: ${money(c.maintenance)} de mantenimiento${c.jobs ? ` y ${plural(c.jobs, 'sueldo', 'sueldos')} (${money(c.wages)}, si hay quien trabaje)` : ''}.`;
}

/** Parte mensual: el mantenimiento de ahora por tipo de edificio. */
export function maintenanceSection(state: GameState): HTMLElement | '' {
  const list = maintenanceByKind(state);
  if (!list.length) return '';
  const total = list.reduce((a, x) => a + x.amount, 0);
  return h(
    'details',
    { class: 'advanced', 'data-test': 'maintenance-by-kind' },
    h('summary', {}, `Mantenimiento por edificio: ${money(total)} al mes`),
    h('ul', { class: 'accounts' }, ...list.map((x) => h('li', { class: 'neg' }, h('span', {}, `${BUILD_NAMES[x.kind] ?? x.kind}${x.count > 1 ? ` × ${x.count}` : ''}`), h('span', {}, `−${money(x.amount)}`)))),
    h('p', { class: 'muted small' }, 'Lo que costará este mes con lo que hay construido (el ayuntamiento, según su nivel; los servicios mejorados, más).'),
  );
}
