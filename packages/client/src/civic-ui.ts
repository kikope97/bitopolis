import { tickToDate } from '@bitopolis/shared';
import { BUDGET_TEXT, type BudgetPlan, canHoldFestival, FESTIVAL, GRANT_NAME, kidsCount } from '@bitopolis/sim';
import { formatDate, money } from './i18n.ts';
import type { SocialCtx } from './social-ui.ts';
import { confirmDialog, h, sheet } from './ui.ts';

/**
 * v1.5: el ayuntamiento por dentro, en una sola hoja: presupuesto del año,
 * fiestas del pueblo y subvenciones de la Diputación.
 */
const STATUS: Record<string, string> = { open: 'por aprobar (enero)', approved: 'aprobado', prorrogado: 'prorrogado' };
const SIZE: Record<string, string> = { none: 'aún no', pequena: 'pequeñas', grande: 'grandes', popular: 'populares (las montaron los vecinos)' };

export function openTownHall(ctx: SocialCtx): void {
  const s = ctx.state();
  const b = s.budget;
  const d = tickToDate(s.tick);
  const reopen = () => openTownHall(ctx);

  /* --- presupuesto --- */
  const budget: (Node | string)[] = [
    h('h3', {}, `Presupuesto del año ${b.year}`),
    h('p', {}, `Plan en vigor: `, h('strong', {}, b.plan), ` · ${STATUS[b.status]}${b.votesFor + b.votesAgainst ? ` (${b.votesFor} a favor, ${b.votesAgainst} en contra)` : ''}.`),
  ];
  if (b.status === 'open') {
    budget.push(h('p', { class: 'muted small' }, 'Elige el plan del año. El pleno lo vota: cada facción según lo que prefiere y lo contenta que esté. Si no lo presentas en enero, se prorroga el actual.'));
    for (const plan of ['austero', 'equilibrado', 'inversor'] as BudgetPlan[]) {
      const btn = h('button', { class: 'btn choice' }, h('strong', {}, plan[0]!.toUpperCase() + plan.slice(1)), h('span', { class: 'muted small' }, ` ${BUDGET_TEXT[plan].split(': ')[1]}`));
      btn.addEventListener('click', async () => {
        if (await ctx.command({ type: 'ProposeBudget', plan })) reopen();
      });
      budget.push(btn);
    }
  } else budget.push(h('p', { class: 'muted small' }, BUDGET_TEXT[b.plan]));

  /* --- fiestas --- */
  const f = s.festival;
  const fest: (Node | string)[] = [
    h('h3', {}, f.name ? `Fiestas de ${f.name}` : 'Fiestas del pueblo'),
    h('p', {}, f.year === d.year ? `Este año: ${SIZE[f.size]}.` : 'Son en julio y agosto. Si no las organizas, en septiembre las montan los vecinos (más pequeñas).'),
  ];
  if (f.until > s.tick) fest.push(h('p', { class: 'muted small' }, `El buen ambiente dura hasta el ${formatDate(tickToDate(f.until))}.`));
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
    if (!can.ok && size === 'grande') fest.push(h('p', { class: 'muted small' }, can.error ?? ''));
  }

  /* --- subvenciones --- */
  const grants: (Node | string)[] = [h('h3', {}, 'Subvenciones de la Diputación')];
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

  /* --- vecinos --- */
  const kids = kidsCount(s);
  const census = h('p', { class: 'muted small' }, `Censo: ${s.citizens.length} adultos y ${kids} ${kids === 1 ? 'niño' : 'niños'} (los niños van al colegio y a los 18 se independizan).`);

  sheet('Ayuntamiento', ...budget, ...fest, ...grants, h('h3', {}, 'Censo'), census);
}
