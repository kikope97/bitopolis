import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { runMigrations } from './migrations.ts';
import type { DB } from './schema.ts';

export type Db = Kysely<DB>;

/** Abre SQLite en modo WAL y aplica las migraciones pendientes. */
export async function openDb(file: string): Promise<{ db: Db; raw: Database.Database }> {
  const raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: raw }) });
  await runMigrations(db);
  return { db, raw };
}
