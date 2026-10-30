/** Identificador de esta pestaña (para saber quién tiene la partida abierta). */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomBase62(n: number): string {
  const bytes = new Uint8Array(n * 2);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length && out.length < n; i++) {
    const v = bytes[i]!;
    if (v < 248) out += ALPHABET[v % 62];
  }
  while (out.length < n) out += ALPHABET[crypto.getRandomValues(new Uint8Array(1))[0]! % 62];
  return out;
}

export function sessionId(): string {
  try {
    let id = sessionStorage.getItem('bitopolis.session');
    if (!id) {
      id = randomBase62(24);
      sessionStorage.setItem('bitopolis.session', id);
    }
    return id;
  } catch {
    return randomBase62(24);
  }
}
