/// <reference lib="webworker" />
import { REAL_MS_PER_DAY_AT_X1, TICKS_PER_DAY, type Command, type TimedCommand } from '@bitopolis/shared';
import { applyCommand, type GameState, hashState, migrate, step } from '@bitopolis/sim';

/** La simulación corre aquí, fuera del hilo principal. */
export type ToWorker =
  | { type: 'init'; state: unknown }
  | { type: 'speed'; speed: number }
  | { type: 'command'; cmd: Command; id: number }
  /** Pide un lote de guardado con lo que haya hasta ahora. */
  | { type: 'flush' }
  /** 2.0: deja de esperar a la IA en el turno `n` (deciden las reglas al vencer). */
  | { type: 'release'; n: number };

export interface SaveBatch {
  fromTick: number;
  toTick: number;
  commands: TimedCommand[];
  hash: string;
}

/** Lo que el worker ha aplicado y aún no ha salido en un lote (desde `from` hasta `state.tick`). */
export interface Unsaved {
  from: number;
  commands: TimedCommand[];
}

export type FromWorker =
  /**
   * El estado va en JSON (2.5.1): JSON.parse en el hilo principal cuesta la mitad que deshacer el clon
   * estructurado de un objeto grande, y el stringify se paga aquí, fuera del hilo de la interfaz.
   * `unsaved` va con cada estado: si la página se cierra, el hilo principal monta con él el último lote.
   */
  | { type: 'state'; json: string; unsaved: Unsaved }
  | { type: 'result'; id: number; ok: boolean; error?: string }
  | { type: 'save'; batch: SaveBatch; flush: boolean }
  /** 2.0: el reloj espera a la IA (turno `n`). */
  | { type: 'thinking'; n: number | null };

let state: GameState | null = null;
let speed = 0;
let acc = 0;
let last = performance.now();
let dirty = false;
let lastPost = 0;
let pending: TimedCommand[] = [];
let batchFrom = 0;
/** 2.0: turnos que ya no se esperan (la IA tardó o falló) y el turno que se está esperando. */
const released = new Set<number>();
let waiting: number | null = null;

const post = (m: FromWorker) => postMessage(m);
const postState = () => state && post({ type: 'state', json: JSON.stringify(state), unsaved: { from: batchFrom, commands: pending } });

/**
 * Emite un lote con lo que haya desde el último. Solo el del cierre del día va `live` (el servidor
 * pide entonces a la IA); `force` (latido, al ocultarse) lo emite aunque esté vacío (renueva la
 * sesión). Sin `force`, solo si hay ticks u órdenes nuevas.
 */
function emitSave(live: boolean, force = false) {
  if (!state) return;
  if (!force && state.tick === batchFrom && pending.length === 0) return;
  post({ type: 'save', flush: !live, batch: { fromTick: batchFrom, toTick: state.tick, commands: pending, hash: hashState(state) } });
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
      // 2.0: el reloj no se adelanta al turno del pueblo mientras la IA piensa (como mucho
      // lo que decida el hilo principal; luego deciden las reglas al vencer).
      const t = state.ai?.turn;
      if (t && state.tick + 1 >= t.due && !released.has(t.n)) {
        acc = 0;
        if (waiting !== t.n) {
          waiting = t.n;
          post({ type: 'thinking', n: t.n });
        }
        break;
      }
      if (waiting !== null) {
        waiting = null;
        post({ type: 'thinking', n: null });
      }
      step(state);
      acc -= 1;
      dirty = true;
      // Guardado al cerrar cada día de juego.
      if (state.tick % TICKS_PER_DAY === 0) emitSave(true);
    }
  }
  if (state && dirty && now - lastPost > 150) {
    postState();
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
    postState();
  } else if (m.type === 'speed') {
    speed = m.speed;
    last = performance.now();
    // Al pausar se guarda lo jugado del día (si no, al recargar el reloj volvía al último cierre de día).
    if (speed === 0) emitSave(false);
  } else if (m.type === 'command' && state) {
    const r = applyCommand(state, m.cmd);
    if (r.ok) {
      pending.push({ tick: state.tick, cmd: m.cmd });
      dirty = true;
    }
    // 2.0: si el comando cerró el turno que se esperaba, el reloj sigue.
    if (waiting !== null && state.ai?.turn?.n !== waiting) {
      waiting = null;
      post({ type: 'thinking', n: null });
    }
    // Cada orden del jugador sale en un lote en el acto (en pausa no se cierra ningún día, y en marcha
    // podía pasar un día entero sin guardar). El servidor reproduce un lote con fromTick == toTick.
    if (r.ok) emitSave(false);
    // Luego el estado: quien espera el resultado ya ve el cambio aplicado.
    postState();
    post({ type: 'result', id: m.id, ok: r.ok, error: r.ok ? undefined : r.error });
  } else if (m.type === 'flush') {
    emitSave(false, true);
  } else if (m.type === 'release') {
    released.add(m.n);
    if (released.size > 50) released.delete(released.values().next().value!);
  }
};
loop();
