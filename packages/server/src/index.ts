import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { scheduleBackups } from './db/backup.ts';
import { openDb } from './db/index.ts';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const { db, raw } = await openDb(join(config.dataDir, 'bitopolis.db'));
const app = await buildApp(config, db);
scheduleBackups(raw, config.dataDir, (m) => app.log.info(m));

if (!config.masterKey) app.log.warn('BITOPOLIS_MASTER_KEY no está definida: no se podrán guardar API keys.');
if (config.publicUrl.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(config.publicUrl)) {
  app.log.warn('Sirviendo por HTTP sin cifrar: la URL de la partida funciona como contraseña. Usa un proxy con HTTPS.');
}

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
