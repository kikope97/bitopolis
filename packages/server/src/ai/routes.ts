import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GameToken } from '@bitopolis/shared';
import {
  buildAdvisorRequest,
  buildChronicleRequest,
  buildDecisionRequest,
  buildLetterRequest,
  buildPlenoRequest,
  buildTalkRequest,
  createInitialState,
  FORMAT_VERSION,
  type GameState,
  migrate,
  NEEDS,
  parseLetter,
  parsePleno,
  PLENO_ROLES,
  PLENO_STANCES,
  PLENO_TALK,
  type PlenoTalkInput,
  townFacts,
  validActions,
} from '@bitopolis/sim';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { SettingsStore } from '../settings.ts';
import { newSeed } from '../tokens.ts';
import { costEur, PROVIDER_INFO, PROVIDERS, providerFromKey, type ProviderId } from './catalog.ts';
import { encryptSecret, maskKey } from './crypto.ts';
import { type AiService, type AiSettings, ModelsError } from './service.ts';

/**
 * 2.0: coste de los turnos del pueblo, medido en vivo con `pnpm ai-eval --live`
 * (ronda 16): por turno, ≈2500 tokens de entrada fijos más ≈900 por vecino con IA
 * (una cuarta parte en caché) y ≈220 de salida por vecino.
 */
export const TURN_COST = { inBase: 2500, inPerCitizen: 900, cachedShare: 0.25, outPerCitizen: 220 };
/** Pueblo de referencia para la estimación: vecinos con nombre en una partida mediana. */
export const REFERENCE_TOWN = 60;
/** Días de juego entre turnos según la velocidad (`SetTurnPace`). */
const PACE: Record<number, number> = { 1: 7, 3: 14, 10: 28 };
/** Margen para segundas preguntas, reacciones rápidas y conversaciones. */
export const RETRY_RATE = 0.15;
/** Crónica del diario: una al mes con el modelo premium. */
const CHRONICLE = { in: 800, out: 260 };

/** Vecinos con IA para un % dado en el pueblo de referencia. */
export const aiCitizensFor = (share: number) => Math.max(1, Math.round((REFERENCE_TOWN * share) / 100));

/** Coste en € de un turno del pueblo con `citizens` vecinos con IA. */
export function turnCost(ai: AiService, provider: ProviderId, model: string, citizens: number): number {
  const tin = TURN_COST.inBase + citizens * TURN_COST.inPerCitizen;
  return costEur(ai.prices, model, provider, { in: tin, cachedIn: tin * TURN_COST.cachedShare, out: citizens * TURN_COST.outPerCitizen });
}

/** Coste en € de un día de juego (turnos al ritmo de la velocidad, con margen, y la parte de la crónica del mes). */
export function estimatePerGameDay(ai: AiService, provider: ProviderId, model: string, premium: string, citizens: number, speed = 1): number {
  const turns = (turnCost(ai, provider, model, citizens) * (1 + RETRY_RATE)) / (PACE[speed] ?? 7);
  const chronicle = costEur(ai.prices, premium, provider, { in: CHRONICLE.in, cachedIn: 0, out: CHRONICLE.out }) / 30;
  return turns + chronicle;
}

