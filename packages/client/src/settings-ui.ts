import { sfx, unlockAudio } from './audio.ts';
import { onPrefs, type Prefs, prefs, setPrefs } from './prefs.ts';
import { h, sheet } from './ui.ts';

/**
 * Grupo de opciones con el patrón radiogroup: un solo elemento en el orden
 * de tabulación y las flechas mueven la selección (WAI-ARIA).
 */
export function radioGroup<T extends string | number>(label: string, options: [T, string][], current: T, onPick: (v: T) => void): HTMLElement {
  const box = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map(([value, text]) => {
    const b = h('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(value === current), tabindex: value === current ? '0' : '-1' }, text);
    b.addEventListener('click', () => select(value));
    return b;
  });
  const select = (value: T) => {
    buttons.forEach((b, i) => {
      const on = options[i]![0] === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) b.focus();
    });
    onPick(value);
  };
  box.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (i + d + options.length) % options.length;
    select(options[n]![0]);
  });
  box.append(...buttons);
  return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), box);
}

function toggle(label: string, key: 'sfx' | 'music' | 'ambience' | 'vibrate' | 'calm' | 'shortcuts' | 'fullHub', help?: string): HTMLElement {
  const input = h('input', { type: 'checkbox', ...(prefs()[key] ? { checked: true } : {}) }) as HTMLInputElement;
  input.addEventListener('change', () => {
    unlockAudio();
    setPrefs({ [key]: input.checked } as Partial<Prefs>);
    if (key === 'sfx' && input.checked) sfx.tap();
  });
  return h('label', { class: 'check' }, input, h('span', {}, label, help ? h('small', { class: 'help' }, ` ${help}`) : ''));
}

/** Control de volumen en decibelios (el oído es logarítmico). */
function volume(label: string, key: 'sfxDb' | 'musicDb' | 'ambDb', bus: 'sfx' | 'music' | 'ambience'): HTMLElement {
  const text = (db: number) => (db <= -40 ? 'silencio' : `${db} dB`);
  // El valor ya lo da aria-valuetext: el <output> visible se oculta al lector (no se repite).
  const out = h('output', { 'aria-hidden': 'true' }, text(prefs()[key]));
  const input = h('input', { type: 'range', min: '-40', max: '0', step: '1', value: String(prefs()[key]), 'aria-valuetext': text(prefs()[key]), ...(prefs()[bus] ? {} : { disabled: true }) }) as HTMLInputElement;
  // Con el interruptor apagado, el volumen no se toca.
  const off = onPrefs((p) => {
    if (!input.isConnected) return off();
    input.disabled = !p[bus];
  });
  input.addEventListener('input', () => {
    const db = Number(input.value);
    out.textContent = text(db);
    input.setAttribute('aria-valuetext', text(db));
    setPrefs({ [key]: db } as Partial<Prefs>);
  });
  input.addEventListener('change', () => {
    unlockAudio();
    if (key === 'sfxDb') sfx.tap();
  });
  return h('label', { class: 'field volume' }, h('span', { class: 'field-label' }, label, ' · ', out), input);
}

/** Ajustes de este dispositivo: sonido, vibración y accesibilidad (spec §8.2, §8.4). */
/** 2.0: en Modo IA, el % de vecinos con IA de esta partida (si la key es del jugador). */
export interface AiShareCtl {
  share: number;
  locked: boolean;
  set: (share: number) => Promise<boolean>;
}

