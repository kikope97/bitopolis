import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptSecret, maskKey } from '../src/ai/crypto.ts';
import { listModels, ProviderError } from '../src/ai/providers.ts';
import { AiService } from '../src/ai/service.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { SettingsStore } from '../src/settings.ts';
import { newGameToken } from '../src/tokens.ts';

/** Lista de modelos (v1.9.x): desplegable en /admin y en Configurar. Todo sin red. */
const OPENAI_KEY = 'sk-proj-SECRETO-1234567890-wxyz';
const ANT_KEY = 'sk-ant-SECRETO-1234567890-wxyz';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Seen = { url: string; headers: Headers };
function fakeFetch(handler: (url: URL, seen: Seen[]) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    seen.push({ url: url.href, headers: new Headers(init?.headers) });
    return handler(url, seen);
  }) as typeof fetch;
  return { f, seen };
}

describe('listModels (OpenAI y compatibles)', () => {
  it('pide GET /models con Bearer, quita los que no son de chat y ordena de más nuevo a más antiguo', async () => {
    const { f, seen } = fakeFetch(() =>
      json({
        data: [
          { id: 'gpt-5.4-nano', created: 1_780_000_000 },
          { id: 'text-embedding-3-small', created: 1_790_000_000 },
          { id: 'gpt-5.4-mini', created: 1_785_000_000 },
          { id: 'gpt-4o', created: 1_700_000_000 },
          { id: 'whisper-1', created: 1_600_000_000 },
          { id: 'gpt-4o' },
        ],
      }),
    );
    const list = await listModels('openai', OPENAI_KEY, undefined, { fetch: f });
    expect(list.map((m) => m.id)).toEqual(['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4o']);
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/models');
    expect(seen[0]!.headers.get('authorization')).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it('endpoint propio sin key: no manda Authorization y sin fechas ordena por nombre', async () => {
    const { f, seen } = fakeFetch(() => json({ object: 'list', data: [{ id: 'qwen3' }, { id: 'llama3.2', name: 'Llama 3.2' }] }));
    const list = await listModels('openai-compatible', undefined, 'http://ollama:11434/v1/', { fetch: f });
    expect(list).toEqual([{ id: 'llama3.2', name: 'Llama 3.2' }, { id: 'qwen3' }]);
    expect(seen[0]!.url).toBe('http://ollama:11434/v1/models');
    expect(seen[0]!.headers.has('authorization')).toBe(false);
  });

  it('los errores llevan el código de estado y nunca la key', async () => {
    const leak = fakeFetch(() => json({ error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } }, 401));
    const e = await listModels('openai', OPENAI_KEY, undefined, { fetch: leak.f }).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.status).toBe(401);
    expect(String(e.message)).not.toContain('SECRETO');
    const notJson = fakeFetch(() => new Response('<html>hola</html>', { status: 200 }));
    await expect(listModels('openai', OPENAI_KEY, undefined, { fetch: notJson.f })).rejects.toThrow('no es JSON');
    const noList = fakeFetch(() => json({ models: [] }));
    await expect(listModels('openai', OPENAI_KEY, undefined, { fetch: noList.f })).rejects.toThrow('lista de modelos');
    await expect(listModels('openai', undefined, undefined, { fetch: noList.f })).rejects.toThrow('falta la API key');
  });

  it('se rinde si el proveedor no contesta a tiempo', async () => {
    const hang = (async (_i: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('abortado', 'AbortError'))))) as typeof fetch;
    const e = await listModels('openai', OPENAI_KEY, undefined, { fetch: hang, signal: AbortSignal.timeout(30) }).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.message).toBe('el proveedor no respondió a tiempo');
  });
});

