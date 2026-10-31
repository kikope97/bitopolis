import { tickToDate } from '@bitopolis/shared';
import { CAMPAIGN_COST, canCampaign, canMotion, daysToElection, type ElectionResult, FACTION_TEXT, FACTIONS, type GameState, OPPOSITION_POP, politicsActive } from '@bitopolis/sim';
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
  // Cuenta atrás en los últimos 3 meses (v1.3).
  const d = daysToElection(state);
  const countdown = d <= 90 ? ` · ${d} d` : '';
  chip.textContent = (opp ? `🗳 Oposición · ${p.approval} %` : `🗳 ${p.approval} %`) + countdown;
  chip.classList.toggle('soon', d <= 90);
  chip.classList.toggle('neg', p.approval < 50);
  chip.setAttribute('aria-label', `${opp ? 'Estás en la oposición. ' : ''}Intención de voto: ${p.approval} %. Elecciones: ${left(state)}. Ver política`);
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
  items.push(h('h3', {}, 'Intención de voto'), h('p', { class: 'muted small' }, 'Entre quienes piensan votar (sin contar la abstención).'));
  items.push(bar('Tú', p.approval, 'me'));
  if (p.party) items.push(bar(`«${p.party.name}»`, 100 - p.approval, 'rival'));
  else items.push(h('p', { class: 'muted' }, 'Todavía no hay candidatura rival. Si tu intención de voto baja, algún vecino se animará a fundar un partido.'));

  items.push(
    h('h3', {}, 'Facciones'),
    h('p', { class: 'muted small' }, `Cumplir lo que pide cada facción es lo que más votos da. Cada campaña acerca un poco a una facción (una al mes${opp ? '' : `, el último año, ${CAMPAIGN_COST} € por acto`}).`),
  );
  const can = canCampaign(state);
  const why = h('p', { id: 'campaign-why', class: 'muted small' }, can.ok ? '' : (can.error ?? ''));
  for (const f of FACTIONS) {
    const info = p.factions[f];
    const btn = h('button', { class: 'btn small', ...(can.ok ? {} : { 'aria-disabled': 'true', 'aria-describedby': 'campaign-why' }) }, `Hacer campaña con ${FACTION_TEXT[f].toLowerCase()}`);
    btn.addEventListener('click', async () => {
      if (!can.ok) return;
      if (await ctx.command({ type: 'Campaign', faction: f })) openPolitics(ctx);
    });
    items.push(
      h(
        'div',
        { class: 'faction' },
        bar(`${FACTION_TEXT[f]} (${info.members})`, info.satisfaction),
        h('p', { class: 'muted' }, info.demands.length ? `Piden: ${info.demands.join(' y ')}.` : 'Están conformes.', p.campaign[f] ? ` Campaña: ${'●'.repeat(p.campaign[f])}` : ''),
        btn,
        opp ? motionButton(ctx, f) : '',
      ),
    );
  }
  items.splice(items.length - FACTIONS.length, 0, why);
  if (opp && p.party) items.splice(items.length - FACTIONS.length, 0, motionIntro(state));

  // Registro del gobierno rival (v1.3): qué ha hecho, de lo último a lo primero.
  if (p.log.length) {
    items.push(
      h('h3', {}, opp ? 'Lo que ha hecho el gobierno' : 'Lo que hizo el último gobierno rival'),
      h('ul', { class: 'pol-log' }, ...[...p.log].reverse().slice(0, 8).map((e) => h('li', {}, h('span', { class: 'muted small' }, formatDate(tickToDate(e.tick))), ' ', e.text))),
    );
  }

  if (p.party) {
    const leader = h('button', { class: 'btn small' }, `Ver la ficha de ${p.party.leaderName}`);
    leader.addEventListener('click', () => openCitizen(ctx, p.party!.leaderId));
    items.push(h('h3', {}, opp ? 'Gobierno' : 'Oposición'), h('p', {}, `«${p.party.name}», de la facción ${FACTION_TEXT[p.party.faction].toLowerCase()}. Lo lidera ${p.party.leaderName}.`), leader);
    // Lo que ha prometido el rival (y si lo cumple): munición para la oposición.
    if (p.party.promises.length) {
      const status = { pending: 'pendiente', kept: '✓ cumplida', broken: '✗ incumplida' } as const;
      items.push(
        h('h3', {}, `Promesas de «${p.party.name}»`),
        h(
          'ul',
          { class: 'accounts' },
          ...p.party.promises.map((pr) =>
            h(
              'li',
              { class: pr.status === 'broken' ? 'neg' : pr.status === 'kept' ? 'pos' : '' },
              h('span', {}, `${pr.need} (${FACTION_TEXT[pr.faction].toLowerCase()})${pr.fromMotion ? ' · tu moción' : ''}`),
              h('span', {}, pr.status === 'pending' && p.mayor === p.party!.leaderId ? `pendiente hasta el ${formatDate(tickToDate(pr.deadline))}` : status[pr.status]),
            ),
          ),
        ),
      );
    }
  }
  if (p.history.length) {
    items.push(h('h3', {}, 'Elecciones anteriores'));
    items.push(h('ul', { class: 'people' }, ...[...p.history].reverse().map((r) => h('li', {}, resultText(r)))));
  }
  sheet('Política y elecciones', ...items);
}

