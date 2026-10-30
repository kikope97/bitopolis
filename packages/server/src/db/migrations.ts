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
