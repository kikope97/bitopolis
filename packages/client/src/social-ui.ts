import type { Command } from '@bitopolis/shared';
import {
  activeObjectives,
  BUILD_NAMES,
  type Citizen,
  diary,
  GOAL_TEXT,
  goalDone,
  type GameState,
  happinessFactors,
  memoryText,
  NEED_TEXT,
  PLENO_COST,
  QUESTION_TEXT,
  QUESTIONS,
  ruleAdvice,
  ruleAnswer,
  topNeeds,
} from '@bitopolis/sim';
import { tickToDate } from '@bitopolis/shared';
import { api } from './api.ts';
import { money } from './i18n.ts';
import { $, h, sheet, toast } from './ui.ts';

type Cmd = (c: Command) => Promise<boolean>;

export interface SocialCtx {
  token: string;
  state: () => GameState;
  command: Cmd;
}

const RELATION_TEXT: Record<string, string> = { amistad: 'amistad', pareja: 'pareja', rivalidad: 'rivalidad', rencor: 'rencor' };
const DESIRE_TEXT: Record<string, string> = {
  trabajo_cerca: 'trabajar cerca de casa',
  casa_propia: 'tener casa propia',
  parque: 'un parque',
  tienda: 'tiendas cerca',
  tranquilidad: 'tranquilidad',
  prosperar: 'prosperar',
};
const FEAR_TEXT: Record<string, string> = { paro: 'el paro', impuestos: 'los impuestos', soledad: 'la soledad', ruido: 'el ruido', deudas: 'las deudas' };
const TRAIT_TEXT: Record<string, string> = { terco: 'Terquedad', ahorro: 'Ahorro', social: 'Sociable', ambicion: 'Ambición' };

const moodWord = (h0: number) => (h0 >= 65 ? 'contento' : h0 >= 40 ? 'regular' : 'descontento');

/** Ficha completa del vecino (§6.2) con «Hablar» (§7). */
export function openCitizen(ctx: SocialCtx, citizenId: number): void {
  const state = ctx.state();
  const c = state.citizens.find((x) => x.id === citizenId);
  if (!c) return;
  const job = state.buildings.find((b) => b.id === c.jobId);
  const nameOf = (id: number) => state.citizens.find((x) => x.id === id)?.name ?? 'alguien que se fue';
  const traits = h(
    'ul',
    { class: 'traits' },
    ...Object.entries(c.traits).map(([k, v]) =>
      h('li', {}, h('span', {}, TRAIT_TEXT[k] ?? k), h('progress', { max: '100', value: String(v), 'aria-label': `${TRAIT_TEXT[k]}: ${v} de 100` })),
    ),
  );
  const worries = happinessFactors(state, c)
    .filter((f) => f.value < 0)
    .map((f) => f.label);
  const answer = h('p', { class: 'answer', 'aria-live': 'polite' });
  const ask = h('div', { class: 'ask' });
  for (const q of QUESTIONS) {
    const b = h('button', { class: 'btn small' }, QUESTION_TEXT[q]);
    b.addEventListener('click', async () => {
      await ctx.command({ type: 'TalkTo', citizenId: c.id, question: q });
      answer.textContent = `«${ruleAnswer(ctx.state(), c, q, worries[0])}»`;
      if (ctx.state().aiMode) {
        answer.classList.add('thinking');
        try {
          const r = await api.talk(ctx.token, c.id, q);
          if (r.text) {
            answer.replaceChildren(`«${r.text}» `, h('span', { class: 'ai-badge' }, 'IA'));
          }
        } catch {
          /* se queda la respuesta por reglas */
        } finally {
          answer.classList.remove('thinking');
        }
      }
    });
    ask.append(b);
  }
  const last = [...state.decisionLog].reverse().filter((d) => d.citizenId === c.id).slice(0, 3);
  sheet(
    `★ ${c.name}`,
    h('p', {}, `${c.profession || 'vecina'}, ${c.age} años · ${moodWord(c.happiness)} (${Math.round(c.happiness)}) · ${money(c.money)}`),
    h('p', {}, `${c.owns ? (c.mortgage > 0 ? `Propietario (le quedan ${money(c.mortgage)} de hipoteca)` : 'Propietario') : 'De alquiler'} · ${job ? `trabaja en ${(job.name ?? BUILD_NAMES[job.kind] ?? '').toLowerCase()}` : 'trabaja fuera'}`),
    h('p', {}, `Quiere ${DESIRE_TEXT[c.desire]}; teme ${FEAR_TEXT[c.fear]}. Meta: ${GOAL_TEXT[c.goal]} ${goalDone(state, c) ? '✓' : ''}`),
    h('h3', {}, 'Hablar'),
    ask,
    answer,
    h('h3', {}, 'Relaciones'),
    c.relations.length ? h('ul', { class: 'people' }, ...c.relations.map((r) => h('li', {}, `${nameOf(r.id)}: ${RELATION_TEXT[r.kind]}`))) : h('p', { class: 'muted' }, 'Aún no tiene relaciones en el pueblo.'),
    h('h3', {}, 'Recuerdos'),
    c.memories.length ? h('ul', { class: 'people' }, ...[...c.memories].reverse().map((m) => h('li', {}, memoryText(state, m)))) : h('p', { class: 'muted' }, 'Nada que contar todavía.'),
    worries.length ? h('p', {}, `Le preocupa: ${worries.slice(0, 3).join(', ').toLowerCase()}.`) : '',
    last.length ? h('h3', {}, 'Lo último que ha dicho') : '',
    ...last.map((d) => h('p', { class: 'quote' }, `«${d.motivo}» `, d.source === 'ai' ? h('span', { class: 'ai-badge' }, 'IA') : '')),
    h('details', { class: 'advanced' }, h('summary', {}, 'Personalidad'), traits, c.summary ? h('p', {}, c.summary) : ''),
  );
}

