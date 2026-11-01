import { tickToDate } from '@bitopolis/shared';
import {
  BUILD_LEVEL,
  BUILD_NAMES,
  budgetFx,
  canUpgradeTownhall,
  type GameState,
  maintenanceOf,
  coverageSummary,
  CRIME,
  daysToElection,
  jailCapacity,
  NEED_LABEL,
  nextLevel,
  politicsActive,
  TOWNHALL_LEVELS,
  townLevel,
} from '@bitopolis/sim';
import { money, MONTHS } from './i18n.ts';
import { economyLines } from './money-ui.ts';
import { pixelIcon } from './icons.ts';
import type { SocialCtx } from './social-ui.ts';
import { townhallSprite } from './sprites.ts';
import { h, sheet } from './ui.ts';

/**
 * v1.8 (petición del creador): al tocar el ayuntamiento, un panel de gestión a
 * pantalla completa: su nivel y la ampliación, cómo va el pueblo, lo que falta,
 * lo que tiene, la seguridad y las elecciones. Todo sale del estado del motor.
 */
export interface ManageLinks {
  townHall: () => void;
  politics: () => void;
  accounts: () => void;
  taxes: () => void;
  focus: (x: number, y: number) => void;
}

const card = (title: string, icon: string, ...body: (Node | string)[]) =>
  h('section', { class: 'mg-card' }, h('h3', {}, pixelIcon(icon), ` ${title}`), ...body);
const row = (label: string, value: string, cls = '') => h('div', { class: `mg-row ${cls}` }, h('span', {}, label), h('strong', {}, value));

/**
 * Lo que se paga a fin de mes, aproximado: los gastos del mes pasado (o el
 * mantenimiento, si aún no hay mes cerrado) más lo que sube el mantenimiento
 * del ayuntamiento con `extraLevels` niveles más (se paga × nivel, tick.ts).
 */
export function monthlyCostEstimate(s: GameState, extraLevels = 0): number {
  const fx = budgetFx(s).maintenance;
  const hall = s.buildings.find((b) => b.kind === 'townhall' && b.built);
  const extra = hall ? maintenanceOf(hall) * extraLevels * fx : 0;
  const last = s.stats.at(-1);
  const base = last ? last.expenses : s.buildings.filter((b) => b.built).reduce((t, b) => t + maintenanceOf(b) * (b.kind === 'townhall' ? townLevel(s) : 1) * fx, 0);
  return Math.round(base + extra);
}

