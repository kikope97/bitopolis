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
}

export interface DB {
  games: GamesTable;
}
