/**
 * 2.5 «Comarca» (bloque G): ficha de la cooperativa agraria (socios,
 * presidente, sobreprecio y reparto del año) y de la oficina de correos
 * (plazo de las subvenciones y cartas). Todo sale del motor.
 */
import { type Building, type Citizen, COOP, coopLevelName, coopPriceFx, coopSurplus, farmOf, type GameState, levelOf, POST, postOffice } from '@bitopolis/sim';
import { money, plural } from './i18n.ts';
import { pixelIcon } from './icons.ts';
import { h } from './ui.ts';

/** Contenido de la ficha de la cooperativa o de correos (o null si no es uno de ellos o aún está en obra). */
export function coopPostBox(state: GameState, b: Building, list: (cs: Citizen[]) => HTMLElement, openMail: () => void): HTMLElement | null {
  if (!b.built || (b.kind !== 'coop' && b.kind !== 'post')) return null;
  const off = b.damaged ? h('p', { class: 'pol-tag' }, 'Mientras esté destrozada no funciona.') : '';
  if (b.kind === 'post') {
    const year = state.letters.filter((l) => state.tick - l.tick < 360 * 24).length;
    const btn = h('button', { class: 'btn wide', id: 'post-mailbox' }, `Buzón del pueblo · ${plural(state.letters.length, 'carta', 'cartas')}`);
    btn.addEventListener('click', openMail);
    return h(
      'section',
      { class: 'level-box vida-box', 'data-post': '1' },
      h('h3', {}, pixelIcon('letter'), ' Correos'),
      off,
      h('p', {}, h('strong', {}, postOffice(state) ? `Subvenciones: ${POST.grantDaysWith} días para responder` : 'Cerrada'), postOffice(state) ? ` (sin correos, la postal de la Diputación llega tarde y solo hay ${POST.grantDaysWithout}).` : ''),
      h('p', {}, `Los que se fueron escriben a su familia y a sus amigos: como mucho una carta al mes. Este año, ${plural(year, 'carta', 'cartas')}.`),
      h('p', { class: 'affects' }, `Quien recibe una carta se alegra (+${POST.letterMood}). Si el pueblo está contento (más de ${POST.returnHappiness} de felicidad) y hay casa libre, a veces quien escribe vuelve.`),
      btn,
    );
  }
  const members = state.coop.members.map((id) => state.citizens.find((c) => c.id === id)).filter((c): c is Citizen => !!c);
  const pres = state.citizens.find((c) => c.id === state.coop.presidentId);
  const farmers = state.citizens.filter((c) => farmOf(state, c));
  const pct = Math.round(coopPriceFx(state) * 100);
  const lv = levelOf(b);
  const box = h(
    'section',
    { class: 'level-box vida-box', 'data-coop': '1' },
    h('h3', {}, pixelIcon('sheaf'), lv >= 2 ? ` Cooperativa con ${coopLevelName(state)}` : ' Cooperativa'),
    off,
    h('p', {}, h('strong', {}, `${plural(members.length, 'socio', 'socios')}`), ` de ${plural(farmers.length, 'vecino con finca', 'vecinos con finca')}`, pres ? ` · preside ${pres.name}` : ''),
    h('p', {}, `Vende la cosecha de sus socios un ${pct || Math.round(COOP.priceFx * 100)} % más cara${lv < 2 ? ` (con la ${coopLevelName(state)}, nivel 2, un ${Math.round(COOP.priceFxLevel2 * 100)} %)` : ''}. Cada socio paga ${money(COOP.fee)} al mes.`),
    h('p', {}, h('strong', {}, 'Para el reparto: '), `${money(b.cash)} en caja`, state.coop.yearBonus ? ` (${money(state.coop.yearBonus)} del sobreprecio de este año)` : '', coopSurplus(state) ? ` y ${money(coopSurplus(state))} de excedente sin vender` : '', '.'),
    state.coop.shareYear !== undefined
      ? h('p', { 'data-share': String(state.coop.lastShare ?? 0) }, `Reparto del año ${state.coop.shareYear}: ${money(state.coop.lastShare ?? 0)}${state.coop.perMember ? ` (${money(state.coop.perMember)} por socio)` : ''}.`)
      : h('p', { class: 'muted small' }, 'El reparto se hace al cerrar diciembre, a partes iguales.'),
    h('p', { class: 'affects' }, `A quién afecta: a quien tiene finca (su dueño o quien la trabaja). Deciden ellos si se hacen socios; quien no paga la cuota ${COOP.dropAfter} meses seguidos se queda fuera. El presidente lo eligen los socios cada enero.`),
  );
  if (members.length) box.append(h('h3', {}, 'Socios'), list(members));
  else if (!farmers.length) box.append(h('p', { class: 'muted small' }, 'Aún no hay fincas: pinta zona agraria junto a una carretera.'));
  return box;
}
