import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * Acceso común opcional (BITOPOLIS_PASSWORD). No son cuentas: una sola
 * contraseña para todo el servidor (por ejemplo, para que solo jueguen tus
 * amigos y nadie más gaste la API key). Sin usuario: no añade seguridad.
 */
const COOKIE = 'bitopolis_auth';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const PUBLIC = [/^\/healthz$/, /^\/login(\.html)?$/, /^\/api\/login$/, /^\/assets\//, /^\/favicon/, /^\/icon/, /^\/manifest/];

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function registerAuth(
  app: FastifyInstance,
  opts: { password: string; secret: string },
): Promise<void> {
  await app.register(cookie);
  // Cambiar la contraseña invalida las sesiones abiertas.
  const key = createHash('sha256').update(`${opts.secret}:${opts.password}`).digest();
  const sign = (exp: number) => `${exp}.${createHmac('sha256', key).update(String(exp)).digest('base64url')}`;
  const valid = (v: string | undefined) => {
    if (!v) return false;
    const [exp] = v.split('.');
    const n = Number(exp);
    return Number.isFinite(n) && n > Date.now() && safeEqual(sign(n), v);
  };
  const fails = new Map<string, { count: number; until: number }>();

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (PUBLIC.some((r) => r.test(path))) return;
    if (valid(req.cookies[COOKIE])) return;
    if (path.startsWith('/api/')) return reply.code(401).send({ error: 'Hace falta iniciar sesión' });
    return reply.redirect(`/login.html?next=${encodeURIComponent(path)}`);
  });

  const Body = z.object({ password: z.string().max(500) });
  app.post('/api/login', async (req, reply) => {
    const ip = req.ip;
    const f = fails.get(ip);
    if (f && f.until > Date.now()) {
      return reply.code(429).send({ error: 'Demasiados intentos. Espera unos minutos.' });
    }
    const b = Body.safeParse(req.body);
    const ok = b.success && safeEqual(b.data.password, opts.password);
    if (!ok) {
      const count = (f && f.until > Date.now() ? f.count : f?.count ?? 0) + 1;
      fails.set(ip, { count: count >= MAX_FAILS ? 0 : count, until: count >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
      return reply.code(401).send({ error: 'Contraseña incorrecta' });
    }
    fails.delete(ip);
    reply.setCookie(COOKIE, sign(Date.now() + SESSION_MS), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: SESSION_MS / 1000,
    });
    return { ok: true };
  });
}
