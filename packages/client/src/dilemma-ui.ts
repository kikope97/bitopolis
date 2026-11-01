import { type Command, tickToDate } from '@bitopolis/shared';
import { DILEMMA_TITLE, dilemmaOption, dilemmaText, type GameState } from '@bitopolis/sim';
import { formatDate } from './i18n.ts';
import { h, sheet, toast } from './ui.ts';

/**
 * 2.4 (bloque D): hoja de un dilema. Las opciones son del motor, con su efecto
 * a la vista; la presentación puede venir del director (IA, validada). Los
 * nombres se tocan para ver dónde viven (`reveal`) y abrir su ficha.
 */
export interface DilemmaCtx {
  state: () => GameState;
  command: (c: Command) => Promise<boolean>;
  /** Deja a la vista la casilla (revealTile en game.ts). */
  reveal: (x: number, y: number) => void;
  openCitizen: (id: number) => void;
}

/** Dónde mirar en el mapa: el edificio del caso o la casa del primer afectado. */
export function dilemmaSpot(state: GameState, id: number): { x: number; y: number } | undefined {
  const d = state.dilemmas.find((x) => x.id === id);
  if (!d) return undefined;
  const b = state.buildings.find((x) => x.id === d.buildingId);
  if (b) return b;
  const c = state.citizens.find((x) => x.id === d.citizenIds[0]);
  return state.buildings.find((x) => x.id === c?.homeId);
}

export function openDilemmaSheet(ctx: DilemmaCtx, id: number): void {
  const state = ctx.state();
  const d = state.dilemmas.find((x) => x.id === id);
  if (!d) return;
  const people = h('div', { class: 'dilemma-people' });
  for (const cid of d.citizenIds) {
    const c = state.citizens.find((x) => x.id === cid);
    if (!c) continue;
    const home = state.buildings.find((b) => b.id === c.homeId);
    const btn = h('button', { class: 'btn small', 'aria-label': `${c.name}: ver dónde vive y su ficha` }, c.name);
    btn.addEventListener('click', () => {
      if (home) ctx.reveal(home.x, home.y);
      ctx.openCitizen(c.id);
    });
    people.append(btn);
  }
  const body: (Node | string)[] = [h('p', {}, d.intro ?? dilemmaText(state, d)), d.intro ? h('p', { class: 'muted small' }, dilemmaText(state, d)) : '', people];
  if (d.resolved) {
    const what = d.resolved === 'no_decidir' ? 'No se decidió a tiempo.' : d.resolved === 'sin_efecto' ? 'Ya no hace falta decidir.' : `Decidiste: ${dilemmaOption(state, d, d.resolved).label}.`;
    body.push(h('p', { class: 'muted' }, what));
  } else {
    body.push(h('p', { class: 'muted small' }, `Tienes hasta el ${formatDate(tickToDate(d.until))}. Si no decides, los afectados se lo guardarán.`));
    const opts = h('div', { class: 'dilemma-options' });
    for (const o of d.options) {
      const t = dilemmaOption(state, d, o);
      const btn = h('button', { class: 'btn' }, h('strong', {}, t.label), h('span', { class: 'small' }, t.effect));
      btn.addEventListener('click', async () => {
        if (await ctx.command({ type: 'ResolveDilemma', id: d.id, option: o })) {
          toast(`${DILEMMA_TITLE[d.kind]}: ${t.label.toLowerCase()}`, { kind: 'info' });
          openDilemmaSheet(ctx, id);
        }
      });
      opts.append(btn);
    }
    body.push(opts);
  }
  sheet(DILEMMA_TITLE[d.kind], ...body).classList.add('half');
}
