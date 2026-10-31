import {
  buildDecisionRequest,
  buildDirectorRequest,
  buildTurnRequest,
  type DirectorChoice,
  type GameState,
  parseDecisions,
  parseDirector,
  parseText,
  parseTurn,
  type Pending,
  type TextRequest,
  turnBatches,
  turnShared,
  type TurnAct,
} from '@bitopolis/sim';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { SettingsStore } from '../settings.ts';
import { costEur, modelFor, priceTable, PROVIDER_INFO, providerFromKey, type ProviderId } from './catalog.ts';
import { decryptSecret } from './crypto.ts';
import { type ListedModel, listModels, type LLMProvider, makeProvider, ProviderError } from './providers.ts';

/** Ajustes efectivos de IA de una partida (lo fijado en /admin > partida). */
export interface AiSettings {
  provider: ProviderId;
  model: string;
  modelPremium: string;
  baseUrl?: string;
  key?: string;
  keyMask?: string;
  capDay?: number;
  capMonth?: number;
  serverMonthly?: number;
  /** 2.0: modelo de los vecinos por defecto: el bueno (calidad) o el barato (ahorro). */
  turnQuality: 'calidad' | 'ahorro';
  /** Campos fijados por el servidor (solo lectura en Configurar). */
  locked: string[];
  configured: boolean;
}

export interface ReadyDecision {
  citizenId: number;
  createdTick: number;
  action: string;
  motivo: string;
}

interface GameAiState {
  inflight: boolean;
  requested: Set<string>;
  ready: ReadyDecision[];
  capped: boolean;
  lastError?: string;
  /** 2.0: turnos del pueblo pedidos (número) y su resultado. */
  turns: Map<number, TurnResult>;
}

/** 2.0: resultado de un turno del pueblo para el cliente. */
export interface TurnResult {
  n: number;
  status: 'pending' | 'ready' | 'failed';
  acts: TurnAct[];
  /** Vecinos pedidos y respondidos (para el panel de gasto y «Qué está pasando»). */
  requested: number;
  answered: number;
  reason?: string;
  /** Escalón de gasto con el que se pidió: calidad, ahorro o ahorro por estar cerca de un tope. */
  rung?: 'calidad' | 'ahorro' | 'cerca del tope';
  /** Director del pueblo (solo en los turnos semanales). */
  director?: DirectorChoice;
  focus?: string;
  chronicle?: string;
}

/** Con este % de cualquier tope gastado, los turnos bajan al modelo de ahorro. */
export const SAVING_AT = 0.7;

/** 2.0: vecinos por lote y lotes en paralelo (el primero va solo para escribir la caché). */
export const TURN_BATCH = 15;
const TURN_TIMEOUT_MS = 30_000;
/** Todo el turno (lotes, director y segunda pregunta) debe caber en la espera del cliente (45 s). */
const TURN_DEADLINE_MS = 40_000;
/** Sin este margen, no se hace la segunda pregunta. */
const TURN_RETRY_MIN_MS = 8_000;
const TURN_OUT_PER_CITIZEN = 320;
/** Tokens de salida del director (sucesos, avisos, foco y crónica). */
const DIRECTOR_OUT = 900;

const TIMEOUT_MS = 20_000;
const MAX_OUT_PER_CITIZEN = 120;
export const MAX_BATCH = 8;

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const month = (d = new Date()) => d.toISOString().slice(0, 7);

export class AiService {
  private games = new Map<number, GameAiState>();
  /** Reservas en curso (€), para que dos peticiones no se pasen del tope. */
  private reserved = new Map<number, number>();
  /** Para tests: sustituye al proveedor real. */
  providerOverride?: (s: AiSettings) => LLMProvider;
  /** Para tests: sustituye a la lista de modelos del proveedor (sin red). */
  modelsOverride?: typeof listModels;

  constructor(
    private db: Db,
    private config: Config,
    private store: SettingsStore,
  ) {}

  /** Precios (los de /admin sobre la tabla incluida). */
  get prices() {
    return priceTable(this.store.get().ai.prices);
  }

