import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

export const BACKUP_RE = /^bitopolis-\d{4}-\d{2}-\d{2}\.db$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Copia diaria de la BD en <dataDir>/backups con rotación (se guardan `keep`, 7 por defecto; se elige en /admin). */
export async function backupNow(raw: Database.Database, dataDir: string, now = new Date(), keep = 7): Promise<string> {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `bitopolis-${now.toISOString().slice(0, 10)}.db`);
  await raw.backup(file);
  const old = readdirSync(dir)
    .filter((f) => BACKUP_RE.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) rmSync(join(dir, f));
  return file;
}

export function scheduleBackups(raw: Database.Database, dataDir: string, keep: () => number, log: (msg: string) => void): NodeJS.Timeout {
  const run = () => backupNow(raw, dataDir, new Date(), keep()).then((f) => log(`copia de seguridad: ${f}`), (e) => log(`copia fallida: ${e}`));
  void run();
  const t = setInterval(run, DAY_MS);
  t.unref();
  return t;
}
