import { h, sheet } from './ui.ts';
import { prefs } from './prefs.ts';

/** 2.8 (ronda 24): título de la chuleta (la tecla «?» la abre y la cierra). */
export const SHORTCUTS_TITLE = 'Atajos de teclado';

const row = (keys: string[], what: string) =>
  h(
    'li',
    { class: 'kb-row' },
    h('span', { class: 'kb-keys' }, ...keys.flatMap((k, i) => (i ? [' ', h('kbd', {}, k)] : [h('kbd', {}, k)]))),
    h('span', { class: 'kb-what' }, what),
  );

const group = (title: string, rows: HTMLElement[]) => h('section', { class: 'kb-group' }, h('h3', {}, title), h('ul', { class: 'kb-list' }, ...rows));

/** La chuleta con todos los atajos (ratón y teclado). Las teclas de herramientas salen de `TOOLS`. */
export function openShortcuts(tools: readonly { label: string; key: string }[]): HTMLElement {
  const on = prefs().shortcuts;
  const toolRows = tools.filter((t) => t.key).map((t) => row([t.key.toUpperCase()], t.label));
  return sheet(
    SHORTCUTS_TITLE,
    on
      ? ''
      : h('p', { class: 'warn-box', 'data-test': 'keys-off' }, 'Los atajos de una tecla están quitados en Ajustes: solo valen Espacio, Esc, Inicio, las flechas y el ratón.'),
    group('Tiempo', [
      row(['Espacio'], 'Pausar o seguir'),
      row(['<', '>'], 'Más despacio o más deprisa'),
      row(['Mayús+1', 'Mayús+2', 'Mayús+3'], 'x1, x3 o x10'),
    ]),
    group('Paneles', [
      row(['Mayús+P'], 'Pueblo'),
      row(['Mayús+A'], 'Avisos (la campana)'),
      row(['O'], 'Ajustes'),
      row(['L'], 'Cambiar de capa'),
      row(['?'], 'Esta lista'),
      row(['Esc'], 'Cerrar o volver atrás'),
    ]),
    group('Mapa', [
      row(['Rueda'], 'Acercar o alejar hacia el puntero'),
      row(['+', '−'], 'Acercar o alejar'),
      row(['W', 'A', 'S', 'D'], 'Mover el mapa (también las flechas)'),
      row(['Arrastrar'], 'Mover el mapa (en «Mirar»; o con el botón derecho)'),
      row(['Clic derecho'], 'Cancelar la obra o la herramienta'),
      row(['Inicio'], 'Volver al ayuntamiento'),
      row(['Flechas', 'Intro'], 'Con el mapa enfocado (Tab): ir casilla a casilla y abrirla'),
    ]),
    group('Herramientas', toolRows),
  );
}