  /** API key del servidor descifrada (nunca sale de aquí hacia el cliente). */
  serverKey(): string | undefined {
    const enc = this.store.get().ai.keyEnc;
    if (!enc) return undefined;
    try {
      return decryptSecret(enc, this.config.secret);
    } catch {
      return undefined;
    }
  }

  async settings(gameId: number | null): Promise<AiSettings> {
    const srv = this.store.get().ai;
    const env = { ...srv, key: this.serverKey() };
    const row = gameId ? await this.db.selectFrom('ai_config').selectAll().where('game_id', '=', gameId).executeTakeFirst() : undefined;
    const locked: string[] = [];
    const pick = <T>(name: string, envVal: T | undefined, rowVal: T | null | undefined): T | undefined => {
      if (envVal !== undefined) {
        locked.push(name);
        return envVal;
      }
      return rowVal ?? undefined;
    };
    let key: string | undefined;
    let keyMask: string | undefined;
    if (env.key) {
      locked.push('key');
      key = env.key;
      keyMask = 'definida por el servidor';
    } else if (row?.key_enc && srv.playerKeys) {
      try {
        key = decryptSecret(row.key_enc, this.config.secret);
        keyMask = row.key_mask ?? '…';
      } catch {
        key = undefined;
      }
    }
    // Sin permiso para keys propias, la partida tampoco elige endpoint.
    if (!env.key && !srv.playerKeys) locked.push('key');
    // Con key del servidor, la partida no elige endpoint: podría mandar la key a otro sitio.
    const ownEndpoint = srv.playerKeys && !env.key;
    const baseUrl = pick('baseUrl', env.baseUrl, ownEndpoint ? row?.base_url : undefined);
    if (!ownEndpoint && !locked.includes('baseUrl')) locked.push('baseUrl');
    // El proveedor no se elige: sale de la key (o del endpoint propio).
    const provider = providerFromKey(key, baseUrl);
    if (env.key || env.baseUrl) locked.push('provider');
    const model = modelFor(provider, pick('model', env.model, row?.model), (srv.turnQuality ?? 'calidad') === 'calidad' ? 'premium' : 'cheap');
    return {
      provider,
      model,
      modelPremium: modelFor(provider, pick('modelPremium', env.modelPremium, row?.model_premium) ?? env.model, 'premium'),
      baseUrl,
      key,
      keyMask,
      capDay: pick('capDay', env.gameDaily, row?.cap_day),
      capMonth: pick('capMonth', env.gameMonthly, row?.cap_month),
      serverMonthly: env.serverMonthly,
      turnQuality: srv.turnQuality ?? 'calidad',
      locked,
      configured: !!key || (provider === 'openai-compatible' && !!baseUrl),
    };
  }

  /** Gasto en € (día y mes de la partida, mes del servidor). */
  async spend(gameId: number) {
    const sum = async (q: { game?: number; day?: string; month?: string }) => {
      let s = this.db.selectFrom('ai_usage').select((eb) => eb.fn.sum<number>('eur').as('eur'));
      if (q.game !== undefined) s = s.where('game_id', '=', q.game);
      if (q.day) s = s.where('day', '=', q.day);
      if (q.month) s = s.where('month', '=', q.month);
      return Number((await s.executeTakeFirst())?.eur ?? 0);
    };
    return {
      gameDay: await sum({ game: gameId, day: day() }),
      gameMonth: await sum({ game: gameId, month: month() }),
      serverMonth: await sum({ month: month() }),
    };
  }

  private estimate(s: AiSettings, system: string, user: string, n: number): number {
    const tokensIn = Math.ceil((system.length + user.length) / 3.2);
    return costEur(this.prices, s.model, s.provider, { in: tokensIn, cachedIn: 0, out: n * MAX_OUT_PER_CITIZEN }) * 2; // ×2: margen para el reintento
  }

