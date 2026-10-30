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
  townFacts,
  validActions,
} from '@bitopolis/sim';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { newSeed } from '../tokens.ts';
import { costEur, PROVIDER_INFO, PROVIDERS, type ProviderId } from './catalog.ts';
import { encryptSecret, maskKey } from './crypto.ts';
import type { AiService, AiSettings } from './service.ts';

/** Medido con `pnpm sim` (ver docs/rondas): decisiones por vecino con nombre y día. */
export const DECISIONS_PER_CITIZEN_DAY = 0.1;
const TOKENS_IN_BASE = 330;
const TOKENS_IN_PER_CITIZEN = 200;
const TOKENS_OUT_PER_CITIZEN = 40;

/** Estimación de coste en €/hora real según modelo, vecinos y velocidad. */
export function estimatePerHour(ai: AiService, provider: ProviderId, model: string, citizens: number, speed: number): number {
  const daysPerHour = (3600 / 20) * speed;
  const decisionsPerDay = citizens * DECISIONS_PER_CITIZEN_DAY;
  // Las decisiones del mismo día van en un lote.
  const batchesPerDay = Math.min(1, decisionsPerDay);
  const tokensIn = batchesPerDay * TOKENS_IN_BASE + decisionsPerDay * TOKENS_IN_PER_CITIZEN;
  const tokensOut = decisionsPerDay * TOKENS_OUT_PER_CITIZEN;
  return costEur(ai.prices, model, provider, { in: tokensIn, cachedIn: 0, out: tokensOut }) * daysPerHour;
}

function publicSettings(s: AiSettings) {
  // La key nunca vuelve al cliente: solo su máscara.
  const { key: _key, ...rest } = s;
  void _key;
  return rest;
}

const ConfigBody = z.object({
  sessionId: z.string().min(8).max(64),
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1).max(128).optional(),
  modelPremium: z.string().trim().max(128).optional(),
  baseUrl: z.string().trim().url().max(512).optional().or(z.literal('')),
  key: z.string().trim().min(8).max(400).optional(),
  capDay: z.number().min(0).max(1000).optional(),
  capMonth: z.number().min(0).max(10000).optional(),
  accepted: z.boolean(),
});

export async function registerAiRoutes(app: FastifyInstance, db: Db, config: Config, ai: AiService): Promise<void> {
  const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });
  const load = (token: string) => db.selectFrom('games').selectAll().where('token', '=', token).executeTakeFirst();
  const tokenOf = (params: unknown) => GameToken.safeParse((params as { token?: string }).token);

  app.get('/api/ai/meta', async () => ({
    providers: PROVIDERS.map((id) => ({ id, ...PROVIDER_INFO[id] })),
    serverKey: !!config.ai.key,
    maxCitizens: config.ai.maxCitizens,
    canStoreKeys: !!config.masterKey,
    prices: ai.prices,
  }));

  app.get('/api/ai/estimate', async (req) => {
    const q = req.query as Record<string, string>;
    const provider = (PROVIDERS as readonly string[]).includes(q.provider ?? '') ? (q.provider as ProviderId) : 'openai';
    const model = q.model || PROVIDER_INFO[provider].cheap;
    const citizens = Math.max(1, Math.min(20, Number(q.citizens) || config.ai.maxCitizens));
    const out: Record<string, number> = {};
    for (const sp of [1, 3, 10]) out[`x${sp}`] = estimatePerHour(ai, provider, model, citizens, sp);
    return { eurPerHour: out, known: model in ai.prices || provider === 'openai-compatible' };
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
    if (d.key && !config.masterKey) return bad(reply, 'El servidor no tiene BITOPOLIS_MASTER_KEY: no puede guardar keys');
    let row = await load(t.data);
    if (row && row.mode !== 'ai') return bad(reply, 'El modo se elige al empezar y queda fijo: esta partida es de Modo normal', 409);
    if (!row) {
      const seed = newSeed();
      const state = createInitialState({ seed, aiMode: true, namedLimit: config.ai.maxCitizens });
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
      provider: locked.has('provider') ? null : d.provider,
      model: locked.has('model') ? null : (d.model ?? null),
      model_premium: locked.has('modelPremium') ? null : d.modelPremium || null,
      base_url: locked.has('baseUrl') ? null : d.baseUrl || null,
      cap_day: locked.has('capDay') ? null : (d.capDay ?? null),
      cap_month: locked.has('capMonth') ? null : (d.capMonth ?? null),
      accepted_at: new Date().toISOString(),
    };
    const keyValues = d.key && !locked.has('key') ? { key_enc: encryptSecret(d.key, config.masterKey!), key_mask: maskKey(d.key) } : {};
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
    // Sucesos del motor; los motivos del LLM no se reinyectan.
    const events = g.state.events
      .filter((e) => e.kind !== 'decision' && e.kind !== 'tax')
      .map((e) => e.text)
      .slice(-25);
    const r = await ai.text(g.row.id, 'diario', buildChronicleRequest(g.state, townFacts(g.state), events), true);
    if (r.text) chronicles.set(key, r.text);
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
