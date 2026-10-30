import { PALETTE } from './palette.ts';

/**
 * Sprites a partir de plantillas modulares (cuerpo, tejado, puerta, ventanas)
 * sobre matrices de índices de paleta. Luz desde arriba a la izquierda,
 * contorno de 1 px del tono más oscuro del material (nunca negro puro),
 * 3 tonos por material, sin degradados ni antialiasing.
 */
export const S = 16;
const EMPTY = -1;

/** [claro, medio, oscuro] */
type Material = readonly [number, number, number];
export const M = {
  brick: [3, 2, 1],
  terracotta: [19, 18, 17],
  cream: [21, 20, 19],
  white: [12, 13, 14],
  blue: [11, 10, 9],
  green: [5, 6, 7],
  leaf: [22, 23, 24],
  tree: [6, 24, 25],
  grey: [30, 29, 28],
  slate: [13, 14, 15],
  yellow: [4, 20, 19],
  wood: [20, 19, 17],
  plum: [2, 1, 16],
} as const satisfies Record<string, Material>;

export type Grid = number[][];

function grid(w = S, h = S): Grid {
  return Array.from({ length: h }, () => new Array<number>(w).fill(EMPTY));
}

function put(g: Grid, x: number, y: number, c: number) {
  if (y >= 0 && y < g.length && x >= 0 && x < g[0]!.length) g[y]![x] = c;
}

function rect(g: Grid, x: number, y: number, w: number, h: number, c: number) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(g, i, j, c);
}

/** Bloque sombreado: claro arriba/izquierda, oscuro abajo/derecha, contorno. */
function block(g: Grid, x: number, y: number, w: number, h: number, m: Material) {
  rect(g, x, y, w, h, m[1]);
  rect(g, x + 1, y + 1, 1, h - 2, m[0]);
  rect(g, x + 1, y + 1, w - 2, 1, m[0]);
  rect(g, x + w - 2, y + 2, 1, h - 3, m[2]);
  rect(g, x + 2, y + h - 2, w - 3, 1, m[2]);
  outline(g, x, y, w, h, m[2]);
}

function outline(g: Grid, x: number, y: number, w: number, h: number, c: number) {
  rect(g, x, y, w, 1, c);
  rect(g, x, y + h - 1, w, 1, c);
  rect(g, x, y, 1, h, c);
  rect(g, x + w - 1, y, 1, h, c);
}

/** Tejado a dos aguas. */
function gable(g: Grid, x: number, y: number, w: number, h: number, m: Material) {
  for (let j = 0; j < h; j++) {
    const inset = Math.max(0, Math.floor(((h - 1 - j) * (w / 2)) / h) - 1);
    for (let i = inset; i < w - inset; i++) {
      const edge = i === inset || i === w - inset - 1 || j === h - 1;
      put(g, x + i, y + j, edge ? m[2] : i < w / 2 ? m[0] : m[1]);
    }
  }
}

function windowAt(g: Grid, x: number, y: number, frame = 14) {
  rect(g, x, y, 2, 2, 11);
  put(g, x, y, 12);
  put(g, x + 2, y + 2, frame);
}

function door(g: Grid, x: number, y: number, m: Material = M.wood) {
  rect(g, x, y, 2, 3, m[2]);
  put(g, x + 1, y + 1, m[0]);
}

/* ---------- edificios ---------- */

export interface HouseOpts {
  wall: Material;
  roof: Material;
  floors: 1 | 2;
  windows: number;
  chimney: boolean;
}

export function house(o: HouseOpts): Grid {
  const g = grid();
  const top = o.floors === 2 ? 5 : 8;
  block(g, 2, top, 12, 16 - top, o.wall);
  gable(g, 1, top - 5, 14, 6, o.roof);
  if (o.chimney) block(g, 10, top - 6, 3, 4, M.brick);
  door(g, 7, 13);
  const ys = o.floors === 2 ? [top + 3, top + 7] : [top + 3];
  for (const y of ys) {
    if (o.windows >= 1) windowAt(g, 4, y);
    if (o.windows >= 2) windowAt(g, 10, y);
  }
  return g;
}

