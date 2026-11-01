import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type SettingsStore, verifyPassword } from './settings.ts';

/**
 * Acceso común opcional (se activa en /admin). No son cuentas: una sola
 * contraseña para todo el servidor (por ejemplo, para que solo jueguen tus
 * amigos y nadie más gaste la API key). Sin usuario: no añade seguridad.
 */
const COOKIE = 'bitopolis_auth';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const PUBLIC = [
  /^\/healthz$/,
  /^\/login(\.html)?$/,
  /^\/api\/login$/,
  /^\/assets\//,
  /^\/favicon/,
  /^\/icons?\//,
  /^\/manifest/,
  /^\/sw\.js$/,
  // El panel tiene su propio inicio de sesión.
  /^\/admin(\.html)?\/?$/,
  /^\/api\/admin\//,
  // 2.3 (decisión del creador): la vista compartida ya va con su token secreto; no pide contraseña.
  /^\/v\/[A-Za-z0-9]{1,64}$/,
  /^\/api\/view\/(:viewToken|[A-Za-z0-9]{1,64})$/,
];

/** Ruta para decidir permisos: el patrón de la ruta resuelta o, si no hay, la ruta decodificada. */
export function routePath(req: FastifyRequest): string {
  if (req.routeOptions.url) return req.routeOptions.url;
  const raw = req.url.split('?')[0]!;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Cookie firmada `caducidad.firma`. Cambiar `scope` (p. ej. la contraseña) invalida las abiertas. */
export function signedCookie(secret: string, scope: () => string) {
  const key = () => createHash('sha256').update(`${secret}:${scope()}`).digest();
  const sign = (exp: number) => `${exp}.${createHmac('sha256', key()).update(String(exp)).digest('base64url')}`;
  const valid = (v: string | undefined) => {
    if (!v) return false;
    const [exp] = v.split('.');
    const n = Number(exp);
    return Number.isFinite(n) && n > Date.now() && safeEqual(sign(n), v);
  };
  return { sign, valid };
}

/** Bloqueo por IP tras 5 intentos fallidos (15 min). */
export function lockout() {
  const fails = new Map<string, { count: number; until: number }>();
  return {
    locked: (ip: string) => (fails.get(ip)?.until ?? 0) > Date.now(),
    fail(ip: string) {
      const f = fails.get(ip);
      const count = (f && f.until > Date.now() ? f.count : (f?.count ?? 0)) + 1;
      fails.set(ip, { count: count >= MAX_FAILS ? 0 : count, until: count >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
      if (fails.size > 10_000) fails.delete(fails.keys().next().value!);
    },
    ok: (ip: string) => fails.delete(ip),
  };
}

export function setCookie(req: FastifyRequest, reply: FastifyReply, name: string, value: string, ms: number, path = '/'): void {
  reply.setCookie(name, value, { path, httpOnly: true, sameSite: 'strict', secure: req.protocol === 'https', maxAge: ms / 1000 });
}

export async function registerAuth(app: FastifyInstance, store: SettingsStore, secret: string): Promise<void> {
  await app.register(cookie);
  const session = signedCookie(secret, () => `access:${store.get().access.hash}:${store.get().access.epoch ?? 0}`);
  const guard = lockout();
  const enabled = () => store.get().access.enabled && !!store.get().access.hash;

  app.addHook('onRequest', async (req, reply) => {
    if (!enabled()) return;
    const path = routePath(req);
    if (PUBLIC.some((r) => r.test(path))) return;
    if (session.valid(req.cookies[COOKIE])) return;
    if (path.startsWith('/api/')) return reply.code(401).send({ error: 'Hace falta iniciar sesión' });
    return reply.redirect(`/login.html?next=${encodeURIComponent(path)}`);
  });

  const Body = z.object({ password: z.string().max(500) });
  app.post('/api/login', async (req, reply) => {
    if (!enabled()) return { ok: true };
    if (guard.locked(req.ip)) return reply.code(429).send({ error: 'Demasiados intentos. Espera unos minutos.' });
    const b = Body.safeParse(req.body);
    const ok = b.success && (await verifyPassword(b.data.password, store.get().access.hash));
    if (!ok) {
      guard.fail(req.ip);
      return reply.code(401).send({ error: 'Contraseña incorrecta' });
    }
    guard.ok(req.ip);
    setCookie(req, reply, COOKIE, session.sign(Date.now() + SESSION_MS), SESSION_MS);
    return { ok: true };
  });
}
