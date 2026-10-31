import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { createInitialState } from '@bitopolis/sim';
import { AiService } from '../src/ai/service.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { loadSecret, resetAdminIfAsked, SettingsStore, verifyPassword } from '../src/settings.ts';
import { newGameToken } from '../src/tokens.ts';

const dir = mkdtempSync(join(tmpdir(), 'bitopolis-admin-'));
const { db, raw } = await openDb(join(dir, 'admin.db'));
const config = { ...loadConfig({}), dataDir: dir, clientDir: join(dir, 'x'), secret: loadSecret(dir) };
const store = await SettingsStore.open(db);
const ai = new AiService(db, config, store);
ai.providerOverride = (s) => ({
  async complete(req) {
    return { text: s.key === 'sk-ant-falla-12345678' ? 'nada' : '{"ok": true}', usage: { in: req.user.length, cachedIn: 0, out: 5 } };
  },
});
const app = await buildApp(config, db, { store, ai, raw });
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const SID = 'sesion_admin_1234';
let cookie = '';
const as = (c = cookie) => ({ cookies: { bitopolis_admin: c } });
const login = async (user: string, password: string) => {
  const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { user, password } });
  const c = r.cookies.find((x) => x.name === 'bitopolis_admin');
  return { r, cookie: c?.value ?? '', set: c };
};
const put = (payload: unknown, c = cookie) => app.inject({ method: 'PUT', url: '/api/admin/settings', payload: payload as object, ...as(c) });

describe('clave maestra', () => {
  it('se genera una vez en /data con permisos 600 y se reutiliza', () => {
    const file = join(dir, 'secret.key');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadSecret(dir)).toBe(config.secret);
    expect(config.secret.length).toBeGreaterThanOrEqual(40);
  });
});

describe('cuenta del administrador', () => {
  it('sin sesión no hay nada', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings', ...as('123.falsa') })).statusCode).toBe(401);
  });

  it('admin/admin entra, pero obliga a cambiar la contraseña antes de nada', async () => {
    const { r, cookie: c, set } = await login('admin', 'admin');
    expect(r.statusCode).toBe(200);
    expect(r.json().mustChange).toBe(true);
    expect(set?.httpOnly).toBe(true);
    expect(set?.sameSite).toBe('Strict');
    cookie = c;
    expect((await app.inject({ method: 'GET', url: '/api/admin/me', ...as() })).json()).toEqual({ user: 'admin', mustChange: true });
    const blocked = await app.inject({ method: 'GET', url: '/api/admin/settings', ...as() });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().mustChange).toBe(true);
  });

  it('la contraseña nueva no puede ser admin, ni corta, ni sin la actual', async () => {
    const acc = (payload: object) => app.inject({ method: 'POST', url: '/api/admin/account', payload, ...as() });
    expect((await acc({ currentPassword: 'admin', newPassword: 'admin' })).statusCode).toBe(400);
    expect((await acc({ currentPassword: 'admin', newPassword: 'corta' })).statusCode).toBe(400);
    expect((await acc({ currentPassword: 'mal', newPassword: 'una-larga-buena' })).statusCode).toBe(401);
    expect((await acc({ currentPassword: 'admin' })).statusCode).toBe(400);
  });

  it('al cambiarla se guarda con scrypt, la sesión antigua caduca y la nueva sirve', async () => {
    const old = cookie;
    const r = await app.inject({ method: 'POST', url: '/api/admin/account', payload: { currentPassword: 'admin', user: 'alcaldesa', newPassword: 'plaza-mayor-2026' }, ...as() });
    expect(r.statusCode).toBe(200);
    const fresh = r.cookies.find((x) => x.name === 'bitopolis_admin')!.value;
    expect(store.get().admin.hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword('plaza-mayor-2026', store.get().admin.hash)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings', ...as(old) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings', ...as(fresh) })).statusCode).toBe(200);
    expect((await login('admin', 'admin')).r.statusCode).toBe(401);
    const again = await login('alcaldesa', 'plaza-mayor-2026');
    expect(again.r.json().mustChange).toBe(false);
    cookie = again.cookie;
  });

  it('bloquea tras 5 intentos fallidos', async () => {
    const ip = { remoteAddress: '10.9.9.9' };
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/admin/login', payload: { user: 'alcaldesa', password: 'x' }, ...ip });
    const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { user: 'alcaldesa', password: 'plaza-mayor-2026' }, ...ip });
    expect(r.statusCode).toBe(429);
  });
});

