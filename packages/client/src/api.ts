import type { TurnAct } from '@bitopolis/sim';
import type { GameState, ViewSnapshot } from '@bitopolis/sim';
import type { ScenarioId, TerrainShape } from '@bitopolis/shared';
import type { ListedModel } from './model-picker.ts';
import type { SaveBatch } from './sim.worker.ts';

export interface Summary {
  population: number;
  date: { year: number; month: number; day: number };
  treasury: number;
  happiness: number;
  headline: string | null;
}

/** 2.3: estado del enlace de solo lectura. */
export type ShareStatus = { active: false } | { active: true; viewToken: string; since: string | null };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: any = null,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown, keepalive = false): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    keepalive,
  });
  const data = await r.json().catch(() => null);
  if (r.status === 401) {
    location.href = `/login.html?caducada=1&next=${encodeURIComponent(location.pathname)}`;
  }
  if (!r.ok) throw new ApiError(r.status, data?.error ?? `Error ${r.status}`, data);
  return data as T;
}

export const api = {
  get: (token: string) => call<{ exists: false } | { exists: true; mode: string; summary: Summary }>('GET', `/api/games/${token}`),
  // 2.3: escenario y terreno solo se mandan si no son los de siempre (Libre y aleatorio).
  create: (token: string, mode: 'normal' | 'ai', sessionId: string, start: { scenario?: ScenarioId; terrain?: TerrainShape } = {}) =>
    call<{ state: GameState; mode: string }>('POST', `/api/games/${token}`, { mode, sessionId, ...start }),
  claim: (token: string, sessionId: string, force = false) =>
    call<{ state: GameState; mode: string }>('POST', `/api/games/${token}/claim`, { sessionId, force }),
  release: (token: string, sessionId: string) =>
    call<{ ok: boolean }>('POST', `/api/games/${token}/release`, { sessionId }, true).catch(() => null),
  save: (token: string, sessionId: string, b: SaveBatch & { live?: boolean }, keepalive = false) =>
    call<{ ok: true; tick: number }>('PUT', `/api/games/${token}/save`, { sessionId, ...b }, keepalive),
  aiMeta: () => call<AiMeta>('GET', '/api/ai/meta'),
  aiConfig: (token: string) => call<AiSettings>('GET', `/api/games/${token}/ai-config`),
  saveAiConfig: (token: string, body: Record<string, unknown>) => call<AiSettings>('PUT', `/api/games/${token}/ai-config`, body),
  /** Modelos de la key guardada (sin borrador) o de una escrita y aún sin guardar. La key no vuelve. */
  aiModels: (token: string, draft?: { key?: string; baseUrl?: string }) =>
    draft
      ? call<{ provider: string; models: ListedModel[] }>('POST', `/api/games/${token}/ai/models`, draft)
      : call<{ provider: string; models: ListedModel[] }>('GET', `/api/games/${token}/ai/models`),
  estimate: (provider: string, model: string, share: number) =>
    call<{ eurPerHour: Record<string, number>; citizens: number; known: boolean }>('GET', `/api/ai/estimate?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}&share=${share}`),
  decisions: (token: string) =>
    call<{ decisions: { citizenId: number; createdTick: number; action: string; motivo: string }[]; capped: boolean; notice?: string; budgetFraction: number }>(
      'GET',
      `/api/games/${token}/decisions`,
    ),
  aiUsage: (token: string) => call<AiUsage>('GET', `/api/games/${token}/ai-usage`),
  aiPreview: (token: string) => call<{ system: string; user: string }>('GET', `/api/games/${token}/ai-preview`),
  talk: (token: string, citizenId: number, question: string) => call<{ text: string | null; reason?: string }>('POST', `/api/games/${token}/talk`, { citizenId, question }),
  /** 2.0: resultado del turno del pueblo `n`. */
  turn: (token: string, n: number) => call<{ turn: TurnResult | null; capped: boolean; notice?: string }>('GET', `/api/games/${token}/turn/${n}`),
  advisor: (token: string, question: string) => call<{ text: string | null; reason?: string }>('POST', `/api/games/${token}/advisor`, { question }),
  chronicle: (token: string) => call<{ text: string | null; reason?: string }>('POST', `/api/games/${token}/chronicle`),
  regenerate: (token: string, sessionId: string) => call<{ token: string }>('POST', `/api/games/${token}/regenerate`, { sessionId }),
  /** 2.3: enlace de solo lectura /v/<viewToken> (independiente del de juego). */
  shareStatus: (token: string) => call<ShareStatus>('GET', `/api/games/${token}/share`),
  share: (token: string, sessionId: string) => call<ShareStatus>('POST', `/api/games/${token}/share`, { sessionId }),
  unshare: (token: string, sessionId: string) => call<ShareStatus>('DELETE', `/api/games/${token}/share`, { sessionId }),
  view: (viewToken: string) => call<{ snapshot: ViewSnapshot; updatedAt: string }>('GET', `/api/view/${viewToken}`),
  async import(file: File): Promise<{ token: string }> {
    const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, data?.error ?? 'No se pudo importar');
    return data;
  },
};

/** 2.0: resultado de un turno del pueblo (lo que decidió la IA). */
export interface TurnResult {
  n: number;
  status: 'pending' | 'ready' | 'failed';
  acts: TurnAct[];
  requested: number;
  answered: number;
  reason?: string;
  rung?: 'calidad' | 'ahorro' | 'cerca del tope';
  director?: { sucesos: { id: string; motivo: string }[]; avisos: { id: string; motivo: string }[] };
  focus?: string;
  chronicle?: string;
}

export interface AiMeta {
  providers: { id: string; label: string; cheap: string; premium: string; baseUrl: string; needsKey: boolean; models?: string[] }[];
  /** La IA la pone el servidor (/admin): todas las partidas son de Modo IA. */
  serverKey: boolean;
  maxCitizens: number;
  /** 2.0: % de vecinos con IA por defecto (o fijo, con key del servidor). */
  aiShare: number;
  /** 2.0: modelo de los vecinos por defecto: el bueno (calidad) o el barato (ahorro). */
  turnQuality?: 'calidad' | 'ahorro';
  /** Sin IA del servidor, ¿puede cada partida poner su propia key? */
  playerKeys: boolean;
  newGames: boolean;
  /** URL pública para los enlaces (vacía: la del navegador). */
  publicUrl: string;
}

export interface AiSettings {
  provider: string;
  model: string;
  modelPremium: string;
  baseUrl?: string;
  keyMask?: string;
  capDay?: number;
  capMonth?: number;
  serverMonthly?: number;
  locked: string[];
  configured: boolean;
}

export interface AiUsage {
  eur: number;
  calls: number;
  requested: number;
  valid: number;
  retried: number;
  tokensIn: number;
  tokensOut: number;
  byKind: Record<string, number>;
  spend: { gameDay: number; gameMonth: number; serverMonth: number };
  caps: { day?: number; month?: number; server?: number };
}
