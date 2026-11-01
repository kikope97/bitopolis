import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { GameToken } from '@bitopolis/shared';
import { migrate, viewSnapshot } from '@bitopolis/sim';
import type { Db } from './db/index.ts';
import { newGameToken } from './tokens.ts';

/**
 * 2.3: compartir el pueblo con un enlace de solo lectura /v/<view_token>.
 * - El token de vista es independiente del de juego (otro `newGameToken()`): con él no se
 *   puede reclamar, guardar, exportar ni regenerar (las rutas /api/games/* buscan solo por `token`).
 * - La vista solo busca por `view_token` y devuelve `viewSnapshot` (lista blanca del motor):
 *   sin estado interno, vecinos, IA, token de juego ni nada de `ai_config`.
 * - Crear o quitar el enlace exige el token de juego y la sesión que tiene la partida (como /save).
 * - Con la contraseña de acceso activa (auth.ts), /v/ y /api/view/ no la piden: el token de vista ya es secreto (decisión del creador).
 */
const TokenParams = z.object({ token: GameToken });
const ViewParams = z.object({ viewToken: GameToken });
const ShareBody = z.object({ sessionId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/) });

export const VIEW_RATE = { max: 30, timeWindow: '1 minute' };

export async function registerShareRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });
  const load = (token: string) =>
    db.selectFrom('games').select(['id', 'lease_session', 'view_token', 'view_created_at']).where('token', '=', token).executeTakeFirst();
  // Más estricto que /save: hace falta ser la última sesión que reclamó la partida (aunque su plazo haya vencido).
  const held = (row: { lease_session: string | null }, sessionId: string) => row.lease_session !== sessionId;
  const status = (row: { view_token?: string | null; view_created_at?: string | null }) =>
    row.view_token ? { active: true, viewToken: row.view_token, since: row.view_created_at ?? null } : { active: false };

  // Estado del enlace (solo con el token de juego).
  app.get('/api/games/:token/share', async (req, reply) => {
    const p = TokenParams.safeParse(req.params);
    if (!p.success) return bad(reply, 'enlace no válido');
    const row = await load(p.data.token);
    if (!row) return bad(reply, 'no existe', 404);
    reply.header('Cache-Control', 'no-store');
    return status(row);
  });

  app.post('/api/games/:token/share', async (req, reply) => {
    const p = TokenParams.safeParse(req.params);
    const b = ShareBody.safeParse(req.body);
    if (!p.success || !b.success) return bad(reply, 'petición no válida');
    const row = await load(p.data.token);
    if (!row) return bad(reply, 'no existe', 404);
    if (held(row, b.data.sessionId)) return reply.code(423).send({ error: 'Partida abierta en otro dispositivo', busy: true });
    reply.header('Cache-Control', 'no-store');
    if (row.view_token) return status(row);
    const viewToken = newGameToken();
    const since = new Date().toISOString();
    await db.updateTable('games').set({ view_token: viewToken, view_created_at: since }).where('id', '=', row.id).execute();
    return { active: true, viewToken, since };
  });

  // «Dejar de compartir»: el enlace deja de valer al momento (uno nuevo tendría otro token).
  app.delete('/api/games/:token/share', async (req, reply) => {
    const p = TokenParams.safeParse(req.params);
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return bad(reply, 'petición no válida');
      }
    }
    const b = ShareBody.safeParse(body);
    if (!p.success || !b.success) return bad(reply, 'petición no válida');
    const row = await load(p.data.token);
    if (!row) return bad(reply, 'no existe', 404);
    if (held(row, b.data.sessionId)) return reply.code(423).send({ error: 'Partida abierta en otro dispositivo', busy: true });
    await db.updateTable('games').set({ view_token: null, view_created_at: null }).where('id', '=', row.id).execute();
    return { active: false };
  });

  app.get('/api/view/:viewToken', { config: { rateLimit: VIEW_RATE } }, async (req, reply) => {
    const p = ViewParams.safeParse(req.params);
    if (!p.success) return bad(reply, 'no encontrado', 404);
    const row = await db.selectFrom('games').select(['state', 'updated_at']).where('view_token', '=', p.data.viewToken).executeTakeFirst();
    if (!row) return bad(reply, 'no encontrado', 404);
    reply.header('Cache-Control', 'private, max-age=60');
    return { snapshot: viewSnapshot(migrate(JSON.parse(row.state))), updatedAt: row.updated_at };
  });
}