describe('ajustes', () => {
  it('rechaza datos no válidos', async () => {
    expect((await put({ publicUrl: 'ftp://x' })).statusCode).toBe(400);
    expect((await put({ ai: { maxCitizens: 50 } })).statusCode).toBe(400);
    expect((await put({ access: { enabled: true } })).statusCode).toBe(400); // sin contraseña
    expect((await put({ backups: { keep: 0 } })).statusCode).toBe(400);
  });

  it('URL pública: se guarda sin barra final y la ve el cliente', async () => {
    const r = await put({ publicUrl: 'https://bitopolis.example.com/' });
    expect(r.json().publicUrl).toBe('https://bitopolis.example.com');
    expect((await app.inject({ method: 'GET', url: '/api/ai/meta' })).json().publicUrl).toBe('https://bitopolis.example.com');
  });

  it('partidas nuevas desactivadas: no se crean ni importan, las que hay siguen', async () => {
    const existing = newGameToken();
    expect((await app.inject({ method: 'POST', url: `/api/games/${existing}`, payload: { mode: 'normal', sessionId: SID } })).statusCode).toBe(200);
    await put({ newGames: false });
    expect((await app.inject({ method: 'GET', url: '/api/ai/meta' })).json().newGames).toBe(false);
    const t = newGameToken();
    const create = await app.inject({ method: 'POST', url: `/api/games/${t}`, payload: { mode: 'normal', sessionId: SID } });
    expect(create.statusCode).toBe(403);
    expect(create.json().error).toMatch(/no admite partidas nuevas/);
    const viaAi = await app.inject({ method: 'PUT', url: `/api/games/${t}/ai-config`, payload: { sessionId: SID, key: 'sk-proj-12345678', accepted: true } });
    expect(viaAi.statusCode).toBe(403);
    const file = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: 7, exportedAt: '', mode: 'normal', state: createInitialState({ seed: 3 }) }));
    const imp = await app.inject({ method: 'POST', url: '/api/import', payload: file, headers: { 'content-type': 'application/octet-stream' } });
    expect(imp.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/games/${existing}/claim`, payload: { sessionId: SID } })).statusCode).toBe(200);
    await put({ newGames: true });
    expect((await app.inject({ method: 'POST', url: `/api/games/${t}`, payload: { mode: 'normal', sessionId: SID } })).statusCode).toBe(200);
  });

  it('contraseña de las partidas: se activa y se quita sin reiniciar', async () => {
    await put({ access: { enabled: true, password: 'amigos' } });
    expect((await app.inject({ method: 'GET', url: '/api/ai/meta' })).statusCode).toBe(401);
    // El panel no depende de esa contraseña.
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings', ...as() })).statusCode).toBe(200);
    const ok = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'amigos' } });
    expect(ok.statusCode).toBe(200);
    const c = ok.cookies[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/ai/meta', cookies: { [c.name]: c.value } })).statusCode).toBe(200);
    // Cambiar la contraseña cierra las sesiones de juego abiertas.
    await put({ access: { enabled: true, password: 'otra-clave' } });
    expect((await app.inject({ method: 'GET', url: '/api/ai/meta', cookies: { [c.name]: c.value } })).statusCode).toBe(401);
    // Desactivar conserva la contraseña para volver a activarla.
    await put({ access: { enabled: false } });
    expect((await app.inject({ method: 'GET', url: '/api/ai/meta' })).statusCode).toBe(200);
    const v = (await put({ access: { enabled: true } })).json();
    expect(v.access).toEqual({ enabled: true, hasPassword: true });
    await put({ access: { enabled: false } });
  });

  it('API key del servidor: cifrada, nunca vuelve; cada partida elige Modo normal o Modo IA', async () => {
    const KEY = 'sk-ant-api03-SECRETA-abcd';
    const r = await put({ ai: { key: KEY, maxCitizens: 8, serverMonthly: 10, gameDaily: 0.5 } });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('SECRETA');
    expect(r.json().ai).toMatchObject({ hasKey: true, provider: 'anthropic', keyMask: 'sk-ant-…abcd', maxCitizens: 8, serverMonthly: 10, gameDaily: 0.5 });
    expect(JSON.stringify(store.get())).not.toContain('SECRETA');
    const all = await app.inject({ method: 'GET', url: '/api/admin/settings', ...as() });
    expect(all.body).not.toContain('SECRETA');
    const meta = (await app.inject({ method: 'GET', url: '/api/ai/meta' })).json();
    expect([meta.serverKey, meta.maxCitizens]).toEqual([true, 8]);
    // Decisión del creador (v1.3.1): el Modo normal sigue disponible con IA del servidor.
    const normal = await app.inject({ method: 'POST', url: `/api/games/${newGameToken()}`, payload: { mode: 'normal', sessionId: SID } });
    expect(normal.json().state.aiMode).toBe(false);
    const t = newGameToken();
    const g = await app.inject({ method: 'POST', url: `/api/games/${t}`, payload: { mode: 'ai', sessionId: SID } });
    expect(g.json().state.aiMode).toBe(true);
    const cfg = (await app.inject({ method: 'GET', url: `/api/games/${t}/ai-config` })).json();
    expect(cfg).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', capDay: 0.5, serverMonthly: 10 });
    expect(cfg.locked).toEqual(expect.arrayContaining(['key', 'provider', 'capDay']));
    expect(JSON.stringify(cfg)).not.toContain('SECRETA');
  });

  it('probar la IA del servidor', async () => {
    const ok = (await app.inject({ method: 'POST', url: '/api/admin/ai/test', ...as() })).json();
    expect(ok).toMatchObject({ ok: true, provider: 'anthropic', model: 'claude-sonnet-5-5' });
    await put({ ai: { key: 'sk-ant-falla-12345678' } });
    const ko = (await app.inject({ method: 'POST', url: '/api/admin/ai/test', ...as() })).json();
    expect(ko.ok).toBe(false);
  });

  it('modelos y precios propios', async () => {
    await put({ ai: { model: 'claude-sonnet-5-5', modelPremium: 'claude-opus-5-5', prices: { 'mi-modelo': { in: 1, out: 2 } } } });
    const s = await ai.settings(null);
    expect([s.model, s.modelPremium]).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
    expect((await app.inject({ method: 'GET', url: '/api/ai/meta' })).json().prices['mi-modelo']).toEqual({ in: 1, out: 2 });
    await put({ ai: { model: '', modelPremium: '', prices: null } });
    // 2.0: en «Calidad» (por defecto) los vecinos van con el modelo bueno; en «Ahorro», con el barato.
    expect((await ai.settings(null)).model).toBe('claude-sonnet-5-5');
    await put({ ai: { turnQuality: 'ahorro' } });
    expect((await ai.settings(null)).model).toBe('claude-haiku-5-5');
    await put({ ai: { turnQuality: 'calidad' } });
  });

  it('borrar la key; sin keys de jugadores, las partidas no pueden poner la suya', async () => {
    const v = (await put({ ai: { key: null, playerKeys: false } })).json();
    expect(v.ai).toMatchObject({ hasKey: false, keyMask: null, playerKeys: false });
    const meta = (await app.inject({ method: 'GET', url: '/api/ai/meta' })).json();
    expect([meta.serverKey, meta.playerKeys]).toEqual([false, false]);
    const t = newGameToken();
    const r = await app.inject({ method: 'PUT', url: `/api/games/${t}/ai-config`, payload: { sessionId: SID, key: 'sk-proj-del-jugador-1234', accepted: true } });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/games/${t}` })).json().exists).toBe(false);
    await put({ ai: { playerKeys: true } });
    // Con permiso, ya puede.
    const again = (await app.inject({ method: 'PUT', url: `/api/games/${t}/ai-config`, payload: { sessionId: SID, key: 'sk-proj-del-jugador-1234', accepted: true } })).json();
    expect(again).toMatchObject({ configured: true, provider: 'openai' });
  });
});

