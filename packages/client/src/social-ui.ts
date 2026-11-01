import type { Command } from '@bitopolis/shared';
import { pocketBox } from './money-ui.ts';
import { mindBox } from './ai-town-ui.ts';
import {
  activeObjectives,
  scenarioStatus,
  type Citizen,
  diary,
  FACTION_TEXT,
  factionOf,
  GOAL_TEXT,
  politicsActive,
  goalDone,
  type GameState,
  worriesOf,
  HOOK_TEXT,
  hookFor,
  memoryText,
  NEED_TEXT,
  isFemaleName,
  lowerFirst,
  professionOf,
  workplaceText,
  PLENO_COST,
  QUESTION_TEXT,
  QUESTIONS,
  ruleAdvice,
  ruleAnswer,
  plenoPlan,
  plenoUnlocked,
  STREETS,
  streetCandidates,
  plenoLines,
  PLENO_REACTION_TEXT,
} from '@bitopolis/sim';
import { tickToDate } from '@bitopolis/shared';
import { api } from './api.ts';
import { formatDate, money } from './i18n.ts';
import { portraitSprite } from './sprites.ts';
import { $, confirmDialog, h, sheet, toast, withBack } from './ui.ts';
import { openFamily } from './album-ui.ts';
import type { AwaySince } from './away-ui.ts';
import { drawPixelIcons, pixelIcon } from './icons.ts';
import { lettersTo, openMailbox } from './mail-ui.ts';

type Cmd = (c: Command) => Promise<boolean>;

export interface SocialCtx {
  token: string;
  state: () => GameState;
  command: Cmd;
  /** 2.2: elegir en el mapa la calle que se dedica a un vecino (lo pone game.ts). */
  pickStreet?: (citizenId: number, name: string) => void;
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
  const worries = worriesOf(state, c).map((f) => f.label);
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
  // Sin repetir: la misma frase dicha varias veces sale una sola vez.
  const last = [...state.decisionLog]
    .reverse()
    .filter((d) => d.citizenId === c.id)
    .filter((d, i, all) => all.findIndex((x) => x.motivo === d.motivo) === i)
    .slice(0, 3);
  const hook = hookFor(state, c.id);
  // Retrato pixel art (12×18) ampliado ×4.
  const face = portraitCanvas(c.id, 4);
  const owner = isFemaleName(c.name) ? 'Propietaria' : 'Propietario';
  sheet(
    h('span', {}, h('span', { 'aria-hidden': 'true' }, '★ '), c.name),
    face,
    h('p', {}, `${c.profession ? professionOf(c) : 'Sin oficio conocido'}, ${c.age} años · ${moodWord(c.happiness)} (${Math.round(c.happiness)}) · ${money(c.money)}`),
    c.kids?.length ? h('p', { class: 'muted small' }, c.kids.length === 1 ? 'Tiene un hijo en casa.' : `Tiene ${c.kids.length} hijos en casa.`) : '',
    h('p', {}, `${c.owns ? (c.mortgage > 0 ? `${owner} (le quedan ${money(c.mortgage)} de hipoteca)` : owner) : c.homeId === null ? 'Sin casa' : 'De alquiler'} · ${job ? `trabaja en ${workplaceText(job)}` : c.unemployedSince !== undefined ? 'en paro' : 'trabaja fuera'}`),
    // 2.0: lo que piensa y planea (si piensa con IA).
    mindBox(state, c) ?? '',
    // v1.9: su balance y sus deudas.
    h('h3', {}, 'Su bolsillo'),
    pocketBox(ctx, c, () => openCitizen(ctx, citizenId)),
    h('p', {}, `Quiere ${DESIRE_TEXT[c.desire]}; teme ${FEAR_TEXT[c.fear]}. Meta: ${GOAL_TEXT[c.goal]} ${goalDone(state, c) ? '✓' : ''}`),
    hook ? h('p', { class: 'hook' }, h('strong', {}, 'Ahora mismo: '), `${HOOK_TEXT[hook.kind]}.`) : '',
    politicsActive(state)
      ? h(
          'p',
          {},
          `Facción: ${FACTION_TEXT[factionOf(state, c)].toLowerCase()}.`,
          state.politics.party?.leaderId === c.id ? h('strong', {}, ` Lidera «${state.politics.party.name}»${state.politics.mayor === c.id ? ' y es el alcalde' : ''}.`) : '',
        )
      : '',
    h('h3', {}, 'Hablar'),
    ask,
    answer,
    familyButton(ctx, c.id),
    // 2.5: cartas de los que se fueron.
    lettersButton(ctx, c.id),
    h('h3', {}, 'Relaciones'),
    c.relations.length ? h('ul', { class: 'people' }, ...c.relations.map((r) => h('li', {}, `${nameOf(r.id)}: ${RELATION_TEXT[r.kind]}`))) : h('p', { class: 'muted' }, 'Aún no tiene relaciones en el pueblo.'),
    h('h3', {}, 'Recuerdos'),
    c.memories.length ? h('ul', { class: 'people' }, ...memoryLines(state, c).map((t) => h('li', {}, t))) : h('p', { class: 'muted' }, 'Nada que contar todavía.'),
    worries.length ? h('p', {}, `Le preocupa: ${worries.slice(0, 3).map(lowerFirst).join(', ')}.`) : '',
    last.length ? h('h3', {}, 'Lo último que ha dicho') : '',
    ...last.map((d) => h('p', { class: 'quote' }, `«${d.motivo}» `, d.source === 'ai' ? h('span', { class: 'ai-badge' }, 'IA') : '')),
    h('details', { class: 'advanced' }, h('summary', {}, 'Personalidad'), traits, c.summary ? h('p', {}, c.summary) : ''),
  );
}