/** Pleno municipal (§7): peticiones, votos y promesas registradas. */
export function openPleno(ctx: SocialCtx): void {
  const state = ctx.state();
  const reopen = () => openPleno(ctx);
  const promises = state.promises.slice(-6).reverse();
  const promiseList = promises.length
    ? h(
        'ul',
        { class: 'accounts' },
        ...promises.map((p) => {
          const d = tickToDate(p.deadline);
          const st = p.status === 'pending' ? `pendiente, vence ${d.day}/${d.month} año ${d.year}` : p.status === 'kept' ? '✓ cumplida' : '✗ incumplida';
          return h('li', { class: p.status === 'broken' ? 'neg' : p.status === 'kept' ? 'pos' : '' }, h('span', {}, NEED_TEXT[p.need]), h('span', {}, st));
        }),
      )
    : h('p', { class: 'muted' }, 'Aún no has prometido nada.');
  if (!state.pleno) {
    const go = h('button', { class: 'btn primary wide' }, `Convocar pleno (${money(PLENO_COST)})`);
    go.addEventListener('click', async () => {
      if (await ctx.command({ type: 'ConvenePleno' })) reopen();
    });
    const needs = topNeeds(state).slice(0, 3);
    sheet(
      'Pleno municipal',
      h('p', {}, 'Los vecinos exponen sus peticiones y se vota. Lo que prometas queda registrado: si no lo cumples a tiempo, quien lo apoyó no lo olvidará.'),
      needs.length ? h('p', {}, `Hoy pedirían: ${needs.join(', ')}.`) : '',
      go,
      h('h3', {}, 'Promesas'),
      promiseList,
    );
    return;
  }
  const list = h('div', { class: 'petitions' });
  for (const p of state.pleno.petitions) {
    const who = state.citizens.find((c) => c.id === p.citizenId);
    const said = [...state.decisionLog].reverse().find((d) => d.citizenId === p.citizenId);
    const card = h(
      'div',
      { class: 'petition' },
      h('p', {}, h('strong', {}, who?.name ?? 'Un vecino'), ` pide ${NEED_TEXT[p.need]}.`),
      said ? h('p', { class: 'quote' }, `«${said.motivo}»`) : '',
      h('p', {}, `Votos: ${p.yes} a favor, ${p.no} en contra.`),
    );
    if (p.answer) card.append(h('p', { class: 'muted' }, p.answer === 'promise' ? '✓ Prometido' : '✗ Rechazado'));
    else {
      const yes = h('button', { class: 'btn primary' }, 'Prometer');
      const no = h('button', { class: 'btn' }, 'Rechazar');
      yes.addEventListener('click', async () => {
        await ctx.command({ type: 'AnswerPetition', petitionId: p.id, answer: 'promise' });
        reopen();
      });
      no.addEventListener('click', async () => {
        await ctx.command({ type: 'AnswerPetition', petitionId: p.id, answer: 'reject' });
        reopen();
      });
      card.append(h('div', { class: 'row' }, yes, no));
    }
    list.append(card);
  }
  const close = h('button', { class: 'btn wide' }, 'Cerrar el pleno');
  close.addEventListener('click', async () => {
    await ctx.command({ type: 'ClosePleno' });
    toast('Pleno cerrado. Las promesas quedan registradas.', { kind: 'good' });
    reopen();
  });
  sheet('Pleno municipal', list, close, h('h3', {}, 'Promesas'), promiseList);
}