  /**
   * Escalera de gasto de los turnos (2.0): el modelo de los vecinos (en
   * «Calidad», Sonnet por defecto) → el barato del proveedor al pasar del 70 %
   * de un tope → reglas al llegar al tope.
   */
  async turnModel(gameId: number, s: AiSettings): Promise<{ model: string; rung: NonNullable<TurnResult['rung']> }> {
    const cheap = PROVIDER_INFO[s.provider].cheap;
    const rung = s.model === cheap ? 'ahorro' : 'calidad';
    if (s.model === cheap || s.provider === 'openai-compatible') return { model: s.model, rung };
    const spent = await this.spend(gameId);
    const near = (used: number, cap?: number) => cap !== undefined && used >= cap * SAVING_AT;
    if (near(spent.gameDay, s.capDay) || near(spent.gameMonth, s.capMonth) || near(spent.serverMonth, s.serverMonthly)) return { model: cheap, rung: 'cerca del tope' };
    return { model: s.model, rung };
  }

  /** ¿Cabe este gasto en todos los topes? Devuelve el tope que lo impide. */
  async budgetBlock(gameId: number, s: AiSettings, eur: number): Promise<string | null> {
    const spent = await this.spend(gameId);
    const res = [...this.reserved.values()].reduce((a, b) => a + b, 0);
    const mine = this.reserved.get(gameId) ?? 0;
    if (s.capDay !== undefined && spent.gameDay + mine + eur > s.capDay) return 'tope diario de la partida';
    if (s.capMonth !== undefined && spent.gameMonth + mine + eur > s.capMonth) return 'tope mensual de la partida';
    if (s.serverMonthly !== undefined && spent.serverMonth + res + eur > s.serverMonthly) return 'tope mensual del servidor';
    return null;
  }

  /**
   * Reserva antes del primer await: dos peticiones simultáneas ven la reserva
   * de la otra y no pueden pasar juntas del tope. Si no cabe, se libera.
   */
  private async reserve(gameId: number, s: AiSettings, eur: number): Promise<string | null> {
    this.reserved.set(gameId, (this.reserved.get(gameId) ?? 0) + eur);
    const blocked = await this.budgetBlock(gameId, s, 0);
    if (blocked) this.reserved.set(gameId, Math.max(0, (this.reserved.get(gameId) ?? 0) - eur));
    return blocked;
  }

  private gs(gameId: number): GameAiState {
    let g = this.games.get(gameId);
    if (!g) this.games.set(gameId, (g = { inflight: false, requested: new Set(), ready: [], capped: false, turns: new Map() }));
    return g;
  }

  /** Tras cada guardado: pide el turno del pueblo abierto y, por adelantado, las decisiones pendientes. */
  onSaved(gameId: number, state: GameState): Promise<void> | void {
    const turn = this.onTurn(gameId, state);
    const dec = this.onPending(gameId, state);
    if (turn || dec) return Promise.all([turn, dec]).then(() => undefined);
  }

  /** 2.0: si hay un turno abierto que aún no se ha pedido, se piden sus lotes. */
  private onTurn(gameId: number, state: GameState): Promise<void> | void {
    const t = state.ai?.turn;
    if (!state.aiMode || !t) return;
    const g = this.gs(gameId);
    if (g.turns.has(t.n)) return;
    const batches = turnBatches(state, TURN_BATCH);
    const result: TurnResult = { n: t.n, status: 'pending', acts: [], requested: batches.flat().length, answered: 0 };
    g.turns.set(t.n, result);
    // Solo se guardan los últimos turnos.
    for (const k of [...g.turns.keys()]) if (k < t.n - 4) g.turns.delete(k);
    return this.requestTurn(gameId, state, batches, result).catch((e) => {
      result.status = 'failed';
      result.reason = (e as Error).message;
    });
  }

