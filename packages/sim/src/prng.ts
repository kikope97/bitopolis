/**
 * PRNG determinista sfc32. Su estado vive dentro del GameState (4 uint32),
 * así que serializar la partida guarda también la posición del generador.
 * En `sim` está prohibido Math.random(): todo azar pasa por aquí.
 */
export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  // splitmix32 para expandir la semilla a 4 palabras.
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st: RngState = [next(), next(), next(), next()];
  for (let i = 0; i < 12; i++) nextU32(st);
  return st;
}

export function nextU32(st: RngState): number {
  let [a, b, c, d] = st;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  st[0] = a >>> 0;
  st[1] = b;
  st[2] = c;
  st[3] = d;
  return t;
}

/** Flotante en [0, 1). */
export function nextFloat(st: RngState): number {
  return nextU32(st) / 4294967296;
}

/** Entero en [min, max] (ambos incluidos). */
export function nextInt(st: RngState, min: number, max: number): number {
  return min + Math.floor(nextFloat(st) * (max - min + 1));
}

export function chance(st: RngState, p: number): boolean {
  return nextFloat(st) < p;
}

export function pick<T>(st: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: lista vacía');
  return items[nextInt(st, 0, items.length - 1)] as T;
}