/** Consejero (§7): reglas en Modo normal; IA premium en Modo IA. */
export function openAdvisor(ctx: SocialCtx): void {
  const out = h('div', { class: 'advice', 'aria-live': 'polite' });
  const ask = (q: 'como_va' | 'que_cambiarias', label: string) => {
    const b = h('button', { class: 'btn wide' }, label);
    b.addEventListener('click', async () => {
      out.replaceChildren(...ruleAdvice(ctx.state(), q).map((l) => h('p', {}, l)));
      if (ctx.state().aiMode) {
        out.classList.add('thinking');
        try {
          const r = await api.advisor(ctx.token, q);
          if (r.text) out.replaceChildren(h('p', {}, r.text, ' ', h('span', { class: 'ai-badge' }, 'IA')));
          else if (r.reason) out.append(h('p', { class: 'muted' }, `(Consejo por reglas: ${r.reason})`));
        } catch {
          /* se queda el consejo por reglas */
        } finally {
          out.classList.remove('thinking');
        }
      }
    });
    return b;
  };
  sheet('Consejero', h('p', {}, 'Pregunta y te respondo con los datos reales del pueblo.'), ask('como_va', '¿Cómo va el pueblo?'), ask('que_cambiarias', '¿Qué cambiarías?'), out);
}

/** Diario del pueblo (§7): crónica de lo que pasa, con la voz de los vecinos. */
export function openDiary(ctx: SocialCtx): void {
  const state = ctx.state();
  const entries = diary(state);
  const chronicle = h('div', { 'aria-live': 'polite' });
  const items: (Node | string)[] = [];
  if (state.aiMode) {
    const b = h('button', { class: 'btn wide' }, 'Crónica del mes (IA)');
    b.addEventListener('click', async () => {
      chronicle.replaceChildren(h('p', { class: 'muted' }, 'El cronista escribe…'));
      try {
        const r = await api.chronicle(ctx.token);
        chronicle.replaceChildren(r.text ? h('p', { class: 'chronicle' }, r.text, ' ', h('span', { class: 'ai-badge' }, 'IA')) : h('p', { class: 'muted' }, `No se pudo escribir la crónica (${r.reason ?? 'sin IA'}).`));
      } catch {
        chronicle.replaceChildren(h('p', { class: 'muted' }, 'Sin conexión.'));
      }
    });
    items.push(b, chronicle);
  }
  for (const e of entries) items.push(h('h3', {}, e.date), h('ul', { class: 'people' }, ...e.lines.map((l) => h('li', {}, l))));
  if (!entries.length) items.push(h('p', { class: 'muted' }, 'Todavía no ha pasado nada digno de contar.'));
  sheet('Diario del pueblo', ...items);
}

/** Tarjeta de objetivos (1–3 visibles, con recompensa). */
export function renderObjectives(state: GameState): void {
  const box = $('#objectives');
  const list = activeObjectives(state);
  const sig = list.map((o) => o.id).join(',');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren(
    h('strong', {}, 'Objetivos'),
    ...list.map((o) => h('span', { class: 'obj' }, `○ ${o.text}`, h('small', {}, ` +${money(o.reward)}${o.unlock ? ' y un edificio' : ''}`))),
  );
}

/** «Mientras no estabas»: cambios desde la última visita en este navegador. */
export function resumeSummary(token: string, state: GameState): string[] | null {
  const key = `bitopolis.seen.${token}`;
  let seen: { tick: number; pop: number; treasury: number } | null = null;
  try {
    seen = JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    seen = null;
  }
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify({ tick: state.tick, pop: state.citizens.length, treasury: state.treasury }));
    } catch {
      /* sin almacenamiento */
    }
  };
  if (!seen || seen.tick >= state.tick) {
    save();
    return null;
  }
  const lines: string[] = [];
  const dp = state.citizens.length - seen.pop;
  if (dp) lines.push(`${dp > 0 ? '+' : ''}${dp} ${Math.abs(dp) === 1 ? 'vecino' : 'vecinos'}`);
  const dm = state.treasury - seen.treasury;
  lines.push(`Caja: ${dm >= 0 ? '+' : ''}${money(dm)}`);
  const important = state.events.filter((e) => e.tick > seen!.tick && ['business', 'milestone', 'departure', 'bankrupt', 'warning', 'info'].includes(e.kind));
  for (const e of important.slice(-3).reverse()) lines.push(e.text);
  save();
  return lines.slice(0, 5);
}

export function rememberSeen(token: string, state: GameState): void {
  try {
    localStorage.setItem(`bitopolis.seen.${token}`, JSON.stringify({ tick: state.tick, pop: state.citizens.length, treasury: state.treasury }));
  } catch {
    /* sin almacenamiento */
  }
}

export type { Citizen };