  private async requestTurn(gameId: number, state: GameState, batches: number[][], result: TurnResult): Promise<void> {
    const g = this.gs(gameId);
    const s = await this.settings(gameId);
    if (!s.configured || batches.length === 0) {
      result.status = 'failed';
      result.reason = s.configured ? 'sin vecinos con IA' : 'IA sin configurar';
      return;
    }
    const shared = turnShared(state);
    const { model, rung } = await this.turnModel(gameId, s);
    result.rung = rung;
    // Ronda 16: todo el turno (con la segunda pregunta) tiene que caber en la espera del cliente.
    const deadline = Date.now() + TURN_DEADLINE_MS;
    const timeLeft = () => Math.max(1000, Math.min(TURN_TIMEOUT_MS, deadline - Date.now()));
    /** Pide un lote; a los vecinos que la IA se haya dejado se les pregunta una vez más, solos. */
    const one = async (ids: number[], retry = true): Promise<void> => {
      let missing: number[];
      const req = buildTurnRequest(state, ids, shared);
      const est = costEur(this.prices, model, s.provider, { in: Math.ceil((req.system.length + req.shared.length + req.user.length) / 3.2), cachedIn: 0, out: ids.length * TURN_OUT_PER_CITIZEN }) * 1.5;
      const blocked = await this.reserve(gameId, s, est);
      if (blocked) {
        g.capped = true;
        g.lastError = `IA en pausa: ${blocked} alcanzado. Deciden las reglas.`;
        throw new Error(blocked);
      }
      g.capped = false;
      const usage = { in: 0, cachedIn: 0, out: 0 };
      let status = 'ok';
      let valid = 0;
      try {
        const provider = this.providerOverride ? this.providerOverride(s) : makeProvider(s.provider, s.key, s.baseUrl);
        const r = await provider.complete(
          { system: req.system, shared: req.shared, user: req.user, schema: req.schema, model, maxTokens: 300 + ids.length * TURN_OUT_PER_CITIZEN },
          AbortSignal.timeout(timeLeft()),
        );
        if (r.truncated) status = 'truncated';
        usage.in = r.usage.in;
        usage.cachedIn = r.usage.cachedIn;
        usage.out = r.usage.out;
        const parsed = parseTurn(r.text, ids, `${req.shared}\n${req.user}`);
        valid = parsed.acts.length;
        result.acts.push(...parsed.acts);
        result.answered += parsed.acts.length;
        missing = parsed.missing;
        if (missing.length && status === 'ok') status = 'partial';
      } catch (e) {
        status = (e as Error).name === 'TimeoutError' ? 'timeout' : 'error';
        missing = ids;
        g.lastError = `La IA no respondió a tiempo (${(e as Error).message}). Esta semana deciden las reglas para parte del pueblo.`;
      } finally {
        this.reserved.set(gameId, Math.max(0, (this.reserved.get(gameId) ?? 0) - est));
        const now = new Date();
        await this.db
          .insertInto('ai_usage')
          .values({
            game_id: gameId,
            ts: now.getTime(),
            day: day(now),
            month: month(now),
            kind: 'turno',
            model,
            tokens_in: usage.in,
            tokens_cached: usage.cachedIn,
            tokens_out: usage.out,
            eur: costEur(this.prices, model, s.provider, usage),
            requested: ids.length,
            valid,
            retried: retry ? 0 : 1,
            status,
          })
          .execute();
      }
      // Segunda pregunta si aún hay tiempo: a los que faltan; si falló el lote entero (cortado o
      // sin respuesta), en dos mitades más cortas.
      if (!retry || !missing.length || deadline - Date.now() < TURN_RETRY_MIN_MS) return;
      if (missing.length < ids.length) await one(missing, false);
      else if (ids.length > 1) {
        const half = Math.ceil(ids.length / 2);
        await Promise.all([one(ids.slice(0, half), false).catch(() => undefined), one(ids.slice(half), false).catch(() => undefined)]);
      }
    };
    /** El director del pueblo: una petición con el modelo del director (cerca del tope, un turno sí y otro no). */
    const director = async (): Promise<void> => {
      if (state.ai?.turn?.kind !== 'semana' || (rung === 'cerca del tope' && result.n % 2 === 1)) return;
      const req = buildDirectorRequest(state, shared);
      // Ronda 16: el director va siempre con su modelo (también en Ahorro); cerca del tope, con el barato.
      const dModel = rung === 'cerca del tope' ? model : s.modelPremium;
      const est = costEur(this.prices, dModel, s.provider, { in: Math.ceil((req.system.length + req.shared.length + req.user.length) / 3.2), cachedIn: 0, out: DIRECTOR_OUT }) * 1.5;
      if (await this.reserve(gameId, s, est)) return;
      const usage = { in: 0, cachedIn: 0, out: 0 };
      let status = 'ok';
      try {
        const provider = this.providerOverride ? this.providerOverride(s) : makeProvider(s.provider, s.key, s.baseUrl);
        const r = await provider.complete({ system: req.system, shared: req.shared, user: req.user, schema: req.schema, model: dModel, maxTokens: DIRECTOR_OUT }, AbortSignal.timeout(timeLeft()));
        usage.in = r.usage.in;
        usage.cachedIn = r.usage.cachedIn;
        usage.out = r.usage.out;
        const parsed = parseDirector(r.text, req.ids, `${req.shared}\n${req.user}`);
        if (parsed) {
          result.director = parsed.director;
          if (parsed.focus) result.focus = parsed.focus;
          if (parsed.chronicle) result.chronicle = parsed.chronicle;
        } else status = 'invalid';
      } catch (e) {
        status = (e as Error).name === 'TimeoutError' ? 'timeout' : 'error';
      } finally {
        this.reserved.set(gameId, Math.max(0, (this.reserved.get(gameId) ?? 0) - est));
        const now = new Date();
        await this.db
          .insertInto('ai_usage')
          .values({ game_id: gameId, ts: now.getTime(), day: day(now), month: month(now), kind: 'director', model: dModel, tokens_in: usage.in, tokens_cached: usage.cachedIn, tokens_out: usage.out, eur: costEur(this.prices, dModel, s.provider, usage), requested: 1, valid: result.director ? 1 : 0, retried: 0, status })
          .execute();
      }
    };
    // Ronda 16: todos los lotes a la vez con el director (esperar al primero para escribir la
    // caché ahorraba céntimos y costaba una latencia entera).
    try {
      const all = batches.map((b) => one(b).catch((e: Error) => e));
      const [first] = await Promise.all([Promise.all(all), director().catch(() => undefined)]);
      const capped = first.find((x): x is Error => x instanceof Error && g.capped);
      if (capped) throw capped;
    } catch (e) {
      result.reason = (e as Error).message;
    }
    result.status = result.acts.length ? 'ready' : 'failed';
  }

