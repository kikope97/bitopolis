import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { tickToDate } from '@bitopolis/shared';
import { migrate } from '@bitopolis/sim';
import { DEFAULT_PRICES, PROVIDER_INFO, providerFromKey } from './ai/catalog.ts';
import { encryptSecret, maskKey } from './ai/crypto.ts';
import { makeProvider } from './ai/providers.ts';
import { estimatePerGameDay } from './ai/routes.ts';
import { type AiService, ModelsError } from './ai/service.ts';
import { lockout, safeEqual, setCookie, signedCookie } from './auth.ts';
import type { Config } from './config.ts';
import { backupNow, BACKUP_RE } from './db/backup.ts';
import type { Db } from './db/index.ts';
import { DEFAULT_ADMIN, hashPassword, type ServerSettings, type SettingsStore, verifyPassword } from './settings.ts';

/**
 * Panel de administración (/admin): todo lo que antes eran variables de
 * entorno (decisión del creador). Usuario y contraseña propios, admin/admin la
 * primera vez, con cambio obligatorio antes de tocar nada.
 */
const COOKIE = 'bitopolis_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;

const Login = z.object({ user: z.string().max(100), password: z.string().max(500) });
const Account = z.object({
  currentPassword: z.string().max(500),
  user: z.string().trim().min(1).max(64).regex(/^[\w.@-]+$/, 'solo letras, números y . _ @ -').optional(),
  newPassword: z.string().min(8, 'la contraseña nueva necesita al menos 8 caracteres').max(500).optional(),
});
const Money = z.number().min(0).max(100_000).nullable();
const PriceSchema = z.object({ in: z.number().min(0).max(1000), cachedIn: z.number().min(0).max(1000).optional(), out: z.number().min(0).max(1000) });
const Patch = z.object({
  publicUrl: z.string().trim().max(512).refine((v) => v === '' || /^https?:\/\/[^\s/]+(\/.*)?$/.test(v), 'URL no válida (http:// o https://)').optional(),
  newGames: z.boolean().optional(),
  access: z.object({ enabled: z.boolean(), password: z.string().min(4, 'la contraseña de las partidas necesita al menos 4 caracteres').max(500).optional() }).optional(),
  ai: z
    .object({
      /** Key nueva; null la borra; ausente la deja como está. */
      key: z.string().trim().min(8).max(400).nullable().optional(),
      baseUrl: z.string().trim().url().max(512).or(z.literal('')).optional(),
      model: z.string().trim().max(128).optional(),
      modelPremium: z.string().trim().max(128).optional(),
      maxCitizens: z.number().int().min(1).max(20).optional(),
      serverMonthly: Money.optional(),
      gameMonthly: Money.optional(),
      gameDaily: Money.optional(),
      prices: z.record(z.string().min(1).max(128), PriceSchema).nullable().optional(),
      playerKeys: z.boolean().optional(),
    })
    .optional(),
  backups: z.object({ keep: z.number().int().min(1).max(60) }).optional(),
});
export type AdminPatch = z.infer<typeof Patch>;
/** Probar una key (o un endpoint) aún sin guardar; lo que falte, lo guardado. */
const ModelsBody = z.object({
  key: z.string().trim().min(8, 'La API key es demasiado corta').max(400).optional(),
  baseUrl: z.string().trim().url('El endpoint no es una URL válida').max(512).or(z.literal('')).optional(),
});

/** Lo que ve el panel: nada de hashes ni la key. */
export function adminView(s: ServerSettings, version: string) {
  // La máscara conserva el prefijo «sk-ant-», que basta para deducir el proveedor.
  const provider = providerFromKey(s.ai.keyMask, s.ai.baseUrl);
  return {
    version,
    admin: { user: s.admin.user, mustChange: s.admin.mustChange },
    publicUrl: s.publicUrl,
    newGames: s.newGames,
    access: { enabled: s.access.enabled, hasPassword: !!s.access.hash },
    ai: {
      hasKey: !!s.ai.keyEnc,
      keyMask: s.ai.keyMask ?? null,
      provider: s.ai.keyEnc || s.ai.baseUrl ? provider : null,
      baseUrl: s.ai.baseUrl ?? '',
      model: s.ai.model ?? '',
      modelPremium: s.ai.modelPremium ?? '',
      maxCitizens: s.ai.maxCitizens,
      serverMonthly: s.ai.serverMonthly ?? null,
      gameMonthly: s.ai.gameMonthly ?? null,
      gameDaily: s.ai.gameDaily ?? null,
      prices: s.ai.prices ?? null,
      playerKeys: s.ai.playerKeys,
    },
    backups: s.backups,
  };
}