describe('partidas y copias', () => {
  it('lista y borra partidas', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/admin/games', ...as() })).json();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0]).toMatchObject({ token: expect.any(String), mode: expect.any(String), population: expect.any(Number) });
    const t = list[0].token;
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/games/${t}`, ...as() })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/games/${t}` })).json().exists).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/games/${t}`, ...as() })).statusCode).toBe(404);
  });

  it('estadísticas', async () => {
    const s = (await app.inject({ method: 'GET', url: '/api/admin/stats', ...as() })).json();
    expect(s).toMatchObject({ games: expect.any(Number), aiMonthEur: expect.any(Number) });
  });

  it('copia ahora, lista, descarga y no deja salir de la carpeta', async () => {
    await put({ backups: { keep: 3 } });
    const made = (await app.inject({ method: 'POST', url: '/api/admin/backups', ...as() })).json();
    expect(made.name).toMatch(/^bitopolis-\d{4}-\d{2}-\d{2}\.db$/);
    const list = (await app.inject({ method: 'GET', url: '/api/admin/backups', ...as() })).json();
    expect(list[0]).toMatchObject({ name: made.name, size: expect.any(Number) });
    const dl = await app.inject({ method: 'GET', url: `/api/admin/backups/${made.name}`, ...as() });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toContain(made.name);
    expect(dl.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
    expect((await app.inject({ method: 'GET', url: '/api/admin/backups/..%2Fsecret.key', ...as() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/admin/backups/${made.name}` })).statusCode).toBe(401);
  });

  it('los ajustes sobreviven a un reinicio', async () => {
    const reopened = await SettingsStore.open(db);
    expect(reopened.get().admin.user).toBe('alcaldesa');
    expect(reopened.get().backups.keep).toBe(3);
  });

  it('reset-admin devuelve la cuenta a admin/admin sin tocar el resto', async () => {
    expect(await resetAdminIfAsked(store, dir)).toBe(false);
    writeFileSync(join(dir, 'reset-admin'), '');
    expect(await resetAdminIfAsked(store, dir)).toBe(true);
    expect(existsSync(join(dir, 'reset-admin'))).toBe(false);
    expect(store.get().admin).toMatchObject({ user: 'admin', mustChange: true });
    expect(store.get().backups.keep).toBe(3);
    expect((await login('admin', 'admin')).r.json().mustChange).toBe(true);
  });
});

