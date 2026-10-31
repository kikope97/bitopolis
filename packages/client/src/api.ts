import type { GameState } from '@bitopolis/sim';
import type { SaveBatch } from './sim.worker.ts';

export interface Summary {
  population: number;
  date: { year: number; month: number; day: number };
  treasury: number;
  happiness: number;
  headline: string | null;
}

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
  create: (token: string, mode: 'normal' | 'ai', sessionId: string) =>
    call<{ state: GameState; mode: string }>('POST', `/api/games/${token}`, { mode, sessionId }),
  claim: (token: string, sessionId: string, force = false) =>
    call<{ state: GameState; mode: string }>('POST', `/api/games/${token}/claim`, { sessionId, force }),
  release: (token: string, sessionId: string) =>
    call<{ ok: boolean }>('POST', `/api/games/${token}/release`, { sessionId }, true).catch(() => null),
  save: (token: string, sessionId: string, b: SaveBatch & { live?: boolean }, keepalive = false) =>
    call<{ ok: true; tick: number }>('PUT', `/api/games/${token}/save`, { sessionId, ...b }, keepalive),
  aiMeta: () => call<AiMeta>('GET', '/api/ai/meta'),
  aiConfig: (token: string) => call<AiSettings>('GET', `/api/games/${token}/ai-config`),
  saveAiConfig: (token: string, body: Record<string, unknown>) => call<AiSettings>('PUT', `/api/games/${token}/ai-config`, body),
  estimate: (provider: string, model: string, citizens: number) =>
    call<{ eurPerHour: Record<string, number>; known: boolean }>('GET', `/api/ai/estimate?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}&citizens=${citizens}`),
  decisions: (token: string) =>
    call<{ decisions: { citizenId: number; createdTick: number; action: string; motivo: string }[]; capped: boolean; notice?: string; budgetFraction: number }>(
      'GET',
      `/api/games/${token}/decisions`,
    ),
  aiUsage: (token: string) => call<AiUsage>('GET', `/api/games/${token}/ai-usage`),
  aiPreview: (token: string) => call<{ system: string; user: string }>('GET', `/api/games/${token}/ai-preview`),
  talk: (token: string, citizenId: number, question: string) => call<{ text: string | null; reason?: string }>('POST', `/api/games/${token}/talk`, { citizenId, question }),
  advisor: (token: string, question: string) => call<{ text: string | null; reason?: string }>('POST', `/api/games/${token}/advisor`, { question }),
  chronicle: (token: string) => call<{ text: string | null; reason?: string }>('POST', `/api/games/${token}/chronicle`),
  regenerate: (token: string, sessionId: string) => call<{ token: string }>('POST', `/api/games/${token}/regenerate`, { sessionId }),
  async import(file: File): Promise<{ token: string }> {
    const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, data?.error ?? 'No se pudo importar');
    return data;
  },
};

export interface AiMeta {
  providers: { id: string; label: string; cheap: string; premium: string; baseUrl: string; needsKey: boolean; models?: string[] }[];
  /** La IA la pone el servidor (/admin): todas las partidas son de Modo IA. */
  serverKey: boolean;
  maxCitizens: number;
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
