import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type { HealthResponse } from '@bitopolis/shared';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import { registerAuth } from './auth.ts';
import { registerAiRoutes } from './ai/routes.ts';
import { AiService } from './ai/service.ts';
import { registerGameRoutes } from './games.ts';
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

export async function buildApp(config: Config, db: Db, ai = new AiService(db, config)): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // La URL de la partida es una contraseña: no se escribe en los logs.
      serializers: { req: (req) => ({ method: req.method, url: req.url.replace(/\/p\/[^/?]+|\/api\/games\/[^/?]+/g, (m) => m.replace(/[^/]+$/, '…')) }) },
    },
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', allowList: (req) => req.url === '/healthz' });

  if (config.user && config.password) {
    await registerAuth(app, { user: config.user, password: config.password, secret: config.masterKey ?? 'bitopolis' });
  }

  // Entrar en / crea una URL nueva. La partida no se guarda hasta pulsar Jugar.
  app.get('/', async (_req, reply) => reply.redirect(`/p/${newGameToken()}`));
  await registerGameRoutes(app, db, config, ai);
  await registerAiRoutes(app, db, config, ai);

  app.get('/healthz', async (): Promise<HealthResponse> => {
    await sql`select 1`.execute(db);
    return { ok: true, version: config.version, db: 'ok' };
  });

  if (existsSync(config.clientDir)) {
    await app.register(fastifyStatic, { root: config.clientDir, wildcard: false, index: false });
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