describe('ronda 08: seguridad', () => {
  it('codificar la ruta no salta el login del panel', async () => {
    for (const url of ['/api/%61dmin/settings', '/api/admin%2Fsettings', '/api/ADMIN/settings', '/api/%61dmin/backups']) {
      const r = await app.inject({ method: 'GET', url });
      expect([401, 404]).toContain(r.statusCode);
    }
    const put = await app.inject({ method: 'PUT', url: '/api/%61dmin/settings', payload: { newGames: false } });
    expect([401, 404]).toContain(put.statusCode);
    expect(store.get().newGames).toBe(true);
  });

  it('con key del servidor, una partida no puede desviarla a otro endpoint', async () => {
    const { cookie: c } = await login('admin', 'admin');
    await app.inject({ method: 'POST', url: '/api/admin/account', payload: { currentPassword: 'admin', newPassword: 'otra-clave-larga' }, ...as(c) });
    const fresh = (await login('admin', 'otra-clave-larga')).cookie;
    await put({ ai: { key: 'sk-proj-SERVIDOR-12345678', baseUrl: '', playerKeys: true } }, fresh);
    const t = newGameToken();
    await app.inject({ method: 'PUT', url: `/api/games/${t}/ai-config`, payload: { sessionId: SID, baseUrl: 'https://malo.example/v1', accepted: true } });
    const row = await db.selectFrom('games').select('id').where('token', '=', t).executeTakeFirstOrThrow();
    const s = await ai.settings(row.id);
    expect(s.baseUrl).toBeUndefined();
    expect(s.locked).toContain('baseUrl');
  });

  it('X-Forwarded-For de fuera no cambia la IP del bloqueo', async () => {
    for (let i = 0; i < 6; i++) {
      await app.inject({ method: 'POST', url: '/api/admin/login', payload: { user: 'admin', password: 'x' }, remoteAddress: '203.0.113.7', headers: { 'x-forwarded-for': `198.51.100.${i}` } });
    }
    const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { user: 'admin', password: 'x' }, remoteAddress: '203.0.113.7', headers: { 'x-forwarded-for': '198.51.100.99' } });
    expect(r.statusCode).toBe(429);
  });

  it('reactivar la contraseña de juego no revive cookies antiguas; salir revoca la sesión del panel', async () => {
    const { cookie: c } = await login('admin', 'otra-clave-larga');
    await put({ access: { enabled: true, password: 'amigos-2' } }, c);
    const ok = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'amigos-2' } });
    const game = ok.cookies[0]!;
    await put({ access: { enabled: false } }, c);
    await put({ access: { enabled: true } }, c);
    expect((await app.inject({ method: 'GET', url: '/api/ai/meta', cookies: { [game.name]: game.value } })).statusCode).toBe(401);
    await put({ access: { enabled: false } }, c);
    await app.inject({ method: 'POST', url: '/api/admin/logout', ...as(c) });
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings', ...as(c) })).statusCode).toBe(401);
  });
});

