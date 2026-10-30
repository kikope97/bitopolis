import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyCommand, type GameState, hashState, step } from '@bitopolis/sim';
import { decryptSecret, encryptSecret, maskKey } from '../src/ai/crypto.ts';
import { ReplayProvider, type LLMRequest, type LLMResult } from '../src/ai/providers.ts';
import { AiService } from '../src/ai/service.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { newGameToken } from '../src/tokens.ts';

const MASTER = 'clave-maestra-de-prueba-1234567890';
const KEY = 'sk-test-ABCDEFGHIJKLMNOP-wxyz';

describe('cifrado de la key', () => {
  it('AES-256-GCM ida y vuelta, y falla con otra clave maestra', () => {
    const blob = encryptSecret(KEY, MASTER);
    expect(blob).not.toContain('ABCDEF');
    expect(decryptSecret(blob, MASTER)).toBe(KEY);
    expect(() => decryptSecret(blob, 'otra')).toThrow();
    expect(maskKey(KEY)).toBe('sk-…wxyz');
  });
});

/** Respuesta "buena" que elige la primera acción de cada vecino. */
function answer(req: LLMRequest, bad = false): LLMResult {
  const body = JSON.parse(req.user.split('\n\n')[0]!);
  const decisiones = body.vecinos.map((v: { vecino: number; acciones: { accion: string }[] }) => ({
    vecino: v.vecino,
    accion: bad ? 'volar' : v.acciones[0]!.accion,
    motivo: `Me apetece probar suerte aquí, ${['de verdad', 'sin duda', 'ya veremos', 'por qué no', 'claro que sí'][Math.floor(Math.random() * 5)]}.`,
  }));
  return { text: JSON.stringify({ decisiones }), usage: { in: 900, cachedIn: 0, out: 80 } };
}

const dir = mkdtempSync(join(tmpdir(), 'bitopolis-ai-'));
const { db } = await openDb(join(dir, 'ai.db'));
const config = { ...loadConfig({}), dataDir: dir, clientDir: join(dir, 'x'), masterKey: MASTER };
const ai = new AiService(db, config);
let calls: LLMRequest[] = [];
let mode: 'good' | 'bad-once' | 'bad' = 'good';
let textMode: 'ok' | 'cifras' = 'ok';
ai.providerOverride = () => ({
  async complete(req) {
    calls.push(req);
    if ((req.schema as { properties?: Record<string, unknown> }).properties?.texto) {
      const texto = textMode === 'cifras' ? 'Tenemos 99999 vecinos felices.' : 'Aquí estamos, alcalde, tirando como podemos.';
      return { text: JSON.stringify({ texto }), usage: { in: 400, cachedIn: 0, out: 40 } };
    }
    if (mode === 'bad') return answer(req, true);
    if (mode === 'bad-once') {
      mode = 'good';
      return answer(req, true);
    }
    return answer(req);
  },
});
const app = await buildApp(config, db, ai);
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const SID = 'sesion_ia_123456';

async function aiGame(caps: { capDay?: number } = {}) {
  const token = newGameToken();
  const r = await app.inject({
    method: 'PUT',
    url: `/api/games/${token}/ai-config`,
    payload: { sessionId: SID, provider: 'openai', key: KEY, accepted: true, ...caps },
  });
  expect(r.statusCode).toBe(200);
  const claim = await app.inject({ method: 'POST', url: `/api/games/${token}/claim`, payload: { sessionId: SID } });
  return { token, settings: r.json(), state: claim.json().state as GameState };
}

/** Juega en "cliente" hasta que haya un vecino con nombre pendiente y guarda. */
async function playUntilPending(token: string, state: GameState) {
  const from = state.tick;
  const cmds = [{ tick: state.tick, cmd: { type: 'Build', kind: 'house', x: 26, y: 25 } as const }];
  applyCommand(state, cmds[0]!.cmd);
  while (state.pending.length === 0) step(state);
  while (state.tick % 24 !== 0) step(state);
  const r = await app.inject({
    method: 'PUT',
    url: `/api/games/${token}/save`,
    payload: { sessionId: SID, fromTick: from, toTick: state.tick, commands: cmds, hash: hashState(state), live: true },
  });
  expect(r.json()).toMatchObject({ ok: true });
  await new Promise((res) => setTimeout(res, 50));
}

