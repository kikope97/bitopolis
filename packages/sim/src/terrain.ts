import type { TerrainShape } from '@bitopolis/shared';
import { chance, nextInt, type RngState } from './prng.ts';

/**
 * v1.7: geografía. Cada casilla tiene un terreno (aparte de lo construido):
 * llano, río, mar o colina. En el río solo caben puentes; en el mar, nada;
 * en la colina se construye, pero cuesta más.
 */
export const Terrain = { Flat: 0, River: 1, Sea: 2, Hill: 3 } as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const isWater = (t: number | undefined) => t === Terrain.River || t === Terrain.Sea;

/**
 * Genera el terreno de un pueblo nuevo. El centro (ayuntamiento y primera
 * calle, con margen) queda siempre en llano para que el comienzo sea igual de
 * fácil en todas las semillas.
 *
 * 2.3: `shape` fuerza o quita costa, río y lomas. «aleatorio» es lo de siempre
 * (mismos dados en el mismo orden: misma semilla, mismo mapa). Las demás tiran
 * los mismos dados y luego deciden: «rio» (río seguro, sin mar), «costa» (mar
 * seguro), «colina» (sin mar, más lomas y más grandes) y «llano» (ni agua ni
 * lomas). `opts.river` obliga a que haya río (escenario «Tras la riada»).
 */
export function generateTerrain(rng: RngState, w: number, h: number, shape: TerrainShape = 'aleatorio', opts: { river?: boolean } = {}): number[] {
  const t = new Array<number>(w * h).fill(Terrain.Flat);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const dry = (x: number, y: number) => Math.abs(x - cx) <= 7 && Math.abs(y - cy) <= 5;
  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h && !dry(x, y)) t[y * w + x] = v;
  };

  // Costa: a veces el pueblo da al mar por uno de sus lados.
  let seaSide = -1;
  const seaDice = chance(rng, 0.4);
  if (shape === 'costa' || (shape === 'aleatorio' && seaDice)) {
    seaSide = nextInt(rng, 0, 3); // 0 norte, 1 este, 2 sur, 3 oeste
    let depth = nextInt(rng, 3, 5);
    const len = seaSide % 2 === 0 ? w : h;
    for (let k = 0; k < len; k++) {
      if (chance(rng, 0.45)) depth = Math.max(2, Math.min(6, depth + nextInt(rng, -1, 1)));
      for (let d = 0; d < depth; d++) {
        if (seaSide === 0) set(k, d, Terrain.Sea);
        else if (seaSide === 1) set(w - 1 - d, k, Terrain.Sea);
        else if (seaSide === 2) set(k, h - 1 - d, Terrain.Sea);
        else set(d, k, Terrain.Sea);
      }
    }
  }

  // Río: cruza el mapa serpenteando (hacia el mar, si lo hay). Dos casillas de ancho.
  const riverDice = chance(rng, 0.85);
  if (opts.river || shape === 'rio' || ((shape === 'aleatorio' || shape === 'costa' || shape === 'colina') && riverDice)) {
    // Eje del río: si hay mar, perpendicular a su costa y desembocando en ella.
    const vertical = seaSide === -1 ? chance(rng, 0.5) : seaSide % 2 === 0;
    const len = vertical ? h : w;
    const span = vertical ? w : h;
    const forwardDown = seaSide === -1 ? chance(rng, 0.5) : seaSide === 2 || seaSide === 1;
    const center = vertical ? cx : cy;
    const reach = vertical ? 7 : 5;
    // Empieza a un lado del centro (a veces cerca, otras lejos).
    let lat = chance(rng, 0.5) ? nextInt(rng, 3, center - reach - 2) : nextInt(rng, center + reach + 1, span - 5);
    let drift = 0;
    for (let k = 0; k < len; k++) {
      const f = forwardDown ? k : len - 1 - k;
      const prev = lat;
      if (chance(rng, 0.3)) drift = nextInt(rng, -1, 1);
      lat = Math.max(1, Math.min(span - 3, lat + drift));
      // A la altura del centro, el río se aparta del pueblo inicial.
      const nearCenter = Math.abs(f - (vertical ? cy : cx)) <= (vertical ? 6 : 8);
      if (nearCenter && lat >= center - reach - 2 && lat <= center + reach + 1) {
        lat = prev < center ? center - reach - 3 : center + reach + 2;
        drift = 0;
      }
      // Continuo: si salta varias casillas de lado, se rellena el tramo.
      const lo = Math.min(prev, lat);
      const hi = Math.max(prev, lat) + 1;
      let reachedSea = false;
      for (let l = lo; l <= hi; l++) {
        const [x, y] = vertical ? [l, f] : [f, l];
        if (t[y * w + x] === Terrain.Sea) reachedSea = true;
        else set(x, y, Terrain.River);
      }
      if (reachedSea) break;
    }
  }

  // Colinas: de una a tres lomas, lejos del centro y fuera del agua.
  const hillDice = nextInt(rng, 1, 3);
  const hills = shape === 'llano' ? 0 : shape === 'colina' ? hillDice + 2 : hillDice;
  for (let n = 0; n < hills; n++) {
    let hx = 0;
    let hy = 0;
    for (let tries = 0; tries < 20; tries++) {
      hx = nextInt(rng, 3, w - 4);
      hy = nextInt(rng, 3, h - 4);
      if (Math.abs(hx - cx) > 10 || Math.abs(hy - cy) > 8) break;
    }
    const r = nextInt(rng, 2, 4) + (shape === 'colina' ? 1 : 0);
    for (let y = hy - r - 1; y <= hy + r + 1; y++) {
      for (let x = hx - r - 1; x <= hx + r + 1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h || t[y * w + x] !== Terrain.Flat) continue;
        const d = Math.hypot(x - hx, y - hy);
        if (d <= r || (d <= r + 1 && chance(rng, 0.5))) set(x, y, Terrain.Hill);
      }
    }
  }
  return t;
}
