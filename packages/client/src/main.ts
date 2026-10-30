import type { GameState } from '@bitopolis/sim';
import { tickToDate } from '@bitopolis/shared';
import { render, TILE } from './render.ts';
import type { FromWorker, ToWorker } from './sim.worker.ts';
import SimWorker from './sim.worker.ts?worker';

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const ctx = canvas.getContext('2d')!;
const worker = new SimWorker();
const send = (m: ToWorker) => worker.postMessage(m);

let state: GameState | null = null;
const cam = { x: 0, y: 0, zoom: 2 };
const fmt = new Intl.NumberFormat('es-ES');

function resize() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  cam.zoom = 2 * dpr;
  if (state) center();
  draw();
}

function center() {
  if (!state) return;
  const s = TILE * cam.zoom;
  cam.x = Math.round((state.map.w * s - canvas.width) / 2);
  cam.y = Math.round((state.map.h * s - canvas.height) / 2);
}

function draw() {
  if (!state) return;
  render(ctx, state, cam);
  const d = tickToDate(state.tick);
  document.querySelector('#hud-date')!.textContent = `Año ${d.year} · ${d.day}/${d.month}`;
  document.querySelector('#hud-money')!.textContent = `${fmt.format(state.treasury)} €`;
  document.querySelector('#hud-pop')!.textContent = `${state.citizens.length} vecinos`;
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  if (e.data.type === 'state') {
    const first = state === null;
    state = e.data.state;
    if (first) center();
    draw();
  }
};

for (const btn of document.querySelectorAll<HTMLButtonElement>('.speed button')) {
  btn.addEventListener('click', () => {
    const speed = Number(btn.dataset.speed);
    send({ type: 'speed', speed });
    for (const b of document.querySelectorAll('.speed button')) b.setAttribute('aria-pressed', String(b === btn));
  });
}
document.querySelector('.speed button[data-speed="1"]')!.setAttribute('aria-pressed', 'true');

window.addEventListener('resize', resize);
send({ type: 'init', seed: 42 });
resize();