/** 2.5: las cartas que ha recibido (buzón filtrado), si tiene alguna. */
function lettersButton(ctx: SocialCtx, id: number): HTMLElement | string {
  const n = lettersTo(ctx.state(), id).length;
  if (!n) return '';
  const b = h('button', { class: 'btn small', id: 'citizen-letters' }, pixelIcon('letter'), n === 1 ? 'Una carta' : `${n} cartas`);
  b.addEventListener('click', () => {
    const name = ctx.state().citizens.find((x) => x.id === id)?.name.split(' ')[0] ?? 'la ficha';
    withBack(name, () => openCitizen(ctx, id), () => openMailbox({ token: ctx.token, state: ctx.state, openCitizen: (k) => openCitizen(ctx, k) }, id));
  });
  return b;
}

/** v1.7: acceso al árbol genealógico desde la ficha. */
function familyButton(ctx: SocialCtx, id: number): HTMLElement {
  const b = h('button', { class: 'btn small' }, h('canvas', { class: 'px-icon', 'data-icon': 'family', 'aria-hidden': 'true' }), 'Árbol familiar');
  drawPixelIcons(b);
  b.addEventListener('click', () => {
    const name = ctx.state().citizens.find((x) => x.id === id)?.name.split(' ')[0] ?? 'la ficha';
    withBack(name, () => openCitizen(ctx, id), () => openFamily(ctx, id, (k) => openCitizen(ctx, k)));
  });
  return b;
}

