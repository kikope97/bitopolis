import type { Generated } from 'kysely';

/**
 * Esquema de la base de datos. Solo tipos portables (TEXT, INTEGER) para
 * poder migrar a MariaDB sin reescribir.
 */
export interface GamesTable {
  id: Generated<number>;
  /** Token de la URL /p/<token>. */
  token: string;
  created_at: string;
  updated_at: string;
  mode: string;
  format_version: number;
  /** Estado de la partida serializado (JSON). */
  state: string;
  /** Sesión de navegador que tiene la partida abierta y hasta cuándo (ms). */
  lease_session: string | null;
  lease_until: Generated<number>;
  seed: Generated<number>;
}

export interface AiConfigTable {
  game_id: number;
  provider: string | null;
  model: string | null;
  model_premium: string | null;
  base_url: string | null;
  /** API key cifrada con AES-256-GCM (BITOPOLIS_MASTER_KEY). */
  key_enc: string | null;
  key_mask: string | null;
  cap_day: number | null;
  cap_month: number | null;
  accepted_at: string | null;
}

export interface AiUsageTable {
  id: Generated<number>;
  game_id: number;
  ts: number;
  day: string;
  month: string;
  kind: string;
  model: string;
  tokens_in: number;
  tokens_cached: number;
  tokens_out: number;
  eur: number;
  requested: number;
  valid: number;
  retried: number;
  status: string;
}

export interface DB {
  games: GamesTable;
  ai_config: AiConfigTable;
  ai_usage: AiUsageTable;
}
