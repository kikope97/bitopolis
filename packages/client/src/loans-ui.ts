import type { Command } from '@bitopolis/shared';
import { earlyFee, type GameState, LOANS, type Loan, loadBand, loanCapacity, loanLoad, loanOffer, monthlyQuotas, type Rating, validateCommand } from '@bitopolis/sim';
import { money } from './i18n.ts';
import { confirmDialog, h, sheet } from './ui.ts';

type Cmd = (c: Command) => Promise<boolean>;

/**
 * 2.2: Dinero › «Préstamos». Insignia con la nota (A–D), «Pedir préstamo» con el
 * importe en pasos de 1.000 € (−/+), tres plazos, y la cuota y la TAE antes de
 * confirmar; lista de préstamos con su barra y «Amortizar». A 360 px, todo en una
 * columna y botones de 44 px como mínimo.
 */
const RATING_TEXT: Record<Rating, string> = {
  A: 'Cuentas sanas: los préstamos salen baratos y te prestan mucho.',
  B: 'Cuentas normales.',
  C: 'Cuentas flojas: los préstamos salen caros y te prestan poco.',
  D: 'Sin crédito: nadie presta al ayuntamiento hasta que mejore.',
};

/** Lo elegido en el formulario (se conserva al refrescar la hoja). */
let amount = 5_000;
let months: 12 | 24 | 48 = 24;

export function ratingBadge(rating: Rating): HTMLElement {
  return h('span', { class: `loan-badge r-${rating}`, 'aria-label': `Nota ${rating}` }, rating);
}

/** % de la carga, para enseñarla. */
export function loadPct(state: GameState): number {
  const l = loanLoad(state);
  return Number.isFinite(l) ? Math.round(l * 100) : 100;
}

/** El 💰 de la barra se pone en ámbar con mucha carga. */
export function heavyLoad(state: GameState): boolean {
  return loanLoad(state) > LOANS.warnLoad;
}

export function openLoans(getState: () => GameState, command: Cmd): void {
  const state = getState();
  const reopen = () => openLoans(getState, command);
  const rating = state.rating ?? 'B';
  const loans = state.loans ?? [];
  const q = monthlyQuotas(state);
  const head = h(
    'section',
    { class: 'loan-head' },
    ratingBadge(rating),
    h(
      'div',
      {},
      h('p', {}, h('strong', {}, `Nota ${rating}`), q > 0 ? ` · carga ${loadBand(loanLoad(state))} (${loadPct(state)} % de lo que entra)` : ' · sin préstamos'),
      h('p', { class: 'muted small' }, RATING_TEXT[rating]),
    ),
  );
  const how = h(
    'details',
    { class: 'gloss' },
    h('summary', {}, '¿Cómo se calcula la nota?'),
    h(
      'p',
      {},
      'Cada mes se comparan las cuotas con lo que ingresa el ayuntamiento (media de 12 meses). A: menos del 10 % y seis meses ganando dinero. B: menos del 20 %. C: menos del 35 % o un préstamo de tesorería en el último año. D: más, dos de tesorería o quiebra. ',
      'Si la caja cierra un mes en negativo, el banco cubre el hueco con un préstamo de tesorería a 12 meses, más caro, y la nota baja.',
    ),
  );
  const parts: (Node | string)[] = [head, how];
  if (state.politics.mayor !== 'player') {
    parts.push(h('p', { class: 'pol-banner' }, h('strong', {}, 'Estás en la oposición. '), 'Los préstamos los pide quien gobierna.'));
  } else parts.push(...requestForm(state, command, reopen));
  parts.push(h('h3', {}, 'Préstamos vivos'));
  if (!loans.length) parts.push(h('p', { class: 'muted' }, 'No debes nada al banco.'));
  else {
    parts.push(h('p', {}, `Cuotas: ${money(q)} al mes · debes ${money(loans.reduce((a, l) => a + l.left, 0))}`));
    const list = h('ul', { class: 'loan-list' });
    for (const l of loans) list.append(loanItem(state, l, command, reopen));
    parts.push(list);
  }
  sheet('Préstamos', ...parts);
}

