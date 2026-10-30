import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

const KEEP = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Copia diaria de la BD en <dataDir>/backups con rotación (se guardan 7). */
export async function backupNow(raw: Database.Database, dataDir: string, now = new Date()): Promise<string> {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `bitopolis-${now.toISOString().slice(0, 10)}.db`);
  await raw.backup(file);
  const old = readdirSync(dir)
    .filter((f) => /^bitopolis-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(KEEP);
  for (const f of old) rmSync(join(dir, f));
  return file;
}

export function scheduleBackups(raw: Database.Database, dataDir: string, log: (msg: string) => void): NodeJS.Timeout {
  const run = () => backupNow(raw, dataDir).then((f) => log(`copia de seguridad: ${f}`), (e) => log(`copia fallida: ${e}`));
  void run();
  const t = setInterval(run, DAY_MS);
  t.unref();
  return t;
}
