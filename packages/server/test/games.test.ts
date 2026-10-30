import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { applyCommand, type GameState, hashState, step } from '@bitopolis/sim';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { newGameToken } from '../src/tokens.ts';

const dir = mkdtempSync(join(tmpdir(), 'bitopolis-games-'));
const { db } = await openDb(join(dir, 'test.db'));
const app = await buildApp({ ...loadConfig({}), dataDir: dir, clientDir: join(dir, 'nope') }, db);
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const A = 'sesionA_12345678';
const B = 'sesionB_12345678';

async function create() {
  const token = newGameToken();
  const r = await app.inject({ method: 'POST', url: `/api/games/${token}`, payload: { mode: 'normal', sessionId: A } });
  expect(r.statusCode).toBe(200);
  return { token, state: r.json().state as GameState };
}

describe('partidas', () => {
  it('/ redirige a una URL nueva /p/<token> sin crear la partida', async () => {
    const r = await app.inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(302);
    const token = r.headers.location!.split('/p/')[1]!;
    expect(token).toMatch(/^[0-9A-Za-z]{22}$/);
    const g = await app.inject({ method: 'GET', url: `/api/games/${token}` });
    expect(g.json()).toEqual({ exists: false });
  });

  it('crea, guarda verificando por replay y devuelve mini estadísticas', async () => {
    const { token, state } = await create();
    const cmd = { type: 'BuildRoad', x: 2, y: 2, x2: 6, y2: 2 } as const;
    const commands = [{ tick: 5, cmd }];
    for (let i = 0; i < 24; i++) {
      if (state.tick === 5) applyCommand(state, cmd);
      step(state);
    }
    const ok = await app.inject({
      method: 'PUT',
      url: `/api/games/${token}/save`,
      payload: { sessionId: A, fromTick: 0, toTick: 24, commands, hash: hashState(state) },
    });
    expect(ok.json()).toEqual({ ok: true, tick: 24 });
    const g = (await app.inject({ method: 'GET', url: `/api/games/${token}` })).json();
    expect(g.exists).toBe(true);
    expect(g.summary.population).toBe(1);
    expect(g.summary.date.day).toBe(2);
  });

  it('rechaza un guardado con el hash trucado', async () => {
    const { token } = await create();
    const r = await app.inject({
      method: 'PUT',
      url: `/api/games/${token}/save`,
      payload: { sessionId: A, fromTick: 0, toTick: 24, commands: [], hash: '0000000000000000' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().state.tick).toBe(0);
  });

  it('solo un dispositivo juega a la vez', async () => {
    const { token } = await create();
    const busy = await app.inject({ method: 'POST', url: `/api/games/${token}/claim`, payload: { sessionId: B } });
    expect(busy.statusCode).toBe(423);
    const forced = await app.inject({ method: 'POST', url: `/api/games/${token}/claim`, payload: { sessionId: B, force: true } });
    expect(forced.statusCode).toBe(200);
    const lost = await app.inject({
      method: 'PUT',
      url: `/api/games/${token}/save`,
      payload: { sessionId: A, fromTick: 0, toTick: 0, commands: [], hash: '0000000000000000' },
    });
    expect(lost.statusCode).toBe(423);
  });

  it('regenerar el enlace invalida el anterior', async () => {
    const { token } = await create();
    const r = await app.inject({ method: 'POST', url: `/api/games/${token}/regenerate`, payload: { sessionId: A } });
    const fresh = r.json().token as string;
    expect(fresh).not.toBe(token);
    expect((await app.inject({ method: 'GET', url: `/api/games/${token}` })).json().exists).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/api/games/${fresh}` })).json().exists).toBe(true);
  });

  it('exporta e importa como partida nueva', async () => {
    const { token } = await create();
    const ex = await app.inject({ method: 'GET', url: `/api/games/${token}/export` });
    expect(ex.statusCode).toBe(200);
    const file = JSON.parse(gunzipSync(ex.rawPayload).toString());
    expect(file.bitopolis).toBe(1);
    expect(JSON.stringify(file)).not.toMatch(/api[_-]?key/i);
    const im = await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: ex.rawPayload,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(im.statusCode).toBe(200);
    expect(im.json().token).not.toBe(token);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: Buffer.from('hola'),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('acceso común', async () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'bitopolis-auth-'));
  const { db: db2 } = await openDb(join(dir2, 'a.db'));
  const app2 = await buildApp({ ...loadConfig({}), dataDir: dir2, clientDir: join(dir2, 'x'), user: 'fam', password: 'secreto' }, db2);
  afterAll(async () => {
    await app2.close();
    await db2.destroy();
  });

  it('pide login y bloquea tras varios fallos', async () => {
    expect((await app2.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app2.inject({ method: 'GET', url: '/api/games/abc' })).statusCode).toBe(401);
    expect((await app2.inject({ method: 'GET', url: '/p/x' })).statusCode).toBe(302);
    const good = await app2.inject({ method: 'POST', url: '/api/login', payload: { user: 'fam', password: 'secreto' } });
    expect(good.statusCode).toBe(200);
    const c = good.cookies[0]!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    const ok = await app2.inject({ method: 'GET', url: '/', cookies: { [c.name]: c.value } });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toMatch(/^\/p\//);
    for (let i = 0; i < 5; i++) await app2.inject({ method: 'POST', url: '/api/login', payload: { user: 'fam', password: 'x' } });
    const locked = await app2.inject({ method: 'POST', url: '/api/login', payload: { user: 'fam', password: 'secreto' } });
    expect(locked.statusCode).toBe(429);
  });
});
