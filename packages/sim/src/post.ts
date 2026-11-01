/**
 * 2.5 (bloque H): oficina de correos (`post`), postales de la Diputación y
 * cartas de los que se fueron (`state.letters`). Números en `POST`.
 *
 * - Sin correos, las ofertas de subvención de la Diputación llegan tarde: hay
 *   `POST.grantDaysWithout` días para responder en vez de `grantDaysWith`.
 * - Con la oficina abierta, como mucho una carta al mes: la escribe alguien que
 *   se fue (`state.departed`, no los fallecidos) a un pariente o a un amigo que
 *   sigue aquí. El estado guarda solo `{from, to, tick, template}`; el texto sale
 *   de una plantilla del motor (`letterText`) o, en Modo IA, del servidor (en su
 *   caché, fuera del estado y del hash; `buildLetterRequest` en letter-prompt.ts).
 * - Quien la recibe se alegra (+`POST.letterMood`) y la recuerda. Si el pueblo
 *   está contento y hay casa libre, a veces quien escribe vuelve (`returnChance`).
 *
 * Todo con hash de la semilla (sin dados): las partidas sin correos no cambian.
 */
import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { POST } from './balance.ts';
import type { Departed } from './family.ts';
import { familyOf } from './family.ts';
import { hash32 } from './hash.ts';
import { OUTSIDE, transfer } from './money.ts';
import { newResident } from './resident.ts';
import { addMemory, setRelation } from './social.ts';
import type { Citizen, GameState, Letter } from './state.ts';
import { pushEvent } from './state.ts';

/** La oficina de correos del pueblo (terminada y sin destrozar). */
export function postOffice(state: GameState): boolean {
  return state.buildings.some((b) => b.kind === 'post' && b.built && !b.damaged);
}

/** Días para responder a una subvención de la Diputación (civic.ts). */
export function grantOfferDays(state: GameState): number {
  return postOffice(state) ? POST.grantDaysWith : POST.grantDaysWithout;
}

/* ---------------- cartas ---------------- */

export type LetterTie = 'pareja' | 'familia' | 'amistad';
export const LETTER_TIE_TEXT: Record<LetterTie, string> = { pareja: 'su antigua pareja', familia: 'su familia', amistad: 'su amistad' };

/** Plantillas del motor (respaldo de la IA). `vuelvo` solo cuando quien escribe vuelve. */
export const LETTER_TEMPLATES = ['echo_de_menos', 'trabajo_nuevo', 'como_va', 'familia', 'fiestas', 'vuelvo'] as const;
export type LetterTemplate = (typeof LETTER_TEMPLATES)[number];

const TEMPLATE_TEXT: Record<LetterTemplate, (to: string, from: string) => string> = {
  echo_de_menos: (to, from) => `Hola, ${to}: aquí sigo, lejos, pero no hay día que no me acuerde del pueblo y de ti. Dale recuerdos a todos de mi parte. Un abrazo muy fuerte, ${from}.`,
  trabajo_nuevo: (to, from) => `${to}, ya tengo trabajo nuevo y un piso pequeño. Se vive bien, aunque echo de menos el bar y las tardes en la plaza. Escríbeme cuando puedas. ${from}.`,
  como_va: (to, from) => `¿Cómo va el pueblo, ${to}? Por aquí todo es ruido y prisas. Cuéntame qué se cuece por ahí, que me llegan pocas noticias. Un beso, ${from}.`,
  familia: (to, from) => `${to}, te escribo para decirte que estoy bien y que no os preocupéis. Cuida mucho de los tuyos; pronto iré a veros. Con todo el cariño, ${from}.`,
  fiestas: (to, from) => `${to}, este año me pierdo las fiestas otra vez y me da mucha pena. Brinda por mí y guárdame un sitio en la próxima. Un abrazo, ${from}.`,
  vuelvo: (to, from) => `${to}, he decidido volver. Me cuentan que el pueblo va bien y que hay casa libre. ¡Prepara el café, que nos vemos muy pronto! ${from}.`,
};

const firstName = (name: string) => name.split(' ')[0]!;

/** Nombre de quien escribe: ficha de `departed` o, si ya volvió, el vecino. */
export function letterFromName(state: GameState, l: Letter): string {
  return state.departed?.find((d) => d.id === l.from)?.name ?? state.citizens.find((c) => c.id === l.from)?.name ?? 'alguien que se fue';
}

export function letterToName(state: GameState, l: Letter): string {
  return state.citizens.find((c) => c.id === l.to)?.name ?? state.departed?.find((d) => d.id === l.to)?.name ?? 'un vecino';
}

/** Texto de la carta con la plantilla del motor (lo que se lee sin IA o si la IA falla). */
export function letterText(state: GameState, l: Letter): string {
  const t = (LETTER_TEMPLATES as readonly string[]).includes(l.template) ? (l.template as LetterTemplate) : 'echo_de_menos';
  return TEMPLATE_TEXT[t](firstName(letterToName(state, l)), firstName(letterFromName(state, l)));
}

/** Qué une a quien escribe con quien recibe (para la IA y la ficha). */
export function letterTie(state: GameState, from: number, to: number): LetterTie | null {
  const fam = familyOf(state, to);
  if (fam?.partner?.id === from) return 'pareja';
  if (fam && [...fam.parents, ...fam.children, ...fam.siblings, ...fam.grandchildren].some((k) => k.id === from)) return 'familia';
  const c = state.citizens.find((x) => x.id === to);
  if (c?.memories.some((m) => (m.kind === 'se_fue_amigo' || m.kind === 'paso_pagina' || m.kind === 'carta') && m.about.includes(from))) return 'amistad';
  if ((state.departed ?? []).find((d) => d.id === from)?.friends?.includes(to)) return 'amistad';
  return null;
}

