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
    location.href = `/login.html?next=${encodeURIComponent(location.pathname)}`;
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
  save: (token: string, sessionId: string, b: SaveBatch, keepalive = false) =>
    call<{ ok: true; tick: number }>('PUT', `/api/games/${token}/save`, { sessionId, ...b }, keepalive),
  regenerate: (token: string, sessionId: string) => call<{ token: string }>('POST', `/api/games/${token}/regenerate`, { sessionId }),
  async import(file: File): Promise<{ token: string }> {
    const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, data?.error ?? 'No se pudo importar');
    return data;
  },
};
