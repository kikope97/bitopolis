import { tickToDate } from '@bitopolis/shared';
import { canCampaign, daysToElection, type ElectionResult, FACTION_TEXT, FACTIONS, type GameState, OPPOSITION_POP, politicsActive } from '@bitopolis/sim';
import { formatDate } from './i18n.ts';
import { lowMotion } from './prefs.ts';
import { $, h, sheet } from './ui.ts';
import type { SocialCtx } from './social-ui.ts';
import { openCitizen } from './social-ui.ts';

/**
 * Política (v1.0): intención de voto, facciones con sus exigencias, campaña,
 * partido rival, historial y noche electoral. Todo sale del estado del motor.
 */

const months = (s: GameState) => Math.max(0, Math.round(daysToElection(s) / 30));
/** «faltan 7 meses» o, si queda menos de uno, «faltan 4 días». */
const left = (s: GameState) => {
  const d = daysToElection(s);
  return d < 30 ? `faltan ${d} ${d === 1 ? 'día' : 'días'}` : `faltan ${months(s)} meses`;
};

/** Barra con número y texto (el color nunca es la única señal). */
function bar(label: string, value: number, cls = ''): HTMLElement {
  // El ancho va por CSSOM: la CSP no deja atributos style en línea.
  const fill = h('span', { class: 'pol-fill' });
  fill.style.width = `${Math.max(2, Math.min(100, value))}%`;
  return h(
    'div',
    { class: `pol-bar ${cls}` },
    h('span', { class: 'pol-label' }, label),
    h('span', { class: 'pol-track', role: 'img', 'aria-label': `${label}: ${value} %` }, fill),
    h('span', { class: 'pol-num' }, `${value} %`),
  );
}

/** Indicador del HUD: intención de voto o «oposición». */
export function renderPollChip(state: GameState, onOpen: () => void): void {
  const chip = $('#hud-poll') as HTMLButtonElement;
  const active = politicsActive(state);
  chip.hidden = !active;
  if (!active) return;
  const p = state.politics;
  const opp = p.mayor !== 'player';
  chip.textContent = opp ? `🗳 Oposición · ${p.approval} %` : `🗳 ${p.approval} %`;
  chip.classList.toggle('neg', p.approval < 50);
  chip.setAttribute('aria-label', `${opp ? 'Estás en la oposición. ' : ''}Intención de voto: ${p.approval} %. Elecciones en ${months(state)} meses. Ver política`);
  if (!chip.dataset.bound) {
    chip.dataset.bound = '1';
    chip.addEventListener('click', onOpen);
  }
}

export function openPolitics(ctx: SocialCtx): void {
  const state = ctx.state();
  const p = state.politics;
  const date = formatDate(tickToDate(p.nextElection));
  if (!politicsActive(state)) {
    sheet(
      'Política y elecciones',
      h('p', {}, `Próximas elecciones: ${date} (${left(state)}).`),
      h('p', {}, `Con ${OPPOSITION_POP} vecinos el pueblo empieza a organizarse en facciones y puede nacer una oposición. Hasta entonces, nadie se presenta contra ti.`),
    );
    return;
  }
  const opp = p.mayor !== 'player';
  const items: (Node | string)[] = [];
  if (opp) {
    items.push(
      h(
        'p',
        { class: 'pol-banner' },
        h('strong', {}, 'Estás en la oposición. '),
        `Gobierna ${p.party?.leaderName ?? 'otro alcalde'} («${p.party?.name ?? ''}»). Puedes hablar con los vecinos y hacer campaña; vuelves si ganas las elecciones del ${date}.`,
      ),
    );
  }
  items.push(h('p', {}, `Próximas elecciones: ${date} (${left(state)}).`));
  items.push(h('h3', {}, 'Intención de voto'));
  items.push(bar('Tú', p.approval, 'me'));
  if (p.party) items.push(bar(`«${p.party.name}»`, 100 - p.approval, 'rival'));
  else items.push(h('p', { class: 'muted' }, 'Todavía no hay candidatura rival. Si tu intención de voto baja, algún vecino se animará a fundar un partido.'));

  items.push(h('h3', {}, 'Facciones'));
  const can = canCampaign(state);
  for (const f of FACTIONS) {
    const info = p.factions[f];
    const btn = h('button', { class: 'btn small', ...(can.ok ? {} : { 'aria-disabled': 'true' }) }, 'Hacer campaña');
    btn.addEventListener('click', async () => {
      if (await ctx.command({ type: 'Campaign', faction: f })) openPolitics(ctx);
    });
    items.push(
      h(
        'div',
        { class: 'faction' },
        bar(`${FACTION_TEXT[f]} (${info.members})`, info.satisfaction),
        h('p', { class: 'muted' }, info.demand ? `Piden: ${info.demand}.` : 'Están conformes.', p.campaign[f] ? ` Campaña: ${'●'.repeat(p.campaign[f])}` : ''),
        btn,
      ),
    );
  }
  if (!can.ok) items.push(h('p', { class: 'muted small' }, can.error ?? ''));

  if (p.party) {
    const leader = h('button', { class: 'btn small' }, `Ver la ficha de ${p.party.leaderName}`);
    leader.addEventListener('click', () => openCitizen(ctx, p.party!.leaderId));
    items.push(h('h3', {}, opp ? 'Gobierno' : 'Oposición'), h('p', {}, `«${p.party.name}», de la facción ${FACTION_TEXT[p.party.faction].toLowerCase()}. Lo lidera ${p.party.leaderName}.`), leader);
  }
  if (p.history.length) {
    items.push(h('h3', {}, 'Elecciones anteriores'));
    items.push(h('ul', { class: 'people' }, ...[...p.history].reverse().map((r) => h('li', {}, resultText(r)))));
  }
  sheet('Política y elecciones', ...items);
}

function resultText(r: ElectionResult): string {
  const y = tickToDate(r.tick).year;
  if (r.unopposed) return `Año ${y}: sin rival, alcalde por aclamación.`;
  return `Año ${y}: ${r.winner === 'player' ? 'ganaste' : 'perdiste'} (${r.player} votos frente a ${r.rival} de «${r.rivalName}»; ${r.abstention} se abstuvieron).`;
}

/** Noche electoral: recuento animado (instantáneo con movimiento reducido). */
export function openElectionNight(ctx: SocialCtx): void {
  const state = ctx.state();
  const r = state.politics.history.at(-1);
  if (!r) return;
  const total = Math.max(1, r.player + r.rival + r.abstention);
  const pct = (n: number) => Math.round((n / total) * 100);
  const rows = [bar('Tú', pct(r.player), 'me'), ...(r.unopposed ? [] : [bar(`«${r.rivalName}»`, pct(r.rival), 'rival')]), bar('Abstención', pct(r.abstention), 'abst')];
  if (!lowMotion()) {
    for (const row of rows) {
      const fill = row.querySelector<HTMLElement>('.pol-fill')!;
      const w = fill.style.width;
      fill.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = w)));
    }
  }
  const won = r.winner === 'player';
  sheet(
    'Noche electoral',
    h('p', { class: 'big-number' }, r.unopposed ? 'Sin rival: sigues de alcalde' : won ? '¡Ganas las elecciones!' : 'Pierdes las elecciones'),
    ...rows,
    h('p', {}, resultText(r)),
    !won ? h('p', {}, 'Pasas a la oposición: no puedes gobernar, pero sí hablar con los vecinos y hacer campaña. No hay game over: en cuatro años vuelves a presentarte.') : '',
  );
}