describe('listModels (Anthropic, SDK oficial)', () => {
  const page = (ids: string[], hasMore: boolean) =>
    json({
      data: ids.map((id, i) => ({ type: 'model', id, display_name: id.replace('claude-', 'Claude '), created_at: `2026-0${9 - i}-01T00:00:00Z`, lifecycle: id.includes('3') ? 'deprecated' : 'active' })),
      has_more: hasMore,
      first_id: ids[0],
      last_id: ids.at(-1),
    });

  it('recorre todas las páginas con la key y conserva nombre, fecha y si está obsoleto', async () => {
    const { f, seen } = fakeFetch((url) => (url.searchParams.get('after_id') ? page(['claude-haiku-3'], false) : page(['claude-opus-5-5', 'claude-haiku-5-5'], true)));
    const list = await listModels('anthropic', ANT_KEY, undefined, { fetch: f });
    expect(list.map((m) => m.id)).toEqual(['claude-haiku-3', 'claude-opus-5-5', 'claude-haiku-5-5']);
    expect(list[1]).toMatchObject({ name: 'Claude opus-5-5' });
    expect(list[0]!.deprecated).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models\?/);
    expect(new URL(seen[1]!.url).searchParams.get('after_id')).toBe('claude-haiku-5-5');
    expect(seen[0]!.headers.get('authorization') ?? seen[0]!.headers.get('x-api-key')).toMatch(ANT_KEY);
  });

  it('un 401 se queda en el código, sin el mensaje del proveedor', async () => {
    const { f } = fakeFetch(() => json({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${ANT_KEY}` } }, 401));
    const e = await listModels('anthropic', ANT_KEY, undefined, { fetch: f }).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.status).toBe(401);
    expect(e.message).not.toContain('SECRETO');
  });
});

/* --- Rutas --- */
const dir = mkdtempSync(join(tmpdir(), 'bitopolis-models-'));
const { db } = await openDb(join(dir, 'models.db'));
const config = { ...loadConfig({}), dataDir: dir, clientDir: join(dir, 'x'), secret: 'clave-maestra-de-prueba-modelos-123' };
const store = await SettingsStore.open(db);
const ai = new AiService(db, config, store);
const asked: { provider: string; key?: string; baseUrl?: string }[] = [];
let fail: ProviderError | null = null;
ai.modelsOverride = async (provider, key, baseUrl) => {
  asked.push({ provider, key, baseUrl });
  if (fail) throw fail;
  return [{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', created: 2 }, { id: 'modelo-raro', created: 1 }];
};
const app = await buildApp(config, db, { store, ai });
let cookie = '';
beforeAll(async () => {
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { user: 'admin', password: 'admin' } });
  const first = login.cookies.find((c) => c.name === 'bitopolis_admin')!.value;
  const r = await app.inject({ method: 'POST', url: '/api/admin/account', payload: { currentPassword: 'admin', newPassword: 'plaza-mayor-2026' }, cookies: { bitopolis_admin: first } });
  cookie = r.cookies.find((c) => c.name === 'bitopolis_admin')!.value;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
const setServer = (ai2: { key?: string; model?: string; modelPremium?: string; playerKeys?: boolean }) =>
  store.update((s) => {
    delete s.ai.keyEnc;
    delete s.ai.keyMask;
    delete s.ai.model;
    delete s.ai.modelPremium;
    if (ai2.key) {
      s.ai.keyEnc = encryptSecret(ai2.key, config.secret);
      s.ai.keyMask = maskKey(ai2.key);
    }
    if (ai2.model) s.ai.model = ai2.model;
    if (ai2.modelPremium) s.ai.modelPremium = ai2.modelPremium;
    s.ai.playerKeys = ai2.playerKeys ?? true;
    return s;
  });
const adminReq = (method: 'GET' | 'POST', payload?: object, c = cookie) =>
  app.inject({ method, url: '/api/admin/ai/models', ...(payload ? { payload } : {}), cookies: { bitopolis_admin: c } });

describe('GET/POST /api/admin/ai/models', () => {
  it('sin sesión, 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/ai/models' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/admin/ai/models', payload: { key: ANT_KEY } })).statusCode).toBe(401);
  });

  it('con la key guardada: lista con aviso de precio y sin la key', async () => {
    await setServer({ key: ANT_KEY });
    asked.length = 0;
    const r = await adminReq('GET');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      provider: 'anthropic',
      models: [
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', priced: true },
        { id: 'modelo-raro', priced: false },
      ],
    });
    expect(r.body).not.toContain('SECRETO');
    expect(asked[0]).toEqual({ provider: 'anthropic', key: ANT_KEY, baseUrl: undefined });
  });

  it('POST prueba una key sin guardarla (el proveedor sale de la key)', async () => {
    asked.length = 0;
    const r = await adminReq('POST', { key: OPENAI_KEY });
    expect(r.statusCode).toBe(200);
    expect(r.json().provider).toBe('openai');
    expect(asked[0]!.key).toBe(OPENAI_KEY);
    expect(store.get().ai.keyMask).toBe(maskKey(ANT_KEY));
    expect((await adminReq('POST', { key: 'corta' })).json().error).toBe('La API key es demasiado corta');
  });

  it('errores del proveedor: 502 con un mensaje claro y sin la key', async () => {
    fail = new ProviderError('el proveedor respondió 401', 401);
    const r = await adminReq('GET');
    fail = null;
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toBe('La API key no es válida o no puede ver la lista de modelos');
    fail = new ProviderError('el proveedor no respondió a tiempo');
    expect((await adminReq('GET')).json().error).toBe('El proveedor no respondió en 10 segundos');
    fail = null;
  });

  it('sin key ni endpoint: 400', async () => {
    await setServer({});
    expect((await adminReq('GET')).statusCode).toBe(400);
  });
});

describe('/api/games/:token/ai/models', () => {
  const SID = 'sesion_modelos_1234';
  const gameReq = (token: string, method: 'GET' | 'POST' = 'GET', payload?: object) => app.inject({ method, url: `/api/games/${token}/ai/models`, ...(payload ? { payload } : {}) });

  it('key del jugador: prueba la escrita (POST) y luego usa la guardada (GET)', async () => {
    await setServer({ playerKeys: true });
    const token = newGameToken();
    expect((await gameReq(token)).statusCode).toBe(400);
    asked.length = 0;
    const probe = await gameReq(token, 'POST', { key: OPENAI_KEY });
    expect(probe.statusCode).toBe(200);
    expect(probe.json().provider).toBe('openai');
    expect(probe.body).not.toContain('SECRETO');
    const saved = await app.inject({ method: 'PUT', url: `/api/games/${token}/ai-config`, payload: { sessionId: SID, accepted: true, key: ANT_KEY } });
    expect(saved.statusCode).toBe(200);
    const r = await gameReq(token);
    expect(r.statusCode).toBe(200);
    expect(r.json().provider).toBe('anthropic');
    expect(asked.at(-1)!.key).toBe(ANT_KEY);
    // Ronda 16: la key guardada nunca va a otro endpoint (quien tenga el enlace no puede robarla).
    asked.length = 0;
    await gameReq(token, 'POST', { baseUrl: 'https://atacante.example/v1' });
    expect(asked.every((a) => a.key === undefined)).toBe(true);
  });

  it('sin permiso para keys propias, 403', async () => {
    await setServer({ playerKeys: false });
    expect((await gameReq(newGameToken(), 'POST', { key: OPENAI_KEY })).statusCode).toBe(403);
  });

  it('key del servidor: su lista si la partida elige modelo; 403 si el modelo está fijado', async () => {
    await setServer({ key: ANT_KEY });
    asked.length = 0;
    // Una key escrita por el jugador no sustituye a la del servidor.
    const r = await gameReq(newGameToken(), 'POST', { key: OPENAI_KEY });
    expect(r.statusCode).toBe(200);
    expect(r.json().provider).toBe('anthropic');
    expect(asked[0]!.key).toBe(ANT_KEY);
    expect(r.body).not.toContain('SECRETO');
    await setServer({ key: ANT_KEY, model: 'claude-haiku-5-5', modelPremium: 'claude-sonnet-5-5' });
    const locked = await gameReq(newGameToken());
    expect(locked.statusCode).toBe(403);
    expect(locked.json().error).toBe('El modelo lo fija el servidor');
  });
});
