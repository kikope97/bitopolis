import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { GameState } from '@bitopolis/sim';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { hashPassword, SettingsStore } from '../src/settings.ts';
import { newGameToken } from '../src/tokens.ts';

/** 2.3: enlace de solo lectura /v/<token>. */
const dir = mkdtempSync(join(tmpdir(), 'bitopolis-share-'));
const { db } = await openDb(join(dir, 'test.db'));
const store = await SettingsStore.open(db);
const app = await buildApp({ ...loadConfig({}), dataDir: dir, clientDir: join(dir, 'nope'), secret: 'secreto-de-prueba' }, db, { store });
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const A = 'sesionA_12345678';
const B = 'sesionB_12345678';
const KEY = 'sk-ant-claveSecretaDePrueba1234567890';

async function create() {
  const token = newGameToken();
  const r = await app.inject({ method: 'POST', url: `/api/games/${token}`, payload: { mode: 'normal', sessionId: A } });
  expect(r.statusCode).toBe(200);
  return { token, state: r.json().state as GameState };
}
const share = (token: string, sessionId = A) => app.inject({ method: 'POST', url: `/api/games/${token}/share`, payload: { sessionId } });
const unshare = (token: string, sessionId = A) => app.inject({ method: 'DELETE', url: `/api/games/${token}/share`, payload: { sessionId } });
const view = (v: string) => app.inject({ method: 'GET', url: `/api/view/${v}` });

describe('compartir el pueblo (solo lectura)', () => {
  it('crea un enlace independiente del de juego y la vista enseña el pueblo', async () => {
    const { token, state } = await create();
    expect((await app.inject({ method: 'GET', url: `/api/games/${token}/share` })).json()).toEqual({ active: false });
    const r = await share(token);
    expect(r.statusCode).toBe(200);
    const { viewToken, active } = r.json();
    expect(active).toBe(true);
    expect(viewToken).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(viewToken).not.toBe(token);
    // Repetir devuelve el mismo enlace.
    expect((await share(token)).json().viewToken).toBe(viewToken);
    expect((await app.inject({ method: 'GET', url: `/api/games/${token}/share` })).json()).toMatchObject({ active: true, viewToken });
    const v = await view(viewToken);
    expect(v.statusCode).toBe(200);
    expect(v.headers['cache-control']).toBe('private, max-age=60');
    expect(v.headers['referrer-policy']).toBe('no-referrer');
    expect(v.headers['content-security-policy']).toContain("default-src 'self'");
    const snap = v.json().snapshot;
    expect(snap.map.tiles).toEqual(state.map.tiles);
    expect(snap.summary.population).toBe(state.citizens.length);
    const body = v.body;
    expect(body).not.toContain(token);
    expect(body).not.toContain('"rng"');
    expect(body).not.toContain('"seed"');
    expect(body).not.toContain('"citizens"');
  });

  it('nunca lleva la key ni datos de ai_config', async () => {
    const { token } = await create();
    const row = await db.selectFrom('games').select('id').where('token', '=', token).executeTakeFirstOrThrow();
    await db.insertInto('ai_config').values({ game_id: row.id, provider: 'anthropic', model: 'm', model_premium: null, base_url: 'https://llm.example', key_enc: KEY, key_mask: 'sk-ant-…7890', cap_day: 1, cap_month: 2, accepted_at: null }).execute();
    const v = await view((await share(token)).json().viewToken);
    expect(v.statusCode).toBe(200);
    for (const s of [KEY, 'sk-ant', 'llm.example', '7890', 'key_enc', 'key_mask', token]) expect(v.body).not.toContain(s);
  });

  it('un token de vista no sirve en las rutas de juego', async () => {
    const { token } = await create();
    const v = (await share(token)).json().viewToken as string;
    expect((await app.inject({ method: 'GET', url: `/api/games/${v}` })).json()).toEqual({ exists: false });
    expect((await app.inject({ method: 'POST', url: `/api/games/${v}/claim`, payload: { sessionId: A, force: true } })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PUT', url: `/api/games/${v}/save`, payload: { sessionId: A, fromTick: 0, toTick: 0, commands: [], hash: '0000000000000000' } })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/games/${v}/export` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/games/${v}/regenerate`, payload: { sessionId: A } })).statusCode).toBe(404);
    expect((await share(v)).statusCode).toBe(404);
    expect((await unshare(v)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/games/${v}/share` })).statusCode).toBe(404);
    // Y al revés: el token de juego no abre la vista.
    expect((await view(token)).statusCode).toBe(404);
  });

  it('solo la sesión que tiene la partida crea o quita el enlace', async () => {
    const { token } = await create();
    expect((await share(token, B)).statusCode).toBe(423);
    const v = (await share(token)).json().viewToken as string;
    expect((await unshare(token, B)).statusCode).toBe(423);
    expect((await view(v)).statusCode).toBe(200);
  });

  it('regenerar el de juego no toca el de vista; dejar de compartir lo invalida', async () => {
    const { token } = await create();
    const v = (await share(token)).json().viewToken as string;
    const fresh = (await app.inject({ method: 'POST', url: `/api/games/${token}/regenerate`, payload: { sessionId: A } })).json().token as string;
    expect((await view(v)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/games/${fresh}/share` })).json()).toMatchObject({ active: true, viewToken: v });
    expect((await unshare(fresh)).json()).toEqual({ active: false });
    expect((await view(v)).statusCode).toBe(404);
    // Uno nuevo es otro token: el viejo sigue sin valer.
    const v2 = (await share(fresh)).json().viewToken as string;
    expect(v2).not.toBe(v);
    expect((await view(v)).statusCode).toBe(404);
    expect((await view(v2)).statusCode).toBe(200);
  });

  it('tokens mal formados dan 404 sin buscar', async () => {
    expect((await view('corto')).statusCode).toBe(404);
    expect((await view("x' OR '1'='1")).statusCode).toBe(404);
  });

  it('con la contraseña de acceso activa, la vista no la pide (su token ya es secreto) y el juego sí', async () => {
    const { token } = await create();
    const v = (await share(token)).json().viewToken as string;
    const hash = await hashPassword('amigos');
    await store.update((s) => ({ ...s, access: { enabled: true, hash } }));
    try {
      expect((await view(v)).statusCode).toBe(200);
      // Sin el cliente compilado en los tests da 404, pero nunca manda a iniciar sesión.
      expect([200, 404]).toContain((await app.inject({ method: 'GET', url: `/v/${v}` })).statusCode);
      expect((await app.inject({ method: 'GET', url: `/p/${token}` })).statusCode).toBe(302);
      expect((await app.inject({ method: 'GET', url: `/api/games/${token}` })).statusCode).toBe(401);
    } finally {
      await store.update((s) => ({ ...s, access: { enabled: false, hash: '' } }));
    }
    expect((await view(v)).statusCode).toBe(200);
  });

  it('la vista tiene un límite de 30 por minuto', async () => {
    const { token } = await create();
    const v = (await share(token)).json().viewToken as string;
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await view(v)).statusCode;
    expect(last).toBe(429);
  });
});
