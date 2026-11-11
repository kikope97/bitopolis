import type { GameState } from '@bitopolis/sim';
import type { ToolId } from './tools.ts';
import { prefs } from './prefs.ts';
import { $, confirmDialog, h } from './ui.ts';
import { buildTabShows, coarse, onceGet, onceSet, tabName, verbo, whereOf } from './wording.ts';

/** Tutorial guiado (~3 min): una flecha señala qué tocar. */
interface Step {
  /** Texto; puede depender del puntero (ratón o dedo), de la herramienta y de cómo se ven las pestañas. */
  text: string | ((tool: ToolId) => string);
  /** Selector del elemento al que apunta la flecha (o null: el mapa). */
  target: (tool: ToolId) => string | null;
  done: (s: GameState, tool: ToolId, ctx: Ctx) => boolean;
  /** v1.9.1: algo del mapa que hay que encontrar (destella y la cámara va allí). */
  focus?: 'townhall';
  /** 2.7: el paso solo informa (no pide tocar nada ahora): lleva «Siguiente», que lo guarda hasta el paso siguiente. */
  info?: boolean;
}

interface Ctx {
  roads0: number;
}

const roadCount = (s: GameState) => s.map.tiles.filter((t) => t === 1).length;
/** v1.6: las obras están en la bandeja «Construir»: primero la pestaña, luego la casilla. */
const inTray = (id: string) => (document.querySelector('#tray:not([hidden])') ? `#tray [data-tool="${id}"]` : '#tab-build');
const has = (s: GameState, k: string) => s.buildings.some((b) => b.kind === k);

/**
 * 2.8: el tutorial habla como la pantalla: el nombre que se ve en la pestaña
 * («Carretera» o «Calle»), dónde está el dock («abajo» o «a la derecha») y «toca» o «haz clic».
 */
const dock = () => whereOf('#dock');
const Verbo = () => verbo({ cap: true });
/** «abre «Construir»» (u «Obras»); si la pestaña enseña la herramienta elegida, lo dice. */
const openBuild = (cap = false) => {
  const shows = buildTabShows();
  return `${cap ? 'Abre' : 'abre'} «${tabName('build')}»${shows ? ` (ahora pone «${shows}»)` : ''}`;
};
/** En modo tranquilo solo hay x1. */
const calmOnly = () => prefs().calm;

const STEPS: Step[] = [
  {
    text: () => {
      const road = tabName('road');
      // Con el nombre corto («Calle»), se dice también qué es (la carretera).
      return road === 'Carretera'
        ? `Bienvenido, alcalde. El tiempo está parado. ${Verbo()} «Carretera», ${dock()}.`
        : `Bienvenido, alcalde. El tiempo está parado. Carretera: ${verbo()} «${road}», ${dock()}.`;
    },
    target: () => '[data-tool="road"]',
    done: (s, tool, c) => tool === 'road' || roadCount(s) > c.roads0,
  },
  {
    // Con ratón no hay barra «Construir»: se confirma con un segundo clic en el final.
    text: () =>
      coarse()
        ? 'Toca el final de la calle del ayuntamiento y luego dónde quieres que acabe. Confirma con «Construir».'
        : 'Haz clic en el final de la calle del ayuntamiento y luego dónde quieres que acabe. Haz clic otra vez en el final para confirmar.',
    target: () => null,
    done: (s, _t, c) => roadCount(s) > c.roads0,
  },
  {
    text: (tool) =>
      tool === 'water'
        ? `Ahora el agua: ${verbo()} una casilla junto a la carretera.`
        : `Ahora el agua: ${openBuild()}, elige «Agua» y ${verbo()} una casilla junto a la carretera.`,
    target: (tool) => (tool === 'water' ? null : inTray('water')),
    done: (s) => has(s, 'water'),
  },
  {
    text: (tool) => (tool === 'power' ? `Y la luz: ${verbo()} una casilla junto a la carretera.` : `Y la luz: «${tabName('build')}» › «Luz», junto a la carretera.`),
    target: (tool) => (tool === 'power' ? null : inTray('power')),
    done: (s) => has(s, 'power'),
  },
  {
    text: (tool) => (tool === 'house' ? `Ahora ${verbo()} una casilla junto a la carretera para la «Casa».` : `Construye una «Casa» (en «${tabName('build')}») para que llegue gente.`),
    target: (tool) => (tool === 'house' ? null : inTray('house')),
    done: (s) => has(s, 'house'),
  },
  {
    // 2.8: en modo tranquilo solo hay x1: no se pide acelerar.
    text: () =>
      calmOnly()
        ? 'Las obras tardan unos días. Pon el tiempo en marcha con ▶ (arriba). En modo tranquilo va siempre a x1.'
        : 'Las obras tardan unos días. Pon el tiempo en marcha con ▶ (arriba) y acelera con x3, al lado.',
    target: () => '#play-pause',
    done: (s) => s.citizens.length >= 2,
  },
  {
    text: () => `¡Ya tienes vecinos! Con 10 podrás ampliar el ayuntamiento (el edificio del centro) y desbloquear las zonas R, C e I: en la franja de ${whereOf('#strip')} ves cuántos faltan. Si dudas, pulsa «?».`,
    target: () => null,
    done: (s) => s.citizens.length >= 10,
    info: true,
  },
  {
    // v1.8: el ayuntamiento por niveles.
    text: () => `${Verbo()} el ayuntamiento (el edificio que destella, en el centro) y pulsa «Ampliar a nivel 2»: desbloquea las zonas, el colegio, la policía y los plenos.`,
    target: () => null,
    done: (s) => (s.townhallLevel ?? 1) >= 2,
    focus: 'townhall',
  },
  {
    // Ronda 12: el paso anterior no se cerraba nunca; ahora llega el momento del desbloqueo.
    text: (tool) =>
      tool === 'zoneR'
        ? `Marca un rectángulo junto a la carretera (${coarse() ? 'toca una esquina y luego la otra' : 'arrastra de una esquina a la otra'}): los vecinos construirán sus casas.`
        : `¡Zonas desbloqueadas! ${openBuild(true)}, elige «Zona R» y marca un rectángulo junto a la carretera: los vecinos construirán sus casas.`,
    target: (tool) => (tool === 'zoneR' ? null : inTray('zoneR')),
    done: (s) => s.map.zones.some((z) => z === 1),
  },
  {
    // 2.8 (informe 01): la C, la I y las cifras de la franja no se explicaban nunca. Se cierra con «Entendido».
    text: () =>
      `R son casas, C tiendas e I talleres y fábricas (empleo). En la franja de ${whereOf('#strip')}, «R +24» dice cuánta falta hace cada zona: cuanto más larga la barra, más hace falta; en negativo, sobra. ${Verbo()} la franja para ver el detalle.`,
    target: () => '#strip-info',
    done: () => false,
  },
];

