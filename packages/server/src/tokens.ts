import { randomBytes, randomInt } from 'node:crypto';
import { GAME_TOKEN_LENGTH } from '@bitopolis/shared';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Token de partida: 22 caracteres base62 ≈ 131 bits de azar criptográfico. */
export function newGameToken(): string {
  let out = '';
  for (let i = 0; i < GAME_TOKEN_LENGTH; i++) out += ALPHABET[randomInt(62)];
  return out;
}

export function newSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}
