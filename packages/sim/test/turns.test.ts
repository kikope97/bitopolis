import { TICKS_PER_DAY, TICKS_PER_MONTH, type Command } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  buildTurnRequest,
  checkInvariants,
  createInitialState,
  type GameState,
  GESTURES,
  gestureCandidates,
  hashState,
  migrate,
  NEEDS,
  parseTurn,
  PLANS,
  runSimulation,
  SPEND,
  step,
  turnBatches,
  turnMenu,
  validateCommand,
} from '../src/index.ts';
import { FIRST_NAMES } from '../src/names.ts';

/** IA de pruebas: elige al azar (con su propio generador) entre todo lo que permite el menú. */
function fuzzTurn(seed: number) {
  let x = seed >>> 0 || 1;
  const rnd = (n: number) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
  return (state: GameState): Command | null => {
    const t = state.ai?.turn;
    if (!t) return null;
    const acts = t.ids
      .map((id) => state.citizens.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => {
        const menu = turnMenu(state, c).map((m) => m.accion);
        const others = gestureCandidates(state, c);
        return {
          vecino: c.id,
          accion: menu[rnd(menu.length)]!,
          gesto: { con: others.length ? others[rnd(others.length)]!.id : 0, tipo: GESTURES[rnd(GESTURES.length)]! },
          actitud: rnd(5) - 2,
          gasto: { donde: SPEND[rnd(SPEND.length)]!, tienda: 0, ocio: rnd(2) === 0 },
          plan: rnd(6) === 0 ? { tipo: PLANS[1 + rnd(PLANS.length - 1)]!, necesidad: NEEDS[rnd(NEEDS.length)]!, meses: 1 + rnd(6) } : { tipo: 'ninguno', necesidad: '', meses: 0 },
          pensamiento: 'Hoy pienso en el pueblo.',
          motivo: 'Porque toca.',
        };
      });
    return { type: 'TownTurn', n: t.n, acts };
  };
}

