import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Command } from '@bitopolis/shared';
import { applyCommand, type GameState, hashState, step } from '@bitopolis/sim';
import type { LLMRequest, LLMResult } from '../src/ai/providers.ts';
import { AiService } from '../src/ai/service.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { SettingsStore } from '../src/settings.ts';
import { newGameToken } from '../src/tokens.ts';

/** 2.0: el servidor pide los turnos del pueblo por lotes y el cliente los aplica. */
const MASTER = 'clave-maestra-de-prueba-turnos-123456';
const dir = mkdtempSync(join(tmpdir(), 'bitopolis-turnos-'));
const { db } = await openDb(join(dir, 'turnos.db'));
const config = { ...loadConfig({}), dataDir: dir, clientDir: join(dir, 'x'), secret: MASTER };
const store = await SettingsStore.open(db);
const ai = new AiService(db, config, store);
let calls: LLMRequest[] = [];
/** Si es true, la primera respuesta de cada lote se deja al último vecino. */
let forget = false;
ai.providerOverride = () => ({
  async complete(req): Promise<LLMResult> {
    calls.push(req);
    if (req.user.startsWith('Director de la semana')) {
      const d = JSON.parse(req.user.slice(req.user.indexOf('\n') + 1)) as { menu: { id: string; malo: boolean }[] };
      const out = { sucesos: d.menu.filter((m) => !m.malo).slice(0, 1).map((m) => ({ id: m.id, motivo: 'Toca.' })), avisos: d.menu.filter((m) => m.malo).slice(0, 1).map((m) => ({ id: m.id, motivo: 'Se huele.' })), foco: 'Semana de obras', cronica: 'El pueblo crece y se nota en la plaza.' };
      return { text: JSON.stringify(out), usage: { in: 3000, cachedIn: 2000, out: 200 } };
    }
    const list = JSON.parse(req.user.slice(req.user.indexOf('\n') + 1)) as { vecino: number; acciones: string[] }[];
    const keep = forget && list.length > 1 ? list.slice(0, -1) : list;
    const decisiones = keep.map((v) => ({
      vecino: v.vecino,
      accion: v.acciones[0]!.split(' ')[0],
      gesto: { con: 0, tipo: 'ninguno' },
      actitud: 1,
      gasto: { donde: 'pueblo', tienda: 0, ocio: true },
      plan: { tipo: 'ninguno', necesidad: '', meses: 0 },
      pensamiento: 'Este pueblo empieza a tener vida.',
      motivo: 'Porque aquí estoy a gusto.',
    }));
    return { text: JSON.stringify({ decisiones }), usage: { in: 9000, cachedIn: 2000, out: 1500 } };
  },
});
const app = await buildApp(config, db, { store, ai });
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const SID = 'sesion_turnos_123456';

async function aiGame(extra: Record<string, unknown> = {}) {
  const token = newGameToken();
  const r = await app.inject({
    method: 'PUT',
    url: `/api/games/${token}/ai-config`,
    payload: { sessionId: SID, key: 'sk-ant-api03-turnos-abcdef', accepted: true, aiShare: 100, ...extra },
  });
  expect(r.statusCode).toBe(200);
  const claim = await app.inject({ method: 'POST', url: `/api/games/${token}/claim`, payload: { sessionId: SID } });
  return { token, state: claim.json().state as GameState };
}