/** Quién puede escribir este mes y a quién: se fue hace más de un mes (y no tantos años) y no ha escrito este año. */
export function letterCandidates(state: GameState): { from: Departed; to: Citizen; tie: LetterTie }[] {
  const out: { from: Departed; to: Citizen; tie: LetterTie }[] = [];
  const order: Record<LetterTie, number> = { pareja: 0, familia: 1, amistad: 2 };
  for (const d of state.departed ?? []) {
    if (d.reason !== 'se_fue') continue;
    const away = state.tick - d.tick;
    if (away < POST.minDays * TICKS_PER_DAY || away > POST.maxYears * DAYS_PER_YEAR * TICKS_PER_DAY) continue;
    if (state.letters.some((l) => l.from === d.id && state.tick - l.tick < POST.everyDays * TICKS_PER_DAY)) continue;
    const options = state.citizens
      .map((c) => ({ c, tie: letterTie(state, d.id, c.id) }))
      .filter((x): x is { c: Citizen; tie: LetterTie } => x.tie !== null)
      .sort((a, b) => order[a.tie] - order[b.tie] || a.c.id - b.c.id);
    if (options[0]) out.push({ from: d, to: options[0].c, tie: options[0].tie });
  }
  return out;
}

/** ¿Vuelve quien escribe? Pueblo contento, casa libre y `returnChance` por hash (sin dados). */
export function wouldReturn(state: GameState, letterId: number, freeHome: boolean): boolean {
  if (!freeHome || !state.citizens.length) return false;
  const avg = state.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.length;
  return avg > POST.returnHappiness && hash32(state.seed, letterId, 93) % 1000 < POST.returnChance * 1000;
}

/**
 * Al cerrar el mes, con la oficina abierta: como mucho una carta (y solo un mes
 * de cada dos, por hash). Devuelve el vecino que vuelve, si vuelve (tick.ts lo
 * presenta al pueblo como a cualquier recién llegado).
 */
export function postMonth(state: GameState, freeHome: boolean): Citizen | null {
  if (!postOffice(state) || !Array.isArray(state.letters)) return null;
  const month = Math.floor(state.tick / TICKS_PER_MONTH);
  const sentThisMonth = state.letters.filter((l) => Math.floor(l.tick / TICKS_PER_MONTH) === month).length;
  if (sentThisMonth >= POST.lettersPerMonth) return null;
  const list = letterCandidates(state);
  if (!list.length || hash32(state.seed, month, 61) % 2 !== 0) return null;
  const { from, to, tie } = list[hash32(state.seed, month, 62) % list.length]!;
  const id = state.nextId++;
  const back = wouldReturn(state, id, freeHome);
  const pool = LETTER_TEMPLATES.filter((t) => t !== 'vuelvo' && (t !== 'familia' || tie !== 'amistad'));
  const template: LetterTemplate = back ? 'vuelvo' : pool[hash32(state.seed, id, 63) % pool.length]!;
  const letter: Letter = { id, from: from.id, to: to.id, tick: state.tick, template };
  state.letters.push(letter);
  if (state.letters.length > POST.keep) state.letters.splice(0, state.letters.length - POST.keep);
  // Quien la recibe se alegra y lo recuerda (con el nombre de quien escribe: ya no vive aquí).
  to.happiness = Math.min(100, to.happiness + POST.letterMood);
  if (to.named) {
    addMemory(state, to, 'carta', 3, POST.letterMood, [from.id]);
    const m = to.memories.at(-1);
    if (m?.kind === 'carta') m.names = [firstName(from.name)];
  }
  pushEvent(state, 'info', `${to.name} recibe carta de ${firstName(from.name)}, que se fue del pueblo (Pueblo › Buzón)`, { ref: to.id });
  return back ? comeBack(state, from, to, tie) : null;
}

/** Quien escribió vuelve: el mismo vecino (mismo id, para el árbol), con unos ahorros y sin casa aún. */
function comeBack(state: GameState, d: Departed, to: Citizen, tie: LetterTie): Citizen {
  const years = Math.floor((state.tick - d.tick) / (DAYS_PER_YEAR * TICKS_PER_DAY));
  const c = newResident(state, { age: d.age + years });
  c.id = d.id;
  c.name = d.name;
  if (d.parents?.length) c.parents = d.parents;
  state.departed = state.departed.filter((x) => x.id !== d.id);
  state.citizens.push(c);
  transfer(state, OUTSIDE, c.id, POST.returnSavings);
  if (tie === 'amistad') setRelation(state, c, to, 'amistad', 60);
  if (c.named) {
    c.memories = c.memories.filter((m) => m.kind !== 'llego');
    addMemory(state, c, 'volvio', 4, 4);
  }
  pushEvent(state, 'arrival', `${c.name} vuelve al pueblo: se lo contó a ${firstName(to.name)} por carta`, { ref: c.id });
  return c;
}

/* ---------------- invariantes ---------------- */

export function postInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const ids = new Set<number>();
  for (const l of state.letters ?? []) {
    if (ids.has(l.id)) errors.push(`carta ${l.id} repetida`);
    ids.add(l.id);
    if (!(LETTER_TEMPLATES as readonly string[]).includes(l.template)) errors.push(`carta ${l.id} con plantilla desconocida`);
  }
  return errors;
}
