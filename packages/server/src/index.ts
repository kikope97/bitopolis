import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { scheduleBackups } from './db/backup.ts';
import { openDb } from './db/index.ts';
import { loadSecret, resetAdminIfAsked, SettingsStore } from './settings.ts';

const base = loadConfig();
mkdirSync(base.dataDir, { recursive: true });
const config = { ...base, secret: loadSecret(base.dataDir) };
const { db, raw } = await openDb(join(config.dataDir, 'bitopolis.db'));
const store = await SettingsStore.open(db);
const reset = await resetAdminIfAsked(store, config.dataDir);
const app = await buildApp(config, db, { store, raw });
scheduleBackups(raw, config.dataDir, () => store.get().backups.keep, (m) => app.log.info(m));

if (reset) app.log.warn('Cuenta del panel restablecida a admin / admin (archivo reset-admin).');
if (store.get().admin.mustChange) {
  app.log.warn('Entra en /admin con admin / admin y cambia la contraseña: hasta entonces no se puede configurar nada.');
}

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