export function openManagement(ctx: SocialCtx, links: ManageLinks, note?: string): void {
  const s = ctx.state();
  const lv = townLevel(s);
  const info = TOWNHALL_LEVELS[lv - 1]!;
  const next = nextLevel(s);
  const reopen = (msg?: string) => openManagement(ctx, links, msg);

  /* --- el ayuntamiento y su ampliación --- */
  // Copia: el sprite está en caché y no puede moverse al DOM.
  const src = townhallSprite(lv);
  const pic = h('canvas', { class: 'mg-hall', width: String(src.width), height: String(src.height), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  pic.getContext('2d')?.drawImage(src, 0, 0);
  const up: (Node | string)[] = [];
  if (next) {
    const ok = canUpgradeTownhall(s);
    const btn = h('button', { class: 'btn primary mg-upgrade' }, pixelIcon('upgrade'), ` Ampliar a nivel ${next.level} · ${money(next.cost)}`) as HTMLButtonElement;
    btn.disabled = !ok.ok;
    btn.addEventListener('click', async () => {
      // El aviso va dentro de la hoja: un aviso normal quedaría tapado por la pantalla completa.
      if (await ctx.command({ type: 'UpgradeTownhall' })) {
        const after = ctx.state();
        reopen(`✓ Ayuntamiento ampliado a nivel ${next.level}. Quedan ${money(after.treasury)} en caja; a fin de mes pagas ≈ ${money(due)}.`);
      }
    });
    // Antes de pagar: cuánto queda y lo que viene a fin de mes (ronda de pruebas: el tutorial dejaba la caja en ~100 €).
    const left = s.treasury - next.cost;
    const due = monthlyCostEstimate(s, 1);
    const tight = ok.ok && left < due;
    up.push(
      h('p', {}, `Siguiente: `, h('strong', {}, next.name), ` (nivel ${next.level}). Pide ${next.pop} vecinos y ${money(next.cost)}.`),
      h('p', { class: 'muted small' }, `Desbloquea: ${next.unlocks.join(', ')}.`),
      ok.ok ? h('p', { class: tight ? 'pocket-warn mg-after' : 'muted small mg-after', 'data-test': 'upgrade-after' }, `${tight ? '⚠ ' : ''}Te quedarán ${money(left)}; a fin de mes pagas ≈ ${money(due)}.${tight ? ' Quizá convenga esperar a cobrar.' : ''}`) : '',
      btn,
    );
    if (!ok.ok) up.push(h('p', { class: 'muted small mg-why' }, ok.error));
  } else up.push(h('p', { class: 'muted small' }, 'Es el nivel más alto: el orgullo del pueblo.'));
  const hall = h(
    'section',
    { class: 'mg-card mg-hero' },
    pic,
    h('div', {}, note ? h('p', { class: 'mg-note', role: 'status', 'data-test': 'upgrade-done' }, note) : '', h('h3', {}, info.name), h('p', { class: 'mg-level' }, `Nivel ${lv} de ${TOWNHALL_LEVELS.length}`), ...up),
  );

  /* --- cómo va --- */
  const pop = s.citizens.length;
  const happy = pop ? Math.round(s.citizens.reduce((a, c) => a + c.happiness, 0) / pop) : 0;
  const last = s.stats.at(-1);
  const net = last ? last.income - last.expenses : 0;
  const how = card(
    'Cómo va el pueblo',
    'people',
    row('Vecinos', String(pop)),
    row('Felicidad media', `${happy} %`, happy < 50 ? 'neg' : ''),
    row('En caja', money(s.treasury), s.treasury < 0 ? 'neg' : ''),
    ...(last ? [row(`Último mes (${MONTHS[(tickToDate(s.tick).month + 10) % 12]})`, `${net >= 0 ? '+' : ''}${money(net)}`, net < 0 ? 'neg' : '')] : []),
  );
  const accounts = h('button', { class: 'btn' }, 'Ver las cuentas');
  accounts.addEventListener('click', links.accounts);
  how.append(accounts);

  /* --- lo que falta --- */
  const gaps = coverageSummary(s);
  const missing = card('Lo que falta', 'layers');
  if (!gaps.length) missing.append(h('p', { class: 'muted small' }, 'Todas las viviendas tienen lo que el pueblo puede ofrecer ahora.'));
  for (const g of gaps) {
    const viv = (n: number) => `${n} ${n === 1 ? 'vivienda' : 'viviendas'}`;
    const parts = [g.falta ? `${viv(g.falta)} sin él` : '', g.lleno ? `${viv(g.lleno)} con él lleno` : ''].filter(Boolean);
    missing.append(row(NEED_LABEL[g.key][0]!.toUpperCase() + NEED_LABEL[g.key].slice(1), parts.join(' · '), 'neg'));
  }
  const locked = Object.entries(BUILD_LEVEL).filter(([, l]) => l > lv);
  if (locked.length) {
    missing.append(h('p', { class: 'muted small' }, `Con más nivel: ${locked.map(([k, l]) => `${(BUILD_NAMES[k] ?? k).toLowerCase()} (${l})`).join(', ')}.`));
  }

  /* --- lo que tiene --- */
  const counts = new Map<string, number>();
  for (const b of s.buildings) if (b.built && b.kind !== 'townhall') counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
  const has = card('Lo que tiene', 'townhall');
  if (!counts.size) has.append(h('p', { class: 'muted small' }, 'Aún nada más que el ayuntamiento.'));
  const grid = h('div', { class: 'mg-grid' });
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) grid.append(h('span', { class: 'mg-chip' }, `${BUILD_NAMES[k] ?? KIND_TEXT[k] ?? k} `, h('strong', {}, String(n))));
  has.append(grid);
  const broken = s.buildings.filter((b) => b.damaged);
  for (const b of broken) {
    const go = h('button', { class: 'btn small danger' }, `${b.name ?? BUILD_NAMES[b.kind] ?? 'Tienda'}: ${b.damaged?.cause === 'fuego' ? 'quemado' : 'destrozada'}`);
    go.addEventListener('click', () => links.focus(b.x, b.y));
    has.append(go);
  }

  /* --- seguridad --- */
  const j = s.justice;
  const stations = s.buildings.filter((b) => b.kind === 'police' && b.built).length;
  const cap = stations * CRIME.cellsPerStation;
  const jail = jailCapacity(s);
  const safety = card(
    'Seguridad',
    'handcuffs',
    row('Robos', String(j.robberies)),
    row('Robos en casas', String(j.homeRobberies ?? 0)),
    row('Robos de vecinos del pueblo', String(j.localThefts ?? 0)),
    row('Detenciones', String(j.arrests)),
    row(`Multas cobradas (${CRIME.finePerDay} €/día por detenido)`, money(j.fines ?? 0)),
    row('Calabozos', stations ? `${j.cells.length} de ${cap}` : 'sin comisaría', stations && j.cells.length >= cap ? 'neg' : ''),
    row('Cárcel', jail ? `${j.jail.length} de ${jail} presos` : lv >= 4 ? 'sin cárcel' : 'llega con el nivel 4', jail && j.jail.length >= jail ? 'neg' : ''),
  );

  /* --- política y vecinos --- */
  const pol = card('Elecciones y vecinos', 'megaphone');
  if (politicsActive(s)) {
    const p = s.politics;
    pol.append(
      row(p.mayor === 'player' ? 'Intención de voto' : 'Estás en la oposición', `${p.approval} %`, p.approval < 50 ? 'neg' : ''),
      row('Elecciones', `en ${daysToElection(s)} días`),
      ...(p.party ? [row('Partido rival', `«${p.party.name}»`)] : []),
    );
  } else pol.append(h('p', { class: 'muted small' }, 'Las elecciones empiezan a contar con 50 vecinos.'));
  const assoc = s.associations ?? [];
  if (assoc.length) pol.append(row('Asociaciones vecinales', String(assoc.length), assoc.some((a) => (a.protests ?? 0) > 0) ? 'neg' : ''));
  const polBtn = h('button', { class: 'btn' }, 'Política');
  polBtn.addEventListener('click', links.politics);
  const thBtn = h('button', { class: 'btn' }, 'Presupuesto, fiestas y asociaciones');
  thBtn.addEventListener('click', links.townHall);
  pol.append(h('div', { class: 'mg-actions' }, polBtn, thBtn));

  /* --- v1.9: el bolsillo de los vecinos y la salud de las empresas --- */
  const pockets = card('Vecinos y empresas', 'coin', ...economyLines(s).map((l) => row(l.label, l.bad ? `⚠ ${l.value}` : l.value, l.bad ? 'neg' : '')));
  const taxesBtn = h('button', { class: 'btn' }, 'Impuestos y sueldo mínimo');
  taxesBtn.addEventListener('click', links.taxes);
  pockets.append(h('div', { class: 'mg-actions' }, taxesBtn));

  const el = sheet('Gestión del pueblo', h('div', { class: 'mg' }, hall, how, pockets, missing, has, safety, pol));
  el.classList.add('full');
  // Tapa toda la pantalla: modal también en tableta y horizontal (ronda 14).
  el.setAttribute('aria-modal', 'true');
}

const KIND_TEXT: Record<string, string> = { res: 'Pisos', shop: 'Tiendas', factory: 'Fábricas', office: 'Oficinas' };
