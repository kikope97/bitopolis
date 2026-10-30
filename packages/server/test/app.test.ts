import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'bitopolis-'));
const { db, raw } = await openDb(join(dir, 'test.db'));
const app = await buildApp({ ...loadConfig({}), dataDir: dir, clientDir: join(dir, 'nope'), secret: 'secreto-de-prueba' }, db, { raw });

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('servidor', () => {
  it('/healthz responde ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, db: 'ok' });
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
  });
  it('la BD está en WAL y migrada', async () => {
    expect(raw.pragma('journal_mode', { simple: true })).toBe('wal');
    const tables = raw.prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('games');
  });
});

describe('copias de seguridad', () => {
  it('rota y conserva 7', async () => {
    const { backupNow } = await import('../src/db/backup.ts');
    const { readdirSync } = await import('node:fs');
    for (let d = 1; d <= 9; d++) await backupNow(raw, dir, new Date(Date.UTC(2026, 0, d)));
    const files = readdirSync(join(dir, 'backups')).sort();
    expect(files).toHaveLength(7);
    expect(files[0]).toBe('bitopolis-2026-01-03.db');
  });
});
