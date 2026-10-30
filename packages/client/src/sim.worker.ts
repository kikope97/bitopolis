/// <reference lib="webworker" />
import { REAL_MS_PER_DAY_AT_X1, TICKS_PER_DAY, type Command, type TimedCommand } from '@bitopolis/shared';
import { applyCommand, type GameState, hashState, migrate, step } from '@bitopolis/sim';

/** La simulación corre aquí, fuera del hilo principal. */
export type ToWorker =
  | { type: 'init'; state: unknown }
  | { type: 'speed'; speed: number }
  | { type: 'command'; cmd: Command; id: number }
  /** Pide un lote de guardado con lo que haya hasta ahora. */
  | { type: 'flush' };

export interface SaveBatch {
  fromTick: number;
  toTick: number;
  commands: TimedCommand[];
  hash: string;
}

export type FromWorker =
  | { type: 'state'; state: GameState }
  | { type: 'result'; id: number; ok: boolean; error?: string }
  | { type: 'save'; batch: SaveBatch; flush: boolean };

let state: GameState | null = null;
let speed = 0;
let acc = 0;
let last = performance.now();
let dirty = false;
let lastPost = 0;
let pending: TimedCommand[] = [];
let batchFrom = 0;

const post = (m: FromWorker) => postMessage(m);

function emitSave(flush: boolean) {
  if (!state) return;
  if (!flush && state.tick === batchFrom) return;
  post({ type: 'save', flush, batch: { fromTick: batchFrom, toTick: state.tick, commands: pending, hash: hashState(state) } });
  pending = [];
  batchFrom = state.tick;
}

function loop() {
  const now = performance.now();
  const dt = Math.min(now - last, 500);
  last = now;
  if (state && speed > 0) {
    acc += (dt * speed * TICKS_PER_DAY) / REAL_MS_PER_DAY_AT_X1;
    while (acc >= 1) {
      step(state);
      acc -= 1;
      dirty = true;
      // Guardado al cerrar cada día de juego.
      if (state.tick % TICKS_PER_DAY === 0) emitSave(false);
    }
  }
  if (state && dirty && now - lastPost > 100) {
    post({ type: 'state', state });
    dirty = false;
    lastPost = now;
  }
  setTimeout(loop, 33);
}

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    state = migrate(m.state);
    pending = [];
    batchFrom = state.tick;
    acc = 0;
    post({ type: 'state', state });
  } else if (m.type === 'speed') {
    speed = m.speed;
    last = performance.now();
  } else if (m.type === 'command' && state) {
    const r = applyCommand(state, m.cmd);
    if (r.ok) {
      pending.push({ tick: state.tick, cmd: m.cmd });
      dirty = true;
    }
    post({ type: 'result', id: m.id, ok: r.ok, error: r.ok ? undefined : r.error });
    post({ type: 'state', state });
  } else if (m.type === 'flush') {
    emitSave(true);
  }
};
loop();