/** Juega en «cliente» hasta que se abre un turno con al menos `min` vecinos y guarda en ese momento (en tramos, como el cliente). */
async function playUntilTurn(token: string, state: GameState, min = 2) {
  let from = state.tick;
  let cmds: { tick: number; cmd: Command }[] = [
    { tick: state.tick, cmd: { type: 'Build', kind: 'house', x: 26, y: 25 } },
    { tick: state.tick, cmd: { type: 'Build', kind: 'house', x: 22, y: 25 } },
  ];
  for (const c of cmds) applyCommand(state, c.cmd);
  const save = async () => {
    const r = await app.inject({
      method: 'PUT',
      url: `/api/games/${token}/save`,
      payload: { sessionId: SID, fromTick: from, toTick: state.tick, commands: cmds, hash: hashState(state), live: true },
    });
    expect(r.json()).toMatchObject({ ok: true });
    from = state.tick;
    cmds = [];
  };
  let guard = 0;
  while (!(state.ai?.turn && state.ai.turn.kind === 'semana' && state.ai.turn.ids.length >= min) && guard++ < 24 * 400) {
    step(state);
    // Un turno pequeño que no vale para la prueba: se cierra por reglas al vencer, como en el juego.
    if (state.tick - from >= 24 * 10 && state.tick % 24 === 0 && !state.ai?.turn) await save();
  }
  const t = state.ai!.turn!;
  expect(t).toBeTruthy();
  await save();
  // Se espera a que el servidor termine de pedir el turno.
  for (let i = 0; i < 100; i++) {
    const g = (await app.inject({ method: 'GET', url: `/api/games/${token}/turn/${t.n}` })).json();
    if (g.turn && g.turn.status !== 'pending') return { t, result: g };
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('el turno no llegó');
}

describe('turnos del pueblo en el servidor (2.0)', () => {
  it('al guardar con un turno abierto se pide, llega validado y se puede aplicar', async () => {
    calls = [];
    forget = false;
    const { token, state } = await aiGame();
    const { t, result } = await playUntilTurn(token, state);
    expect(result.turn.status).toBe('ready');
    expect(result.turn.acts.map((a: { vecino: number }) => a.vecino).sort()).toEqual([...t.ids].sort());
    // Modo «Calidad» (por defecto): los turnos van con el modelo bueno.
    expect(calls.find((c) => c.user.startsWith('Lote'))!.model).toBe('claude-sonnet-5-5');
    expect(result.turn.rung).toBe('calidad');
    // El director va en la misma ronda, con el modelo del director, y su respuesta llega validada.
    expect(calls.some((c) => c.user.startsWith('Director de la semana'))).toBe(true);
    expect(result.turn.director).toBeTruthy();
    expect(result.turn.chronicle).toContain('pueblo');
    // Bloque común aparte (para la caché) y nada de la key.
    expect(calls.find((c) => c.user.startsWith('Lote'))!.shared).toBeTruthy();
    expect(JSON.stringify(calls)).not.toContain('turnos-abcdef');
    expect(applyCommand(state, { type: 'TownTurn', n: t.n, acts: result.turn.acts, director: result.turn.director, focus: result.turn.focus, chronicle: result.turn.chronicle }).ok).toBe(true);
    expect(state.ai!.directed).toBe(true);
    expect(state.ai!.log.at(-1)!.chronicle).toContain('pueblo');
    expect(state.ai!.turn ?? null).toBeNull();
    expect(state.ai!.log.at(-1)!.source).toBe('ia');
    const usage = (await app.inject({ method: 'GET', url: `/api/games/${token}/ai-usage` })).json();
    expect(usage.eur).toBeGreaterThan(0);
  });

  it('a los vecinos que la IA se deja se les pregunta otra vez, solos', async () => {
    calls = [];
    forget = true;
    const { token, state } = await aiGame();
    const { t, result } = await playUntilTurn(token, state, 3);
    forget = false;
    // Lote completo y segunda pregunta solo con el que faltó.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const lots = calls.filter((c) => c.user.startsWith('Lote'));
    const second = JSON.parse(lots.at(-1)!.user.slice(lots.at(-1)!.user.indexOf('\n') + 1)) as unknown[];
    expect(second.length).toBeLessThan(t.ids.length);
    // En la segunda pregunta también falta uno (el falso siempre se deja el último), salvo si iba solo.
    expect(result.turn.answered).toBeGreaterThanOrEqual(t.ids.length - 1);
  });

  it('escalera de gasto: cerca de un tope, los turnos bajan al modelo barato; en el tope, reglas', async () => {
    calls = [];
    forget = false;
    // Tope diario de la partida: con lo que ya gastó un turno pasa del 70 %.
    const { token, state } = await aiGame({ capDay: 0.2 });
    const game = await db.selectFrom('games').select('id').where('token', '=', token).executeTakeFirstOrThrow();
    const now = new Date();
    await db
      .insertInto('ai_usage')
      .values({ game_id: game.id, ts: now.getTime(), day: now.toISOString().slice(0, 10), month: now.toISOString().slice(0, 7), kind: 'turno', model: 'x', tokens_in: 0, tokens_cached: 0, tokens_out: 0, eur: 0.15, requested: 1, valid: 1, retried: 0, status: 'ok' })
      .execute();
    const { t, result } = await playUntilTurn(token, state);
    expect(result.turn.rung).toBe('cerca del tope');
    const lots = calls.filter((c) => c.user.startsWith('Lote'));
    expect(lots.length).toBeGreaterThan(0);
    expect(lots.every((c) => c.model === 'claude-haiku-5-5')).toBe(true);
    // Cerca del tope, el director solo un turno sí y otro no (los pares).
    expect(calls.some((c) => c.user.startsWith('Director'))).toBe(t.n % 2 === 0);

    // Con el tope pasado, no se llama: el cliente suelta el reloj y deciden las reglas.
    calls = [];
    await db.updateTable('ai_usage').set({ eur: 1 }).where('game_id', '=', game.id).execute();
    const b = await aiGame({ capDay: 0.2 });
    const gb = await db.selectFrom('games').select('id').where('token', '=', b.token).executeTakeFirstOrThrow();
    await db
      .insertInto('ai_usage')
      .values({ game_id: gb.id, ts: now.getTime(), day: now.toISOString().slice(0, 10), month: now.toISOString().slice(0, 7), kind: 'turno', model: 'x', tokens_in: 0, tokens_cached: 0, tokens_out: 0, eur: 0.5, requested: 1, valid: 1, retried: 0, status: 'ok' })
      .execute();
    const r2 = await playUntilTurn(b.token, b.state);
    expect(calls.filter((c) => c.user.startsWith('Lote') || c.user.startsWith('Director'))).toHaveLength(0);
    expect(r2.result.turn.status).toBe('failed');
    expect(r2.result.capped).toBe(true);
  });
});
