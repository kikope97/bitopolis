import type { GameState } from '@bitopolis/sim';
import type { ToolId } from './tools.ts';
import { $, confirmDialog, h } from './ui.ts';

/** Tutorial guiado (~3 min): una flecha señala qué tocar. */
interface Step {
  text: string;
  /** Selector del elemento al que apunta la flecha (o null: el mapa). */
  target: (tool: ToolId) => string | null;
  done: (s: GameState, tool: ToolId, ctx: Ctx) => boolean;
  /** v1.9.1: algo del mapa que hay que encontrar (destella y la cámara va allí). */
  focus?: 'townhall';
}

interface Ctx {
  roads0: number;
}

const roadCount = (s: GameState) => s.map.tiles.filter((t) => t === 1).length;
/** v1.6: las obras están en la bandeja «Construir»: primero la pestaña, luego la casilla. */
const inTray = (id: string) => (document.querySelector('#tray:not([hidden])') ? `#tray [data-tool="${id}"]` : '#tab-build');
const has = (s: GameState, k: string) => s.buildings.some((b) => b.kind === k);

const STEPS: Step[] = [
  {
    text: 'Bienvenido, alcalde. El tiempo está parado. Toca «Carretera», abajo.',
    target: () => '[data-tool="road"]',
    done: (s, tool, c) => tool === 'road' || roadCount(s) > c.roads0,
  },
  {
    text: 'Toca el final de la calle del ayuntamiento y luego dónde quieres que acabe. Confirma con «Construir».',
    target: () => null,
    done: (s, _t, c) => roadCount(s) > c.roads0,
  },
  {
    text: 'Ahora el agua: abre «Construir», elige «Agua» y toca una casilla junto a la carretera.',
    target: (tool) => (tool === 'water' ? null : inTray('water')),
    done: (s) => has(s, 'water'),
  },
  {
    text: 'Y la luz: «Construir» › «Luz», junto a la carretera.',
    target: (tool) => (tool === 'power' ? null : inTray('power')),
    done: (s) => has(s, 'power'),
  },
  {
    text: 'Construye una «Casa» (en «Construir») para que llegue gente.',
    target: (tool) => (tool === 'house' ? null : inTray('house')),
    done: (s) => has(s, 'house'),
  },
  {
    text: 'Las obras tardan unos días. Pon el tiempo en marcha con ▶ (arriba) y acelera con x3, al lado.',
    target: () => '#play-pause',
    done: (s) => s.citizens.length >= 2,
  },
  {
    text: '¡Ya tienes vecinos! Con 10 podrás ampliar el ayuntamiento (el edificio del centro) y desbloquear las zonas R, C e I: abajo ves cuántos faltan. Si dudas, pulsa «?».',
    target: () => null,
    done: (s) => s.citizens.length >= 10,
  },
  {
    // v1.8: el ayuntamiento por niveles.
    text: 'Toca el ayuntamiento (el edificio que destella, en el centro) y pulsa «Ampliar a nivel 2»: desbloquea las zonas, el colegio, la policía y los plenos.',
    target: () => null,
    done: (s) => (s.townhallLevel ?? 1) >= 2,
    focus: 'townhall',
  },
  {
    // Ronda 12: el paso anterior no se cerraba nunca; ahora llega el momento del desbloqueo.
    text: '¡Zonas desbloqueadas! Abre «Construir», elige «Zona R» y marca un rectángulo junto a la carretera: los vecinos construirán sus casas.',
    target: (tool) => (tool === 'zoneR' ? null : inTray('zoneR')),
    done: (s) => s.map.zones.some((z) => z === 1),
  },
];

export class Tutorial {
  private step = 0;
  private ctx: Ctx = { roads0: 0 };
  private box: HTMLElement;
  private arrow: HTMLElement;
  private skip: HTMLButtonElement;
  private started = false;
  /** Último paso cuyo `focus` ya se enseñó (para no mover la cámara en cada refresco). */
  private focused = -1;
  /** Lo pone game.ts: destaca en el mapa lo que pide el paso. */
  onFocus: ((what: 'townhall') => void) | null = null;

  constructor(private storageKey: string) {
    this.arrow = h('div', { class: 'tut-arrow', 'aria-hidden': 'true' }, '▼');
    this.skip = h('button', { class: 'tut-skip' }, 'Saltar');
    // Ronda 12: un toque al mapa caía en «Saltar» y el tutorial se perdía; ahora se pregunta.
    this.skip.addEventListener('click', async () => {
      if (this.step >= STEPS.length - 1 || (await confirmDialog('¿Saltar el tutorial?', 'Puedes repetirlo desde Pueblo › Repetir tutorial.', 'Saltar'))) this.finish();
    });
    this.box = h('div', { class: 'tut-box', role: 'status', 'aria-live': 'polite' }, h('p', {}), this.skip);
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
    if (fromScratch) this.step = 0;
    // Un pueblo ya hecho (importado o de otra partida) no empieza el tutorial desde cero (ronda 11).
    else if (this.step === 0 && state.citizens.length >= 10) {
      this.finish();
      return;
    }
    this.started = true;
    this.ctx.roads0 = roadCount(state);
    // v1.6: al volver, se saltan los pasos que el pueblo ya tiene hechos (antes empezaba en «Bienvenido»).
    if (!fromScratch && (has(state, 'water') || has(state, 'power') || has(state, 'house'))) this.step = Math.max(this.step, 2);
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
    if (cur.focus && this.focused !== this.step) {
      this.focused = this.step;
      this.onFocus?.(cur.focus);
    }
    const p = this.box.querySelector('p')!;
    if (p.textContent !== cur.text) p.textContent = cur.text;
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
    // Botones de arriba (▶): la flecha apunta hacia arriba, por debajo del botón (encima del mapa, sin texto).
    const up = r.top < window.innerHeight / 3;
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