/** Pasos de obras que se pueden comprobar en el pueblo (agua, luz, casa). */
const FIRST_BUILD_STEP = 2;
const LAST_BUILD_STEP = 4;

export class Tutorial {
  private step = 0;
  private ctx: Ctx = { roads0: 0 };
  private box: HTMLElement;
  private arrow: HTMLElement;
  private skip: HTMLButtonElement;
  private next: HTMLButtonElement;
  /** Paso informativo que ya se leyó («Siguiente»): la caja no sale hasta el paso siguiente. */
  private dismissed = -1;
  private started = false;
  /** Último paso cuyo `focus` ya se enseñó (para no mover la cámara en cada refresco). */
  private focused = -1;
  /** Lo pone game.ts: destaca en el mapa lo que pide el paso. */
  onFocus: ((what: 'townhall') => void) | null = null;

  /** 2.8: la partida (para guardar el «Siguiente» en este navegador; antes vivía solo en memoria). */
  private token: string;

  constructor(private storageKey: string, token?: string) {
    this.token = token ?? storageKey.replace(/^bitopolis\.tut\./, '');
    this.arrow = h('div', { class: 'tut-arrow', 'aria-hidden': 'true' }, '▼');
    this.skip = h('button', { class: 'tut-skip' }, 'Saltar');
    this.next = h('button', { class: 'tut-next' }, 'Siguiente');
    this.next.addEventListener('click', () => {
      this.dismissed = this.step;
      onceSet(this.token, 'tutSeen', this.step);
      this.box.hidden = true;
      document.documentElement.style.setProperty('--tut-h', '0px');
    });
    // Ronda 12: un toque al mapa caía en «Saltar» y el tutorial se perdía; ahora se pregunta.
    this.skip.addEventListener('click', async () => {
      if (this.step >= STEPS.length - 1 || (await confirmDialog('¿Saltar el tutorial?', 'Puedes repetirlo desde Pueblo › Repetir tutorial.', 'Saltar'))) this.finish();
    });
    // 2.7: los botones van juntos a un lado, separados del texto (un toque al mapa caía en «Saltar»).
    this.box = h('div', { class: 'tut-box', role: 'status', 'aria-live': 'polite' }, h('p', {}), h('div', { class: 'tut-actions' }, this.skip));
    try {
      const v = localStorage.getItem(storageKey);
      this.step = v === 'done' ? STEPS.length : Number(v ?? 0) || 0;
    } catch {
      this.step = 0;
    }
  }

  get active() {
    return this.step < STEPS.length;
  }

  /** Qué hay que encontrar en el mapa en el paso actual (o null). */
  get focus(): 'townhall' | null {
    return (this.active && this.started && STEPS[this.step]!.focus) || null;
  }