  /** 2.0: el resultado de un turno (el cliente lo aplica con un comando `TownTurn`). */
  turn(gameId: number, n: number): TurnResult | null {
    return this.gs(gameId).turns.get(n) ?? null;
  }

  /** Decisiones con detonante (vecinos por reglas que piden IA, y el Modo IA de antes). */
  private onPending(gameId: number, state: GameState): Promise<void> | void {
    if (!state.aiMode || state.pending.length === 0) return;
    const g = this.gs(gameId);
    if (g.inflight) return;
    // Lotes de 8 vecinos como mucho: con 20 vecinos el coste queda acotado.
    const fresh = state.pending.filter((p) => !g.requested.has(`${p.citizenId}:${p.createdTick}`) && p.dueTick > state.tick).slice(0, MAX_BATCH);
    if (fresh.length === 0) return;
    for (const p of fresh) g.requested.add(`${p.citizenId}:${p.createdTick}`);
    if (g.requested.size > 500) g.requested = new Set([...g.requested].slice(-200));
    g.inflight = true;
    return this.request(gameId, state, fresh).finally(() => {
      g.inflight = false;
    });
  }

  private async request(gameId: number, state: GameState, pendings: Pending[]): Promise<void> {
    const g = this.gs(gameId);
    const s = await this.settings(gameId);
    if (!s.configured) return;
    const req = buildDecisionRequest(state, pendings);
    const est = this.estimate(s, req.system, req.user, pendings.length);
    const blocked = await this.reserve(gameId, s, est);
    if (blocked) {
      g.capped = true;
      g.lastError = `IA en pausa: ${blocked} alcanzado. Deciden las reglas.`;
      return;
    }
    g.capped = false;
    const usage = { in: 0, cachedIn: 0, out: 0 };
    let status = 'ok';
    let valid = 0;
    let retried = 0;
    try {
      const provider = this.providerOverride ? this.providerOverride(s) : makeProvider(s.provider, s.key, s.baseUrl);
      const call = async (system: string, user: string, list: Pending[]) => {
        const r = await provider.complete(
          { system, user, schema: buildDecisionRequest(state, list).schema, model: s.model, maxTokens: 200 + list.length * MAX_OUT_PER_CITIZEN },
          AbortSignal.timeout(TIMEOUT_MS),
        );
        usage.in += r.usage.in;
        usage.cachedIn += r.usage.cachedIn;
        usage.out += r.usage.out;
        // Un motivo repetido se acepta: el modelo no ve sus motivos anteriores (no se reinyectan)
        // y reintentar por eso solo gastaba tokens.
        return parseDecisions(r.text, list, {}, false, system + '\n' + user);
      };
      let parsed = await call(req.system, req.user, pendings);
      const add = (ds: typeof parsed.decisions) => {
        for (const d of ds) {
          const p = pendings.find((x) => x.citizenId === d.citizenId)!;
          g.ready.push({ citizenId: d.citizenId, createdTick: p.createdTick, action: d.action, motivo: d.motivo });
        }
      };
      add(parsed.decisions);
      valid = parsed.decisions.length;
      // Un reintento para los inválidos; después, reglas.
      if (parsed.invalid.length > 0) {
        const again = pendings.filter((p) => parsed.invalid.includes(p.citizenId));
        const r2 = buildDecisionRequest(state, again);
        // La nota va al final (parte variable) para no romper el prefijo cacheable.
        const note = `${r2.user}\n\nTu respuesta anterior no era válida (${parsed.error ?? 'acción no permitida o falta un vecino'}). Usa solo las acciones de cada vecino y un motivo nuevo, sin cifras.`;
        parsed = await call(r2.system, note, again);
        add(parsed.decisions);
        retried = parsed.decisions.length;
        if (parsed.invalid.length > 0) status = 'partial';
      }
    } catch (e) {
      status = (e as Error).name === 'TimeoutError' ? 'timeout' : 'error';
      g.lastError = `La IA no respondió (${(e as Error).message}). Deciden las reglas.`;
    } finally {
      this.reserved.set(gameId, Math.max(0, (this.reserved.get(gameId) ?? 0) - est));
    }
    const now = new Date();
    await this.db
      .insertInto('ai_usage')
      .values({
        game_id: gameId,
        ts: now.getTime(),
        day: day(now),
        month: month(now),
        kind: 'decision',
        model: s.model,
        tokens_in: usage.in,
        tokens_cached: usage.cachedIn,
        tokens_out: usage.out,
        eur: costEur(this.prices, s.model, s.provider, usage),
        requested: pendings.length,
        valid,
        retried,
        status,
      })
      .execute();
  }