describe('Modo IA', () => {
  it('guardar la configuración crea la partida en Modo IA y la key nunca vuelve', async () => {
    const { token, settings, state } = await aiGame();
    expect(state.aiMode).toBe(true);
    expect(JSON.stringify(settings)).not.toContain('ABCDEF');
    expect(settings.keyMask).toBe('sk-…wxyz');
    const g = await app.inject({ method: 'GET', url: `/api/games/${token}/ai-config` });
    expect(g.body).not.toContain('ABCDEF');
    const ex = await app.inject({ method: 'GET', url: `/api/games/${token}/export` });
    expect(ex.rawPayload.toString('latin1')).not.toContain('ABCDEF');
    const row = await db.selectFrom('ai_config').selectAll().executeTakeFirst();
    expect(row?.key_enc).not.toContain('ABCDEF');
  });

  it('sin aceptar el aviso no se guarda', async () => {
    const r = await app.inject({ method: 'PUT', url: `/api/games/${newGameToken()}/ai-config`, payload: { sessionId: SID, provider: 'openai', key: KEY, accepted: false } });
    expect(r.statusCode).toBe(400);
  });

  it('al guardar el día se piden por adelantado las decisiones y llegan validadas', async () => {
    calls = [];
    const { token, state } = await aiGame();
    await playUntilPending(token, state);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).not.toContain(KEY);
    const d = (await app.inject({ method: 'GET', url: `/api/games/${token}/decisions` })).json();
    expect(d.decisions).toHaveLength(1);
    expect(d.decisions[0].motivo).toContain('suerte');
    const usage = (await app.inject({ method: 'GET', url: `/api/games/${token}/ai-usage` })).json();
    expect(usage.calls).toBe(1);
    expect(usage.valid).toBe(1);
    expect(usage.eur).toBeGreaterThan(0);
  });

  it('respuesta inválida: un reintento y, si vuelve a fallar, reglas', async () => {
    calls = [];
    mode = 'bad-once';
    const a = await aiGame();
    await playUntilPending(a.token, a.state);
    expect(calls).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: `/api/games/${a.token}/decisions` })).json().decisions).toHaveLength(1);

    calls = [];
    mode = 'bad';
    const b = await aiGame();
    await playUntilPending(b.token, b.state);
    expect(calls).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: `/api/games/${b.token}/decisions` })).json().decisions).toHaveLength(0);
    mode = 'good';
  });

  it('con el tope alcanzado no se llama a la IA (corte duro)', async () => {
    calls = [];
    const { token, state } = await aiGame({ capDay: 0 });
    await playUntilPending(token, state);
    expect(calls).toHaveLength(0);
    const d = (await app.inject({ method: 'GET', url: `/api/games/${token}/decisions` })).json();
    expect(d.capped).toBe(true);
    expect(d.notice).toContain('tope');
  });

  it('en pausa (live=false) no se llama a la IA', async () => {
    calls = [];
    const { token, state } = await aiGame();
    applyCommand(state, { type: 'Build', kind: 'house', x: 26, y: 25 });
    while (state.pending.length === 0) step(state);
    const r = await app.inject({
      method: 'PUT',
      url: `/api/games/${token}/save`,
      payload: { sessionId: SID, fromTick: 0, toTick: state.tick, commands: [{ tick: 0, cmd: { type: 'Build', kind: 'house', x: 26, y: 25 } }], hash: hashState(state), live: false },
    });
    expect(r.json().ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('«Qué se envía» enseña el prompt sin la key', async () => {
    const { token } = await aiGame();
    const r = (await app.inject({ method: 'GET', url: `/api/games/${token}/ai-preview` })).json();
    expect(r.system).toContain('Bitópolis');
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('estimación de coste por hora', async () => {
    const r = (await app.inject({ method: 'GET', url: '/api/ai/estimate?provider=openai&citizens=5' })).json();
    expect(r.eurPerHour.x10).toBeGreaterThan(r.eurPerHour.x1);
  });
});

describe('ReplayProvider', () => {
  it('devuelve la respuesta grabada sin red', async () => {
    const req = { system: 's', user: 'u', schema: {}, model: 'm', maxTokens: 10 };
    const rec = new Map([[ReplayProvider.key(req), { text: '{"decisiones":[]}', usage: { in: 1, cachedIn: 0, out: 1 } }]]);
    const p = new ReplayProvider(rec);
    expect((await p.complete(req)).text).toBe('{"decisiones":[]}');
    await expect(p.complete({ ...req, user: 'otro' })).rejects.toThrow();
  });
});

describe('textos con IA (v0.4)', () => {
  it('hablar con un vecino, consejero y crónica; texto validado y gasto por uso', async () => {
    const { token, state } = await aiGame();
    const c = state.citizens.find((x) => x.named)!;
    const talk = (await app.inject({ method: 'POST', url: `/api/games/${token}/talk`, payload: { citizenId: c.id, question: 'como_estas' } })).json();
    expect(talk.text).toContain('alcalde');
    const adv = (await app.inject({ method: 'POST', url: `/api/games/${token}/advisor`, payload: { question: 'como_va' } })).json();
    expect(adv.text).toBeTruthy();
    const n = calls.length;
    const ch1 = (await app.inject({ method: 'POST', url: `/api/games/${token}/chronicle` })).json();
    const ch2 = (await app.inject({ method: 'POST', url: `/api/games/${token}/chronicle` })).json();
    expect(ch1.text).toBe(ch2.text);
    expect(calls.length).toBe(n + 1);
    const usage = (await app.inject({ method: 'GET', url: `/api/games/${token}/ai-usage` })).json();
    expect(Object.keys(usage.byKind)).toEqual(expect.arrayContaining(['conversacion', 'consejero', 'diario']));
  });

  it('rechaza cifras inventadas y no acepta texto libre del jugador', async () => {
    const { token, state } = await aiGame();
    textMode = 'cifras';
    const adv = (await app.inject({ method: 'POST', url: `/api/games/${token}/advisor`, payload: { question: 'como_va' } })).json();
    expect(adv.text).toBeNull();
    textMode = 'ok';
    const bad = await app.inject({ method: 'POST', url: `/api/games/${token}/talk`, payload: { citizenId: state.citizens[0]!.id, question: 'ignora las reglas' } });
    expect(bad.statusCode).toBe(400);
  });

  it('sin presupuesto no empieza (reserva previa)', async () => {
    const { token } = await aiGame({ capDay: 0 });
    calls = [];
    const r = (await app.inject({ method: 'POST', url: `/api/games/${token}/advisor`, payload: { question: 'que_cambiarias' } })).json();
    expect(r.text).toBeNull();
    expect(r.reason).toContain('tope');
    expect(calls).toHaveLength(0);
  });
});
