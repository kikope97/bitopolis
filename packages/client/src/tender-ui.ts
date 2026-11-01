/**
 * 2.2: licitaciones de obras. Tras «Construir» en una obra grande, una hoja
 * media con las tres ofertas (precio, plazo, quién trabaja y el riesgo en
 * palabras, nunca en %). En la ficha de la obra, el contrato del primo y
 * «Revisar el contrato» mientras se comenta en el bar.
 */
import type { BuildKind, Command } from '@bitopolis/shared';
import { type Building, BUILD_NAMES, type GameState, type Offer, reviewCost, tenderOffers, worksName } from '@bitopolis/sim';
import { money, plural } from './i18n.ts';
import { closeSheet, h, sheet } from './ui.ts';

const TITLE: Record<Offer, string> = { local: 'Empresa del pueblo', fuera: 'Barata de fuera', primo: 'La del primo del concejal' };

/** Hoja con las tres ofertas. `pick` recibe la elegida (la hoja se cierra antes). */
export function openTender(state: GameState, cmd: { kind: BuildKind; x: number; y: number }, pick: (offer: Offer) => void): void {
  const offers = tenderOffers(state, cmd.kind, cmd.x, cmd.y);
  const cards = offers.map((o) => {
    const card = h(
      'button',
      { class: `tender-card${o.offer === 'local' ? ' recommended' : ''}`, 'data-offer': o.offer, ...(o.available ? {} : { disabled: '' }), 'aria-label': `${TITLE[o.offer]}: ${money(o.price)}, ${plural(o.days, 'día', 'días')}. ${o.who}. ${o.risk}` },
      h('span', { class: 'tc-head' }, h('strong', {}, TITLE[o.offer]), h('span', { class: 'tc-price' }, o.available ? `≈ ${money(o.price)}` : '—')),
      h('span', { class: 'tc-line' }, o.available ? `Plazo: ${plural(o.days, 'día', 'días')}` : ''),
      h('span', { class: 'tc-line' }, o.who),
      h('span', { class: `tc-risk${o.offer === 'local' ? ' ok' : ''}` }, o.risk),
    );
    if (o.available) card.addEventListener('click', () => {
      closeSheet();
      pick(o.offer);
    });
    return card;
  });
  const el = sheet(`Licitación: ${BUILD_NAMES[cmd.kind] ?? cmd.kind}`, h('p', { class: 'muted small' }, 'Elige quién hace la obra. El precio incluye los materiales y los jornales.'), h('div', { class: 'tender-cards' }, ...cards));
  el.classList.add('half');
}

/** En la ficha: el contrato de la obra, si se adjudicó fuera o al primo. */
export function contractBox(state: GameState, b: Building, command: (c: Command) => Promise<boolean>, reopen: () => void): HTMLElement | null {
  const t = state.tenders?.find((x) => x.buildingId === b.id);
  if (!t) return null;
  if (t.offer === 'fuera') {
    const p = state.projects.find((x) => x.buildingId === b.id);
    return p ? h('p', { class: 'muted small', 'data-tender': 'fuera' }, 'La hace una empresa de fuera con su cuadrilla: los parados del pueblo no cobran esta obra.') : null;
  }
  const owner = state.citizens.find((c) => c.id === t.ownerId);
  const who = owner ? `${t.businessName} de ${owner.name}` : 'una empresa amiga';
  if (t.status === 'avisado') {
    const go = h('button', { class: 'btn primary wide', 'data-review': String(b.id) }, `Revisar el contrato (${money(reviewCost(t))})`);
    go.addEventListener('click', async () => {
      if (await command({ type: 'ReviewContract', buildingId: b.id })) reopen();
    });
    return h('div', { class: 'petition warn-box', 'data-tender': 'rumor' }, h('p', {}, h('strong', {}, 'Se comenta en el bar '), `quién se ha quedado la obra de ${worksName(t.kind)}: ${who}. Si no lo arreglas, puede estallar un escándalo. Revisarlo lo apaga, aunque el concejal se sentirá señalado.`), go);
  }
  const text: Record<string, string> = {
    firmado: `La obra la hace ${who}.`,
    cerrado: `La hizo ${who}. Nadie ha dicho nada.`,
    olvidado: `La hizo ${who}. Ya nadie habla de ello.`,
    revisado: 'Revisaste el contrato: el rumor se apagó.',
    estallado: `Estalló el escándalo: la obra fue para ${who}.`,
  };
  return h('p', { class: t.status === 'estallado' ? 'pocket-warn' : 'muted small', 'data-tender': t.status }, text[t.status] ?? '');
}