  /**
   * Texto con el modelo premium (consejero, diario) o el barato (conversación).
   * Reserva el presupuesto antes de empezar: si no alcanza, no empieza (spec §9.5).
   */
  async text(gameId: number, kind: 'consejero' | 'diario' | 'conversacion', req: TextRequest, premium: boolean): Promise<{ text: string | null; reason?: string }> {
    const s = await this.settings(gameId);
    if (!s.configured) return { text: null, reason: 'IA sin configurar' };
    const model = premium ? s.modelPremium : s.model;
    const est = costEur(this.prices, model, s.provider, { in: Math.ceil((req.system.length + req.user.length) / 3.2), cachedIn: 0, out: Math.ceil(req.max / 3) + 60 }) * 1.5;
    const blocked = await this.reserve(gameId, s, est);
    if (blocked) return { text: null, reason: `${blocked} alcanzado` };
    const usage = { in: 0, cachedIn: 0, out: 0 };
    let text: string | null = null;
    let status = 'ok';
    try {
      const provider = this.providerOverride ? this.providerOverride(s) : makeProvider(s.provider, s.key, s.baseUrl);
      const r = await provider.complete({ system: req.system, user: req.user, schema: req.schema, model, maxTokens: Math.ceil(req.max / 2) + 120 }, AbortSignal.timeout(TIMEOUT_MS));
      usage.in = r.usage.in;
      usage.cachedIn = r.usage.cachedIn;
      usage.out = r.usage.out;
      text = parseText(r.text, req);
      if (!text) status = 'invalid';
    } catch (e) {
      status = (e as Error).name === 'TimeoutError' ? 'timeout' : 'error';
    } finally {
      this.reserved.set(gameId, Math.max(0, (this.reserved.get(gameId) ?? 0) - est));
    }
    const now = new Date();
    await this.db
      .insertInto('ai_usage')
      .values({
        game_id: gameId,
        ts: now.getTime(),
        day: day(now),
        month: month(now),
        kind,
        model,
        tokens_in: usage.in,
        tokens_cached: usage.cachedIn,
        tokens_out: usage.out,
        eur: costEur(this.prices, model, s.provider, usage),
        requested: 1,
        valid: text ? 1 : 0,
        retried: 0,
        status,
      })
      .execute();
    return text ? { text } : { text: null, reason: status };
  }

