import type { GameState } from '@bitopolis/sim';
import type { ToolId } from './tools.ts';
import { $, h } from './ui.ts';

/** Tutorial guiado (~3 min): una flecha señala qué tocar. */
interface Step {
  text: string;
  /** Selector del elemento al que apunta la flecha (o null: el mapa). */
  target: (tool: ToolId) => string | null;
  done: (s: GameState, tool: ToolId, ctx: Ctx) => boolean;
}

interface Ctx {
  roads0: number;
}

const roadCount = (s: GameState) => s.map.tiles.filter((t) => t === 1).length;
const has = (s: GameState, k: string) => s.buildings.some((b) => b.kind === k);

const STEPS: Step[] = [
  {
    text: 'Bienvenido, alcalde. El tiempo está parado. Toca «Carretera» (abajo).',
    target: () => '[data-tool="road"]',
    done: (s, tool, c) => tool === 'road' || roadCount(s) > c.roads0,
  },
  {
    text: 'Toca el final de la calle del ayuntamiento y luego dónde quieres que acabe (con ratón, también puedes arrastrar).',
    target: () => null,
    done: (s, _t, c) => roadCount(s) > c.roads0,
  },
  {
    text: 'Ahora el agua: toca «Agua» (abajo) y luego una casilla junto a la carretera.',
    target: (tool) => (tool === 'water' ? null : '[data-tool="water"]'),
    done: (s) => has(s, 'water'),
  },
  {
    text: 'Y la luz: «Luz», junto a la carretera.',
    target: (tool) => (tool === 'power' ? null : '[data-tool="power"]'),
    done: (s) => has(s, 'power'),
  },
  {
    text: 'Construye una «Casa» para que llegue gente.',
    target: (tool) => (tool === 'house' ? null : '[data-tool="house"]'),
    done: (s) => has(s, 'house'),
  },
  {
    text: 'Las obras tardan unos días. Pon el tiempo en marcha con ▶ (abajo a la izquierda); el botón de al lado lo acelera.',
    target: () => '#play-pause',
    done: (s) => s.citizens.length >= 2,
  },
  {
    text: '¡Ya tienes vecinos! Con 10 se desbloquean las zonas R, C e I. Si dudas, pulsa «?» (a la derecha).',
    target: () => '#whatnow',
    done: () => false,
  },
];

export class Tutorial {
  private step = 0;
  private ctx: Ctx = { roads0: 0 };
  private box: HTMLElement;
  private arrow: HTMLElement;
  private skip: HTMLButtonElement;
  private started = false;

  constructor(private storageKey: string) {
    this.arrow = h('div', { class: 'tut-arrow', 'aria-hidden': 'true' }, '▼');
    this.skip = h('button', { class: 'tut-skip' }, 'Saltar');
    this.skip.addEventListener('click', () => this.finish());
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

  start(state: GameState, fromScratch = false) {
    if (fromScratch) this.step = 0;
    // Un pueblo ya hecho (importado o de otra partida) no empieza el tutorial desde cero (ronda 11).
    else if (this.step === 0 && state.citizens.length >= 10) {
      this.finish();
      return;
    }
    this.started = true;
    this.ctx.roads0 = roadCount(state);
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
    this.step = STEPS.length;
    this.box.remove();
    this.arrow.remove();
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
    const p = this.box.querySelector('p')!;
    if (p.textContent !== cur.text) p.textContent = cur.text;
    const sel = cur.target(tool);
    const target = sel ? document.querySelector<HTMLElement>(sel) : null;
    if (!target) {
      this.arrow.hidden = true;
      return;
    }
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const r = target.getBoundingClientRect();
    this.arrow.hidden = false;
    this.arrow.style.left = `${Math.round(r.left + r.width / 2 - 12)}px`;
    this.arrow.style.top = `${Math.round(r.top - 30)}px`;
  }
}