function townhall(): Grid {
  const g = grid();
  block(g, 1, 6, 14, 10, M.cream);
  gable(g, 0, 1, 16, 6, M.terracotta);
  block(g, 6, 0, 4, 4, M.cream); // torre del reloj
  put(g, 7, 1, 12);
  put(g, 8, 2, 15);
  for (const x of [3, 6, 9, 12]) windowAt(g, x, 8);
  rect(g, 6, 12, 4, 4, M.wood[2]);
  put(g, 7, 13, M.wood[0]);
  rect(g, 4, 11, 1, 5, M.cream[0]);
  rect(g, 11, 11, 1, 5, M.cream[0]);
  return g;
}

function waterTower(): Grid {
  const g = grid();
  rect(g, 4, 9, 1, 7, M.grey[2]);
  rect(g, 11, 9, 1, 7, M.grey[2]);
  rect(g, 4, 12, 8, 1, M.grey[1]);
  block(g, 2, 2, 12, 8, M.blue);
  gable(g, 2, 0, 12, 3, M.slate);
  rect(g, 5, 5, 6, 1, M.blue[0]);
  return g;
}

function powerPlant(): Grid {
  const g = grid();
  block(g, 1, 7, 10, 9, M.grey);
  block(g, 11, 2, 4, 14, M.slate);
  rect(g, 11, 4, 4, 1, M.plum[0]);
  rect(g, 3, 10, 2, 2, M.yellow[0]);
  rect(g, 7, 10, 2, 2, M.yellow[0]);
  put(g, 13, 0, 13);
  put(g, 12, 1, 13);
  door(g, 5, 13, M.slate);
  return g;
}

function park(): Grid {
  const g = grid();
  rect(g, 0, 0, 16, 16, M.leaf[0]);
  for (let i = 0; i < 16; i += 3) put(g, (i * 7) % 16, i, M.leaf[1]);
  rect(g, 6, 0, 3, 16, M.wood[0]);
  tree(g, 1, 1);
  tree(g, 10, 6);
  rect(g, 2, 12, 4, 1, M.wood[2]); // banco
  rect(g, 2, 13, 1, 1, M.wood[2]);
  rect(g, 5, 13, 1, 1, M.wood[2]);
  put(g, 12, 2, 4);
  put(g, 3, 9, 2);
  return g;
}

function school(): Grid {
  const g = grid();
  block(g, 0, 5, 16, 11, M.brick);
  rect(g, 0, 4, 16, 2, M.slate[2]);
  for (const x of [2, 5, 10, 13]) windowAt(g, x, 7);
  door(g, 7, 13);
  rect(g, 7, 0, 1, 5, M.grey[2]); // mástil
  rect(g, 8, 0, 3, 2, M.yellow[0]);
  return g;
}

function clinic(): Grid {
  const g = grid();
  block(g, 1, 4, 14, 12, M.white);
  rect(g, 1, 3, 14, 2, M.slate[1]);
  rect(g, 7, 6, 2, 6, M.brick[1]);
  rect(g, 5, 8, 6, 2, M.brick[1]);
  windowAt(g, 2, 7);
  windowAt(g, 12, 7);
  door(g, 7, 13, M.slate);
  return g;
}

function shop(variant: number): Grid {
  const g = grid();
  const walls = [M.cream, M.white, M.brick];
  const awnings = [M.brick, M.blue, M.green];
  block(g, 1, 4, 14, 12, walls[variant % 3]!);
  const aw = awnings[(variant >> 2) % 3]!;
  for (let x = 1; x < 15; x++) {
    rect(g, x, 7, 1, 2, x % 2 === 0 ? aw[0] : 12);
  }
  rect(g, 1, 9, 14, 1, aw[2]);
  rect(g, 3, 11, 4, 3, 11);
  put(g, 3, 11, 12);
  door(g, 10, 13);
  rect(g, 4, 5, 8, 1, aw[1]); // letrero
  return g;
}

function factory(): Grid {
  const g = grid();
  block(g, 0, 6, 16, 10, M.grey);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) put(g, i * 4 + j, 5 - j, M.slate[j === 0 ? 2 : 1]);
  }
  block(g, 12, 0, 3, 7, M.brick);
  rect(g, 2, 9, 3, 2, 11);
  rect(g, 6, 9, 3, 2, 11);
  rect(g, 10, 11, 4, 5, M.slate[2]);
  return g;
}