/** Recuerdos sin repetir (ronda 12: salía la misma frase varias veces seguidas). */
function memoryLines(state: GameState, c: GameState['citizens'][number]): string[] {
  const out: { text: string; n: number }[] = [];
  for (const m of [...c.memories].reverse()) {
    const text = memoryText(state, m);
    const same = out.find((o) => o.text === text);
    if (same) same.n++;
    else out.push({ text, n: 1 });
  }
  return out.map((o) => (o.n > 1 ? `${o.text} (×${o.n})` : o.text));
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
    // Ronda 14: en el nivel 1 se dice antes de tocar, no al final.
    const locked = !plenoUnlocked(state);
    if (locked) {
      go.setAttribute('aria-disabled', 'true');
      go.textContent = '🔒 Los plenos llegan con el ayuntamiento de nivel 2 (toca el ayuntamiento)';
    }
    go.addEventListener('click', async () => {
      if (locked) return;
      // Cuesta dinero: se confirma (ronda 10).
      if (!(await confirmDialog('Convocar pleno', `Cuesta ${money(PLENO_COST)} y solo hay uno al mes.`, 'Convocar'))) return;
      if (await ctx.command({ type: 'ConvenePleno' })) {
        toast(`Pleno convocado: −${money(PLENO_COST)}`, { kind: 'info' });
        reopen();
      }
    });
    // Lo mismo que traerá el pleno al convocarlo (mismo cálculo del motor).
    const needs = plenoPlan(state).map((p) => `${NEED_TEXT[p.need]}${p.opposition ? ' (la oposición)' : ''}`);
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
  const close = h('button', { class: 'btn wide' }, 'Cerrar el pleno');
  const deadline = formatDate(tickToDate(state.tick + 24 * 120));
  const done = (a: 'promise' | 'reject') => h('p', { class: 'muted' }, a === 'promise' ? '✓ Prometido' : '✗ Rechazado');
  for (const p of state.pleno.petitions) {
    const who = state.citizens.find((c) => c.id === p.citizenId);
    const fiscal = p.need === 'bajar_tasas' || p.need === 'bajar_ibi';
    const n = p.supporters.length;
    const party = state.politics.party;
    const card = h(
      'div',
      { class: p.opposition ? 'petition opposition' : 'petition' },
      p.opposition && party ? h('p', { class: 'pol-tag' }, `Pregunta de la oposición · «${party.name}»`) : '',
      h('p', {}, h('strong', {}, who?.name ?? 'Un vecino'), ` pide ${NEED_TEXT[p.need]}.`),
      h('p', {}, `Votos: ${p.yes} a favor, ${p.no} en contra.`),
    );
    if (p.answer) card.append(done(p.answer));
    else {
      const terms = h('p', { class: 'muted' }, `Si prometes: plazo hasta el ${deadline}${fiscal ? ' y hay que mantener la bajada 60 días' : ''}. Si no cumples, ${n} ${n === 1 ? 'vecino con nombre se enfada' : 'vecinos con nombre se enfadan'}.${p.opposition ? ' Si la aceptas, su facción se acerca a ti; si la rechazas, la oposición lo usará en tu contra.' : ''}`);
      const yes = h('button', { class: 'btn primary' }, 'Prometer');
      const no = h('button', { class: 'btn' }, 'Rechazar');
      const row = h('div', { class: 'row' }, yes, no);
      // Se actualiza solo la tarjeta: el foco pasa a la siguiente petición (o a «Cerrar»).
      const answer = async (a: 'promise' | 'reject') => {
        if (!(await ctx.command({ type: 'AnswerPetition', petitionId: p.id, answer: a }))) return;
        terms.remove();
        row.replaceWith(done(a));
        (list.querySelector<HTMLButtonElement>('.petition .btn.primary') ?? close).focus();
      };
      yes.addEventListener('click', () => answer('promise'));
      no.addEventListener('click', () => answer('reject'));
      card.append(terms, row);
    }
    list.append(card);
  }
  close.addEventListener('click', async () => {
    await ctx.command({ type: 'ClosePleno' });
    toast('Pleno cerrado. Las promesas quedan registradas.', { kind: 'good' });
    reopen();
  });
  sheet('Pleno municipal', h('p', { class: 'muted' }, 'El pleno se cierra solo a los 2 días; lo que no respondas queda sin respuesta.'), plenoTalk(ctx), list, streetCard(ctx), close, h('h3', {}, 'Promesas'), promiseList);
}

/** 2.4: lo que se ha oído en este pleno (texto fuera del estado: caché por pleno). */
const plenoHeard = new Map<string, { id: number; linea: string }[]>();
const STANCE_TEXT: Record<string, string> = { a_favor: 'a favor', en_contra: 'en contra', matiz: 'con matices' };

/**
 * 2.4: intervenciones del pleno en bocadillos, en columna. Primero las
 * plantillas del motor; en Modo IA se piden al servidor (una vez por pleno) y
 * se cambian las que lleguen bien.
 */
