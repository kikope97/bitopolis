import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifrado de API keys con AES-256-GCM. La clave sale de BITOPOLIS_MASTER_KEY
 * (nunca se guarda en la BD). Formato: v1.<iv>.<tag>.<datos> en base64url.
 */
function keyFrom(master: string): Buffer {
  return createHash('sha256').update(`bitopolis:${master}`).digest();
}

export function encryptSecret(plain: string, master: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(master), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(blob: string, master: string): string {
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('formato de secreto desconocido');
  const d = createDecipheriv('aes-256-gcm', keyFrom(master), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

/** Lo único que ve el cliente: "sk-…abcd". */
export function maskKey(key: string): string {
  // El prefijo dice el proveedor y no es secreto («sk-ant-»); del resto, solo los 4 últimos.
  const head = key.startsWith('sk-ant-') && key.length > 15 ? 'sk-ant-' : key.slice(0, Math.min(3, Math.max(0, key.length - 8)));
  return `${head}…${key.slice(-4)}`;
}
