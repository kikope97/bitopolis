import { z } from 'zod';

/** Token de partida: ≥128 bits en base62 (22 caracteres). */
export const GAME_TOKEN_LENGTH = 22;
export const GameToken = z.string().regex(/^[0-9A-Za-z]{22}$/);

export interface HealthResponse {
  ok: true;
  version: string;
  db: 'ok';
}
