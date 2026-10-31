import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { GameToken } from '@bitopolis/shared';
import {
  buildAdvisorRequest,
  buildChronicleRequest,
  buildDecisionRequest,
  buildTalkRequest,
  createInitialState,
  FORMAT_VERSION,
  type GameState,
  migrate,
  SYSTEM_PROMPT,
  townFacts,
  validActions,
} from '@bitopolis/sim';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { SettingsStore } from '../settings.ts';
import { newSeed } from '../tokens.ts';
import { costEur, PROVIDER_INFO, PROVIDERS, type ProviderId } from './catalog.ts';
import { encryptSecret, maskKey } from './crypto.ts';
import type { AiService, AiSettings } from './service.ts';

/** Medido con `pnpm sim` (ver docs/rondas): decisiones por vecino con nombre y día. */
export const DECISIONS_PER_CITIZEN_DAY = 0.085;
/** Las «opiniones» salen con cualquier número de vecinos: nunca menos de media decisión al día. */
const MIN_DECISIONS_PER_DAY = 0.5;
// Ronda 09: la base es el prompt de sistema real (≈3,2 caracteres por token) más el resumen del pueblo.
const TOKENS_IN_BASE = Math.ceil(SYSTEM_PROMPT.length / 3.2) + 120;
const TOKENS_IN_PER_CITIZEN = 230;
const TOKENS_OUT_PER_CITIZEN = 40;

/** Margen para los reintentos de respuestas no válidas (v1.3; medido: casi siempre valen a la primera). */
export const RETRY_RATE = 0.15;
/** Crónica del diario: una al mes con el modelo premium. */
const CHRONICLE = { in: 800, out: 260 };

/** Coste en € de un día de juego: decisiones (con reintentos) y la parte de la crónica del mes. */
export function estimatePerGameDay(ai: AiService, provider: ProviderId, model: string, premium: string, citizens: number): number {
  const decisionsPerDay = Math.max(MIN_DECISIONS_PER_DAY, citizens * DECISIONS_PER_CITIZEN_DAY);
  // Las decisiones del mismo día van en un lote.
  const batchesPerDay = Math.min(1, decisionsPerDay);
  const tokensIn = batchesPerDay * TOKENS_IN_BASE + decisionsPerDay * TOKENS_IN_PER_CITIZEN;
  const tokensOut = decisionsPerDay * TOKENS_OUT_PER_CITIZEN;
  const decisions = costEur(ai.prices, model, provider, { in: tokensIn, cachedIn: 0, out: tokensOut }) * (1 + RETRY_RATE);
  const chronicle = costEur(ai.prices, premium, provider, { in: CHRONICLE.in, cachedIn: 0, out: CHRONICLE.out }) / 30;
  return decisions + chronicle;
}

/** Estimación de coste en €/hora real según modelo, vecinos y velocidad (1 día = 20 s a x1). */
export function estimatePerHour(ai: AiService, provider: ProviderId, model: string, citizens: number, speed: number, premium = PROVIDER_INFO[provider].premium): number {
  return estimatePerGameDay(ai, provider, model, premium, citizens) * (3600 / 20) * speed;
}

function publicSettings(s: AiSettings) {
  // La key nunca vuelve al cliente: solo su máscara.
  const { key: _key, ...rest } = s;
  void _key;
  return rest;
}

const ConfigBody = z.object({
  sessionId: z.string().min(8).max(64),
  /** Ya no se elige: se deduce de la key. Se acepta y se ignora (clientes antiguos). */
  provider: z.enum(PROVIDERS).optional(),
  model: z.string().trim().min(1).max(128).optional(),
  modelPremium: z.string().trim().max(128).optional(),
  baseUrl: z.string().trim().url().max(512).optional().or(z.literal('')),
  key: z.string().trim().min(8).max(400).optional(),
  capDay: z.number().min(0).max(1000).optional(),
  capMonth: z.number().min(0).max(10000).optional(),
  /** 2.0: % de vecinos con IA (solo con key propia; con la del servidor manda /admin). */
  aiShare: z.number().int().min(0).max(100).optional(),
  accepted: z.boolean(),
});