  start(state: GameState, fromScratch = false) {
    this.focused = -1;
    // 2.8: el paso informativo ya leído no vuelve al abrir la partida otra vez (informes 01, 03, 04).
    this.dismissed = fromScratch ? -1 : (onceGet(this.token, 'tutSeen') ?? -1);
    if (fromScratch) {
      this.step = 0;
      onceSet(this.token, 'tutSeen', -1);
    } else if (this.step === 0 && state.citizens.length >= 10) {
      // Un pueblo ya hecho (importado o de otra partida) no empieza el tutorial desde cero (ronda 11).
      this.finish();
      return;
    }
    this.started = true;
    this.ctx.roads0 = roadCount(state);
    // v1.6: al volver, se saltan los pasos que el pueblo ya tiene hechos (antes empezaba en «Bienvenido»).
    if (!fromScratch && (has(state, 'water') || has(state, 'power') || has(state, 'house'))) this.step = Math.max(this.step, 2);
    // El paso guardado nunca va por delante del pueblo: si falta el agua (o la luz, o la casa) de un
    // paso ya pasado, se vuelve a él (p. ej. una partida que no llegó a guardarse).
    if (!fromScratch) {
      const was = this.step;
      while (this.step > FIRST_BUILD_STEP && this.step <= LAST_BUILD_STEP + 1 && !STEPS[this.step - 1]!.done(state, 'inspect', this.ctx)) this.step--;
      if (this.step !== was) this.save();
    }
    while (!fromScratch && this.step > 1 && this.active && this.step < STEPS.length - 1 && STEPS[this.step]!.done(state, 'inspect', this.ctx)) this.step++;
    if (this.active) {
      $('#app').append(this.box, this.arrow);
    }
  }

  private save() {
    try {
      localStorage.setItem(this.storageKey, this.active ? String(this.step) : 'done');
    } catch {
      /* sin almacenamiento: el tutorial se repetirá */
    }
  }

  finish() {
    this.mark(null);
    this.step = STEPS.length;
    this.box.remove();
    this.arrow.remove();
    document.documentElement.style.setProperty('--tut-h', '0px');
    this.save();
  }

  update(state: GameState, tool: ToolId) {
    if (!this.active || !this.started) return;
    const s = STEPS[this.step]!;
    if (s.done(state, tool, this.ctx)) {
      this.step++;
      this.save();
      if (!this.active) return this.finish();
    }
    // Último paso: sin cierre automático; se cierra con «Entendido».
    this.skip.textContent = this.step === STEPS.length - 1 ? 'Entendido' : 'Saltar';
    const cur = STEPS[this.step]!;
    // «Siguiente» solo en los pasos que informan (y fuera del DOM en los demás: un solo botón en la caja).
    if (cur.info && !this.next.isConnected) this.skip.before(this.next);
    else if (!cur.info && this.next.isConnected) this.next.remove();
    const hide = this.dismissed === this.step;
    if (this.box.hidden !== hide) this.box.hidden = hide;
    if (hide) {
      document.documentElement.style.setProperty('--tut-h', '0px');
      this.mark(null);
      this.arrow.hidden = true;
      return;
    }
    if (cur.focus && this.focused !== this.step) {
      this.focused = this.step;
      this.onFocus?.(cur.focus);
    }
    const p = this.box.querySelector('p')!;
    const text = typeof cur.text === 'function' ? cur.text(tool) : cur.text;
    if (p.textContent !== text) p.textContent = text;
    // Los botones del mapa suben por encima de la caja (ronda 12: la caja tapaba «Capas» y «?»).
    if (this.box.isConnected) document.documentElement.style.setProperty('--tut-h', `${this.box.offsetHeight + 8}px`);
    const sel = cur.target(tool);
    const target = sel ? document.querySelector<HTMLElement>(sel) : null;
    this.mark(target);
    if (!target) {
      this.arrow.hidden = true;
      return;
    }
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const r = target.getBoundingClientRect();
    // Botones de la barra de arriba (▶): la flecha apunta hacia arriba, por debajo del botón (encima del mapa, sin texto).
    const up = !!target.closest('.topbar');
    // Ronda 21: abajo (pestañas, bandeja) la flecha flotante pisaba la franja («Z▼as») y los títulos de la bandeja.
    // Ahora el propio botón lleva el marco y una flecha pequeña en su borde de arriba (tut-target, style.css).
    this.arrow.hidden = !up;
    if (!up) return;
    this.arrow.style.left = `${Math.round(r.left + r.width / 2 - 12)}px`;
    this.arrow.textContent = '▲';
    this.arrow.style.top = `${Math.round(r.bottom + 6)}px`;
  }

  /** Marca el elemento señalado (y desmarca el anterior). */
  private marked: HTMLElement | null = null;
  private mark(el: HTMLElement | null) {
    if (this.marked === el) return;
    this.marked?.classList.remove('tut-target');
    this.marked = el;
    el?.classList.add('tut-target');
  }
}
