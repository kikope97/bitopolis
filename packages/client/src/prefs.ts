/**
 * Preferencias del jugador (de este dispositivo): sonido, vibración y
 * accesibilidad. Se guardan en localStorage y se aplican como atributos en
 * <html>, para que el CSS y el render reaccionen sin recargar.
 */
export interface Prefs {
  sfx: boolean;
  music: boolean;
  /** Ambiente (pájaros de día, grillos de noche): bus propio, separado de la música. */
  ambience: boolean;
  /** Volumen de cada bus en decibelios (−40 a 0). */
  sfxDb: number;
  musicDb: number;
  ambDb: number;
  vibrate: boolean;
  /** Letra: legible (por defecto) o la fuente pixel propia (opción estética, spec §8.4). */
  font: 'legible' | 'pixel';
  /** Tamaño del texto (independiente del zoom del mapa). */
  text: 100 | 150 | 200;
  contrast: 'normal' | 'alto';
  /** Paleta de las capas y avisos para daltonismo. */
  colorblind: 'no' | 'rojo-verde' | 'azul-amarillo';
  /** Modo tranquilo: x1, pausa en eventos importantes y avisos sin tiempo límite. */
  calm: boolean;
  /** Movimiento: según el sistema o siempre reducido. */
  motion: 'sistema' | 'reducido';
}

const KEY = 'bitopolis.prefs';
const DEFAULTS: Prefs = { sfx: true, music: false, ambience: false, sfxDb: -9, musicDb: -22, ambDb: -28, vibrate: true, font: 'legible', text: 100, contrast: 'normal', colorblind: 'no', calm: false, motion: 'sistema' };

let current: Prefs = load();
const listeners = new Set<(p: Prefs) => void>();

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    // Migración de la preferencia antigua de vibración.
    if (localStorage.getItem('bitopolis.vibrate') === 'off') raw.vibrate = false;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function prefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  apply();
  for (const l of listeners) l(current);
}

export function onPrefs(fn: (p: Prefs) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Movimiento reducido: por el sistema, por preferencia o por el modo tranquilo. */
export function lowMotion(): boolean {
  return current.motion === 'reducido' || current.calm || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function apply(): void {
  const r = document.documentElement;
  r.dataset.text = String(current.text);
  r.dataset.font = current.font;
  r.dataset.contrast = current.contrast;
  r.dataset.colorblind = current.colorblind;
  r.dataset.motion = lowMotion() ? 'reducido' : 'normal';
}