/** `share` (2.3): el bloque «Compartir el pueblo» (solo dentro de una partida). */
export function openSettings(ai?: AiShareCtl, share?: Node): void {
  const p = prefs();
  const aiBlock: (Node | string)[] = [];
  if (ai) {
    const out = h('output', {}, `${ai.share} %`);
    const range = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(ai.share), 'aria-label': 'Vecinos que piensan con IA', ...(ai.locked ? { disabled: true } : {}) }) as HTMLInputElement;
    range.addEventListener('input', () => (out.textContent = `${range.value} %`));
    range.addEventListener('change', () => void ai.set(Number(range.value)));
    aiBlock.push(
      h('h3', {}, 'IA del pueblo'),
      h('label', { class: 'field' }, 'Vecinos que piensan con IA ', out, ai.locked ? h('span', { class: 'muted small' }, ' · lo fija el servidor') : '', range),
      h('p', { class: 'muted small' }, 'Al subirlo, más vecinos pasan a decidir con la IA cada semana. Al bajarlo, solo cambia para los que lleguen. Más vecinos con IA, más gasto.'),
    );
  }
  sheet(
    'Ajustes',
    // 2.7: «Accesibilidad» primero (antes estaba al final de una hoja de ~1.800 px).
    h('h3', {}, 'Accesibilidad'),
    h('h4', { class: 'set-sub' }, 'Lectura'),
    textSizeGroup(),
    radioGroup<Prefs['font']>(
      'Letra',
      [
        ['legible', 'Legible'],
        ['pixel', 'Pixel (retro)'],
      ],
      p.font,
      (v) => setPrefs({ font: v }),
    ),
    radioGroup<Prefs['contrast']>(
      'Contraste',
      [
        ['normal', 'Normal'],
        ['alto', 'Alto'],
      ],
      p.contrast,
      (v) => setPrefs({ contrast: v }),
    ),
    radioGroup<Prefs['colorblind']>(
      'Colores para daltonismo',
      [
        ['no', 'No'],
        ['rojo-verde', 'Rojo-verde'],
        ['azul-amarillo', 'Azul-amarillo'],
      ],
      p.colorblind,
      (v) => setPrefs({ colorblind: v }),
    ),
    radioGroup<Prefs['motion']>(
      'Animaciones',
      [
        ['sistema', 'Según el sistema'],
        ['reducido', 'Reducidas'],
      ],
      p.motion,
      (v) => setPrefs({ motion: v }),
    ),
    h('h4', { class: 'set-sub' }, 'Ritmo'),
    toggle('Modo tranquilo', 'calm', '(velocidad x1, pausa en los eventos importantes y avisos sin tiempo límite)'),
    // 2.7: a x3/x10 el tiempo se frenaba solo cada poco por cosas menores.
    radioGroup<Prefs['slowFor']>(
      'A x3 y x10, bajar a x1 por',
      [
        ['emergencias', 'Solo emergencias (incendio, riada, disturbios, manifestación)'],
        ['importante', 'También ofertas, dilemas y fiestas'],
        ['nada', 'Nada (avisa sin frenar)'],
      ],
      p.slowFor,
      (v) => setPrefs({ slowFor: v }),
    ),
    h('h4', { class: 'set-sub' }, 'Teclado'),
    toggle('Atajos de una tecla', 'shortcuts', '(W A S D, L, O y las herramientas; con lector de pantalla puede ir mejor sin ellos)'),
    ...(share ? [share] : []),
    ...aiBlock,
    h('h3', {}, 'Sonido'),
    toggle('Efectos de sonido', 'sfx'),
    volume('Volumen de los efectos', 'sfxDb', 'sfx'),
    toggle('Música', 'music'),
    volume('Volumen de la música', 'musicDb', 'music'),
    toggle('Ambiente', 'ambience', '(pájaros de día, grillos de noche)'),
    volume('Volumen del ambiente', 'ambDb', 'ambience'),
    toggle('Vibración', 'vibrate', '(en móviles que la admiten)'),
    h('h3', {}, 'Panel «Pueblo»'),
    toggle('Enseñar todo desde el principio', 'fullHub', '(sin esperar a que el pueblo crezca: préstamos, política, comarca, historia…)'),
    h('p', { class: 'muted small' }, 'Se guardan en este dispositivo.'),
    // Petición del creador: la versión, abajo del todo.
    h('p', { class: 'muted small app-version' }, `Bitópolis ${__APP_VERSION__}`),
  );
}

/** 2.7: «Tamaño del texto» (en Ajustes y en la pantalla de inicio). */
export function textSizeGroup(): HTMLElement {
  return radioGroup<Prefs['text']>(
    'Tamaño del texto',
    [
      [100, '100 %'],
      [150, '150 %'],
      [200, '200 %'],
    ],
    prefs().text,
    (v) => setPrefs({ text: v }),
  );
}