describe('turnos del pueblo con IA (2.0)', () => {
  it('en Modo IA se abre un turno cada semana; sin respuesta, deciden las reglas y el dinero cuadra', () => {
    const { state, report } = runSimulation({ seed: 3, days: 200, profile: 'constructor', aiMode: true, aiShare: 50, checkEveryDay: true });
    expect(report.invariantErrors).toEqual([]);
    expect(state.ai!.lastN).toBeGreaterThan(20);
    expect(state.ai!.log.every((l) => l.source === 'reglas')).toBe(true);
    // En Modo normal no hay turnos.
    const normal = runSimulation({ seed: 3, days: 30, profile: 'constructor' }).state;
    expect(normal.ai).toBeUndefined();
  }, 120_000);

  it('una IA que elige al azar entre todo lo posible durante años: dinero, deuda e invariantes intactos', () => {
    for (const seed of [1, 2, 3]) {
      const { state, report } = runSimulation({ seed, days: 900, profile: 'constructor', aiMode: true, aiShare: 100, checkEveryDay: true, onTurn: fuzzTurn(seed) });
      expect(report.invariantErrors).toEqual([]);
      expect(checkInvariants(state)).toEqual([]);
      expect(state.ai!.log.some((l) => l.source === 'ia')).toBe(true);
      expect(state.citizens.length).toBeGreaterThan(0);
    }
  }, 600_000);

  it('es determinista: reproducir los comandos (con los turnos de la IA) da el mismo estado', () => {
    const { state, report } = runSimulation({ seed: 5, days: 240, profile: 'constructor', aiMode: true, aiShare: 60, onTurn: fuzzTurn(9) });
    const s = createInitialState({ seed: 5, aiMode: true, aiShare: 60 });
    const byTick = new Map<number, Command[]>();
    for (const c of report.commands) byTick.set(c.tick, [...(byTick.get(c.tick) ?? []), c.cmd]);
    // Mismo orden que el runner: los comandos del día, luego las horas (y el turno en su hora).
    for (const c of byTick.get(0) ?? []) applyCommand(s, c);
    while (s.tick < state.tick) {
      step(s);
      for (const c of byTick.get(s.tick) ?? []) expect(applyCommand(s, c).ok).toBe(true);
    }
    expect(hashState(s)).toBe(hashState(state));
  }, 120_000);

  it('cada parte se valida: una acción que no está en el menú se ignora; un turno cerrado se rechaza', () => {
    const { state } = runSimulation({ seed: 4, days: 120, profile: 'constructor', aiMode: true, aiShare: 100 });
    // Se avanza hasta que se abra un turno.
    let guard = 0;
    while (!state.ai!.turn && guard++ < 24 * 40) step(state);
    const t = state.ai!.turn!;
    const c = state.citizens.find((x) => t.ids.includes(x.id))!;
    const job = c.jobId;
    const bad = { vecino: c.id, accion: 'fundar:banco_suizo', gesto: { con: 0, tipo: 'ninguno' }, actitud: 2, gasto: { donde: 'pueblo', tienda: 0, ocio: false }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: 'Pienso.', motivo: 'Motivo.' };
    expect(applyCommand(state, { type: 'TownTurn', n: t.n, acts: [bad] }).ok).toBe(true);
    expect(c.jobId).toBe(job);
    expect(c.attitude).toBe(2);
    expect(c.thought).toBe('Pienso.');
    expect(validateCommand(state, { type: 'TownTurn', n: t.n, acts: [] }).ok).toBe(false);
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('un ultimátum que vence sin cumplirse hace que el vecino se vaya', () => {
    const { state } = runSimulation({ seed: 2, days: 150, profile: 'constructor', aiMode: true, aiShare: 100 });
    const c = state.citizens.find((x) => x.named)!;
    c.plan = { kind: 'irse_si_no', need: 'colegio', until: state.tick + TICKS_PER_DAY, since: state.tick };
    // Sin colegio en el pueblo, para que no se cumpla.
    state.buildings = state.buildings.filter((b) => b.kind !== 'school');
    for (const x of state.citizens) if (x.jobId !== null && !state.buildings.some((b) => b.id === x.jobId)) x.jobId = null;
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) step(state);
    expect(state.citizens.includes(c)).toBe(false);
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('una medida gorda del alcalde abre una reacción rápida del pueblo', () => {
    const { state } = runSimulation({ seed: 3, days: 100, profile: 'constructor', aiMode: true, aiShare: 100 });
    // Se espera a que no haya turno abierto.
    while (state.ai!.turn) step(state);
    expect(applyCommand(state, { type: 'SetMinimumWage', level: 'high' }).ok).toBe(true);
    expect(state.ai!.quick).toContain('sueldo mínimo');
    while (state.tick % TICKS_PER_DAY !== 0) step(state);
    step(state);
    const opened = state.ai!.turn ?? state.ai!.log.at(-1);
    expect(opened).toBeTruthy();
  }, 120_000);

  it('el % de vecinos con IA: al subirlo, más vecinos con nombre; nunca baja a nadie', () => {
    const { state } = runSimulation({ seed: 6, days: 300, profile: 'constructor', aiMode: true, aiShare: 10 });
    const before = state.citizens.filter((c) => c.named).length;
    expect(applyCommand(state, { type: 'SetAiShare', share: 90 }).ok).toBe(true);
    const after = state.citizens.filter((c) => c.named).length;
    expect(after).toBeGreaterThan(before);
    expect(applyCommand(state, { type: 'SetAiShare', share: 0 }).ok).toBe(true);
    expect(state.citizens.filter((c) => c.named).length).toBe(after);
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('el prompt de un turno: bloque común igual en todos los lotes y respuesta validada', () => {
    const { state } = runSimulation({ seed: 3, days: 250, profile: 'constructor', aiMode: true, aiShare: 100 });
    while (!state.ai!.turn) step(state);
    const batches = turnBatches(state, 5);
    expect(batches.length).toBeGreaterThan(0);
    const a = buildTurnRequest(state, batches[0]!);
    const b = buildTurnRequest(state, batches.at(-1)!);
    expect(a.shared).toBe(b.shared);
    expect(a.system).toBe(b.system);
    const id = batches[0]![0]!;
    const sent = a.shared + a.user;
    const stranger = FIRST_NAMES.find((n) => !sent.includes(n))!;
    const good = JSON.stringify({ decisiones: [{ vecino: id, accion: 'seguir (nada)', gesto: { con: 0, tipo: 'ninguno' }, actitud: 9, gasto: { donde: 'pueblo', tienda: 0, ocio: true }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: `Hablo con ${stranger}.`, motivo: 'Bien.' }] });
    const r = parseTurn(good, batches[0]!, sent);
    expect(r.acts[0]!.accion).toBe('seguir');
    expect(r.acts[0]!.actitud).toBe(2);
    // Un nombre que no está en los datos se borra.
    expect(r.acts[0]!.pensamiento).toBe('');
    expect(parseTurn('no es json', batches[0]!, '').missing).toEqual(batches[0]);
  }, 120_000);

  it('migración 12→13: una partida en Modo IA recibe sus turnos (25 %)', () => {
    const { state } = runSimulation({ seed: 4, days: 60, profile: 'casual', aiMode: true });
    const old = { ...structuredClone(state), formatVersion: 12 } as Record<string, unknown>;
    delete old.ai;
    const m = migrate(old);
    expect(m.ai!.share).toBe(25);
    expect(m.ai!.next).toBeGreaterThan(m.tick);
    const normal = { ...structuredClone(runSimulation({ seed: 4, days: 10, profile: 'casual' }).state), formatVersion: 12 };
    expect(migrate(normal).ai).toBeUndefined();
    expect(TICKS_PER_MONTH).toBeGreaterThan(0);
  });
});
