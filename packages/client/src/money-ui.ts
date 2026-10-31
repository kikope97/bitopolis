import { tickToDate } from '@bitopolis/shared';
import { type Citizen, canMicrocredit, canSettleDebt, type GameState, MICROCREDIT, type Pocket, pocketOf, totalDebt } from '@bitopolis/sim';
import { formatDate, money } from './i18n.ts';
import type { SocialCtx } from './social-ui.ts';
import { confirmDialog, h, toast } from './ui.ts';

/**
 * v1.9 (petición del creador): el balance de cada vecino. Una línea con lo que
 * le entró y le salió el mes pasado y cómo va (holgado, justo, no llega o
 * endeudado); si debe, a quién y cuánto devuelve, con «Aplazar», «Perdonar» y
 * «Microcrédito».
 */
export const POCKET_TEXT: Record<Pocket, string> = {
  holgado: 'holgado',
  justo: 'va justo',
  no_llega: 'no llega a fin de mes',
  endeudado: 'endeudado',
};

export function pocketBox(ctx: SocialCtx, c: Citizen, reopen: () => void): HTMLElement {
  const state = ctx.state();
  const p = pocketOf(c);
  const box = h('section', { class: `pocket pocket-${p}` });
  const last = c.last;
  if (last) {
    const net = last.in - last.out;
    box.append(
      h(
        'p',
        {},
        'El mes pasado: ',
        h('span', { class: 'pos' }, `+${money(last.in)}`),
        ' / ',
        h('span', { class: 'neg' }, `−${money(last.out)}`),
        ' → ',
        h('strong', {}, net >= 0 ? `le sobraron ${money(net)}` : `le faltaron ${money(-net)}`),
        last.repaid > 0 ? ` (devolvió ${money(last.repaid)} de deudas)` : '',
      ),
    );
  } else box.append(h('p', { class: 'muted small' }, 'Aún no ha cerrado ningún mes en el pueblo.'));
  box.append(h('p', {}, h('span', { class: `pocket-tag ${p}` }, POCKET_TEXT[p]), ` · ahorros: ${money(c.money)}`));
  if (c.jobId === null && c.unemployedSince !== undefined) {
    box.append(h('p', { class: 'neg' }, `En paro desde el ${formatDate(tickToDate(c.unemployedSince))}${(c.benefitLeft ?? 0) > 0 ? ` · cobra la prestación (${c.benefitLeft} meses más)` : ' · sin prestación'}.`));
  }
  if ((c.record ?? 0) > 0) box.append(h('p', { class: 'muted small' }, `Antecedentes: ${c.record} ${c.record === 1 ? 'detención' : 'detenciones'} por robo.`));
  const d = c.debt;
  if (d && totalDebt(c) > 0) {
    const parts = [d.town ? `al ayuntamiento ${money(d.town)}` : '', d.bank ? `al banco o casero ${money(d.bank)}` : ''].filter(Boolean).join(', ');
    box.append(h('p', {}, h('strong', {}, `Debe ${money(totalDebt(c))}`), ` (${parts}), desde el ${formatDate(tickToDate(d.since))}.`));
    // Ronda 15: «le sobraron 0 €» no contaba nada: si la deuda creció, se dice.
    if ((last?.grew ?? 0) > 0) box.append(h('p', { class: 'neg' }, `El mes pasado no le llegó: debe ${money(last!.grew!)} más.`));
    if (d.plan && d.plan.until > state.tick) box.append(h('p', { class: 'muted small' }, `Aplazado: paga ${money(d.plan.perMonth)} al mes hasta el ${formatDate(tickToDate(d.plan.until))}, sin recargo.`));
    else if (d.town > 0) box.append(h('p', { class: 'muted small' }, 'Lo que debe al ayuntamiento lleva un recargo del 10 % si pasa un mes sin pagarlo.'));
  }
  const actions = h('div', { class: 'pocket-actions' });
  const add = (label: string, ok: { ok: boolean; error?: string }, run: () => Promise<void>) => {
    const b = h('button', { class: 'btn small' }, label) as HTMLButtonElement;
    if (!ok.ok) {
      b.setAttribute('aria-disabled', 'true');
      b.title = ok.error ?? '';
    }
    b.addEventListener('click', async () => {
      // Ronda 15: en el móvil no hay tooltip: tocarlo explica por qué no se puede.
      if (!ok.ok) {
        toast(`${label}: ${ok.error ?? 'no se puede ahora'}`, { kind: 'info' });
        return;
      }
      await run();
      reopen();
    });
    actions.append(b);
  };
  if (d && d.town > 0) {
    add('Aplazar (12 meses)', canSettleDebt(state, c, 'aplazar'), async () => {
      await ctx.command({ type: 'SettleDebt', citizenId: c.id, mode: 'aplazar' });
    });
    add(`Perdonar ${money(d.town)}`, canSettleDebt(state, c, 'perdonar'), async () => {
      if (await confirmDialog('Perdonar la deuda', `El ayuntamiento renuncia a cobrar ${money(d.town)} a ${c.name}. Le alegrará, pero es dinero que no entra.`, 'Perdonar')) {
        await ctx.command({ type: 'SettleDebt', citizenId: c.id, mode: 'perdonar' });
      }
    });
  }
  const mc = canMicrocredit(state, c);
  if (totalDebt(c) > 0 || c.unemployedSince !== undefined) {
    add(`Microcrédito ${money(MICROCREDIT.amount)}`, mc, async () => {
      if (await confirmDialog('Microcrédito municipal', `Le prestas ${money(MICROCREDIT.amount)} sin intereses; lo devolverá en ${MICROCREDIT.months} cuotas. Si se va del pueblo sin pagarlo, se pierde.`, 'Prestar')) {
        await ctx.command({ type: 'GrantMicrocredit', citizenId: c.id });
      }
    });
  }
  if (actions.childElementCount) box.append(actions);
  return box;
}

/** Marca corta para listas: «€» si no llega o está endeudado. */
export function pocketMark(c: Citizen): string {
  const p = pocketOf(c);
  return p === 'endeudado' ? '€!' : p === 'no_llega' ? '€' : '';
}

/** Resumen del pueblo (panel de gestión y parte): endeudados, paro, impagos, empresas. */
export function economyLines(state: GameState): { label: string; value: string; bad?: boolean }[] {
  const last = state.stats.at(-1);
  const pop = state.citizens.length || 1;
  const debtors = state.citizens.filter((c) => totalDebt(c) > 0).length;
  const owed = state.citizens.reduce((a, c) => a + (c.debt?.town ?? 0), 0);
  const jobless = state.citizens.filter((c) => c.jobId === null && c.unemployedSince !== undefined).length;
  const out: { label: string; value: string; bad?: boolean }[] = [
    { label: 'Vecinos con deudas', value: `${debtors} (${Math.round((100 * debtors) / pop)} %)`, bad: debtors / pop > 0.12 },
    { label: 'Te deben (al ayuntamiento)', value: money(owed) },
    { label: 'En paro', value: String(jobless), bad: jobless / pop > 0.1 },
  ];
  if (last) {
    out.push({ label: 'Impagos el mes pasado', value: money(last.unpaid ?? 0), bad: (last.unpaid ?? 0) > 0.03 * last.income });
    out.push({ label: 'Sueldo mínimo en las empresas', value: `${money(last.wage ?? 0)}/mes` });
    out.push({ label: 'Margen medio de las empresas', value: money(last.margin ?? 0), bad: (last.margin ?? 0) < 0 });
    out.push({ label: 'Empresas que pierden dinero', value: String(last.losing ?? 0), bad: (last.losing ?? 0) > 0 });
  }
  return out;
}