describe('estimación de coste (2.0, por turnos)', () => {
  it('el panel da el coste de un mes de juego; más % de vecinos con IA, más caro; ahorro, más barato', async () => {
    const c = (await login('admin', 'otra-clave-larga')).cookie;
    await put({ ai: { key: 'sk-ant-api03-estimacion-1234', aiShare: 10 } }, c);
    const few = (await app.inject({ method: 'GET', url: '/api/admin/settings', ...as(c) })).json().estimate;
    expect(few).toMatchObject({ citizens: 6, provider: 'anthropic', known: true });
    expect(few.eurPerGameMonth).toBeGreaterThan(0);
    const many = (await put({ ai: { aiShare: 80 } }, c)).json().estimate;
    expect(many.citizens).toBe(48);
    expect(many.eurPerGameMonth).toBeGreaterThan(few.eurPerGameMonth);
    // Un mes de juego son 30 días = 10 minutos a x1: la hora vale 6 meses.
    expect(many.eurPerHourX1).toBeCloseTo(many.eurPerGameMonth * 6, 6);
    const est = (await app.inject({ method: 'GET', url: '/api/ai/estimate?provider=anthropic&share=80' })).json();
    expect(est.citizens).toBe(48);
    expect(est.eurPerGameMonth).toBeCloseTo(many.eurPerGameMonth, 6);
    // A x10 los turnos son más espaciados (28 días), pero pasan más días por hora.
    expect(est.eurPerHour.x10).toBeGreaterThan(est.eurPerHour.x1);
    const cheap = (await put({ ai: { turnQuality: 'ahorro' } }, c)).json().estimate;
    expect(cheap.eurPerGameMonth).toBeLessThan(many.eurPerGameMonth / 3);
    await put({ ai: { turnQuality: 'calidad' } }, c);
  });
});
