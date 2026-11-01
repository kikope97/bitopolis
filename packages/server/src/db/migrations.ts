import { type Kysely, sql } from 'kysely';
import { type Migration, type MigrationProvider, Migrator } from 'kysely/migration';

/** Migraciones en código para que viajen dentro del bundle de la imagen. */
const migrations: Record<string, Migration> = {
  '0001_games': {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('games')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('token', 'varchar(32)', (c) => c.notNull().unique())
        .addColumn('created_at', 'varchar(32)', (c) => c.notNull())
        .addColumn('updated_at', 'varchar(32)', (c) => c.notNull())
        .addColumn('mode', 'varchar(16)', (c) => c.notNull())
        .addColumn('format_version', 'integer', (c) => c.notNull())
        .addColumn('state', 'text', (c) => c.notNull())
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable('games').execute();
    },
  },
  '0002_lease': {
    async up(db: Kysely<unknown>) {
      await db.schema.alterTable('games').addColumn('lease_session', 'varchar(64)').execute();
      await db.schema.alterTable('games').addColumn('lease_until', 'integer', (c) => c.notNull().defaultTo(0)).execute();
      await db.schema.alterTable('games').addColumn('seed', 'integer', (c) => c.notNull().defaultTo(0)).execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.alterTable('games').dropColumn('lease_session').execute();
      await db.schema.alterTable('games').dropColumn('lease_until').execute();
      await db.schema.alterTable('games').dropColumn('seed').execute();
    },
  },
  '0003_ai': {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('ai_config')
        .addColumn('game_id', 'integer', (c) => c.primaryKey().references('games.id').onDelete('cascade'))
        .addColumn('provider', 'varchar(32)')
        .addColumn('model', 'varchar(128)')
        .addColumn('model_premium', 'varchar(128)')
        .addColumn('base_url', 'varchar(512)')
        .addColumn('key_enc', 'text')
        .addColumn('key_mask', 'varchar(32)')
        .addColumn('cap_day', 'real')
        .addColumn('cap_month', 'real')
        .addColumn('accepted_at', 'varchar(32)')
        .execute();
      await db.schema
        .createTable('ai_usage')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('game_id', 'integer', (c) => c.notNull())
        .addColumn('ts', 'integer', (c) => c.notNull())
        .addColumn('day', 'varchar(10)', (c) => c.notNull())
        .addColumn('month', 'varchar(7)', (c) => c.notNull())
        .addColumn('kind', 'varchar(16)', (c) => c.notNull())
        .addColumn('model', 'varchar(128)', (c) => c.notNull())
        .addColumn('tokens_in', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('tokens_cached', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('tokens_out', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('eur', 'real', (c) => c.notNull().defaultTo(0))
        .addColumn('requested', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('valid', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('retried', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('status', 'varchar(16)', (c) => c.notNull())
        .execute();
      await db.schema.createIndex('ai_usage_game_month').on('ai_usage').columns(['game_id', 'month']).execute();
      await db.schema.createIndex('ai_usage_month').on('ai_usage').column('month').execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable('ai_usage').execute();
      await db.schema.dropTable('ai_config').execute();
    },
  },
  // v1.2: ajustes del servidor editables desde /admin (sin variables de entorno).
  '0004_settings': {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('settings')
        .addColumn('key', 'varchar(64)', (c) => c.primaryKey())
        .addColumn('value', 'text', (c) => c.notNull())
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable('settings').execute();
    },
  },
  // 2.3: enlace de solo lectura (/v/<token>), independiente del token de juego. SQLite no admite
  // UNIQUE en ADD COLUMN: va en un índice único (admite varios NULL).
  '0006_view': {
    async up(db: Kysely<unknown>) {
      await db.schema.alterTable('games').addColumn('view_token', 'varchar(32)').execute();
      await db.schema.alterTable('games').addColumn('view_created_at', 'varchar(32)').execute();
      await db.schema.createIndex('games_view_token').unique().on('games').column('view_token').execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropIndex('games_view_token').execute();
      await db.schema.alterTable('games').dropColumn('view_created_at').execute();
      await db.schema.alterTable('games').dropColumn('view_token').execute();
    },
  },
};

class InCodeProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export async function runMigrations(db: Kysely<any>): Promise<void> {
  const migrator = new Migrator({ db, provider: new InCodeProvider() });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) if (r.status === 'Error') throw new Error(`migración ${r.migrationName} falló`);
  if (error) throw error;
  await sql`select 1`.execute(db);
}