function requestForm(state: GameState, command: Cmd, reopen: () => void): Node[] {
  const cap = loanCapacity(state);
  amount = Math.max(LOANS.min, Math.min(amount, Math.max(LOANS.min, cap), LOANS.max));
  const offer = loanOffer(state, amount, months);
  const cmd: Command = { type: 'RequestLoan', amount, months };
  const v = validateCommand(state, cmd);
  const step = (delta: number, label: string, aria: string) => {
    const next = amount + delta;
    const b = h('button', { class: 'btn loan-step', 'aria-label': aria }, label);
    if (next < LOANS.min || next > Math.max(LOANS.min, cap)) b.setAttribute('disabled', '');
    b.addEventListener('click', () => {
      amount = next;
      reopen();
    });
    return b;
  };
  const chips = h('div', { class: 'loan-chips', role: 'radiogroup', 'aria-label': 'Plazo' });
  for (const m of LOANS.terms) {
    const c = h('button', { class: 'btn loan-chip', role: 'radio', 'aria-checked': String(m === months) }, `${m} meses`);
    c.addEventListener('click', () => {
      months = m as 12 | 24 | 48;
      reopen();
    });
    chips.append(c);
  }
  const ask = h('button', { class: 'btn primary wide', id: 'loan-ask' }, `Pedir ${money(amount)}`);
  if (!v.ok) ask.setAttribute('disabled', '');
  ask.addEventListener('click', async () => {
    const ok = await confirmDialog('Pedir préstamo', `El banco ingresa ${money(amount)} en la caja. Devuelves ${money(offer.quota)} al mes durante ${months} meses (TAE ${offer.tae.toLocaleString('es-ES')} %).`, 'Pedirlo');
    if (!ok) return;
    await command(cmd);
    reopen();
  });
  return [
    h('h3', {}, 'Pedir préstamo'),
    h('p', { class: 'muted small' }, cap > 0 ? `Con nota ${state.rating} te prestan hasta ${money(cap)} (contando lo que ya debes).` : v.ok ? '' : (v as { error: string }).error),
    h('div', { class: 'loan-amount' }, step(-LOANS.step, '−', 'Mil euros menos'), h('output', { class: 'loan-value', 'aria-live': 'polite' }, money(amount)), step(LOANS.step, '+', 'Mil euros más')),
    chips,
    h(
      'p',
      { class: 'loan-offer' },
      'Cuota: ',
      h('strong', {}, `${money(offer.quota)} al mes`),
      ` · TAE ${offer.tae.toLocaleString('es-ES')} % · devuelves ${money(offer.total)} en total`,
    ),
    ...(v.ok || cap <= 0 ? [] : [h('p', { class: 'neg small' }, (v as { error: string }).error)]),
    ask,
  ];
}

function loanItem(state: GameState, l: Loan, command: Cmd, reopen: () => void): HTMLElement {
  const paid = l.principal > 0 ? Math.round(((l.principal - l.left) / l.principal) * 100) : 100;
  // Lo que se puede amortizar ahora: todo, o lo que deje la caja (en cientos).
  const afford = Math.floor(Math.max(0, state.treasury) / (1 + LOANS.earlyFee) / 100) * 100;
  const pay = Math.min(l.left, afford);
  const fee = earlyFee(pay);
  const btn = h('button', { class: 'btn small loan-repay' }, pay >= l.left ? 'Amortizar todo' : 'Amortizar');
  if (pay <= 0 || state.politics.mayor !== 'player') btn.setAttribute('disabled', '');
  btn.addEventListener('click', async () => {
    const all = pay >= l.left;
    const ok = await confirmDialog('Amortizar', `${all ? 'Devuelves todo lo que queda' : 'Devuelves una parte'}: ${money(pay)} más ${money(fee)} de comisión (${Math.round(LOANS.earlyFee * 100)} %).${all ? '' : ' La cuota baja y el plazo sigue igual.'}`, 'Amortizar');
    if (!ok) return;
    await command({ type: 'RepayLoan', loanId: l.id, amount: pay });
    reopen();
  });
  return h(
    'li',
    { class: `loan-item ${l.kind}` },
    h('p', {}, h('strong', {}, l.kind === 'tesoreria' ? 'Tesorería (automático)' : `Banco · ${money(l.principal)}`), ` · ${(l.rate * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} % al mes`),
    h('progress', { max: '100', value: String(paid), 'aria-label': `Devuelto el ${paid} %` }),
    h('p', { class: 'small' }, `Quedan ${money(l.left)} · ${l.monthsLeft} ${l.monthsLeft === 1 ? 'mes' : 'meses'} · cuota ${money(l.quota)}`),
    btn,
  );
}
