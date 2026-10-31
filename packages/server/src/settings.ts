import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Price } from './ai/catalog.ts';
import type { Db } from './db/index.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/**
 * Ajustes del servidor, editables desde /admin (decisión del creador: la
 * imagen Docker no lleva variables). Se guardan como un único JSON en la BD y
 * se leen de memoria en cada petición, así que los cambios valen al momento.
 */
export interface ServerSettings {
  /** `epoch` sube al cerrar sesión: invalida todas las sesiones del panel. */
  admin: { user: string; hash: string; mustChange: boolean; epoch?: number };
  /** URL pública para los enlaces de las partidas; vacía = la del navegador. */
  publicUrl: string;
  /** Si es false, no se crean ni importan partidas (las que hay siguen). */
  newGames: boolean;
  /** Contraseña común para entrar a jugar (sin usuario). */
  /** `epoch` sube con cada cambio: las cookies antiguas no reviven al reactivar. */
  access: { enabled: boolean; hash: string; epoch?: number };
  ai: ServerAi;
  backups: { keep: number };
}

export interface ServerAi {
  /** API key del servidor, cifrada con la clave de /data. */
  keyEnc?: string;
  keyMask?: string;
  baseUrl?: string;
  model?: string;
  modelPremium?: string;
  maxCitizens: number;
  /** 2.0: % de vecinos con IA en las partidas nuevas (con key del servidor, fijo; con key propia, lo elige el jugador). */
  aiShare?: number;
  /** 2.0: turnos del pueblo con el modelo de calidad (por defecto) o el de ahorro. */
  turnQuality?: 'calidad' | 'ahorro';
  serverMonthly?: number;
  gameMonthly?: number;
  gameDaily?: number;
  prices?: Record<string, Price>;
  /** Sin key del servidor, ¿puede cada partida poner la suya en Configurar? */
  playerKeys: boolean;
}

export const DEFAULT_ADMIN = { user: 'admin', password: 'admin' };

/* ---------------- contraseñas (scrypt) ---------------- */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(got, expected);
}

/**
 * Clave maestra: cifra las API keys y firma las cookies. Se genera la primera
 * vez en <dataDir>/secret.key (solo lectura para el usuario del contenedor).
 * Va con los datos: una copia de /data incluye todo lo necesario.
 */
export function loadSecret(dataDir: string): string {
  const file = join(dataDir, 'secret.key');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(32).toString('base64url');
  writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return secret;
}

/* ---------------- almacén ---------------- */

async function defaults(): Promise<ServerSettings> {
  return {
    admin: { user: DEFAULT_ADMIN.user, hash: await hashPassword(DEFAULT_ADMIN.password), mustChange: true },
    publicUrl: '',
    newGames: true,
    access: { enabled: false, hash: '' },
    ai: { maxCitizens: 20, playerKeys: true },
    backups: { keep: 7 },
  };
}

export class SettingsStore {
  private constructor(
    private db: Db,
    private current: ServerSettings,
  ) {}

  static async open(db: Db): Promise<SettingsStore> {
    const row = await db.selectFrom('settings').select('value').where('key', '=', 'server').executeTakeFirst();
    const base = await defaults();
    if (!row) {
      await db.insertInto('settings').values({ key: 'server', value: JSON.stringify(base) }).execute();
      return new SettingsStore(db, base);
    }
    // Campos nuevos de versiones posteriores: se completan con el valor por defecto.
    const saved = JSON.parse(row.value) as Partial<ServerSettings>;
    const merged: ServerSettings = {
      ...base,
      ...saved,
      admin: { ...base.admin, ...saved.admin },
      access: { ...base.access, ...saved.access },
      ai: { ...base.ai, ...saved.ai },
      backups: { ...base.backups, ...saved.backups },
    };
    return new SettingsStore(db, merged);
  }

  get(): ServerSettings {
    return this.current;
  }

  async update(fn: (s: ServerSettings) => ServerSettings): Promise<ServerSettings> {
    const next = fn(structuredClone(this.current));
    await this.db.updateTable('settings').set({ value: JSON.stringify(next) }).where('key', '=', 'server').execute();
    this.current = next;
    return next;
  }
}

/**
 * Contraseña del panel olvidada: si existe <dataDir>/reset-admin al arrancar,
 * la cuenta vuelve a admin / admin (con cambio obligatorio) y se borra el
 * archivo. El resto de ajustes no se toca.
 */
export async function resetAdminIfAsked(store: SettingsStore, dataDir: string): Promise<boolean> {
  const flag = join(dataDir, 'reset-admin');
  if (!existsSync(flag)) return false;
  const hash = await hashPassword(DEFAULT_ADMIN.password);
  await store.update((s) => ({ ...s, admin: { user: DEFAULT_ADMIN.user, hash, mustChange: true, epoch: (s.admin.epoch ?? 0) + 1 } }));
  rmSync(flag, { force: true });
  return true;
}