/** Estimación de coste en €/hora real según modelo, vecinos con IA y velocidad (1 día = 20 s a x1). */
export function estimatePerHour(ai: AiService, provider: ProviderId, model: string, citizens: number, speed: number, premium = PROVIDER_INFO[provider].premium): number {
  return estimatePerGameDay(ai, provider, model, premium, citizens, speed) * (3600 / 20) * speed;
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

const ModelsBody = z.object({
  key: z.string().trim().min(8, 'La API key es demasiado corta').max(400).optional(),
  baseUrl: z.string().trim().url('El endpoint no es una URL válida').max(512).optional().or(z.literal('')),
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
      turnQuality: s.ai.turnQuality ?? 'calidad',
      playerKeys: s.ai.playerKeys,
      prices: ai.prices,
      newGames: s.newGames,
      publicUrl: s.publicUrl,
    };
  });

  app.get('/api/ai/estimate', async (req) => {
    const q = req.query as Record<string, string>;
    const provider = (PROVIDERS as readonly string[]).includes(q.provider ?? '') ? (q.provider as ProviderId) : 'openai';
    const quality = (store.get().ai.turnQuality ?? 'calidad') === 'calidad';
    const model = q.model || PROVIDER_INFO[provider][quality ? 'premium' : 'cheap'];
    const premium = q.premium || PROVIDER_INFO[provider].premium;
    const share = q.share !== undefined && q.share !== '' ? Number(q.share) : (store.get().ai.aiShare ?? 50);
    const citizens = aiCitizensFor(Math.max(0, Math.min(100, Number.isFinite(share) ? share : 50)));
    const out: Record<string, number> = {};
    for (const sp of [1, 3, 10]) out[`x${sp}`] = estimatePerHour(ai, provider, model, citizens, sp, premium);
    return { eurPerHour: out, citizens, eurPerGameMonth: estimatePerGameDay(ai, provider, model, premium, citizens) * 30, known: model in ai.prices || provider === 'openai-compatible' };
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

  /**
   * Modelos para el desplegable de Configurar. Con la key del servidor, su
   * lista solo si la partida puede elegir modelo (403 si lo fija el servidor);
   * con la del jugador, la guardada (GET) o una escrita y aún sin guardar (POST).
   * La key nunca vuelve al cliente.
   */
  const gameModels = async (req: FastifyRequest, reply: FastifyReply, draft?: z.infer<typeof ModelsBody>) => {
    const t = tokenOf(req.params);
    if (!t.success) return bad(reply, 'enlace no válido');
    const row = await load(t.data);
    if (row && row.mode !== 'ai') return bad(reply, 'Esta partida es de Modo normal', 409);
    const s = await ai.settings(row?.id ?? null);
    const srv = store.get().ai;
    let key = s.key;
    let baseUrl = s.baseUrl;
    if (srv.keyEnc || srv.baseUrl) {
      // La key del servidor no se manda a otro endpoint ni se cambia desde aquí.
      if (s.locked.includes('model') && s.locked.includes('modelPremium')) return bad(reply, 'El modelo lo fija el servidor', 403);
    } else {
      if (!srv.playerKeys) return bad(reply, 'Este servidor no permite poner una API key propia', 403);
      const nextBase = draft?.baseUrl !== undefined ? draft.baseUrl || undefined : baseUrl;
      // Ronda 16: la key guardada nunca va a un endpoint distinto del guardado (fuga y SSRF).
      if (draft?.key) key = draft.key;
      else if (nextBase !== baseUrl) key = undefined;
      baseUrl = nextBase;
    }
    if (!key && !baseUrl) return bad(reply, 'Escribe tu API key y pulsa «Cargar modelos»');
    try {
      return await ai.models(providerFromKey(key, baseUrl), key, baseUrl);
    } catch (e) {
      if (e instanceof ModelsError) return bad(reply, e.message, 502);
      throw e;
    }
  };
  app.get('/api/games/:token/ai/models', (req, reply) => gameModels(req, reply));
  app.post('/api/games/:token/ai/models', async (req, reply) => {
    const b = ModelsBody.safeParse(req.body ?? {});
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'datos no válidos');
    return gameModels(req, reply, b.data);
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
    // Ronda 16: si el servidor no conoce ese turno (se reinició, o el guardado no era «live»),
    // lo pide ahora con el estado guardado, si ese turno sigue abierto.
    if (!ai.turn(row.id, n) && row.mode === 'ai') {
      const st = migrate(JSON.parse(row.state)) as GameState;
      if (st.ai?.turn?.n === n) void ai.onSaved(row.id, st);
    }
    return { turn: ai.turn(row.id, n), ...ai.status(row.id) };
  });

  /** 2.5: el turno de los alcaldes vecinos de un mes (el cliente lo aplica con `NeighborTurn`). */
  app.get('/api/games/:token/neighbors/:month', async (req, reply) => {
    const t = tokenOf(req.params);
    const m = Number((req.params as { month?: string }).month);
    if (!t.success || !Number.isInteger(m) || m < 0) return bad(reply, 'petición no válida');
    const row = await load(t.data);
    if (!row) return bad(reply, 'no existe', 404);
    // Como con los turnos: si el servidor no lo conoce y sigue abierto, lo pide ahora.
    if (!ai.neighborTurn(row.id, m) && row.mode === 'ai') {
      const st = migrate(JSON.parse(row.state)) as GameState;
      if (st.comarca?.turn?.month === m) void ai.onSaved(row.id, st);
    }
    return { neighbors: ai.neighborTurn(row.id, m) };
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

  /**
   * 2.4: el pleno hablado. El cliente manda quién habla y de qué (ids y enums
   * que calculó el motor); el servidor comprueba los vecinos con su estado,
   * hace una sola llamada por pleno y guarda el texto en caché. No entra en el
   * estado ni en el hash. Si falla, el cliente usa las plantillas.
   */
  const plenos = new Map<string, string>();
  const plenoAsking = new Map<string, Promise<{ text: string | null; reason?: string }>>();
  const lastPleno = new Map<number, number>();
  const PlenoBody = z.object({
    tick: z.number().int().min(0),
    petitions: z
      .array(z.object({ id: z.number().int(), citizenId: z.number().int(), need: z.enum(NEEDS), yes: z.number().int().min(0).max(100_000), no: z.number().int().min(0).max(100_000), opposition: z.boolean().optional() }))
      .min(1)
      .max(4),
    speakers: z.array(z.object({ id: z.number().int(), role: z.enum(PLENO_ROLES), postura: z.enum(PLENO_STANCES), petitionId: z.number().int() })).min(1).max(PLENO_TALK.speakers),
  });
  app.post('/api/games/:token/pleno', async (req, reply) => {
    const g = await aiGame(req.params);
    const b = PlenoBody.safeParse(req.body);
    if (!g || !b.success) return bad(reply, 'petición no válida');
    const st = g.state;
    const body = b.data;
    // El pleno es de ahora (el estado guardado va como mucho un día por detrás) y uno al mes.
    if (body.tick < st.tick - 72 || body.tick > st.tick + 72 || (st.lastPlenoTick >= 0 && body.tick < st.lastPlenoTick)) return bad(reply, 'ese pleno no es de ahora');
    const key = `${g.row.id}:${body.tick}`;
    const cached = plenos.get(key);
    if (cached !== undefined) return cached ? { lines: JSON.parse(cached) } : { lines: null, reason: 'no disponible en este pleno' };
    const prev = lastPleno.get(g.row.id);
    if (prev !== undefined && prev !== body.tick && Math.abs(body.tick - prev) < 24 * 25) return { lines: null, reason: 'solo un pleno al mes' };
    // Solo vecinos con nombre que existen y peticiones del propio pleno.
    // Ronda 20: si el estado guardado ya tiene este pleno, mandan sus datos (no los del cliente).
    const srv = st.pleno && st.pleno.tick === body.tick && st.pleno.speakers?.length ? (st.pleno as unknown as PlenoTalkInput) : null;
    const petitions = srv ? srv.petitions : body.petitions.filter((p) => st.citizens.some((c) => c.id === p.citizenId));
    const speakers = (srv?.speakers ?? body.speakers).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i && petitions.some((p) => p.id === s.petitionId) && st.citizens.some((c) => c.id === s.id && c.named));
    if (!speakers.length) return { lines: null, reason: 'nadie habla' };
    const pleno: PlenoTalkInput = { tick: body.tick, petitions, speakers };
    lastPleno.set(g.row.id, body.tick);
    if (lastPleno.size > 2000) lastPleno.delete(lastPleno.keys().next().value!);
    let run = plenoAsking.get(key);
    if (!run) {
      const request = buildPlenoRequest(st, pleno);
      run = ai.text(g.row.id, 'pleno', request, true, (raw) => {
        const lines = parsePleno(raw, request, pleno);
        return lines.length ? JSON.stringify(lines.map((l) => ({ id: l.id, linea: l.linea }))) : null;
      });
      plenoAsking.set(key, run);
    }
    try {
      const r = await run;
      // Un texto no válido se recuerda como fallo; si fue por tope o por red, se puede reintentar.
      if (r.text || r.reason === 'invalid') {
        plenos.set(key, r.text ?? '');
        if (plenos.size > 2000) plenos.delete(plenos.keys().next().value!);
      }
      return r.text ? { lines: JSON.parse(r.text) } : { lines: null, reason: r.reason };
    } finally {
      plenoAsking.delete(key);
    }
  });

  /**
   * 2.5: el texto de una carta de alguien que se fue. El motor ya decidió quién
   * escribe, a quién y si vuelve (la carta está en el estado guardado: si no,
   * 404); la IA solo redacta. Una llamada por carta, en caché; no entra en el
   * estado ni en el hash. Si falla, el cliente lee la plantilla del motor.
   */
  const letters = new Map<string, string>();
  const letterAsking = new Map<string, Promise<{ text: string | null; reason?: string }>>();
  const LetterId = z.coerce.number().int().min(1).max(1e9);
  app.post('/api/games/:token/letter/:id', async (req, reply) => {
    const g = await aiGame(req.params);
    const id = LetterId.safeParse((req.params as { id?: unknown }).id);
    if (!g || !id.success) return bad(reply, 'petición no válida');
    const letter = g.state.letters?.find((l) => l.id === id.data);
    if (!letter) return bad(reply, 'esa carta no está', 404);
    const key = `${g.row.id}:${letter.id}`;
    const cached = letters.get(key);
    if (cached !== undefined) return cached ? { text: cached } : { text: null, reason: 'no disponible para esta carta' };
    const request = buildLetterRequest(g.state, letter);
    if (!request) return { text: null, reason: 'quien la recibió ya no está' };
    let run = letterAsking.get(key);
    if (!run) {
      run = ai.text(g.row.id, 'carta', request, true, (raw) => parseLetter(raw, request));
      letterAsking.set(key, run);
    }
    try {
      const r = await run;
      // Un texto no válido se recuerda como fallo; si fue por tope o por red, se puede reintentar.
      if (r.text || r.reason === 'invalid') {
        letters.set(key, r.text ?? '');
        if (letters.size > 2000) letters.delete(letters.keys().next().value!);
      }
      return r;
    } finally {
      letterAsking.delete(key);
    }
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
