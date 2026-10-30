import { sfx, unlockAudio } from './audio.ts';
import { type Prefs, prefs, setPrefs } from './prefs.ts';
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

function toggle(label: string, key: 'sfx' | 'music' | 'vibrate' | 'calm', help?: string): HTMLElement {
  const input = h('input', { type: 'checkbox', ...(prefs()[key] ? { checked: true } : {}) }) as HTMLInputElement;
  input.addEventListener('change', () => {
    unlockAudio();
    setPrefs({ [key]: input.checked } as Partial<Prefs>);
    if (key === 'sfx' && input.checked) sfx.tap();
  });
  return h('label', { class: 'check' }, input, h('span', {}, label, help ? h('small', { class: 'help' }, ` ${help}`) : ''));
}

/** Ajustes de este dispositivo: sonido, vibración y accesibilidad (spec §8.2, §8.4). */
export function openSettings(): void {
  const p = prefs();
  sheet(
    'Ajustes',
    h('h3', {}, 'Sonido'),
    toggle('Efectos de sonido', 'sfx'),
    toggle('Música y ambiente', 'music'),
    toggle('Vibración', 'vibrate', '(en móviles que la admiten)'),
    h('h3', {}, 'Lectura'),
    radioGroup<Prefs['text']>(
      'Tamaño del texto',
      [
        [100, '100 %'],
        [150, '150 %'],
        [200, '200 %'],
      ],
      p.text,
      (v) => setPrefs({ text: v }),
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
    h('h3', {}, 'Ritmo y movimiento'),
    toggle('Modo tranquilo', 'calm', '(velocidad x1, pausa en los eventos importantes y avisos sin tiempo límite)'),
    radioGroup<Prefs['motion']>(
      'Animaciones',
      [
        ['sistema', 'Según el sistema'],
        ['reducido', 'Reducidas'],
      ],
      p.motion,
      (v) => setPrefs({ motion: v }),
    ),
    h('p', { class: 'muted small' }, 'Se guardan en este dispositivo.'),
  );
}
