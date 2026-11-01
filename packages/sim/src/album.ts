import { TICKS_PER_DAY } from '@bitopolis/shared';
import type { GameState } from './state.ts';

/**
 * v1.7: álbum del pueblo. Al cerrar el día se repasan los sucesos y los
 * momentos clave quedan como «fotos»: qué pasó, cuándo y dónde (para que el
 * cliente pueda enseñar ese rincón del mapa).
 */
export interface Moment {
  tick: number;
  kind: string;
  text: string;
  x: number;
  y: number;
}

const ALBUM_MAX = 80;
const POP_STEPS = [10, 25, 50, 100, 150, 200, 300];
/** Primer edificio de cada tipo que merece foto. */
const FIRST_KINDS: Record<string, string> = {
  house: 'La primera casa municipal',
  park: 'El primer parque',
  school: 'Abre el colegio',
  clinic: 'Abre el centro de salud',
  police: 'Abre la comisaría',
  plaza: 'Se inaugura la Plaza Mayor',
  market: 'Abre el Mercado',
  bar: 'Abre el bar del pueblo',
  chapel: 'Se bendice la ermita',
  cemetery: 'Se abre el cementerio',
  library: 'Abre la biblioteca',
  sports: 'Abre el polideportivo',
};

/** 2.2: un momento que no sale de los sucesos del día (la primera cosecha se vende al cerrar el mes). */
export function addMoment(state: GameState, kind: string, text: string, at: { x: number; y: number }, unique = true): void {
  if (state.album) add(state, kind, text, at, unique);
}

function add(state: GameState, kind: string, text: string, at: { x: number; y: number }, unique: boolean): void {
  if (unique && state.album.some((m) => m.kind === kind)) return;
  state.album.push({ tick: state.tick, kind, text, x: at.x, y: at.y });
  if (state.album.length > ALBUM_MAX) {
    // Se quitan antes los repetibles (riadas, despedidas) que los «primeros» y los rangos.
    const i = state.album.findIndex((m) => !m.kind.startsWith('primer') && !m.kind.startsWith('rango_'));
    state.album.splice(i >= 0 ? i : 0, 1);
  }
}

/** Cada día: los momentos de hoy al álbum. */
export function albumDay(state: GameState): void {
  if (!state.album) return;
  const since = state.tick - TICKS_PER_DAY;
  const hall = state.buildings.find((b) => b.kind === 'townhall') ?? { x: Math.floor(state.map.w / 2), y: Math.floor(state.map.h / 2) };
  const where = (ref?: number) => {
    if (ref === undefined) return hall;
    const b = state.buildings.find((x) => x.id === ref);
    if (b) return b;
    const c = state.citizens.find((x) => x.id === ref);
    const home = c ? state.buildings.find((x) => x.id === c.homeId) : undefined;
    return home ?? hall;
  };
  for (const e of state.events) {
    if (e.tick <= since) continue;
    if (e.kind === 'built' && e.ref !== undefined) {
      const b = state.buildings.find((x) => x.id === e.ref);
      if (b && FIRST_KINDS[b.kind]) add(state, `primer_${b.kind}`, FIRST_KINDS[b.kind]!, b, true);
    } else if (e.kind === 'milestone' && /fiestas/i.test(e.text)) add(state, 'fiestas', e.text, hall, false);
    else if (e.kind === 'milestone' && e.text.startsWith('Objetivo cumplido') && /Plaza|Mercado/.test(e.text)) add(state, 'hito', e.text, hall, false);
    // 2.1: cada subida de rango, una postal (una por rango).
    else if (e.kind === 'milestone' && e.text.startsWith('¡Bitópolis ya es')) add(state, `rango_${state.rank?.level ?? 0}`, e.text.split('!')[0]!.replace(/^¡/, ''), hall, true);
    else if (e.kind === 'election') add(state, 'elecciones', e.text, hall, false);
    else if (e.text.startsWith('¡Llega un bebé')) add(state, 'primer_bebe', `Primer bebé del pueblo: ${e.text.replace(/^¡/, '').replace(/!$/, '')}`, where(e.ref), true);
    else if (e.text.startsWith('Nos ha dejado')) add(state, 'primera_despedida', e.text.split('. ')[0]!, where(e.ref), true);
    else if (e.text.startsWith('El río se desborda')) {
      // Una foto de riada al mes como mucho (las tormentas pueden durar dos días seguidos).
      if (!state.album.some((m) => m.kind === 'riada' && state.tick - m.tick < 30 * TICKS_PER_DAY)) add(state, 'riada', e.text, where(e.ref), false);
    }
    else if (e.text.startsWith('Se construye un puente')) add(state, 'primer_puente', 'El primer puente sobre el río', hall, true);
    else if (e.kind === 'protest') add(state, 'primera_manifestacion', e.text, hall, true);
    else if (e.text.startsWith('Nace la Asociación')) add(state, 'primera_asociacion', e.text.split(' (')[0]!, where(e.ref), true);
  }
  const pop = state.citizens.length;
  for (const n of POP_STEPS) {
    if (pop >= n) add(state, `primer_pob_${n}`, `El pueblo llega a ${n} vecinos`, hall, true);
  }
}
