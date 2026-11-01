import { type Command, type LandmarkKind, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import {
  bigCompanyIbi,
  bigCompanyJobs,
  bigFactory,
  type Building,
  canFundLandmarkPhase,
  type GameState,
  grantFor,
  grantTerms,
  LANDMARK_EFFECT,
  LANDMARK_NAMES,
  LANDMARKS,
  landmarkByBuilding,
  landmarkReqs,
  landmarksInProgress,
  phaseCost,
  REGION,
} from '@bitopolis/sim';
import { formatDate, money, plural } from './i18n.ts';
import { pixelIcon } from './icons.ts';
import { h, sheet } from './ui.ts';

/**
 * 2.3: grandes obras (ficha con la barra de fases, «Pagar fase N», parar y la
 * cofinanciación), la comarca (bonanza o crisis, con el aviso) y la oferta de
 * la gran empresa.
 */

type Send = (cmd: Command) => Promise<boolean>;

const PHASE_WORD: Record<GameState['region']['phase'], string> = { bonanza: 'Bonanza', normal: 'Normal', crisis: 'Crisis' };

/** Barra de fases: hechas llenas, la que está en obra con su avance, las que faltan vacías. */
export function phaseBar(state: GameState, lmPhase: number, phases: number, buildingId: number): HTMLElement {
  const p = state.projects.find((x) => x.buildingId === buildingId);
  const frac = p ? Math.min(1, p.workerDaysDone / Math.max(1, p.workerDaysNeeded)) : 0;
  const bar = h('div', { class: 'phase-bar', role: 'img', 'aria-label': `Fases: ${lmPhase} de ${phases} terminadas${p ? `, la ${lmPhase + 1} al ${Math.round(frac * 100)} %` : ''}` });
  for (let i = 0; i < phases; i++) {
    const seg = h('span', { class: `phase-seg${i < lmPhase ? ' done' : i === lmPhase && p ? ' doing' : ''}` });
    if (i === lmPhase && p) {
      // Con CSSOM (la CSP no deja atributos style).
      const fill = h('span', { class: 'phase-fill' });
      fill.style.width = `${Math.round(frac * 100)}%`;
      seg.append(fill);
    }
    seg.append(h('span', { class: 'phase-num' }, String(i + 1)));
    bar.append(seg);
  }
  return bar;
}

/** Contenido de la ficha de una gran obra. `reopen` vuelve a pintar la ficha tras un comando. */
export function landmarkContent(state: GameState, b: Building, send: Send, reopen: () => void): (Node | string)[] {
  const lm = landmarkByBuilding(state, b.id);
  if (!lm) return [h('p', {}, 'Esta obra ya no está.')];
  const out: (Node | string)[] = [];
  out.push(h('p', {}, LANDMARK_EFFECT[lm.kind], lm.phase > 0 && lm.phase < lm.phases ? h('span', { class: 'muted' }, ` (ya da ${Math.round((100 * lm.phase) / lm.phases)} %)`) : ''));
  out.push(phaseBar(state, lm.phase, lm.phases, b.id));
  const p = state.projects.find((x) => x.buildingId === b.id);
  const after = async (cmd: Command) => {
    if (await send(cmd)) reopen();
  };
  if (lm.phase >= lm.phases) {
    out.push(h('p', { class: 'pill good' }, `Terminada: las ${lm.phases} fases.`));
  } else if (p) {
    const pct = Math.round((100 * p.workerDaysDone) / p.workerDaysNeeded);
    const left = p.workersNeeded ? Math.ceil((p.workerDaysNeeded - p.workerDaysDone) / p.workersNeeded) : null;
    out.push(h('p', {}, lm.paused ? `Fase ${lm.phase + 1} parada al ${pct} %: la cuadrilla no trabaja ni cobra.` : `Fase ${lm.phase + 1} de ${lm.phases} en obra: ${pct} %${left !== null ? ` · faltan ${plural(left, 'día', 'días')}` : ''}.`));
    const pause = h('button', { class: 'btn wide' }, lm.paused ? 'Reanudar la obra' : 'Parar la obra');
    pause.addEventListener('click', () => void after({ type: 'PauseLandmark', id: lm.id }));
    out.push(pause);
  } else {
    const cost = phaseCost(state, lm);
    const g = grantFor(state, lm);
    const help = g ? Math.round(cost * g.share) : 0;
    out.push(h('p', {}, lm.phase === 0 ? 'Solar marcado: aún no se ha empezado.' : `Parada entre fases (${lm.phase} de ${lm.phases} hechas): no se pierde nada.`));
    const reqs = landmarkReqs(state, lm.kind, cost).filter((r) => r.key !== 'later');
    out.push(
      h('p', { class: 'small' }, `Para la fase ${lm.phase + 1} (se mira al pagarla):`),
      h('ul', { class: 'reqs' }, ...reqs.map((r) => h('li', { class: r.ok ? 'ok' : 'no' }, h('span', { 'aria-hidden': 'true' }, r.ok ? '✓ ' : '✗ '), r.long, h('span', { class: 'visually-hidden' }, r.ok ? ' (cumplido)' : ' (falta)')))),
    );
    const ok = canFundLandmarkPhase(state, lm.id).ok;
    const pay = h('button', { class: 'btn primary wide', id: 'lm-pay' }, `Pagar fase ${lm.phase + 1} (${money(cost)})`) as HTMLButtonElement;
    pay.disabled = !ok;
    pay.addEventListener('click', () => void after({ type: 'FundLandmarkPhase', id: lm.id }));
    out.push(pay);
    if (help) out.push(h('p', { class: 'muted small' }, `${g!.feder ? 'El FEDER' : 'La Diputación'} pone ${money(help)} de la fase: al ayuntamiento le cuesta ${money(cost - help)}, más los sueldos de ${LANDMARKS.specs[lm.kind].workers} obreros durante ${LANDMARKS.specs[lm.kind].days} días.`));
    else out.push(h('p', { class: 'muted small' }, `Además, los sueldos de ${LANDMARKS.specs[lm.kind].workers} obreros durante ${LANDMARKS.specs[lm.kind].days} días.`));
    if (lm.phase > 0 && !lm.paused) {
      const pause = h('button', { class: 'btn wide' }, 'Dejarla parada');
      pause.addEventListener('click', () => void after({ type: 'PauseLandmark', id: lm.id }));
      out.push(pause);
    }
  }
  // Cofinanciación de la Diputación (y el FEDER, en crisis).
  const grants = state.grants.filter((g) => (g.landmark === lm.id || (g.feder && g.kind === lm.kind)) && (g.status === 'offered' || g.status === 'accepted'));
  for (const g of grants) {
    const t = grantTerms(g);
    if (g.status === 'offered') {
      const yes = h('button', { class: 'btn primary', id: 'lm-grant-yes' }, 'Aceptar');
      const no = h('button', { class: 'btn' }, 'Rechazar');
      yes.addEventListener('click', () => void after({ type: 'AnswerGrant', grantId: g.id, accept: true }));
      no.addEventListener('click', () => void after({ type: 'AnswerGrant', grantId: g.id, accept: false }));
      out.push(h('div', { class: 'petition' }, h('p', {}, pixelIcon('coin'), ' ', t.offer), h('p', { class: 'muted small' }, t.terms), h('div', { class: 'row' }, yes, no)));
    } else out.push(h('p', { class: 'small' }, pixelIcon('coin'), ' ', t.accepted));
  }
  if (lm.spent > 0) out.push(h('p', { class: 'muted small' }, `Lleva gastado ${money(lm.spent)}; mantenerla cuesta ${money(Math.round(lm.spent * LANDMARKS.upkeep))} al mes.`));
  return out;
}

/** Qué falta para una gran obra, en una línea («✗ 60 vecinos · ✓ felicidad 55 · ✗ 14.000 €»). */
export function reqLine(state: GameState, kind: LandmarkKind): string {
  return landmarkReqs(state, kind)
    .map((r) => `${r.ok ? '✓' : '✗'} ${r.short}`)
    .join(' · ');
}

/* ---------------- comarca y gran empresa ---------------- */

/** Resumen para el panel «Pueblo». */
export function regionSummary(state: GameState): string {
  const r = state.region;
  const parts = [`Comarca: ${PHASE_WORD[r.phase].toLowerCase()}`];
  if (r.warned && r.next && r.next !== r.phase) parts.push(`${r.next === 'crisis' ? '⚠ crisis' : PHASE_WORD[r.next].toLowerCase()} en ${plural(Math.max(1, Math.round((r.until - state.tick) / TICKS_PER_MONTH)), 'mes', 'meses')}`);
  const works = landmarksInProgress(state).length;
  if (works) parts.push(plural(works, 'gran obra en marcha', 'grandes obras en marcha'));
  if (state.bigCompany?.status === 'oferta') parts.push(`oferta de ${state.bigCompany.name}`);
  return parts.join(' · ');
}

/** ¿Hay algo que mirar? (oferta de la gran empresa o una crisis avisada). */
export function regionAttention(state: GameState): boolean {
  return state.bigCompany?.status === 'oferta' || (state.region.warned && state.region.next === 'crisis');
}

const FX_TEXT: Record<GameState['region']['phase'], string> = {
  bonanza: `Los talleres venden un ${Math.round((REGION.fx.bonanza.factoryRevenue - 1) * 100)} % más, hay más trabajo fuera y las casas valen más.`,
  normal: 'Todo como siempre.',
  crisis: `Los talleres venden un ${Math.round((1 - REGION.fx.crisis.factoryRevenue) * 100)} % menos, hay menos trabajo fuera y las casas valen menos. La Unión Europea ofrece fondos (FEDER).`,
};

/** Hoja «Comarca»: la fase, el aviso, la gran empresa y las grandes obras. */
export function openRegion(state: GameState, send: Send, focus: (b: Building) => void, reopen: () => void): void {
  const r = state.region;
  const content: (Node | string)[] = [];
  content.push(h('p', {}, h('strong', {}, `Fase: ${PHASE_WORD[r.phase]}. `), FX_TEXT[r.phase]));
  if (r.warned && r.next && r.next !== r.phase) {
    content.push(h('p', { class: r.next === 'crisis' ? 'pocket-warn' : '' }, `${r.next === 'crisis' ? '⚠ Se está cociendo una crisis' : `Viene ${PHASE_WORD[r.next].toLowerCase()}`}: empieza hacia el ${formatDate(tickToDate(r.until))}.`));
  } else content.push(h('p', { class: 'muted small' }, 'Cada fase dura de año y medio a tres años; se avisa dos meses antes.'));
  content.push(h('h3', {}, 'La gran empresa'), ...bigCompanyContent(state, send, reopen));
  content.push(h('h3', {}, 'Grandes obras'));
  if (!state.landmarks.length) content.push(h('p', { class: 'muted' }, 'Ninguna todavía. Están en Construir › Grandes obras.'));
  for (const lm of state.landmarks) {
    const b = state.buildings.find((x) => x.id === lm.buildingId);
    if (!b) continue;
    const go = h('button', { class: 'btn wide' }, `${LANDMARK_NAMES[lm.kind]} · ${lm.phase >= lm.phases ? 'terminada' : `fase ${lm.phase} de ${lm.phases}`}`);
    go.addEventListener('click', () => focus(b));
    content.push(go);
  }
  sheet('Comarca', ...content);
}

/** La gran empresa: la oferta con sus tres respuestas, o cómo le va. */
export function bigCompanyContent(state: GameState, send: Send, reopen: () => void): (Node | string)[] {
  const bc = state.bigCompany;
  const c = REGION.bigCompany;
  if (!bc) return [h('p', { class: 'muted' }, `Llega una oferta con ${c.pop} vecinos, ${c.industrialTiles} casillas libres de zona industrial y luz.`)];
  const after = async (cmd: Command) => {
    if (await send(cmd)) reopen();
  };
  if (bc.status === 'oferta') {
    const left = Math.max(1, Math.ceil((bc.deadline - state.tick) / 24));
    const opt = (id: string, label: string, incentive: 'ninguno' | 'ibi_bonificado' | 'suelo_gratis', why: string) => {
      const b = h('button', { class: 'btn wide', id }, label);
      b.addEventListener('click', () => void after({ type: 'AnswerBigCompany', accept: true, incentive }));
      return h('div', { class: 'bc-opt' }, b, h('p', { class: 'muted small' }, why));
    };
    const no = h('button', { class: 'btn wide', id: 'bc-no' }, 'No, gracias');
    no.addEventListener('click', () => void after({ type: 'AnswerBigCompany', accept: false, incentive: 'ninguno' }));
    return [
      h('div', { class: 'petition' },
        h('p', {}, h('strong', {}, bc.name), ` quiere una fábrica grande (2×2) en la zona industrial: hasta ${c.jobs} empleos y un IBI de ${money(c.ibi)} al mes. Contamina el doble que un taller; a quien viva cerca no le gustará, ni a los ecologistas.`),
        h('p', { class: 'muted small' }, `Quedan ${plural(left, 'día', 'días')} para responder.`),
        opt('bc-ibi', 'Sí, con el IBI a mitad 5 años', 'ibi_bonificado', `${c.jobs} empleos; cobras ${money(Math.round(c.ibi * (1 - c.ibiDiscount)))} al mes los primeros años.`),
        opt('bc-land', `Sí, regalando el suelo (${money(c.landCost)})`, 'suelo_gratis', `${c.jobs} empleos y el IBI entero desde el principio.`),
        opt('bc-none', 'Sí, sin incentivos', 'ninguno', `Viene con menos plantilla: ${bigCompanyJobs('ninguno')} empleos.`),
        no,
      ),
    ];
  }
  const b = bigFactory(state);
  const workers = b ? state.citizens.filter((x) => x.jobId === b.id).length : 0;
  switch (bc.status) {
    case 'rechazada':
      return [h('p', { class: 'muted' }, `${bc.name} se fue a otro pueblo.`)];
    case 'cerrada':
      return [h('p', { class: 'muted' }, `${bc.name} cerró y se fue de la comarca.`)];
    default: {
      const lines: (Node | string)[] = [h('p', {}, `${bc.name}: ${b?.built ? `${workers} de ${b.staff ?? bc.jobs} empleos ocupados` : 'construyendo la fábrica'} · IBI ${money(bigCompanyIbi(state))} al mes.`)];
      if (bc.warnUntil !== undefined) lines.push(h('p', { class: 'pocket-warn' }, `⚠ ${bc.status === 'se_va' ? 'Cierra y se va' : 'Hará un ERE (la mitad de la plantilla)'} el ${formatDate(tickToDate(bc.warnUntil))}.`));
      return lines;
    }
  }
}
