/// <reference lib="webworker" />
import { REAL_MS_PER_DAY_AT_X1, TICKS_PER_DAY, type Command } from '@bitopolis/shared';
import { applyCommand, createInitialState, type GameState, step } from '@bitopolis/sim';

/** La simulación corre aquí, fuera del hilo principal. */
export type ToWorker =
  | { type: 'init'; seed: number }
  | { type: 'speed'; speed: number }
  | { type: 'command'; cmd: Command };
export type FromWorker = { type: 'state'; state: GameState } | { type: 'rejected'; error: string };

let state: GameState | null = null;
let speed = 1;
let acc = 0;
let last = performance.now();

const post = (m: FromWorker) => postMessage(m);

function loop() {
  const now = performance.now();
  const dt = Math.min(now - last, 1000);
  last = now;
  if (state && speed > 0) {
    acc += (dt * speed * TICKS_PER_DAY) / REAL_MS_PER_DAY_AT_X1;
    let advanced = false;
    while (acc >= 1) {
      step(state);
      acc -= 1;
      advanced = true;
    }
    if (advanced) post({ type: 'state', state });
  }
  setTimeout(loop, 50);
}

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    state = createInitialState({ seed: m.seed });
    post({ type: 'state', state });
  } else if (m.type === 'speed') {
    speed = m.speed;
  } else if (m.type === 'command' && state) {
    const r = applyCommand(state, m.cmd);
    if (!r.ok) post({ type: 'rejected', error: r.error });
    post({ type: 'state', state });
  }
};
loop();
