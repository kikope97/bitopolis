import { tickToDate } from '@bitopolis/shared';
import { ASSOCIATIONS, BUDGET_TEXT, type BudgetPlan, CAUSE_ASK, canHoldFestival, FESTIVAL, GRANT_NAME, kidsCount } from '@bitopolis/sim';
import { formatDate, money } from './i18n.ts';
import type { SocialCtx } from './social-ui.ts';
import { confirmDialog, h, sheet } from './ui.ts';

/**
 * v1.5: el ayuntamiento por dentro, en una sola hoja: presupuesto del año,
 * fiestas del pueblo y subvenciones de la Diputación.
 */
const STATUS: Record<string, string> = { open: 'por aprobar (enero)', approved: 'aprobado', prorrogado: 'prorrogado' };
const SIZE: Record<string, string> = { none: 'aún no', pequena: 'pequeñas', grande: 'grandes', popular: 'populares (las montaron los vecinos)' };

export function openTownHall(ctx: SocialCtx, focus?: 'budget' | 'festival' | 'grants' | 'associations'): void {
  const s = ctx.state();
  const b = s.budget;
  const d = tickToDate(s.tick);
  const reopen = () => openTownHall(ctx);
  // Lo que cuesta al mes lo que cambia cada plan (con el último parte).
  const last = s.stats.at(-1)?.breakdown ?? {};
  const maint = Math.abs(last['mantenimiento'] ?? 0);
  const wages = Math.abs(last['sueldos'] ?? 0);
  const euros: Record<BudgetPlan, string> = {
    austero: maint + wages ? ` (≈ ahorras ${money(Math.round(maint * 0.15 + wages * 0.1))} al mes)` : '',
    equilibrado: '',
    inversor: maint ? ` (≈ +${money(Math.round(maint * 0.1))} al mes de mantenimiento)` : '',
  };

  /* --- presupuesto --- */
  const budget: (Node | string)[] = [
    h('h3', { id: 'th-budget' }, `Presupuesto del año ${d.year}`),
    h('p', {}, `Plan en vigor: `, h('strong', {}, b.plan), b.year === d.year ? ` · ${STATUS[b.status]}${b.votesFor + b.votesAgainst ? ` (${b.votesFor} a favor, ${b.votesAgainst} en contra)` : ''}.` : ' · el del año que viene se presenta en enero.'),
  ];
  if (b.status === 'open') {
    budget.push(h('p', { class: 'muted small' }, 'Elige el plan del año. El pleno lo vota: cada facción según lo que prefiere y lo contenta que esté. Si no lo presentas en enero, se prorroga el actual.'));
    for (const plan of ['austero', 'equilibrado', 'inversor'] as BudgetPlan[]) {
      const btn = h('button', { class: 'btn choice' }, h('strong', {}, plan[0]!.toUpperCase() + plan.slice(1)), h('span', { class: 'muted small' }, ` ${BUDGET_TEXT[plan].split(': ')[1]}${euros[plan]}`));
      btn.addEventListener('click', async () => {
        if (await ctx.command({ type: 'ProposeBudget', plan })) reopen();
      });
      budget.push(btn);
    }
  } else budget.push(h('p', { class: 'muted small' }, BUDGET_TEXT[b.plan]));

  /* --- fiestas --- */
  const f = s.festival;
  const fest: (Node | string)[] = [
    h('h3', { id: 'th-festival' }, f.name ? `Fiestas de ${f.name}` : 'Fiestas del pueblo'),
    h('p', {}, f.year === d.year ? `Este año: ${SIZE[f.size]}.` : 'Son en julio y agosto. Si no las organizas, en septiembre las montan los vecinos (más pequeñas).'),
  ];
  if (f.until > s.tick) fest.push(h('p', { class: 'muted small' }, `El buen ambiente dura hasta el ${formatDate(tickToDate(f.until))}.`));
  // Un solo motivo para los dos botones (ronda 11: solo lo explicaba uno, y repetido).
  const why = canHoldFestival(s, 'pequena');
  if (!why.ok) fest.push(h('p', { class: 'muted small' }, why.error ?? ''));
  for (const size of ['pequena', 'grande'] as const) {
    const can = canHoldFestival(s, size);
    const label = `${size === 'grande' ? 'Fiestas grandes' : 'Fiestas pequeñas'} · ${money(FESTIVAL[size].cost)} · +${FESTIVAL[size].mood} de felicidad`;
    const btn = h('button', { class: 'btn wide', ...(can.ok ? {} : { 'aria-disabled': 'true' }) }, label);
    btn.addEventListener('click', async () => {
      if (!can.ok) return;
      if (!(await confirmDialog('Organizar las fiestas', `Cuestan ${money(FESTIVAL[size].cost)}.`, 'Organizar'))) return;
      if (await ctx.command({ type: 'HoldFestival', size })) reopen();
    });
    fest.push(btn);
    if (!can.ok && why.ok) fest.push(h('p', { class: 'muted small' }, can.error ?? ''));
  }

  /* --- subvenciones --- */
  const grants: (Node | string)[] = [h('h3', { id: 'th-grants' }, 'Subvenciones de la Diputación')];
  const live = s.grants.filter((g) => g.status === 'offered' || g.status === 'accepted');
  if (!live.length) grants.push(h('p', { class: 'muted' }, 'Ahora mismo no hay ofertas. Llegan de vez en cuando (desde 10 vecinos).'));
  for (const g of live) {
    const what = GRANT_NAME[g.kind] ?? g.kind;
    if (g.status === 'offered') {
      const yes = h('button', { class: 'btn primary' }, 'Aceptar');
      const no = h('button', { class: 'btn' }, 'Rechazar');
      yes.addEventListener('click', async () => {
        if (await ctx.command({ type: 'AnswerGrant', grantId: g.id, accept: true })) reopen();
      });
      no.addEventListener('click', async () => {
        if (await ctx.command({ type: 'AnswerGrant', grantId: g.id, accept: false })) reopen();
      });
      grants.push(
        h('div', { class: 'petition' },
          h('p', {}, `Pagan el ${Math.round(g.share * 100)} % de ${what} si se termina en 6 meses.`),
          h('p', { class: 'muted small' }, 'Al aceptar cobras un anticipo del 30 %. Si no lo terminas a tiempo, lo devuelves con un 10 % de recargo.'),
          h('div', { class: 'row' }, yes, no),
        ),
      );
    } else {
      grants.push(h('p', {}, `Aceptada: ${what}, ${Math.round(g.share * 100)} %. Anticipo cobrado: ${money(g.advance)}. Plazo hasta el ${formatDate(tickToDate(g.deadline))}.`));
    }
  }

  /* --- asociaciones (v1.7) --- */
  const assoc: (Node | string)[] = [h('h3', { id: 'th-associations' }, 'Asociaciones vecinales')];
  if (!s.associations?.length) {
    assoc.push(h('p', { class: 'muted' }, `Ninguna ahora. Nacen cuando ${ASSOCIATIONS.minMembers} o más vecinos con nombre comparten una queja (desde ${ASSOCIATIONS.minPop} vecinos).`));
  }
  for (const a of s.associations ?? []) {
    const leader = s.citizens.find((c) => c.id === a.leaderId);
    const lines: (Node | string)[] = [
      h('p', {}, h('strong', {}, a.name)),
      h('p', { class: 'muted small' }, `${a.members.length} socios con nombre, con ${leader?.name ?? 'su junta'} al frente. Piden ${CAUSE_ASK[a.cause]}.`),
    ];
    if (a.protestDay >= 0) lines.push(h('p', { class: 'pol-tag' }, `Manifestación convocada para el ${formatDate(tickToDate(a.protestDay))}.`));
    if (a.promiseUntil >= 0) lines.push(h('p', { class: 'small' }, `Les prometiste una solución antes del ${formatDate(tickToDate(a.promiseUntil))}. Si no, volverán más enfadados.`));
    const met = a.lastMeeting >= 0 && s.tick - a.lastMeeting < 30 * 24;
    const btn = h('button', { class: 'btn wide', ...(met ? { 'aria-disabled': 'true' } : {}) }, met ? 'Ya os reunisteis este mes' : `Reunirse y prometer una solución en ${ASSOCIATIONS.promiseMonths} meses`);
    btn.addEventListener('click', async () => {
      if (met) return;
      if (await ctx.command({ type: 'MeetAssociation', associationId: a.id })) reopen();
    });
    lines.push(btn);
    assoc.push(h('div', { class: 'petition' }, ...lines));
  }

  /* --- vecinos --- */
  const kids = kidsCount(s);
  const census = h('p', { class: 'muted small' }, `${s.citizens.length} adultos y ${kids} ${kids === 1 ? 'niño' : 'niños'} (los niños van al colegio y a los 18 se independizan).`);

  const el = sheet('Ayuntamiento', ...budget, ...assoc, ...fest, ...grants, h('h3', {}, 'Censo'), census);
  // Desde un aviso, directo a su sección (ronda 11: «Aceptar» quedaba fuera de la pantalla).
  if (focus) el.querySelector(`#th-${focus}`)?.scrollIntoView({ block: 'start' });
}
