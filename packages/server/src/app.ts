import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type Database from 'better-sqlite3';
import type { HealthResponse } from '@bitopolis/shared';
import { registerAdminRoutes } from './admin.ts';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import { registerAuth } from './auth.ts';
import { registerAiRoutes } from './ai/routes.ts';
import { AiService } from './ai/service.ts';
import { registerGameRoutes } from './games.ts';
import { SettingsStore } from './settings.ts';
import { newGameToken } from './tokens.ts';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface AppDeps {
  store?: SettingsStore;
  ai?: AiService;
  /** Conexión SQLite directa, para las copias desde /admin. */
  raw?: Database.Database;
}

export async function buildApp(config: Config, db: Db, deps: AppDeps = {}): Promise<FastifyInstance> {
  const store = deps.store ?? (await SettingsStore.open(db));
  const ai = deps.ai ?? new AiService(db, config, store);
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // La URL de la partida es una contraseña: no se escribe en los logs.
      serializers: { req: (req) => ({ method: req.method, url: req.url.replace(/\/p\/[^/?]+|\/api\/games\/[^/?]+/g, (m) => m.replace(/[^/]+$/, '…')) }) },
    },
    // Solo se cree X-Forwarded-For si viene de un proxy local (Docker, LAN): desde fuera se podría falsear la IP.
    trustProxy: ['loopback', 'linklocal', 'uniquelocal'],
    bodyLimit: 8 * 1024 * 1024,
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  // El límite protege la API (y la key de IA); los archivos estáticos con hash no cuentan.
  const STATIC = /^\/(assets|icons)\/|^\/(sw\.js|manifest\.webmanifest|healthz)$/;
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', allowList: (req) => STATIC.test(req.url.split('?')[0]!) });

  // La contraseña de las partidas se activa o quita en /admin sin reiniciar.
  await registerAuth(app, store, config.secret);

  // Entrar en / crea una URL nueva. La partida no se guarda hasta pulsar Jugar.
  // Desde el icono instalado (PWA) se abre la app y ella vuelve a la última partida del dispositivo.
  app.get('/', async (req, reply) => {
    if ((req.query as Record<string, string>).pwa !== undefined && existsSync(config.clientDir)) return reply.type('text/html').sendFile('index.html');
    return reply.redirect(`/p/${newGameToken()}`);
  });
  await registerGameRoutes(app, db, store, ai);
  await registerAiRoutes(app, db, config, ai, store);
  await registerAdminRoutes(app, { db, raw: deps.raw, config, store, ai });

  app.get('/healthz', async (): Promise<HealthResponse> => {
    await sql`select 1`.execute(db);
    return { ok: true, version: config.version, db: 'ok' };
  });

  if (existsSync(config.clientDir)) {
    await app.register(fastifyStatic, { root: config.clientDir, wildcard: false, index: false });
    app.get('/admin', async (_req, reply) => reply.type('text/html').sendFile('admin.html'));
    // SPA: cualquier ruta que no sea de la API devuelve index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'no encontrado' });
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.log.warn(`No existe el cliente compilado en ${config.clientDir}`);
  }
  return app;
}