function plenoTalk(ctx: SocialCtx): HTMLElement | string {
  const state = ctx.state();
  const pleno = state.pleno;
  if (!pleno?.speakers?.length) return '';
  const key = `${ctx.token}:${pleno.tick}`;
  const box = h('section', { class: 'pleno-talk', 'aria-label': 'Intervenciones del pleno', 'aria-live': 'polite' });
  const paint = (ai: { id: number; linea: string }[]) => {
    const s = ctx.state();
    if (!s.pleno) return;
    box.replaceChildren(
      h('h3', {}, 'Intervenciones'),
      ...plenoLines(s, s.pleno, ai).map((l) => {
        const sp = s.pleno!.speakers!.find((x) => x.id === l.id);
        const name = s.citizens.find((c) => c.id === l.id)?.name ?? 'Un vecino';
        const who = h('button', { class: 'pleno-who', 'aria-label': `Ver la ficha de ${name}` }, name);
        who.addEventListener('click', () => withBack('Pleno', () => openPleno(ctx), () => openCitizen(ctx, l.id)));
        return h(
          'div',
          { class: `pleno-bubble ${l.postura}` },
          h('p', { class: 'pleno-bubble-head' }, who, h('span', { class: 'muted small' }, ` · ${l.postura === 'a_favor' ? '✓ ' : l.postura === 'en_contra' ? '✗ ' : '≈ '}${STANCE_TEXT[l.postura] ?? ''}`), sp?.reaction ? h('span', { class: 'pill' }, ` ${PLENO_REACTION_TEXT[sp.reaction]}`) : ''),
          h('p', { class: 'pleno-line' }, `«${l.linea}» `, l.source === 'ia' ? h('span', { class: 'ai-badge' }, 'IA') : ''),
        );
      }),
    );
  };
  const heard = plenoHeard.get(key);
  paint(heard ?? []);
  if (state.aiMode && !heard) {
    plenoHeard.set(key, []);
    box.classList.add('thinking');
    void api
      .pleno(ctx.token, {
        tick: pleno.tick,
        petitions: pleno.petitions.map((p) => ({ id: p.id, citizenId: p.citizenId, need: p.need, yes: p.yes, no: p.no, ...(p.opposition ? { opposition: true } : {}) })),
        speakers: pleno.speakers.map((x) => ({ id: x.id, role: x.role, postura: x.postura, petitionId: x.petitionId })),
      })
      .then((r) => {
        if (r.lines?.length) {
          plenoHeard.set(key, r.lines);
          paint(r.lines);
        }
      })
      .catch(() => plenoHeard.delete(key))
      .finally(() => box.classList.remove('thinking'));
  }
  return box;
}

/** 2.2: «Dedicar una calle»: los candidatos del motor; al elegir uno, se toca la calle en el mapa. */
function streetCard(ctx: SocialCtx): HTMLElement | string {
  const state = ctx.state();
  const st = state.pleno?.street;
  if (!st) return '';
  const card = h('div', { class: 'petition street-card', 'data-street': st.done ? 'hecha' : 'abierta' }, h('h3', {}, 'Dedicar una calle'));
  if (st.done) {
    const n = state.streetNames?.at(-1);
    card.append(h('p', { class: 'muted' }, n ? `✓ Ya tiene placa: ${n.name}.` : '✓ Ya se ha dedicado una calle en este pleno.'));
    return card;
  }
  const all = streetCandidates(state);
  const cands = st.candidates.map((id) => all.find((c) => c.id === id)).filter((c) => !!c);
  card.append(h('p', { class: 'muted small' }, `El pleno propone a quién recordar. Luego tocas una calle recta o la Plaza Mayor (placa ${money(STREETS.plaque)}). Sus amigos y su familia lo agradecerán; quien se llevaba mal con ellos, no tanto.`));
  for (const c of cands) {
    const b = h('button', { class: 'btn wide street-pick', 'data-citizen': String(c.id) }, h('strong', {}, c.name), h('span', { class: 'muted small' }, ` · ${c.why}`));
    b.addEventListener('click', () => ctx.pickStreet?.(c.id, c.name));
    card.append(b);
  }
  return card;
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
  for (const e of entries) items.push(h('h3', {}, formatDate(tickToDate(e.tick))), h('ul', { class: 'people' }, ...e.lines.map((l) => h('li', {}, l))));
  if (!entries.length) items.push(h('p', { class: 'muted' }, 'Todavía no ha pasado nada digno de contar.'));
  sheet('Diario del pueblo', ...items);
}