export async function registerAiRoutes(app: FastifyInstance, db: Db, config: Config, ai: AiService, store: SettingsStore): Promise<void> {
  const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });
  const load = (token: string) => db.selectFrom('games').selectAll().where('token', '=', token).executeTakeFirst();
  const tokenOf = (params: unknown) => GameToken.safeParse((params as { token?: string }).token);

  /** Lo que el cliente necesita saber del servidor (sin secretos). */
  app.get('/api/ai/meta', async () => {
    const s = store.get();
    return {
      providers: PROVIDERS.map((id) => ({ id, ...PROVIDER_INFO[id] })),
      serverKey: !!s.ai.keyEnc || !!s.ai.baseUrl,
      maxCitizens: s.ai.maxCitizens,
      aiShare: s.ai.aiShare ?? 50,
      playerKeys: s.ai.playerKeys,
      prices: ai.prices,
      newGames: s.newGames,
      publicUrl: s.publicUrl,
    };
  });

  app.get('/api/ai/estimate', async (req) => {
    const q = req.query as Record<string, string>;
    const provider = (PROVIDERS as readonly string[]).includes(q.provider ?? '') ? (q.provider as ProviderId) : 'openai';
    const model = q.model || PROVIDER_INFO[provider].cheap;
    const premium = q.premium || PROVIDER_INFO[provider].premium;
    const citizens = Math.max(1, Math.min(20, Number(q.citizens) || store.get().ai.maxCitizens));
    const out: Record<string, number> = {};
    for (const sp of [1, 3, 10]) out[`x${sp}`] = estimatePerHour(ai, provider, model, citizens, sp, premium);
    return { eurPerHour: out, eurPerGameMonth: estimatePerGameDay(ai, provider, model, premium, citizens) * 30, known: model in ai.prices || provider === 'openai-compatible' };
  });

  app.get('/api/games/:token/ai-config', async (req, reply) => {
    const t = tokenOf(req.params);
    if (!t.success) return bad(reply, 'enlace no válido');
    const row = await load(t.data);
    return publicSettings(await ai.settings(row?.id ?? null));
  });

  /** Guardar la configuración de IA crea la partida en Modo IA (spec §10.1). */
  app.put('/api/games/:token/ai-config', async (req, reply) => {
    const t = tokenOf(req.params);
    const b = ConfigBody.safeParse(req.body);
    if (!t.success || !b.success) return bad(reply, 'configuración no válida');
    const d = b.data;
    if (!d.accepted) return bad(reply, 'Hay que aceptar el aviso sobre el límite de gasto');
    const srv = await ai.settings(null);
    if (!srv.configured && !store.get().ai.playerKeys) return bad(reply, 'Este servidor no permite poner una API key propia', 403);
    let row = await load(t.data);
    if (row && row.mode !== 'ai') return bad(reply, 'El modo se elige al empezar y queda fijo: esta partida es de Modo normal', 409);
    if (!row) {
      if (!store.get().newGames) return bad(reply, 'Este servidor no admite partidas nuevas', 403);
      const seed = newSeed();
      const share = srv.configured ? (store.get().ai.aiShare ?? 50) : (d.aiShare ?? store.get().ai.aiShare ?? 50);
      const state = createInitialState({ seed, aiMode: true, namedLimit: store.get().ai.maxCitizens, aiShare: share });
      const ts = new Date().toISOString();
      await db
        .insertInto('games')
        .values({
          token: t.data,
          created_at: ts,
          updated_at: ts,
          mode: 'ai',
          format_version: FORMAT_VERSION,
          state: JSON.stringify(state),
          seed,
          lease_session: d.sessionId,
          lease_until: 0,
        })
        .execute();
      row = (await load(t.data))!;
    }
    const current = await ai.settings(row.id);
    const locked = new Set(current.locked);
    const values = {
      game_id: row.id,
      provider: null,
      model: locked.has('model') ? null : (d.model ?? null),
      model_premium: locked.has('modelPremium') ? null : d.modelPremium || null,
      base_url: locked.has('baseUrl') ? null : d.baseUrl || null,
      cap_day: locked.has('capDay') ? null : (d.capDay ?? null),
      cap_month: locked.has('capMonth') ? null : (d.capMonth ?? null),
      accepted_at: new Date().toISOString(),
    };
    const keyValues = d.key && !locked.has('key') ? { key_enc: encryptSecret(d.key, config.secret), key_mask: maskKey(d.key) } : {};
    const exists = await db.selectFrom('ai_config').select('game_id').where('game_id', '=', row.id).executeTakeFirst();
    if (exists) await db.updateTable('ai_config').set({ ...values, ...keyValues }).where('game_id', '=', row.id).execute();
    else await db.insertInto('ai_config').values({ key_enc: null, key_mask: null, ...values, ...keyValues }).execute();
    return publicSettings(await ai.settings(row.id));
  });

  app.get('/api/games/:token/decisions', async (req, reply) => {
    const t = tokenOf(req.params);
    if (!t.success) return bad(reply, 'enlace no válido');
    const row = await load(t.data);
    if (!row) return bad(reply, 'no existe', 404);
    const s = await ai.settings(row.id);
    const spent = await ai.spend(row.id);
    // Fracción del tope más cercano (avisos al 50 % y al 80 %).
    const fractions = [
      s.capDay ? spent.gameDay / s.capDay : 0,
      s.capMonth ? spent.gameMonth / s.capMonth : 0,
      s.serverMonthly ? spent.serverMonth / s.serverMonthly : 0,
    ];
    return { ...ai.take(row.id), budgetFraction: Math.max(...fractions) };
  });

  /** 2.0: resultado del turno del pueblo `n` (pendiente, listo o fallido). */
  app.get('/api/games/:token/turn/:n', async (req, reply) => {
    const t = tokenOf(req.params);
    const n = Number((req.params as { n?: string }).n);
    if (!t.success || !Number.isInteger(n) || n < 1) return bad(reply, 'petición no válida');
    const row = await load(t.data);
    if (!row) return bad(reply, 'no existe', 404);
    return { turn: ai.turn(row.id, n), ...ai.status(row.id) };
  });

  app.get('/api/games/:token/ai-usage', async (req, reply) => {
    const t = tokenOf(req.params);
    if (!t.success) return bad(reply, 'enlace no válido');
    const row = await load(t.data);
    if (!row) return bad(reply, 'no existe', 404);
    const s = await ai.settings(row.id);
    return { ...(await ai.report(row.id)), caps: { day: s.capDay, month: s.capMonth, server: s.serverMonthly } };
  });

  /** Textos con IA (v0.4). Entrada: solo ids y enums; salida validada. Si falla, el cliente usa reglas. */
  const chronicles = new Map<string, string>();
  const talks = new Map<string, string>();
  const talking = new Set<number>();
  const TalkBody = z.object({ citizenId: z.number().int().min(1), question: z.enum(['como_estas', 'que_necesitas', 'me_votarias']) });
  const AdvisorBody = z.object({ question: z.enum(['como_va', 'que_cambiarias']) });
  const aiGame = async (params: unknown) => {
    const t = tokenOf(params);
    if (!t.success) return null;
    const row = await load(t.data);
    if (!row || row.mode !== 'ai') return null;
    return { row, state: migrate(JSON.parse(row.state)) as GameState };
  };

  app.post('/api/games/:token/talk', async (req, reply) => {
    const g = await aiGame(req.params);
    const b = TalkBody.safeParse(req.body);
    if (!g || !b.success) return bad(reply, 'petición no válida');
    const c = g.state.citizens.find((x) => x.id === b.data.citizenId && x.named);
    if (!c) return bad(reply, 'ese vecino no está', 404);
    // Una respuesta por vecino, pregunta y día de juego; y una conversación a la vez por partida.
    const key = `${g.row.id}:${c.id}:${b.data.question}:${Math.floor(g.state.tick / 24)}`;
    const cached = talks.get(key);
    if (cached) return { text: cached };
    if (talking.has(g.row.id)) return { text: null, reason: 'ya hay una conversación en curso' };
    talking.add(g.row.id);
    try {
      const r = await ai.text(g.row.id, 'conversacion', buildTalkRequest(g.state, c, b.data.question), false);
      if (r.text) {
        talks.set(key, r.text);
        if (talks.size > 2000) talks.delete(talks.keys().next().value!);
      }
      return r;
    } finally {
      talking.delete(g.row.id);
    }
  });

  app.post('/api/games/:token/advisor', async (req, reply) => {
    const g = await aiGame(req.params);
    const b = AdvisorBody.safeParse(req.body);
    if (!g || !b.success) return bad(reply, 'petición no válida');
    return ai.text(g.row.id, 'consejero', buildAdvisorRequest(g.state, townFacts(g.state), b.data.question), true);
  });

  app.post('/api/games/:token/chronicle', async (req, reply) => {
    const g = await aiGame(req.params);
    if (!g) return bad(reply, 'petición no válida');
    const monthIdx = Math.floor(g.state.tick / (24 * 30));
    const key = `${g.row.id}:${monthIdx}`;
    const cached = chronicles.get(key);
    if (cached) return { text: cached };
    // Si la IA ya falló este mes, no se repite la llamada (premium) cada vez que se abre el diario.
    if (cached === '') return { text: null, reason: 'no disponible este mes' };
    // Sucesos del motor; los motivos del LLM no se reinyectan.
    const events = g.state.events
      .filter((e) => e.kind !== 'decision' && e.kind !== 'tax')
      .map((e) => e.text)
      .slice(-25);
    const r = await ai.text(g.row.id, 'diario', buildChronicleRequest(g.state, townFacts(g.state), events), true);
    // Un texto no válido se recuerda como fallo; si fue por tope o por red, se puede reintentar luego.
    if (r.text || r.reason === 'invalid') chronicles.set(key, r.text ?? '');
    return r;
  });

  /** «Qué se envía»: un ejemplo real del prompt con el estado de esta partida. */
  app.get('/api/games/:token/ai-preview', async (req, reply) => {
    const t = tokenOf(req.params);
    if (!t.success) return bad(reply, 'enlace no válido');
    const row = await load(t.data);
    const state: GameState = row ? migrate(JSON.parse(row.state)) : createInitialState({ seed: 1, aiMode: true });
    let pendings = state.pending;
    if (pendings.length === 0) {
      const c = state.citizens.find((x) => x.named)!;
      pendings = [{ citizenId: c.id, trigger: 'infeliz', actions: validActions(state, c, 'infeliz'), createdTick: state.tick, dueTick: state.tick + 12 }];
    }
    const r = buildDecisionRequest(state, pendings);
    return { system: r.system, user: JSON.stringify(JSON.parse(r.user), null, 2), schema: r.schema };
  });
}
