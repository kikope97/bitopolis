import { tickToDate } from '@bitopolis/shared';
import {
  BUILD_LEVEL,
  BUILD_NAMES,
  canUpgradeTownhall,
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
  focus: (x: number, y: number) => void;
}

const card = (title: string, icon: string, ...body: (Node | string)[]) =>
  h('section', { class: 'mg-card' }, h('h3', {}, pixelIcon(icon), ` ${title}`), ...body);
const row = (label: string, value: string, cls = '') => h('div', { class: `mg-row ${cls}` }, h('span', {}, label), h('strong', {}, value));

export function openManagement(ctx: SocialCtx, links: ManageLinks): void {
  const s = ctx.state();
  const lv = townLevel(s);
  const info = TOWNHALL_LEVELS[lv - 1]!;
  const next = nextLevel(s);
  const reopen = () => openManagement(ctx, links);

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
      if (await ctx.command({ type: 'UpgradeTownhall' })) reopen();
    });
    up.push(
      h('p', {}, `Siguiente: `, h('strong', {}, next.name), ` (nivel ${next.level}). Pide ${next.pop} vecinos y ${money(next.cost)}.`),
      h('p', { class: 'muted small' }, `Desbloquea: ${next.unlocks.join(', ')}.`),
      btn,
    );
    if (!ok.ok) up.push(h('p', { class: 'muted small mg-why' }, ok.error));
  } else up.push(h('p', { class: 'muted small' }, 'Es el nivel más alto: el orgullo del pueblo.'));
  const hall = h(
    'section',
    { class: 'mg-card mg-hero' },
    pic,
    h('div', {}, h('h3', {}, info.name), h('p', { class: 'mg-level' }, `Nivel ${lv} de ${TOWNHALL_LEVELS.length}`), ...up),
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
    const go = h('button', { class: 'btn small danger' }, `${b.name ?? 'Tienda'}: destrozada`);
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
    row('Detenciones', String(j.arrests)),
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

  const el = sheet('Gestión del pueblo', h('div', { class: 'mg' }, hall, how, missing, has, safety, pol));
  el.classList.add('full');
}

const KIND_TEXT: Record<string, string> = { res: 'Pisos', shop: 'Tiendas', factory: 'Fábricas', office: 'Oficinas' };
