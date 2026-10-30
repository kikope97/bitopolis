import { buildDecisionRequest, type GameState, parseDecisions, type Pending, recentMotivos } from '@bitopolis/sim';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { costEur, PROVIDER_INFO, PROVIDERS, priceTable, type ProviderId } from './catalog.ts';
import { decryptSecret } from './crypto.ts';
import { type LLMProvider, makeProvider } from './providers.ts';

/** Ajustes efectivos de IA de una partida (variables de entorno > partida). */
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
}

const TIMEOUT_MS = 20_000;
const MAX_OUT_PER_CITIZEN = 120;
export const MAX_BATCH = 8;

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const month = (d = new Date()) => d.toISOString().slice(0, 7);

export class AiService {
  private games = new Map<number, GameAiState>();
  /** Reservas en curso (€), para que dos peticiones no se pasen del tope. */
  private reserved = new Map<number, number>();
  readonly prices;
  /** Para tests: sustituye al proveedor real. */
  providerOverride?: (s: AiSettings) => LLMProvider;

  constructor(
    private db: Db,
    private config: Config,
  ) {
    this.prices = priceTable(config.ai.pricesJson);
  }

  async settings(gameId: number | null): Promise<AiSettings> {
    const env = this.config.ai;
    const row = gameId ? await this.db.selectFrom('ai_config').selectAll().where('game_id', '=', gameId).executeTakeFirst() : undefined;
    const locked: string[] = [];
    const pick = <T>(name: string, envVal: T | undefined, rowVal: T | null | undefined): T | undefined => {
      if (envVal !== undefined) {
        locked.push(name);
        return envVal;
      }
      return rowVal ?? undefined;
    };
    const providerRaw = pick('provider', env.provider, row?.provider);
    const provider = (PROVIDERS as readonly string[]).includes(providerRaw ?? '') ? (providerRaw as ProviderId) : 'openai';
    const info = PROVIDER_INFO[provider];
    let key: string | undefined;
    let keyMask: string | undefined;
    if (env.key) {
      locked.push('key');
      key = env.key;
      keyMask = 'definida por el servidor';
    } else if (row?.key_enc && this.config.masterKey) {
      try {
        key = decryptSecret(row.key_enc, this.config.masterKey);
        keyMask = row.key_mask ?? '…';
      } catch {
        key = undefined;
      }
    }
    const model = pick('model', env.model, row?.model) ?? info.cheap;
    return {
      provider,
      model,
      modelPremium: pick('modelPremium', env.modelPremium, row?.model_premium) ?? (env.model ? env.model : info.premium),
      baseUrl: pick('baseUrl', env.baseUrl, row?.base_url),
      key,
      keyMask,
      capDay: pick('capDay', env.gameDaily, row?.cap_day),
      capMonth: pick('capMonth', env.gameMonthly, row?.cap_month),
      serverMonthly: env.serverMonthly,
      locked,
      configured: !!key || (provider === 'openai-compatible' && !!(env.baseUrl || row?.base_url)),
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

  private gs(gameId: number): GameAiState {
    let g = this.games.get(gameId);
    if (!g) this.games.set(gameId, (g = { inflight: false, requested: new Set(), ready: [], capped: false }));
    return g;
  }

  /** Tras cada guardado: pide por adelantado las decisiones pendientes. */
  onSaved(gameId: number, state: GameState): Promise<void> | void {
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
    const blocked = await this.budgetBlock(gameId, s, est);
    if (blocked) {
      g.capped = true;
      g.lastError = `IA en pausa: ${blocked} alcanzado. Deciden las reglas.`;
      return;
    }
    g.capped = false;
    this.reserved.set(gameId, (this.reserved.get(gameId) ?? 0) + est);
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
        return parseDecisions(r.text, list, Object.fromEntries(list.map((p) => [p.citizenId, recentMotivos(state, p.citizenId, 3)])));
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