/** Tarjeta de objetivos (1–3 visibles, con recompensa). Se pliega para no tapar el mapa. */
/**
 * v1.6: los objetivos ya no flotan sobre el mapa; viven en el panel «Pueblo».
 * Aquí solo se anuncia al lector de pantalla cuando se cumple uno.
 */
let lastObjectives: string | undefined;
export function renderObjectives(state: GameState): void {
  const list = activeObjectives(state);
  const sig = list.map((o) => o.id).join(',');
  if (lastObjectives !== undefined && sig !== lastObjectives) {
    const gone = lastObjectives.split(',').filter((id) => id && !list.some((o) => o.id === id));
    if (gone.length) $('#sr-live').textContent = `Objetivo cumplido. Nuevos objetivos: ${list.map((o) => o.text).join('; ')}`;
  }
  lastObjectives = sig;
}

export function objectivesNode(state: GameState): HTMLElement {
  const list = activeObjectives(state);
  // 2.3: la meta del escenario (mientras dura), antes que los objetivos de siempre.
  const sc = scenarioStatus(state);
  const goal = sc
    ? h('p', { class: 'scenario-goal', 'data-scenario': sc.id }, h('strong', {}, `${sc.name}: `), sc.goal, h('br', {}), h('small', {}, `${sc.progress}. ${sc.monthsLeft === 1 ? 'Queda 1 mes' : `Quedan ${sc.monthsLeft} meses`}.`))
    : '';
  if (!list.length) return h('div', {}, goal, h('p', { class: 'muted' }, 'Todos los objetivos cumplidos.'));
  return h('div', {}, goal, h('ul', { class: 'obj-list' }, ...list.map((o) => h('li', {}, `○ ${o.text}`, h('small', {}, ` +${money(o.reward)}${o.unlock ? ' y un edificio' : ''}`)))));
}

/** Retrato de un vecino (12×18 píxeles) a la escala pedida. */
export function portraitCanvas(id: number, scale: number, cls = 'portrait'): HTMLCanvasElement {
  const face = h('canvas', { class: cls, width: String(12 * scale), height: String(18 * scale), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const g = face.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = false;
    g.drawImage(portraitSprite(id % 64), 0, 0, 12 * scale, 18 * scale);
  }
  return face;
}

/** Lo que se guarda de cada visita (en este navegador). `at` es la hora real (solo para saber cuánto faltó). */
interface Seen {
  tick: number;
  pop: number;
  treasury: number;
  at?: number;
  rank?: number;
}

const seenOf = (state: GameState): Seen => ({ tick: state.tick, pop: state.citizens.length, treasury: state.treasury, at: Date.now(), rank: state.rank?.level ?? 0 });

/** 2.1: tiempo real fuera para enseñar «Mientras no estabas» aunque el pueblo no avanzara (se para al salir). */
export const AWAY_MS = 30 * 60_000;

/**
 * «Mientras no estabas» (2.1): desde cuándo contar al volver a la partida, o
 * null si no toca (primera visita, o se fue hace poco y no ha pasado nada).
 * Si el pueblo no avanzó (el juego se para al salir), se repasa la última semana.
 */
export function resumeSummary(token: string, state: GameState): AwaySince | null {
  const key = `bitopolis.seen.${token}`;
  let seen: Seen | null;
  try {
    seen = JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    seen = null;
  }
  try {
    localStorage.setItem(key, JSON.stringify(seenOf(state)));
  } catch {
    /* sin almacenamiento */
  }
  if (!seen || seen.tick > state.tick) return null;
  const advanced = seen.tick < state.tick;
  if (!advanced && Date.now() - (seen.at ?? 0) < AWAY_MS) return null;
  return {
    tick: advanced ? seen.tick : Math.max(0, state.tick - 7 * 24),
    pop: seen.pop,
    treasury: seen.treasury,
    advanced,
    rank: seen.rank ?? state.rank?.level ?? 0,
  };
}

export function rememberSeen(token: string, state: GameState): void {
  try {
    localStorage.setItem(`bitopolis.seen.${token}`, JSON.stringify(seenOf(state)));
  } catch {
    /* sin almacenamiento */
  }
}

export type { Citizen };