function tree(g: Grid, x: number, y: number, m: Material = M.tree) {
  rect(g, x + 2, y + 5, 1, 3, M.wood[2]);
  rect(g, x, y + 1, 5, 4, m[1]);
  rect(g, x + 1, y, 3, 1, m[1]);
  rect(g, x + 1, y + 1, 2, 2, m[0]);
  rect(g, x + 4, y + 2, 1, 3, m[2]);
  rect(g, x + 1, y + 5, 3, 1, m[2]);
  put(g, x + 2, y + 5, M.wood[2]);
}

function treeTile(): Grid {
  const g = grid();
  tree(g, 1, 2);
  tree(g, 8, 6);
  return g;
}

function scaffold(): Grid {
  const g = grid();
  rect(g, 2, 12, 12, 4, M.wood[1]);
  outline(g, 2, 12, 12, 4, M.wood[2]);
  for (const x of [2, 7, 13]) rect(g, x, 3, 1, 10, M.yellow[1]);
  for (const y of [4, 8]) rect(g, 2, y, 12, 1, M.yellow[2]);
  put(g, 5, 7, M.yellow[0]);
  put(g, 10, 3, M.yellow[0]);
  return g;
}

/* ---------- iconos 7×7 ---------- */

function icon(rows: string[], colors: Record<string, number>): Grid {
  return rows.map((r) => [...r].map((ch) => (ch === '.' ? EMPTY : colors[ch]!)));
}

export const ICONS = {
  noWater: icon(['...b...', '..bab..', '.babab.', 'babaaab', 'baaaaab', '.baaab.', '..bbb..'], { a: 10, b: 0 }),
  noPower: icon(['..bbbb.', '.baab..', 'baab...', 'baaaab.', '..baab.', '.bab...', 'bb.....'], { a: 4, b: 0 }),
};

/** Letras 3×5 para marcar zonas sin depender del color. */
const LETTERS: Record<string, string[]> = {
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
};

export function letter(ch: 'R' | 'C' | 'I', color: number): Grid {
  return LETTERS[ch]!.map((r) => [...r].map((c) => (c === '#' ? color : EMPTY)));
}

/* ---------- caché de canvas ---------- */

const cache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();

function toCanvas(g: Grid): HTMLCanvasElement {
  const h = g.length;
  const w = g[0]!.length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = g[y]![x]!;
      if (idx === EMPTY) continue;
      const hex = PALETTE[idx]!;
      const o = (y * w + x) * 4;
      img.data[o] = parseInt(hex.slice(1, 3), 16);
      img.data[o + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[o + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function sprite(key: string, make: () => Grid): HTMLCanvasElement {
  let c = cache.get(key) as HTMLCanvasElement | undefined;
  if (!c) {
    c = toCanvas(make());
    cache.set(key, c);
  }
  return c;
}

const RES_WALLS = [M.cream, M.white, M.brick, M.blue];
const RES_ROOFS = [M.terracotta, M.slate, M.plum, M.green];

/** Sprite de un edificio. Las viviendas varían con su id (semilla). */
export function buildingSprite(kind: string, id: number): HTMLCanvasElement {
  switch (kind) {
    case 'townhall':
      return sprite('townhall', townhall);
    case 'water':
      return sprite('water', waterTower);
    case 'power':
      return sprite('power', powerPlant);
    case 'park':
      return sprite('park', park);
    case 'school':
      return sprite('school', school);
    case 'clinic':
      return sprite('clinic', clinic);
    case 'factory':
      return sprite('factory', factory);
    case 'shop':
      return sprite(`shop${id % 12}`, () => shop(id % 12));
    case 'house':
      return sprite('house', () => house({ wall: M.cream, roof: M.terracotta, floors: 1, windows: 2, chimney: true }));
    case 'res': {
      const v = id % 32;
      return sprite(`res${v}`, () =>
        house({
          wall: RES_WALLS[v % 4]!,
          roof: RES_ROOFS[(v >> 2) % 4]!,
          floors: 2,
          windows: 1 + ((v >> 4) & 1),
          chimney: (v & 2) === 0,
        }),
      );
    }
    default:
      return sprite('scaffold', scaffold);
  }
}

export const treeSprite = () => sprite('tree', treeTile);
export const scaffoldSprite = () => sprite('scaffold', scaffold);
export const iconSprite = (k: keyof typeof ICONS) => sprite(`icon-${k}`, () => ICONS[k]);
export const letterSprite = (ch: 'R' | 'C' | 'I', color: number) => sprite(`L${ch}${color}`, () => letter(ch, color));
