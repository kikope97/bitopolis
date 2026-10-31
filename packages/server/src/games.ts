import { gunzipSync, gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { GameToken, TimedCommand, tickToDate } from '@bitopolis/shared';
import {
  applyCommand,
  averageHappiness,
  checkInvariants,
  createInitialState,
  FORMAT_VERSION,
  type GameState,
  hashState,
  migrate,
  step,
} from '@bitopolis/sim';
import type { AiService } from './ai/service.ts';
import type { Db } from './db/index.ts';
import type { SettingsStore } from './settings.ts';
import { newGameToken, newSeed } from './tokens.ts';

/** Tiempo que una pestaña conserva la partida sin dar señales. */
export const LEASE_MS = 90_000;
const MAX_TICKS_PER_SAVE = 24 * 30;

const TokenParams = z.object({ token: GameToken });
const SessionId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const CreateBody = z.object({ mode: z.enum(['normal', 'ai']), sessionId: SessionId });
const ClaimBody = z.object({ sessionId: SessionId, force: z.boolean().optional() });
const SaveBody = z.object({
  sessionId: SessionId,
  fromTick: z.number().int().min(0),
  toTick: z.number().int().min(0),
  commands: z.array(TimedCommand).max(5_000),
  hash: z.string().regex(/^[0-9a-f]{16}$/),
  /** false en pausa, con la pestaña oculta o al salir: entonces no se llama a la IA. */
  live: z.boolean().optional(),
});

export interface ExportFile {
  bitopolis: 1;
  formatVersion: number;
  exportedAt: string;
  mode: string;
  state: GameState;
}

export function summarize(state: GameState) {
  const d = tickToDate(state.tick);
  const headline = [...state.events].reverse().find((e) => e.kind !== 'tax')?.text ?? null;
  return {
    population: state.citizens.length,
    date: d,
    treasury: state.treasury,
    happiness: Math.round(averageHappiness(state)),
    headline,
  };
}

/** Reproduce los comandos del cliente sobre el estado guardado. */
export function replayOnto(state: GameState, commands: z.infer<typeof TimedCommand>[], toTick: number): GameState {
  const sorted = [...commands].sort((a, b) => a.tick - b.tick);
  let i = 0;
  while (i < sorted.length && sorted[i]!.tick < state.tick) i++;
  while (state.tick < toTick) {
    while (i < sorted.length && sorted[i]!.tick === state.tick) applyCommand(state, sorted[i++]!.cmd);
    step(state);
  }
  while (i < sorted.length && sorted[i]!.tick === state.tick) applyCommand(state, sorted[i++]!.cmd);
  return state;
}

export async function registerGameRoutes(app: FastifyInstance, db: Db, store: SettingsStore, ai: AiService): Promise<void> {
  const closed = 'Este servidor no admite partidas nuevas';
  const load = (token: string) => db.selectFrom('games').selectAll().where('token', '=', token).executeTakeFirst();
  const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });
  const now = () => Date.now();

  app.get('/api/games/:token', async (req, reply) => {
    const p = TokenParams.safeParse(req.params);
    if (!p.success) return bad(reply, 'enlace no válido');
    const row = await load(p.data.token);
    if (!row) return { exists: false };
    const state = migrate(JSON.parse(row.state));
    return { exists: true, mode: row.mode, summary: summarize(state) };
  });

  app.post('/api/games/:token', async (req, reply) => {
    const p = TokenParams.safeParse(req.params);
    const b = CreateBody.safeParse(req.body);
    if (!p.success || !b.success) return bad(reply, 'petición no válida');
    if (await load(p.data.token)) return bad(reply, 'la partida ya existe', 409);
    if (!store.get().newGames) return bad(reply, closed, 403);
    // Siempre se elige: también con IA del servidor se puede jugar en Modo normal (decisión del creador, v1.3.1).
    const mode = b.data.mode;
    if (mode === 'ai' && !(await ai.settings(null)).configured) return bad(reply, 'Configura la IA antes de jugar en Modo IA');
    const seed = newSeed();
    const state = createInitialState({ seed, aiMode: mode === 'ai', namedLimit: store.get().ai.maxCitizens, aiShare: store.get().ai.aiShare ?? 50 });
    const ts = new Date().toISOString();
    await db
      .insertInto('games')
      .values({
        token: p.data.token,
        created_at: ts,
        updated_at: ts,
        mode,
        format_version: FORMAT_VERSION,
        state: JSON.stringify(state),
        seed,
        lease_session: b.data.sessionId,
        lease_until: now() + LEASE_MS,
      })
      .execute();
    return { state, mode };
  });

  app.post('/api/games/:token/claim', async (req, reply) => {
    const p = TokenParams.safeParse(req.params);
    const b = ClaimBody.safeParse(req.body);
    if (!p.success || !b.success) return bad(reply, 'petición no válida');
    const row = await load(p.data.token);
    if (!row) return bad(reply, 'no existe', 404);
    const held = row.lease_session && row.lease_session !== b.data.sessionId && row.lease_until > now();
    if (held && !b.data.force) return reply.code(423).send({ error: 'Partida abierta en otro dispositivo', busy: true });
    await db
      .updateTable('games')
      .set({ lease_session: b.data.sessionId, lease_until: now() + LEASE_MS })
      .where('id', '=', row.id)
      .execute();
    return { state: migrate(JSON.parse(row.state)), mode: row.mode };
  });

  app.post('/api/games/:token/release', async (req) => {
    const p = TokenParams.safeParse(req.params);
    const b = ClaimBody.safeParse(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
    if (!p.success || !b.success) return { ok: false };
    await db
      .updateTable('games')
      .set({ lease_until: 0 })
      .where('token', '=', p.data.token)
      .where('lease_session', '=', b.data.sessionId)
      .execute();
    return { ok: true };
  });

  /**
   * Guardado: el cliente manda solo los comandos desde el último guardado y
   * el hash del estado al que ha llegado. El servidor los reproduce y, si el
   * hash coincide, guarda. Así el servidor es la fuente de verdad.
   */
  app.put('/api/games/:token/save', async (req, reply) => {
    const p = TokenParams.safeParse(req.params);
    const b = SaveBody.safeParse(req.body);
    if (!p.success || !b.success) return bad(reply, 'petición no válida');
    const { sessionId, fromTick, toTick, commands, hash, live } = b.data;
    if (toTick < fromTick || toTick - fromTick > MAX_TICKS_PER_SAVE) return bad(reply, 'rango de ticks no válido');
    const row = await load(p.data.token);
    if (!row) return bad(reply, 'no existe', 404);
    if (row.lease_session !== sessionId && row.lease_until > now()) {
      return reply.code(423).send({ error: 'Partida abierta en otro dispositivo', busy: true });
    }
    const state = migrate(JSON.parse(row.state));
    if (state.tick !== fromTick) return reply.code(409).send({ error: 'desincronizado', state });
    // 2.0: con la IA del servidor, el % de vecinos con IA lo fija /admin (la partida no lo cambia).
    if (commands.some((c) => c.cmd.type === 'SetAiShare') && (await ai.settings(row.id)).locked.includes('key')) {
      return reply.code(403).send({ error: 'El % de vecinos con IA lo fija el servidor', state: migrate(JSON.parse(row.state)) });
    }
    replayOnto(state, commands, toTick);
    if (hashState(state) !== hash) {
      req.log.warn({ token: '…', fromTick, toTick }, 'hash distinto en el guardado');
      const fresh = migrate(JSON.parse(row.state));
      return reply.code(409).send({ error: 'desincronizado', state: fresh });
    }
    await db
      .updateTable('games')
      .set({
        state: JSON.stringify(state),
        updated_at: new Date().toISOString(),
        format_version: FORMAT_VERSION,
        lease_session: sessionId,
        lease_until: now() + LEASE_MS,
      })
      .where('id', '=', row.id)
      .execute();
    // Petición anticipada: al cerrar el día N se piden las decisiones del N+1.
    if (row.mode === 'ai' && live) void ai.onSaved(row.id, state);
    return { ok: true, tick: state.tick };
  });

  app.post('/api/games/:token/regenerate', async (req, reply) => {
    const p = TokenParams.safeParse(req.params);
    const b = ClaimBody.safeParse(req.body);
    if (!p.success || !b.success) return bad(reply, 'petición no válida');
    const row = await load(p.data.token);
    if (!row) return bad(reply, 'no existe', 404);
    const token = newGameToken();
    await db.updateTable('games').set({ token, lease_session: b.data.sessionId }).where('id', '=', row.id).execute();
    return { token };
  });

  app.get('/api/games/:token/export', async (req, reply) => {
    const p = TokenParams.safeParse(req.params);
    if (!p.success) return bad(reply, 'enlace no válido');
    const row = await load(p.data.token);
    if (!row) return bad(reply, 'no existe', 404);
    // Nunca incluye la API key: solo modo y estado.
    const file: ExportFile = {
      bitopolis: 1,
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      mode: row.mode,
      state: migrate(JSON.parse(row.state)),
    };
    const day = summarize(file.state).date;
    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="bitopolis-a${day.year}-m${day.month}.bitopolis"`);
    return gzipSync(JSON.stringify(file));
  });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 8 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.post('/api/import', async (req, reply) => {
    if (!store.get().newGames) return bad(reply, closed, 403);
    if (!Buffer.isBuffer(req.body)) return bad(reply, 'archivo no válido');
    let file: ExportFile;
    try {
      file = JSON.parse(gunzipSync(req.body, { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8'));
    } catch {
      return bad(reply, 'El archivo no es una partida de Bitópolis');
    }
    if (file?.bitopolis !== 1 || typeof file.state !== 'object') return bad(reply, 'El archivo no es una partida de Bitópolis');
    let state: GameState;
    try {
      state = migrate(file.state);
    } catch (e) {
      return bad(reply, `No se puede importar: ${(e as Error).message}`);
    }
    const errors = checkInvariants(state);
    if (errors.length) return bad(reply, 'La partida del archivo está dañada');
    const token = newGameToken();
    const ts = new Date().toISOString();
    await db
      .insertInto('games')
      .values({
        token,
        created_at: ts,
        updated_at: ts,
        mode: 'normal',
        format_version: FORMAT_VERSION,
        state: JSON.stringify({ ...state, aiMode: false }),
        seed: state.seed,
        lease_session: null,
        lease_until: 0,
      })
      .execute();
    return { token };
  });
}
