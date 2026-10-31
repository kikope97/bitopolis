import { buildDecisionRequest, buildTurnRequest, type GameState, parseDecisions, parseText, parseTurn, type Pending, type TextRequest, turnBatches, turnShared, type TurnAct } from '@bitopolis/sim';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { SettingsStore } from '../settings.ts';
import { costEur, modelFor, priceTable, providerFromKey, type ProviderId } from './catalog.ts';
import { decryptSecret } from './crypto.ts';
import { type LLMProvider, makeProvider } from './providers.ts';

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
}

/** 2.0: vecinos por lote y lotes en paralelo (el primero va solo para escribir la caché). */
export const TURN_BATCH = 15;
const TURN_PARALLEL = 4;
const TURN_TIMEOUT_MS = 60_000;
const TURN_OUT_PER_CITIZEN = 160;

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
    const model = modelFor(provider, pick('model', env.model, row?.model), 'cheap');
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
    const one = async (ids: number[]): Promise<void> => {
      const req = buildTurnRequest(state, ids, shared);
      const est = costEur(this.prices, s.model, s.provider, { in: Math.ceil((req.system.length + req.shared.length + req.user.length) / 3.2), cachedIn: 0, out: ids.length * TURN_OUT_PER_CITIZEN }) * 1.5;
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
          { system: req.system, shared: req.shared, user: req.user, schema: req.schema, model: s.model, maxTokens: 300 + ids.length * TURN_OUT_PER_CITIZEN },
          AbortSignal.timeout(TURN_TIMEOUT_MS),
        );
        usage.in = r.usage.in;
        usage.cachedIn = r.usage.cachedIn;
        usage.out = r.usage.out;
        const parsed = parseTurn(r.text, ids, `${req.shared}\n${req.user}`);
        valid = parsed.acts.length;
        result.acts.push(...parsed.acts);
        result.answered += parsed.acts.length;
        if (parsed.missing.length) status = 'partial';
      } catch (e) {
        status = (e as Error).name === 'TimeoutError' ? 'timeout' : 'error';
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
            model: s.model,
            tokens_in: usage.in,
            tokens_cached: usage.cachedIn,
            tokens_out: usage.out,
            eur: costEur(this.prices, s.model, s.provider, usage),
            requested: ids.length,
            valid,
            retried: 0,
            status,
          })
          .execute();
      }
    };
    // El primer lote va solo (escribe la caché del bloque común); los demás, en paralelo.
    try {
      await one(batches[0]!);
      const rest = batches.slice(1);
      for (let i = 0; i < rest.length; i += TURN_PARALLEL) await Promise.all(rest.slice(i, i + TURN_PARALLEL).map((b) => one(b).catch(() => undefined)));
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
}
