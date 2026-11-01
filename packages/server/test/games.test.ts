import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, type GameState, hashState, step } from '@bitopolis/sim';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { hashPassword, SettingsStore } from '../src/settings.ts';
import { newGameToken } from '../src/tokens.ts';

const dir = mkdtempSync(join(tmpdir(), 'bitopolis-games-'));
const { db } = await openDb(join(dir, 'test.db'));
const app = await buildApp({ ...loadConfig({}), dataDir: dir, clientDir: join(dir, 'nope'), secret: 'secreto-de-prueba' }, db);
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const A = 'sesionA_12345678';
const B = 'sesionB_12345678';

/** Dos carreteras junto al ayuntamiento (el centro siempre es llano). */
function roadsNear(state: GameState) {
  const th = state.buildings.find((b) => b.kind === 'townhall')!;
  return {
    road: { type: 'BuildRoad', x: th.x + 3, y: th.y + 3, x2: th.x + 6, y2: th.y + 3 } as const,
    road2: { type: 'BuildRoad', x: th.x + 3, y: th.y + 4, x2: th.x + 3, y2: th.y + 6 } as const,
  };
}

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

  it('en pausa: lotes sin ticks (fromTick == toTick) con órdenes se reproducen y se guardan en cadena', async () => {
    const { token, state } = await create();
    for (let i = 0; i < 4; i++) step(state);
    const save = (payload: object) => app.inject({ method: 'PUT', url: `/api/games/${token}/save`, payload: { sessionId: A, ...payload } });
    // Al pausar: lo jugado del día, sin órdenes.
    expect((await save({ fromTick: 0, toTick: 4, commands: [], hash: hashState(state) })).json()).toEqual({ ok: true, tick: 4 });
    const { road, road2 } = roadsNear(state);
    expect(applyCommand(state, road).ok).toBe(true);
    expect((await save({ fromTick: 4, toTick: 4, commands: [{ tick: 4, cmd: road }], hash: hashState(state) })).json()).toEqual({ ok: true, tick: 4 });
    expect(applyCommand(state, road2).ok).toBe(true);
    expect((await save({ fromTick: 4, toTick: 4, commands: [{ tick: 4, cmd: road2 }], hash: hashState(state) })).json()).toEqual({ ok: true, tick: 4 });
    const back = (await app.inject({ method: 'POST', url: `/api/games/${token}/claim`, payload: { sessionId: A } })).json().state as GameState;
    expect(hashState(back)).toBe(hashState(state));
    expect(back.treasury).toBeLessThan(30_000);
  });

  it('al cerrar la página: el último guardado repite lo que iba en camino y vale llegue en el orden que llegue', async () => {
    for (const order of ['enCamino primero', 'cierre primero'] as const) {
      const { token, state } = await create();
      const { road, road2 } = roadsNear(state);
        expect(applyCommand(state, road).ok).toBe(true);
      const h1 = hashState(state);
      expect(applyCommand(state, road2).ok).toBe(true);
      for (let i = 0; i < 3; i++) step(state);
      const h2 = hashState(state);
      // El de cierre va por POST (`sendBeacon`); el normal, por PUT.
      const put = (payload: object) =>
        app.inject({ method: 'release' in payload ? 'POST' : 'PUT', url: `/api/games/${token}/save`, payload: { sessionId: A, ...payload } });
      // Lote en camino (la primera carretera, en pausa) y, al cerrar, ese mismo lote más el resto.
      const inFlight = { fromTick: 0, toTick: 0, commands: [{ tick: 0, cmd: road }], hash: h1 };
      const onHide = {
        fromTick: 0,
        toTick: 3,
        commands: [{ tick: 0, cmd: road }, { tick: 0, cmd: road2 }],
        hash: h2,
        release: true,
        parts: [{ toTick: 0, hash: h1, n: 1 }, { toTick: 3, hash: h2, n: 1 }],
      };
      const [x, y] = order === 'enCamino primero' ? [inFlight, onHide] : [onHide, inFlight];
      const [rx, ry] = await Promise.all([put(x), put(y)]);
      if (order === 'enCamino primero') {
        expect(rx.statusCode).toBe(200);
        expect(ry.json()).toEqual({ ok: true, tick: 3 });
      } else {
        expect(rx.json()).toEqual({ ok: true, tick: 3 });
        expect(ry.statusCode).toBe(409);
      }
      // Guardado entero y suelta: otra sesión entra sin forzar.
      const other = await app.inject({ method: 'POST', url: `/api/games/${token}/claim`, payload: { sessionId: B } });
      expect(other.statusCode).toBe(200);
      expect(hashState(other.json().state)).toBe(h2);
      // Si todo estaba ya guardado, el de cierre no hace nada (y no falla).
      const again = await put({ ...onHide, sessionId: B });
      expect(again.json()).toEqual({ ok: true, tick: 3 });
    }
  });

  it('regenerar el enlace invalida el anterior', async () => {
    const { token } = await create();
    const r = await app.inject({ method: 'POST', url: `/api/games/${token}/regenerate`, payload: { sessionId: A } });
    const fresh = r.json().token as string;
    expect(fresh).not.toBe(token);
    expect((await app.inject({ method: 'GET', url: `/api/games/${token}` })).json().exists).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/api/games/${fresh}` })).json().exists).toBe(true);
  });

  it('2.3: crea con escenario y terreno, guarda por replay, lo lista en /admin y la importación lo conserva', async () => {
    const token = newGameToken();
    const r = await app.inject({ method: 'POST', url: `/api/games/${token}`, payload: { mode: 'normal', sessionId: A, scenario: 'riada', terrain: 'llano' } });
    expect(r.statusCode).toBe(200);
    const state = r.json().state as GameState;
    expect(state.scenario).toMatchObject({ id: 'riada', done: false });
    expect(state.buildings.filter((b) => b.damaged?.cause === 'riada').length).toBeGreaterThan(0);
    // Mismo comienzo que en el motor con la semilla que puso el servidor.
    expect(hashState(state)).toBe(hashState(createInitialState({ seed: state.seed, scenario: 'riada', terrain: 'llano' })));
    for (let i = 0; i < 24; i++) step(state);
    const ok = await app.inject({ method: 'PUT', url: `/api/games/${token}/save`, payload: { sessionId: A, fromTick: 0, toTick: 24, commands: [], hash: hashState(state) } });
    expect(ok.json()).toEqual({ ok: true, tick: 24 });
    const row = await db.selectFrom('games').select(['scenario']).where('token', '=', token).executeTakeFirst();
    expect(row?.scenario).toBe('riada');
    const ex = await app.inject({ method: 'GET', url: `/api/games/${token}/export` });
    const im = await app.inject({ method: 'POST', url: '/api/import', payload: ex.rawPayload, headers: { 'content-type': 'application/octet-stream' } });
    expect(im.statusCode).toBe(200);
    const copy = await db.selectFrom('games').select(['scenario', 'state']).where('token', '=', im.json().token).executeTakeFirst();
    expect(copy?.scenario).toBe('riada');
    expect(JSON.parse(copy!.state).scenario.id).toBe('riada');
    // Sin escenario ni terreno: Libre, como siempre; uno que no existe, 400.
    const plain = await create();
    expect(plain.state.scenario).toEqual({ id: 'libre', done: true });
    expect(hashState(plain.state)).toBe(hashState(createInitialState({ seed: plain.state.seed })));
    const bad = await app.inject({ method: 'POST', url: `/api/games/${newGameToken()}`, payload: { mode: 'normal', sessionId: A, scenario: 'marte' } });
    expect(bad.statusCode).toBe(400);
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
  const store2 = await SettingsStore.open(db2);
  await store2.update((s) => ({ ...s, access: { enabled: true, hash: '' } }));
  const app2 = await buildApp({ ...loadConfig({}), dataDir: dir2, clientDir: join(dir2, 'x'), secret: 'otro-secreto' }, db2, { store: store2 });
  afterAll(async () => {
    await app2.close();
    await db2.destroy();
  });

  it('activada sin contraseña no bloquea nada', async () => {
    expect((await app2.inject({ method: 'GET', url: '/api/games/abc' })).statusCode).not.toBe(401);
    await store2.update((s) => ({ ...s, access: { enabled: true, hash: '' } }));
  });

  it('pide login y bloquea tras varios fallos', async () => {
    const hash = await hashPassword('secreto');
    await store2.update((s) => ({ ...s, access: { enabled: true, hash } }));
    expect((await app2.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app2.inject({ method: 'GET', url: '/api/games/abc' })).statusCode).toBe(401);
    expect((await app2.inject({ method: 'GET', url: '/p/x' })).statusCode).toBe(302);
    const good = await app2.inject({ method: 'POST', url: '/api/login', payload: { password: 'secreto' } });
    expect(good.statusCode).toBe(200);
    const c = good.cookies[0]!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    const ok = await app2.inject({ method: 'GET', url: '/', cookies: { [c.name]: c.value } });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toMatch(/^\/p\//);
    for (let i = 0; i < 5; i++) await app2.inject({ method: 'POST', url: '/api/login', payload: { password: 'x' } });
    const locked = await app2.inject({ method: 'POST', url: '/api/login', payload: { password: 'secreto' } });
    expect(locked.statusCode).toBe(429);
  });
});