const opt = <T>(v: T | null | undefined) => (v === null || v === undefined || v === '' ? undefined : v);

export async function registerAdminRoutes(
  app: FastifyInstance,
  deps: { db: Db; raw?: Database.Database; config: Config; store: SettingsStore; ai: AiService },
): Promise<void> {
  const { db, raw, config, store, ai } = deps;
  const session = signedCookie(config.secret, () => `admin:${store.get().admin.user}:${store.get().admin.hash}:${store.get().admin.epoch ?? 0}`);
  const guard = lockout();
  const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });
  const zodError = (e: z.ZodError) => e.issues[0]?.message ?? 'datos no válidos';
  const view = () => adminView(store.get(), config.version);
  /** Coste orientativo con lo guardado: un mes de juego (30 días) y una hora real a x1. */
  const estimate = async () => {
    const s = await ai.settings(null);
    const n = store.get().ai.maxCitizens;
    const day = estimatePerGameDay(ai, s.provider, s.model, s.modelPremium, n);
    return { citizens: n, provider: s.provider, eurPerGameMonth: day * 30, eurPerHourX1: day * 180, known: s.model in ai.prices || s.provider === 'openai-compatible' };
  };

  // Todo /api/admin pide sesión, salvo entrar; con admin/admin solo se puede cambiar la cuenta.
  const OPEN = new Set(['/api/admin/login', '/api/admin/logout']);
  const BEFORE_CHANGE = new Set(['/api/admin/me', '/api/admin/account']);
  app.addHook('onRequest', async (req, reply) => {
    // El patrón de la ruta ya resuelta, no req.url: «/api/%61dmin/…» llega a la misma ruta.
    const path = req.routeOptions.url ?? '';
    if (!path.startsWith('/api/admin/') || OPEN.has(path)) return;
    if (!session.valid(req.cookies?.[COOKIE])) return reply.code(401).send({ error: 'Inicia sesión como administrador' });
    if (store.get().admin.mustChange && !BEFORE_CHANGE.has(path)) {
      return reply.code(403).send({ error: 'Cambia la contraseña del administrador antes de seguir', mustChange: true });
    }
  });

  app.post('/api/admin/login', async (req, reply) => {
    if (guard.locked(req.ip)) return bad(reply, 'Demasiados intentos. Espera unos minutos.', 429);
    const b = Login.safeParse(req.body);
    const s = store.get().admin;
    // scrypt siempre, aunque el usuario no coincida: el tiempo no delata qué usuarios existen.
    const pwOk = await verifyPassword(b.success ? b.data.password : '', s.hash);
    const ok = b.success && safeEqual(b.data.user, s.user) && pwOk;
    if (!ok) {
      guard.fail(req.ip);
      return bad(reply, 'Usuario o contraseña incorrectos', 401);
    }
    guard.ok(req.ip);
    setCookie(req, reply, COOKIE, session.sign(Date.now() + SESSION_MS), SESSION_MS);
    return { ok: true, mustChange: s.mustChange };
  });

  app.post('/api/admin/logout', async (req, reply) => {
    // Salir cierra todas las sesiones del panel (una cookie robada deja de valer).
    if (session.valid(req.cookies?.[COOKIE])) await store.update((s) => ({ ...s, admin: { ...s.admin, epoch: (s.admin.epoch ?? 0) + 1 } }));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/admin/me', async () => ({ user: store.get().admin.user, mustChange: store.get().admin.mustChange }));

  app.post('/api/admin/account', async (req, reply) => {
    const b = Account.safeParse(req.body);
    if (!b.success) return bad(reply, zodError(b.error));
    const s = store.get().admin;
    if (!(await verifyPassword(b.data.currentPassword, s.hash))) return bad(reply, 'La contraseña actual no es correcta', 401);
    const pw = b.data.newPassword;
    if (s.mustChange && !pw) return bad(reply, 'Elige una contraseña nueva');
    if (pw && pw === DEFAULT_ADMIN.password) return bad(reply, 'La contraseña nueva no puede ser «admin»');
    if (pw && pw === b.data.currentPassword) return bad(reply, 'La contraseña nueva tiene que ser distinta');
    const hash = pw ? await hashPassword(pw) : s.hash;
    await store.update((x) => ({ ...x, admin: { ...x.admin, user: b.data.user ?? x.admin.user, hash, mustChange: false } }));
    // La firma depende del usuario y la contraseña: se renueva la sesión de quien la cambia.
    setCookie(req, reply, COOKIE, session.sign(Date.now() + SESSION_MS), SESSION_MS);
    return { ok: true, user: store.get().admin.user };
  });

  app.get('/api/admin/settings', async () => ({
    ...view(),
    estimate: await estimate(),
    defaults: {
      prices: DEFAULT_PRICES,
      models: Object.fromEntries((['anthropic', 'openai', 'openai-compatible'] as const).map((p) => [p, { cheap: PROVIDER_INFO[p].cheap, premium: PROVIDER_INFO[p].premium, models: PROVIDER_INFO[p].models ?? [] }])),
    },
  }));

  app.put('/api/admin/settings', async (req, reply) => {
    const b = Patch.safeParse(req.body);
    if (!b.success) return bad(reply, zodError(b.error));
    const p = b.data;
    const accessHash = p.access?.password ? await hashPassword(p.access.password) : undefined;
    if (p.access?.enabled && !accessHash && !store.get().access.hash) return bad(reply, 'Pon una contraseña para proteger las partidas');
    await store.update((s) => {
      if (p.publicUrl !== undefined) s.publicUrl = p.publicUrl.replace(/\/+$/, '');
      if (p.newGames !== undefined) s.newGames = p.newGames;
      if (p.access) s.access = { enabled: p.access.enabled, hash: accessHash ?? s.access.hash, epoch: (s.access.epoch ?? 0) + 1 };
      if (p.backups) s.backups = p.backups;
      const a = p.ai;
      if (a) {
        if (a.key === null) {
          delete s.ai.keyEnc;
          delete s.ai.keyMask;
        } else if (a.key) {
          s.ai.keyEnc = encryptSecret(a.key, config.secret);
          s.ai.keyMask = maskKey(a.key);
        }
        if (a.baseUrl !== undefined) s.ai.baseUrl = opt(a.baseUrl);
        if (a.model !== undefined) s.ai.model = opt(a.model);
        if (a.modelPremium !== undefined) s.ai.modelPremium = opt(a.modelPremium);
        if (a.maxCitizens !== undefined) s.ai.maxCitizens = a.maxCitizens;
        if (a.serverMonthly !== undefined) s.ai.serverMonthly = opt(a.serverMonthly);
        if (a.gameMonthly !== undefined) s.ai.gameMonthly = opt(a.gameMonthly);
        if (a.gameDaily !== undefined) s.ai.gameDaily = opt(a.gameDaily);
        if (a.prices !== undefined) s.ai.prices = a.prices && Object.keys(a.prices).length ? a.prices : undefined;
        if (a.playerKeys !== undefined) s.ai.playerKeys = a.playerKeys;
      }
      return s;
    });
    return { ...view(), estimate: await estimate() };
  });

  /** Prueba la IA del servidor con una petición mínima (cuenta en el gasto). */
  app.post('/api/admin/ai/test', async (_req, reply) => {
    const s = await ai.settings(null);
    if (!s.configured) return bad(reply, 'No hay API key ni endpoint propio en el servidor');
    const t0 = Date.now();
    try {
      const provider = ai.providerOverride ? ai.providerOverride(s) : makeProvider(s.provider, s.key, s.baseUrl);
      const r = await provider.complete(
        {
          system: 'Eres una prueba de conexión. Responde solo con el JSON pedido.',
          user: 'Devuelve {"ok": true}.',
          schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
          model: s.model,
          maxTokens: 40,
        },
        AbortSignal.timeout(20_000),
      );
      const ok = /"ok"\s*:\s*true/.test(r.text);
      return { ok, provider: s.provider, model: s.model, ms: Date.now() - t0, ...(ok ? {} : { error: 'La respuesta no tenía el formato esperado' }) };
    } catch (e) {
      // El mensaje del proveedor no incluye la key; se recorta por si acaso.
      return { ok: false, provider: s.provider, model: s.model, ms: Date.now() - t0, error: String((e as Error).message).slice(0, 300) };
    }
  });

  /** Modelos que ofrece la key del servidor (GET) o una por guardar (POST). La key nunca vuelve. */
  const listFor = async (reply: FastifyReply, key: string | undefined, baseUrl: string | undefined) => {
    if (!key && !baseUrl) return bad(reply, 'No hay API key ni endpoint propio: pon la key primero');
    try {
      return await ai.models(providerFromKey(key, baseUrl), key, baseUrl);
    } catch (e) {
      if (e instanceof ModelsError) return bad(reply, e.message, 502);
      throw e;
    }
  };
  app.get('/api/admin/ai/models', async (_req, reply) => {
    const s = await ai.settings(null);
    return listFor(reply, s.key, s.baseUrl);
  });
  app.post('/api/admin/ai/models', async (req, reply) => {
    const b = ModelsBody.safeParse(req.body ?? {});
    if (!b.success) return bad(reply, zodError(b.error));
    const s = await ai.settings(null);
    const baseUrl = b.data.baseUrl === undefined ? s.baseUrl : opt(b.data.baseUrl);
    return listFor(reply, b.data.key ?? s.key, baseUrl);
  });

  app.get('/api/admin/stats', async () => {
    const monthKey = new Date().toISOString().slice(0, 7);
    const spend = await db.selectFrom('ai_usage').select((eb) => eb.fn.sum<number>('eur').as('eur')).where('month', '=', monthKey).executeTakeFirst();
    const games = await db.selectFrom('games').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    return { version: config.version, games: Number(games?.n ?? 0), aiMonthEur: Number(spend?.eur ?? 0), serverMonthly: store.get().ai.serverMonthly ?? null };
  });

  app.get('/api/admin/games', async () => {
    const monthKey = new Date().toISOString().slice(0, 7);
    const rows = await db.selectFrom('games').select(['id', 'token', 'mode', 'created_at', 'updated_at', 'state']).orderBy('updated_at', 'desc').limit(500).execute();
    const spend = await db.selectFrom('ai_usage').select(['game_id', (eb) => eb.fn.sum<number>('eur').as('eur')]).where('month', '=', monthKey).groupBy('game_id').execute();
    const byGame = new Map(spend.map((r) => [r.game_id, Number(r.eur)]));
    return rows.map((r) => {
      let population = 0;
      let date: ReturnType<typeof tickToDate> | null = null;
      try {
        const st = migrate(JSON.parse(r.state));
        population = st.citizens.length;
        date = tickToDate(st.tick);
      } catch {
        /* partida dañada: se lista igualmente para poder borrarla */
      }
      return { token: r.token, mode: r.mode, createdAt: r.created_at, updatedAt: r.updated_at, population, date, aiMonthEur: byGame.get(r.id) ?? 0 };
    });
  });

  app.delete('/api/admin/games/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const r = await db.deleteFrom('games').where('token', '=', token).executeTakeFirst();
    if (!Number(r.numDeletedRows)) return bad(reply, 'Esa partida no existe', 404);
    return { ok: true };
  });

  const backupsDir = join(config.dataDir, 'backups');
  app.get('/api/admin/backups', async () => {
    if (!existsSync(backupsDir)) return [];
    return readdirSync(backupsDir)
      .filter((f) => BACKUP_RE.test(f))
      .sort()
      .reverse()
      .map((f) => ({ name: f, size: statSync(join(backupsDir, f)).size }));
  });

  app.post('/api/admin/backups', async (_req, reply) => {
    if (!raw) return bad(reply, 'Copias no disponibles', 503);
    const file = await backupNow(raw, config.dataDir, new Date(), store.get().backups.keep);
    return { ok: true, name: file.split('/').pop() };
  });

  app.get('/api/admin/backups/:name', async (req, reply) => {
    const name = (req.params as { name: string }).name;
    if (!BACKUP_RE.test(name) || !existsSync(join(backupsDir, name))) return bad(reply, 'Esa copia no existe', 404);
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return reply.type('application/octet-stream').send(createReadStream(join(backupsDir, name)));
  });
}