  /** 2.0: estado de la IA para el cliente (el aviso se entrega una vez). */
  status(gameId: number): { capped: boolean; notice?: string } {
    const g = this.gs(gameId);
    const notice = g.lastError;
    g.lastError = undefined;
    return { capped: g.capped, notice };
  }

  /** Decisiones listas para el cliente (se entregan una sola vez). */
  take(gameId: number): { decisions: ReadyDecision[]; capped: boolean; notice?: string } {
    const g = this.gs(gameId);
    const out = g.ready;
    g.ready = [];
    const notice = g.lastError;
    g.lastError = undefined;
    return { decisions: out, capped: g.capped, notice };
  }

  /** Panel de gasto y calidad. */
  async report(gameId: number) {
    const rows = await this.db.selectFrom('ai_usage').selectAll().where('game_id', '=', gameId).execute();
    const total = rows.reduce(
      (a, r) => ({
        eur: a.eur + r.eur,
        calls: a.calls + 1,
        requested: a.requested + r.requested,
        valid: a.valid + r.valid,
        retried: a.retried + r.retried,
        tokensIn: a.tokensIn + r.tokens_in,
        tokensOut: a.tokensOut + r.tokens_out,
      }),
      { eur: 0, calls: 0, requested: 0, valid: 0, retried: 0, tokensIn: 0, tokensOut: 0 },
    );
    const byKind: Record<string, number> = {};
    for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + r.eur;
    return { ...total, byKind, spend: await this.spend(gameId) };
  }

  /**
   * Modelos que ofrece una key, con aviso de los que no tienen precio en la
   * tabla (el coste se estima con uno caro). Los errores salen en español y sin
   * la key: el mensaje del proveedor no se reenvía.
   */
  async models(provider: ProviderId, key: string | undefined, baseUrl: string | undefined): Promise<{ provider: ProviderId; models: PricedModel[] }> {
    let list: ListedModel[];
    try {
      list = await (this.modelsOverride ?? listModels)(provider, key, baseUrl);
    } catch (e) {
      throw new ModelsError(modelsErrorText(e));
    }
    const prices = this.prices;
    // Los modelos locales no cuestan dinero: siempre «con precio».
    const models = list.map(({ created: _c, ...m }) => ({ ...m, priced: provider === 'openai-compatible' || m.id in prices }));
    return { provider, models };
  }
}

export interface PricedModel {
  id: string;
  name?: string;
  deprecated?: boolean;
  /** false: no está en la tabla de precios, el coste es aproximado. */
  priced: boolean;
}

export class ModelsError extends Error {}

function modelsErrorText(e: unknown): string {
  if (!(e instanceof ProviderError)) return 'No se pudo cargar la lista de modelos';
  if (e.status === 401 || e.status === 403) return 'La API key no es válida o no puede ver la lista de modelos';
  if (e.status === 404) return 'Ese endpoint no ofrece la lista de modelos (/models)';
  if (e.status === 429) return 'El proveedor pide esperar un poco (demasiadas peticiones)';
  if (e.status) return `El proveedor respondió con un error (${e.status})`;
  if (e.message === 'falta la API key') return 'Falta la API key';
  if (e.message.includes('a tiempo')) return 'El proveedor no respondió en 10 segundos';
  if (e.message.includes('conectar')) return 'No se pudo conectar con el proveedor';
  return 'La respuesta del proveedor no traía la lista de modelos';
}
