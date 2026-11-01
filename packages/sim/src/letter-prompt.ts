/**
 * 2.5 (bloque H): la carta con IA. El motor decide quién escribe, a quién, cuándo
 * y si vuelve (`postMonth`, post.ts); la IA solo redacta la carta (≤ 400) con datos
 * reales del estado, validada con `parseText` (ni cifras ni nombres inventados).
 * El texto no entra en el estado ni en el hash: el servidor lo guarda en su caché
 * y, si falla, se lee la plantilla del motor (`letterText`).
 */
import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import { POST } from './balance.ts';
import { LETTER_TIE_TEXT, letterFromName, letterText, letterTie } from './post.ts';
import { parseText, TEXT_SYSTEM, type TextRequest, toneOf } from './prompt.ts';
import { memoryText, professionOf } from './social.ts';
import type { GameState, Letter } from './state.ts';
import { seasonOf } from './weather.ts';

const SEASON_TEXT: Record<string, string> = { invierno: 'invierno', primavera: 'primavera', verano: 'verano', otono: 'otoño' };

/** Cuánto lleva fuera, en palabras (sin cifras sueltas que la IA pueda torcer). */
function awayText(ticks: number): string {
  const months = Math.floor(ticks / TICKS_PER_MONTH);
  if (months < 2) return 'poco más de un mes';
  if (months < 12) return `${months} meses`;
  const years = Math.floor(ticks / (DAYS_PER_YEAR * TICKS_PER_DAY));
  return years === 1 ? 'un año' : `${years} años`;
}

const mood = (h: number) => (h >= 70 ? 'contento' : h >= 45 ? 'regular' : 'descontento');

/** Petición para una carta guardada. Null si quien la recibe ya no está. */
export function buildLetterRequest(state: GameState, l: Letter): TextRequest | null {
  const to = state.citizens.find((c) => c.id === l.to);
  if (!to) return null;
  const d = state.departed?.find((x) => x.id === l.from);
  const back = l.template === 'vuelvo';
  const tie = letterTie(state, l.from, l.to) ?? 'amistad';
  const avg = state.citizens.length ? Math.round(state.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.length) : 0;
  // Novedades del pueblo: solo textos del motor (hitos y obras de los últimos meses).
  const news = state.events
    .filter((e) => (e.kind === 'milestone' || e.kind === 'built') && e.tick <= l.tick && l.tick - e.tick <= 3 * TICKS_PER_MONTH)
    .slice(-3)
    .map((e) => e.text);
  const date = tickToDate(l.tick);
  const data = {
    escribe: {
      nombre: letterFromName(state, l),
      ...(d ? { edad: d.age } : {}),
      fuera_desde_hace: d ? awayText(l.tick - d.tick) : 'un tiempo',
      vuelve_al_pueblo: back,
    },
    para: {
      nombre: to.name,
      edad: to.age,
      profesion: professionOf(to),
      que_les_une: LETTER_TIE_TEXT[tie],
      tono: toneOf(to),
      animo: mood(to.happiness),
      recuerdos: [...to.memories].filter((m) => m.kind !== 'carta').sort((a, b) => b.importance - a.importance).slice(0, 2).map((m) => memoryText(state, m)),
    },
    pueblo: {
      vecinos: state.citizens.length,
      animo: mood(avg),
      estacion: SEASON_TEXT[seasonOf(date.month)] ?? 'primavera',
      novedades: news,
    },
    carta_de_ejemplo: letterText(state, l),
  };
  return {
    system: `${TEXT_SYSTEM}
- Escribes la carta que manda "escribe" (que se fue del pueblo) a "para" (que sigue en él), en primera persona, cercana y con su despedida y su firma (el nombre de pila de quien escribe). Máx. ${POST.maxText} caracteres.
- Habla de lo que les une y de cómo le va fuera sin inventar nombres de sitios ni de personas. Si "vuelve_al_pueblo" es true, anuncia que vuelve; si es false, no lo anuncies.
- "carta_de_ejemplo" es solo una idea del tono: no la copies.`,
    user: JSON.stringify(data),
    schema: { type: 'object', additionalProperties: false, required: ['texto'], properties: { texto: { type: 'string', description: `máximo ${POST.maxText} caracteres` } } },
    max: POST.maxText,
  };
}

/** Valida la carta de la IA (JSON, longitud, cifras y nombres que estén en los datos). */
export function parseLetter(raw: string, req: TextRequest): string | null {
  const text = parseText(raw, req);
  return text && text.length <= POST.maxText ? text : null;
}