/** Moción desde la oposición: llevar al pleno lo que pide la facción. */
function motionButton(ctx: SocialCtx, f: (typeof FACTIONS)[number]): HTMLElement {
  const state = ctx.state();
  const can = canMotion(state, f);
  const id = `motion-why-${f}`;
  const describedBy = !can.ok && can.error?.startsWith('Solo una moción') ? 'motion-next' : id;
  const btn = h('button', { class: 'btn small', ...(can.ok ? {} : { 'aria-disabled': 'true', 'aria-describedby': describedBy }) }, `Presentar moción: ${state.politics.factions[f].demand ?? '—'}`);
  btn.addEventListener('click', async () => {
    if (!can.ok) return;
    if (await ctx.command({ type: 'Motion', faction: f })) openPolitics(ctx);
  });
  // El motivo general («una al mes») ya se dice arriba; aquí solo el particular de esta facción.
  const own = !can.ok && can.error && !can.error.startsWith('Solo una moción');
  return h('div', {}, btn, own ? h('p', { id, class: 'muted small' }, can.error ?? '') : '');
}

/** Cabecera de las mociones: qué hacen, cuándo toca la próxima y cómo acabó la última. */
function motionIntro(state: GameState): HTMLElement {
  const p = state.politics;
  const next = p.lastMotion >= 0 ? p.lastMotion + 30 * 24 : -1;
  const last = p.motions.at(-1);
  return h(
    'div',
    { class: 'motion-intro' },
    h('p', {}, 'Mociones: llevas al pleno lo que pide una facción. Si el gobierno la rechaza, esa facción te apoyará más; si la aprueba, tiene 6 meses para cumplirla, y si no cumple, también te apoyarán a ti.'),
    next > state.tick ? h('p', { id: 'motion-next', class: 'muted small' }, `Una moción al mes: la próxima, el ${formatDate(tickToDate(next))}.`) : '',
    last ? h('p', { class: last.approved ? 'pos' : 'neg' }, `Tu última moción (${last.need}): ${last.approved ? 'aprobada' : 'rechazada'}.`) : '',
  );
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
  // Porcentajes que suman 100 (mayor resto) y, al lado, los votos.
  const parts = r.unopposed ? [r.player, r.abstention] : [r.player, r.rival, r.abstention];
  const total = Math.max(1, parts.reduce((a, b) => a + b, 0));
  const raw = parts.map((n) => (n / total) * 100);
  const pcts = raw.map(Math.floor);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < 100 - pcts.reduce((a, b) => a + b, 0); k++) pcts[order[k % order.length]![1]]!++;
  const labels = r.unopposed ? [`Tú (${r.player} votos)`, `Abstención (${r.abstention})`] : [`Tú (${r.player} votos)`, `«${r.rivalName}» (${r.rival})`, `Abstención (${r.abstention})`];
  const classes = r.unopposed ? ['me', 'abst'] : ['me', 'rival', 'abst'];
  const rows = labels.map((l, i) => bar(l, pcts[i]!, classes[i]));
  if (!lowMotion()) {
    for (const row of rows) {
      const fill = row.querySelector<HTMLElement>('.pol-fill')!;
      const w = fill.style.width;
      fill.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = w)));
    }
  }
  const won = r.winner === 'player';
  // El resultado se anuncia también al lector de pantalla.
  $('#sr-live').textContent = `Noche electoral. ${r.unopposed ? 'Sin rival: sigues de alcalde' : won ? 'Ganas las elecciones' : 'Pierdes las elecciones'}. ${resultText(r)}`;
  document.body.classList.add('election-night');
  sheet(
    'Noche electoral',
    h('p', { class: 'big-number' }, r.unopposed ? 'Sin rival: sigues de alcalde' : won ? '¡Ganas las elecciones!' : 'Pierdes las elecciones'),
    ...rows,
    h('p', {}, resultText(r)),
    !won ? h('p', {}, 'Pasas a la oposición: no puedes gobernar, pero sí hablar con los vecinos y hacer campaña. No hay game over: en cuatro años vuelves a presentarte.') : '',
  );
}
