import { C, PALETTE } from './palette.ts';

/**
 * Pixel art generado por código, en alta definición: casillas de 32×32 y
 * edificios de 32×48 (vista cenital 3/4: sobresalen hacia arriba).
 * Todo se dibuja con índices de la paleta cerrada: luz desde arriba a la
 * izquierda, 4 tonos por material, texturas (ladrillo, tejas, chapa) y
 * tramado en vez de degradados. Nada de antialiasing.
 */
export const T = 32;
export const BH = 48;
const NONE = -1;

/** Tonos de un material: [brillo, base, sombra, oscuro]. */
type Mat = readonly [number, number, number, number];
export const MAT = {
  cream: [12, 21, 20, 19],
  white: [31, 12, 13, 14],
  stone: [30, 29, 28, 27],
  brick: [3, 18, 17, 16],
  red: [3, 2, 17, 16],
  blue: [11, 10, 9, 8],
  teal: [13, 14, 15, 26],
  yellow: [12, 4, 20, 19],
  terracotta: [20, 19, 18, 17],
  slate: [13, 14, 15, 26],
  moss: [22, 23, 24, 25],
  plum: [2, 1, 16, 26],
  metal: [31, 13, 14, 15],
  wood: [20, 19, 17, 16],
  glass: [11, 10, 9, 8],
  leaf: [22, 23, 24, 25],
  pine: [23, 24, 25, 7],
  dirt: [20, 19, 18, 17],
} as const satisfies Record<string, Mat>;

/** Ruido determinista para texturas. */
export function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) h = Math.imul(h ^ (v | 0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export class Pix {
  data: Int16Array;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.data = new Int16Array(w * h).fill(NONE);
  }
  set(x: number, y: number, c: number) {
    x |= 0;
    y |= 0;
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.data[y * this.w + x]! : NONE;
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
  hline(x: number, y: number, w: number, c: number) {
    this.rect(x, y, w, 1, c);
  }
  vline(x: number, y: number, h: number, c: number) {
    this.rect(x, y, 1, h, c);
  }
  frame(x: number, y: number, w: number, h: number, c: number) {
    this.hline(x, y, w, c);
    this.hline(x, y + h - 1, w, c);
    this.vline(x, y, h, c);
    this.vline(x + w - 1, y, h, c);
  }
  /** Tramado en damero (sustituye a los degradados). */
  dither(x: number, y: number, w: number, h: number, c: number, parity = 0) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if ((i + j + parity) % 2 === 0) this.set(i, j, c);
  }
  /** Disco sombreado con luz desde arriba a la izquierda. */
  ball(cx: number, cy: number, r: number, m: Mat, seed = 0) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const light = (-(dx + dy) / (r * 1.6)) + 0.15 - (d / r) * 0.35 + (hash(x, y, seed) - 0.5) * 0.25;
        let c = m[1];
        if (light > 0.38) c = m[0];
        else if (light < -0.32) c = m[3];
        else if (light < -0.05) c = m[2];
        if (d > r - 1) c = light > 0.2 ? m[1] : m[3];
        this.set(x, y, c);
      }
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }
  /** Sombra proyectada: oscurece lo que haya debajo (hierba → verde oscuro). */
  shadow(x: number, y: number, w: number, h: number) {
    const map: Record<number, number> = { 23: 24, 22: 23, 24: 25, 5: 23, 6: 24, 29: 28, 30: 29, 28: 27, 15: 26, 19: 18, 20: 19, 21: 20 };
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        const c = this.get(i, j);
        this.set(i, j, c === NONE ? 24 : (map[c] ?? c));
      }
    }
  }
  blit(src: Pix, ox: number, oy: number) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.data[y * src.w + x]!;
        if (c !== NONE) this.set(ox + x, oy + y, c);
      }
    }
  }
}

/* ======================= piezas de arquitectura ======================= */

type Texture = 'plaster' | 'brick' | 'siding' | 'metal' | 'stone';

/** Fachada con textura, canto iluminado a la izquierda y sombra a la derecha. */
function facade(p: Pix, x: number, y: number, w: number, h: number, m: Mat, tex: Texture, seed: number) {
  p.rect(x, y, w, h, m[1]);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const X = x + i;
      const Y = y + j;
      if (tex === 'brick') {
        const row = Math.floor(j / 3);
        if (j % 3 === 2) p.set(X, Y, m[2]);
        else if ((i + (row % 2) * 3) % 6 === 0) p.set(X, Y, m[2]);
        else if (hash(X, Y, seed) > 0.93) p.set(X, Y, m[0]);
        else if (hash(Y, X, seed) > 0.95) p.set(X, Y, m[3]);
      } else if (tex === 'siding') {
        if (j % 3 === 2) p.set(X, Y, m[2]);
        else if (j % 3 === 0 && hash(X, Y, seed) > 0.85) p.set(X, Y, m[0]);
      } else if (tex === 'metal') {
        if (i % 3 === 2) p.set(X, Y, m[2]);
        else if (i % 3 === 0) p.set(X, Y, m[0]);
      } else if (tex === 'stone') {
        const row = Math.floor(j / 4);
        if (j % 4 === 3 || (i + (row % 2) * 4) % 8 === 0) p.set(X, Y, m[2]);
        else if (hash(X, Y, seed) > 0.9) p.set(X, Y, m[0]);
      } else if (hash(X, Y, seed) > 0.9) {
        p.set(X, Y, hash(Y, X) > 0.5 ? m[0] : m[2]);
      }
    }
  }
  p.vline(x, y, h, m[0]);
  p.vline(x + w - 2, y, h, m[2]);
  p.vline(x + w - 1, y, h, m[3]);
  p.hline(x, y + h - 1, w, m[3]);
  // Zócalo.
  p.hline(x, y + h - 3, w, m[2]);
  p.hline(x, y + h - 2, w, m[3]);
}

/** Tejado a dos aguas visto en 3/4: faldón trasero (luz), cumbrera y faldón delantero. */
function gableRoof(p: Pix, x: number, y: number, w: number, back: number, front: number, m: Mat) {
  const total = back + front;
  for (let j = 0; j < total; j++) {
    const isBack = j < back;
    for (let i = 0; i < w; i++) {
      const X = x + i;
      const Y = y + j;
      let c = isBack ? m[0] : m[1];
      const rowLine = isBack ? (back - j) % 3 === 0 : (j - back) % 3 === 2;
      const seam = (i + (Math.floor(j / 3) % 2) * 2) % 4 === 0;
      if (rowLine) c = isBack ? m[1] : m[2];
      else if (seam) c = isBack ? m[1] : m[2];
      if (i === 0 || i === w - 1) c = m[3];
      p.set(X, Y, c);
    }
  }
  p.hline(x, y, w, m[2]);
  p.hline(x + 1, y + back, w - 2, m[0]); // cumbrera
  p.hline(x, y + total - 1, w, m[3]); // alero
}

/** Tejado plano con pretil, grava y detalles. */
function flatRoof(p: Pix, x: number, y: number, w: number, h: number, m: Mat, seed: number) {
  p.rect(x, y, w, h, MAT.stone[2]);
  p.dither(x + 1, y + 1, w - 2, h - 2, MAT.stone[1], seed % 2);
  for (let i = 0; i < w * h * 0.08; i++) p.set(x + 1 + Math.floor(hash(i, seed) * (w - 2)), y + 1 + Math.floor(hash(seed, i) * (h - 2)), MAT.stone[3]);
  p.frame(x, y, w, h, m[1]);
  p.hline(x, y, w, m[0]);
  p.hline(x, y + h - 1, w, m[3]);
}

/** Mientras se dibuja la variante de noche, la mayoría de ventanas están encendidas. */
let nightLights = false;

function windowAt(p: Pix, x: number, y: number, w: number, h: number, opts: { frame?: number; shutters?: Mat; flowers?: boolean; lit?: boolean } = {}) {
  const f = opts.frame ?? 12;
  const lit = opts.lit || (nightLights && hash(x, y, w, 13) > 0.3);
  p.rect(x - 1, y - 1, w + 2, h + 2, f);
  p.rect(x, y, w, h, lit ? (nightLights ? C.lampWarm : 4) : MAT.glass[2]);
  if (lit && nightLights) {
    p.rect(x, y, w, Math.ceil(h / 2), C.lamp);
    p.set(x, y, 12);
  }
  if (!lit) {
    p.rect(x, y, w, Math.ceil(h / 2), MAT.glass[1]);
    p.set(x, y, MAT.glass[0]);
    p.set(x + 1, y, MAT.glass[0]);
    p.set(x, y + 1, MAT.glass[0]);
    if (w > 3) p.set(x + w - 2, y + h - 2, 31);
  }
  if (w >= 5) p.vline(x + Math.floor(w / 2), y, h, f);
  if (h >= 6) p.hline(x, y + Math.floor(h / 2), w, f);
  p.hline(x - 1, y + h + 1, w + 2, MAT.stone[3]); // sombra del alféizar
  p.hline(x - 2, y + h, w + 4, f);
  if (opts.shutters) {
    p.rect(x - 4, y - 1, 2, h + 2, opts.shutters[1]);
    p.rect(x + w + 2, y - 1, 2, h + 2, opts.shutters[2]);
    for (let j = 0; j < h + 2; j += 2) {
      p.set(x - 4, y - 1 + j, opts.shutters[0]);
      p.set(x + w + 3, y - 1 + j, opts.shutters[3]);
    }
  }
  if (opts.flowers) {
    p.rect(x - 1, y + h + 1, w + 2, 2, MAT.wood[2]);
    for (let i = 0; i < w + 2; i++) p.set(x - 1 + i, y + h, i % 2 ? 2 : 6);
  }
}

function doorAt(p: Pix, x: number, y: number, w: number, h: number, m: Mat = MAT.wood, frame = 12) {
  p.rect(x - 1, y - 1, w + 2, h + 1, frame);
  p.rect(x, y, w, h, m[2]);
  p.rect(x + 1, y + 1, w - 2, Math.floor(h / 2) - 1, m[1]);
  p.rect(x + 1, y + Math.floor(h / 2) + 1, w - 2, Math.floor(h / 2) - 2, m[1]);
  p.vline(x + 1, y + 1, h - 2, m[0]);
  p.set(x + w - 2, y + Math.floor(h / 2) + 1, 4);
  p.rect(x - 2, y + h, w + 4, 1, MAT.stone[1]); // escalón
  p.hline(x - 2, y + h + 1, w + 4, MAT.stone[3]);
}

function chimney(p: Pix, x: number, y: number, h: number, smoke: boolean, seed: number) {
  facade(p, x, y, 4, h, MAT.brick, 'brick', seed);
  p.hline(x - 1, y, 6, MAT.stone[2]);
  p.hline(x - 1, y - 1, 6, MAT.stone[1]);
  if (smoke) {
    p.ball(x + 2, y - 4, 2.2, [31, 12, 13, 14], seed);
    p.ball(x + 4, y - 8, 1.8, [31, 12, 13, 13], seed + 1);
  }
}

/** Sombra del edificio sobre la hierba (abajo y a la derecha). */
function castShadow(p: Pix, x: number, y: number, w: number, h: number) {
  p.shadow(x + w, y + 3, 2, h - 2);
  p.shadow(x + 2, y + h, w, 1);
}

function person(p: Pix, x: number, y: number, shirt: number, hat?: number) {
  p.set(x + 1, y, hat ?? C.hairDark);
  p.set(x + 2, y, hat ?? C.hairDark);
  p.rect(x + 1, y + 1, 2, 1, C.skin);
  p.rect(x, y + 2, 4, 3, shirt);
  p.set(x, y + 2, MAT.metal[0]);
  p.rect(x + 1, y + 5, 1, 2, 8);
  p.rect(x + 2, y + 5, 1, 2, 8);
}

function bush(p: Pix, x: number, y: number, r: number, seed: number, flowers = false) {
  p.ball(x, y, r, MAT.leaf, seed);
  if (flowers) for (let i = 0; i < 4; i++) p.set(x - r + 1 + Math.floor(hash(i, seed) * 2 * r), y - 1 + Math.floor(hash(seed, i) * 2), [2, 4, 12][i % 3]!);
}

/* ============================ edificios ============================ */

const WALLS: [Mat, Texture][] = [
  [MAT.cream, 'plaster'],
  [MAT.white, 'plaster'],
  [MAT.brick, 'brick'],
  [MAT.red, 'brick'],
  [MAT.yellow, 'siding'],
  [MAT.blue, 'siding'],
  [MAT.stone, 'stone'],
];
const ROOFS: Mat[] = [MAT.terracotta, MAT.slate, MAT.plum, MAT.moss, MAT.terracotta];
/** 2.1: tejados por rango del pueblo (solo índices de la paleta). La villa (2) es el aspecto de siempre. */
const THATCH: Mat = [45, 46, 47, 36];
const RED_TILE: Mat = [3, 2, 17, 16];
const DARK_SLATE: Mat = [54, 52, 53, 55];
const PATINA: Mat = [63, 7, 25, 26];
const BLUE_SLATE: Mat = [10, 9, 8, 56];
export const VILLA_RANK = 2;
const RANK_ROOFS: Mat[][] = [
  [THATCH, MAT.terracotta, THATCH, MAT.moss, THATCH],
  [MAT.terracotta, THATCH, MAT.moss, MAT.terracotta, MAT.slate],
  ROOFS,
  [MAT.slate, RED_TILE, MAT.plum, MAT.terracotta, DARK_SLATE],
  [DARK_SLATE, RED_TILE, PATINA, BLUE_SLATE, MAT.terracotta],
];
const roofsFor = (rank: number) => RANK_ROOFS[Math.max(0, Math.min(RANK_ROOFS.length - 1, rank))]!;
const SHUTTERS: Mat[] = [MAT.moss, MAT.teal, MAT.red, MAT.blue];

function cottage(seed: number, rank = VILLA_RANK): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 3, 26, 25, 20);
  // Jardín con valla.
  for (let x = 1; x < 31; x += 3) {
    p.vline(x, 41, 5, MAT.wood[1]);
    p.set(x, 41, MAT.wood[0]);
  }
  p.hline(1, 43, 30, MAT.wood[2]);
  facade(p, 4, 26, 24, 18, MAT.cream, 'plaster', seed);
  gableRoof(p, 2, 13, 28, 6, 8, rank === VILLA_RANK ? MAT.terracotta : roofsFor(rank)[seed % 5]!);
  chimney(p, 21, 8, 7, true, seed);
  windowAt(p, 8, 30, 5, 6, { shutters: MAT.moss, flowers: true });
  windowAt(p, 21, 30, 4, 6, { shutters: MAT.moss });
  doorAt(p, 14, 34, 5, 9);
  bush(p, 3, 44, 3, seed, true);
  bush(p, 28, 44, 3, seed + 3, true);
  return p;
}

function apartment(seed: number, rank = VILLA_RANK): Pix {
  const p = new Pix(T, BH);
  const [wall, tex] = WALLS[seed % WALLS.length]!;
  const roofs = roofsFor(rank);
  const roof = roofs[(seed >> 3) % roofs.length]!;
  const floors = 2 + ((seed >> 5) % 2);
  const fh = 10;
  const top = 46 - floors * fh - 2;
  castShadow(p, 2, top, 28, 46 - top);
  facade(p, 2, top, 28, 46 - top, wall, tex, seed);
  const flat = ((seed >> 6) & 1) === 1;
  if (flat) flatRoof(p, 1, top - 7, 30, 8, wall, seed);
  else gableRoof(p, 1, top - 11, 30, 5, 7, roof);
  if (flat && (seed & 4)) {
    p.rect(20, top - 5, 6, 4, MAT.metal[1]);
    p.frame(20, top - 5, 6, 4, MAT.metal[3]);
    p.hline(21, top - 4, 4, MAT.metal[2]);
  }
  const shutters = (seed >> 4) % 3 === 0 ? SHUTTERS[seed % SHUTTERS.length] : undefined;
  const balcony = ((seed >> 7) & 1) === 1;
  for (let f = 0; f < floors; f++) {
    const y = top + 3 + f * fh;
    const ground = f === floors - 1;
    if (ground) {
      windowAt(p, 6, y + 1, 4, 5, { shutters });
      doorAt(p, 14, y, 5, 8);
      windowAt(p, 23, y + 1, 4, 5, { shutters });
    } else {
      for (const wx of [6, 14, 23]) windowAt(p, wx, y, 4, 5, { shutters, flowers: hash(wx, f, seed) > 0.7, lit: hash(f, wx, seed) > 0.92 });
      if (balcony && f === floors - 2) {
        p.hline(12, y + 6, 9, MAT.metal[3]);
        p.hline(12, y + 7, 9, MAT.metal[2]);
        for (let i = 12; i < 21; i += 2) p.vline(i, y + 3, 4, MAT.metal[3]);
        p.hline(12, y + 3, 9, MAT.metal[1]);
      }
    }
  }
  if (!flat && (seed & 2)) chimney(p, 23, top - 15, 6, false, seed);
  bush(p, 3, 45, 2, seed);
  return p;
}

/**
 * 2.5: bloque de la zona R que creció con la densidad: 1 (media) cuatro plantas,
 * 2 (alta) cinco, con azotea, antenas y balcones corridos. Mismo muro que el bloque bajo.
 */
function denseBlock(seed: number, level: number): Pix {
  const p = new Pix(T, BH);
  const [wall, tex] = WALLS[seed % WALLS.length]!;
  const floors = level >= 2 ? 5 : 4;
  const fh = level >= 2 ? 8 : 9;
  const top = 46 - floors * fh - 1;
  castShadow(p, 2, top, 28, 46 - top);
  facade(p, 2, top, 28, 46 - top, wall, tex, seed);
  flatRoof(p, 1, top - 4, 30, 5, wall, seed);
  // Azotea: caseta de la escalera y antenas (la alta, además, el depósito).
  p.rect(4, top - 7, 6, 3, wall[2]);
  p.hline(4, top - 7, 6, wall[0]);
  p.vline(24, top - 9, 5, MAT.metal[3]);
  p.hline(22, top - 8, 5, MAT.metal[2]);
  if (level >= 2) {
    p.rect(14, top - 8, 6, 4, MAT.metal[1]);
    p.frame(14, top - 8, 6, 4, MAT.metal[3]);
  }
  const shutters = (seed >> 4) % 3 === 0 ? SHUTTERS[seed % SHUTTERS.length] : undefined;
  for (let f = 0; f < floors; f++) {
    const y = top + 2 + f * fh;
    if (f === floors - 1) {
      windowAt(p, 6, y + 1, 4, 4, { shutters });
      doorAt(p, 14, y - 1, 5, 46 - y);
      windowAt(p, 23, y + 1, 4, 4, { shutters });
    } else {
      for (const wx of [6, 14, 23]) windowAt(p, wx, y, 4, 4, { shutters, flowers: hash(wx, f, seed) > 0.75, lit: hash(f, wx, seed) > 0.9 });
      // Balcón corrido cada dos plantas.
      if ((f + seed) % 2 === 0) {
        p.hline(4, y + 5, 24, MAT.metal[3]);
        for (let i = 4; i < 28; i += 3) p.set(i, y + 4, MAT.metal[2]);
      }
    }
  }
  bush(p, 3, 45, 2, seed);
  bush(p, 28, 45, 2, seed + 1);
  return p;
}

/** 2.5: vivienda protegida, tres plantas de ladrillo con la placa municipal azul y el escudo. */
function vpoPix(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 2, 14, 28, 32);
  facade(p, 2, 16, 28, 30, MAT.brick, 'brick', seed);
  flatRoof(p, 1, 11, 30, 6, MAT.brick, seed);
  // Franja clara entre plantas (forjados).
  for (const y of [25, 34]) p.hline(2, y, 28, MAT.cream[1]);
  for (const y of [18, 27]) for (const x of [5, 11, 18, 24]) windowAt(p, x, y, 3, 5, { frame: 12, flowers: hash(x, y, seed) > 0.7 });
  windowAt(p, 5, 37, 3, 5, { frame: 12 });
  windowAt(p, 24, 37, 3, 5, { frame: 12 });
  doorAt(p, 13, 36, 6, 10, MAT.glass, MAT.wood[3]);
  // Placa azul con el escudo encima de la puerta.
  p.rect(12, 30, 8, 4, MAT.blue[1]);
  p.frame(12, 30, 8, 4, MAT.blue[3]);
  p.rect(15, 31, 2, 2, MAT.yellow[1]);
  bush(p, 3, 45, 2, seed, true);
  bush(p, 28, 45, 2, seed + 2, true);
  return p;
}

function shop(seed: number): Pix {
  const p = new Pix(T, BH);
  const [wall, tex] = WALLS[seed % 4]!;
  const awn = [MAT.red, MAT.blue, MAT.moss, MAT.yellow][(seed >> 2) % 4]!;
  castShadow(p, 2, 14, 28, 32);
  facade(p, 2, 14, 28, 32, wall, tex, seed);
  flatRoof(p, 1, 8, 30, 7, wall, seed);
  windowAt(p, 6, 18, 4, 5);
  windowAt(p, 14, 18, 4, 5);
  windowAt(p, 22, 18, 4, 5);
  // Rótulo.
  p.rect(5, 26, 22, 4, MAT.wood[3]);
  p.rect(6, 27, 20, 2, MAT.wood[1]);
  for (let i = 0; i < 7; i++) p.rect(8 + i * 2 + (i > 3 ? 2 : 0), 27, 1, 2, 12);
  // Toldo a rayas con festón.
  for (let x = 2; x < 30; x++) {
    const stripe = Math.floor((x - 2) / 3) % 2 === 0;
    p.vline(x, 31, 3, stripe ? awn[1] : 12);
    p.set(x, 30, stripe ? awn[0] : 31);
    if ((x - 2) % 3 !== 1) p.set(x, 34, stripe ? awn[2] : 13);
  }
  // Escaparate y puerta acristalada.
  p.rect(4, 35, 15, 9, MAT.wood[3]);
  p.rect(5, 36, 13, 7, MAT.glass[2]);
  p.rect(5, 36, 13, 3, MAT.glass[1]);
  p.set(6, 37, 31);
  p.set(7, 36, 31);
  for (let i = 0; i < 4; i++) p.rect(6 + i * 3, 40, 2, 3, [2, 4, 6, 3][(i + seed) % 4]!);
  doorAt(p, 22, 35, 5, 9, MAT.glass, MAT.wood[3]);
  p.rect(28, 41, 2, 3, MAT.wood[2]);
  bush(p, 29, 40, 2, seed, true);
  return p;
}

function factory(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 18, 30, 28);
  facade(p, 1, 22, 30, 24, MAT.metal, 'metal', seed);
  // Tejado en diente de sierra con lucernarios.
  for (let k = 0; k < 4; k++) {
    const x0 = 1 + k * 7;
    for (let j = 0; j < 7; j++) {
      p.hline(x0 + j, 15 + j, 7 - j, MAT.slate[1]);
      p.set(x0 + j, 15 + j, MAT.slate[0]);
      p.vline(x0 + 6, 15 + j, 1, MAT.glass[1]);
    }
    p.vline(x0 + 6, 15, 7, MAT.glass[j0(k)]);
    p.hline(x0, 21, 7, MAT.slate[3]);
  }
  // Chimenea alta con franjas.
  for (let y = 2; y < 22; y++) p.hline(25, y, 4, Math.floor(y / 3) % 2 ? MAT.red[1] : 12);
  p.vline(28, 2, 20, MAT.red[3]);
  p.ball(27, 1, 2.4, [31, 12, 13, 14], seed);
  // Portón y ventanas.
  p.rect(16, 32, 11, 13, MAT.metal[3]);
  for (let y = 33; y < 45; y += 2) p.hline(17, y, 9, MAT.metal[2]);
  p.hline(16, 31, 11, 4);
  windowAt(p, 4, 27, 3, 3);
  windowAt(p, 10, 27, 3, 3);
  doorAt(p, 6, 36, 4, 8, MAT.teal, MAT.metal[2]);
  // Barriles.
  p.ball(29, 43, 1.8, MAT.blue, seed);
  p.ball(13, 44, 1.8, MAT.red, seed + 1);
  return p;
}
const j0 = (k: number) => (k % 2 ? 0 : 1);

function townhall(): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 22, 30, 24);
  facade(p, 1, 22, 30, 24, MAT.stone, 'stone', 7);
  gableRoof(p, 0, 13, 32, 4, 6, MAT.terracotta);
  // Torre del reloj.
  facade(p, 11, 5, 10, 13, MAT.cream, 'plaster', 3);
  gableRoof(p, 10, 0, 12, 2, 4, MAT.terracotta);
  p.ball(16, 10, 3, [31, 12, 13, 14], 1);
  p.set(16, 9, 0);
  p.set(16, 8, 0);
  p.set(17, 10, 0);
  // Balcón con banderas.
  p.hline(9, 31, 14, MAT.metal[3]);
  for (let i = 9; i < 23; i += 2) p.vline(i, 28, 3, MAT.metal[3]);
  p.hline(9, 28, 14, MAT.metal[1]);
  p.vline(12, 23, 6, MAT.metal[2]);
  p.rect(13, 23, 4, 1, 2);
  p.rect(13, 24, 4, 1, 4);
  p.rect(13, 25, 4, 1, 2);
  p.vline(20, 23, 6, MAT.metal[2]);
  p.rect(21, 23, 4, 3, 9);
  p.set(22, 24, 4);
  // Columnas y puerta.
  for (const x of [4, 9, 22, 27]) {
    p.rect(x, 33, 2, 11, MAT.stone[0]);
    p.vline(x + 1, 33, 11, MAT.stone[2]);
  }
  windowAt(p, 4, 25, 3, 5);
  windowAt(p, 25, 25, 3, 5);
  doorAt(p, 13, 34, 6, 10, MAT.wood, MAT.stone[0]);
  p.rect(10, 45, 12, 1, MAT.stone[1]);
  return p;
}

/* ---------------- ayuntamiento por niveles (v1.8) ---------------- */

/** Mástil con la bandera rojigualda (motivo común a todos los niveles). */
function thFlag(p: Pix, x: number, top: number, base: number, left = false) {
  p.vline(x, top, base - top, MAT.metal[2]);
  p.set(x, top - 1, MAT.yellow[1]);
  const fx = left ? x - 5 : x + 1;
  p.rect(fx, top, 5, 2, MAT.red[1]);
  p.rect(fx, top + 2, 5, 2, MAT.yellow[1]);
  p.rect(fx, top + 4, 5, 1, MAT.red[1]);
  p.set(left ? fx : fx + 4, top + 4, MAT.red[2]);
  p.set(left ? fx : fx + 4, top + 2, MAT.yellow[2]);
}

/** Escudo municipal pequeño sobre la puerta. */
function thShield(p: Pix, x: number, y: number) {
  p.rect(x, y, 3, 3, MAT.red[1]);
  p.set(x + 1, y + 1, MAT.yellow[0]);
  p.set(x + 1, y + 3, MAT.red[2]);
  p.set(x + 2, y, MAT.red[2]);
}

/** Reloj de esfera blanca con agujas. */
function thClock(p: Pix, x: number, y: number, r: number) {
  p.ball(x, y, r, [31, 12, 13, 14], 1);
  p.set(x, y - 1, 0);
  p.set(x, y, 0);
  p.set(x + 1, y, 0);
}

/** Balcón de forja con dos banderas colgadas. */
function thBalcony(p: Pix, x: number, y: number, w: number) {
  p.hline(x, y + 3, w, MAT.metal[3]);
  for (let i = x; i < x + w; i += 2) p.vline(i, y, 3, MAT.metal[3]);
  p.hline(x, y, w, MAT.metal[1]);
  p.rect(x + 2, y - 5, 3, 5, MAT.red[1]);
  p.rect(x + 2, y - 4, 3, 2, MAT.yellow[1]);
  p.rect(x + w - 5, y - 5, 3, 5, MAT.blue[1]);
  p.set(x + w - 4, y - 3, MAT.yellow[1]);
}

/** Nivel 1: casa consistorial pequeña, una planta y bandera en el caballete. */
function townhall1(): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 5, 28, 22, 18);
  facade(p, 6, 30, 20, 16, MAT.stone, 'stone', 7);
  gableRoof(p, 4, 20, 24, 4, 6, MAT.terracotta);
  thFlag(p, 16, 9, 24);
  windowAt(p, 9, 34, 3, 5, { shutters: MAT.moss });
  windowAt(p, 21, 34, 3, 5, { shutters: MAT.moss });
  thShield(p, 15, 31);
  doorAt(p, 14, 36, 5, 9, MAT.wood, MAT.stone[0]);
  bush(p, 4, 45, 2, 7, true);
  bush(p, 28, 45, 2, 9, true);
  return p;
}

/** Nivel 2: algo mayor, con espadaña y reloj. */
function townhall2(): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 3, 26, 26, 20);
  facade(p, 4, 28, 24, 18, MAT.stone, 'stone', 7);
  gableRoof(p, 2, 18, 28, 4, 6, MAT.terracotta);
  // Espadaña encalada con el reloj.
  facade(p, 12, 12, 8, 11, MAT.cream, 'plaster', 3);
  p.hline(11, 11, 10, MAT.terracotta[1]);
  p.hline(12, 10, 8, MAT.terracotta[0]);
  p.hline(14, 9, 4, MAT.terracotta[1]);
  thClock(p, 16, 16, 2.6);
  thFlag(p, 26, 6, 21);
  windowAt(p, 7, 31, 3, 5, { shutters: MAT.moss });
  windowAt(p, 22, 31, 3, 5, { shutters: MAT.moss });
  windowAt(p, 7, 39, 3, 4);
  windowAt(p, 22, 39, 3, 4);
  thShield(p, 15, 30);
  doorAt(p, 14, 35, 5, 10, MAT.wood, MAT.stone[0]);
  p.rect(12, 45, 9, 1, MAT.stone[1]);
  return p;
}

/** Nivel 3: más ancho, balcón con banderas y reloj en el frontón. */
function townhall3(): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 24, 30, 22);
  facade(p, 1, 24, 30, 22, MAT.stone, 'stone', 7);
  gableRoof(p, 0, 14, 32, 4, 6, MAT.terracotta);
  // Frontón de piedra con el reloj.
  for (let y = 12; y < 24; y++) {
    const half = (y - 11) * 0.9;
    for (let x = Math.ceil(16 - half); x < 16 + half; x++) p.set(x, y, x < 13 ? MAT.cream[0] : x > 19 ? MAT.cream[2] : MAT.cream[1]);
    p.set(Math.ceil(16 - half), y, 12);
  }
  thClock(p, 16, 19, 2.6);
  thFlag(p, 29, 4, 18, true);
  thBalcony(p, 9, 31, 14);
  windowAt(p, 12, 27, 3, 3);
  windowAt(p, 17, 27, 3, 3);
  windowAt(p, 4, 27, 3, 5);
  windowAt(p, 25, 27, 3, 5);
  windowAt(p, 4, 37, 3, 5);
  windowAt(p, 25, 37, 3, 5);
  doorAt(p, 13, 36, 6, 9, MAT.wood, MAT.stone[0]);
  p.rect(10, 45, 12, 1, MAT.stone[1]);
  return p;
}

/** Nivel 5: palacio municipal con cúpula, pórtico y escalinata. */
function townhall5(): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 0, 18, 32, 27);
  facade(p, 0, 22, 32, 23, MAT.stone, 'stone', 7);
  flatRoof(p, 0, 17, 32, 6, MAT.stone, 7);
  // Balaustrada.
  for (let x = 1; x < 31; x += 2) p.vline(x, 15, 2, MAT.stone[0]);
  p.hline(0, 14, 32, MAT.stone[0]);
  // Tambor y cúpula de pizarra con linterna dorada.
  facade(p, 10, 9, 12, 8, MAT.cream, 'plaster', 3);
  for (const x of [12, 19]) windowAt(p, x, 11, 1, 3, { frame: MAT.cream[2] });
  thClock(p, 16, 12, 2.4);
  for (let y = 2; y < 9; y++) {
    const half = Math.sqrt(Math.max(0, 1 - ((9 - y) / 7.5) ** 2)) * 7;
    for (let x = Math.round(16 - half); x < Math.round(16 + half); x++) {
      const u = (x - (16 - half)) / (2 * half);
      p.set(x, y, u < 0.3 ? MAT.slate[0] : u < 0.65 ? MAT.slate[1] : u < 0.85 ? MAT.slate[2] : MAT.slate[3]);
    }
  }
  for (const x of [12, 16, 20]) p.vline(x, 3, 6, MAT.slate[2]);
  p.hline(9, 8, 14, MAT.stone[0]);
  p.rect(15, 0, 3, 3, MAT.yellow[1]);
  p.set(15, 0, MAT.yellow[0]);
  p.set(17, 2, MAT.yellow[2]);
  // Banderas en las esquinas.
  thFlag(p, 2, 3, 15);
  thFlag(p, 29, 3, 15, true);
  // Planta noble: ventanales con balcones; pórtico central con frontón.
  for (const x of [3, 8, 22, 26]) {
    windowAt(p, x, 25, 3, 5);
    p.hline(x - 1, 31, 5, MAT.metal[3]);
  }
  for (const x of [3, 8, 22, 26]) windowAt(p, x, 36, 3, 5);
  for (let y = 19; y < 25; y++) {
    const half = (y - 18) * 1.2 + 1;
    for (let x = Math.ceil(16 - half); x < 16 + half; x++) p.set(x, y, MAT.cream[1]);
    p.set(Math.ceil(16 - half), y, 12);
  }
  thShield(p, 15, 21);
  p.hline(9, 25, 14, MAT.stone[0]);
  for (const x of [10, 13, 18, 21]) {
    p.rect(x, 26, 2, 18, MAT.stone[0]);
    p.vline(x + 1, 26, 18, MAT.stone[2]);
  }
  doorAt(p, 14, 34, 4, 10, MAT.wood, MAT.stone[0]);
  // Escalinata.
  p.rect(8, 44, 16, 1, MAT.stone[0]);
  p.rect(6, 45, 20, 1, MAT.stone[1]);
  p.hline(5, 46, 22, MAT.stone[0]);
  p.hline(5, 47, 22, MAT.stone[3]);
  return p;
}

function waterTower(seed: number): Pix {
  const p = new Pix(T, BH);
  p.shadow(10, 44, 18, 2);
  // Patas con arriostramiento.
  for (const x of [8, 23]) p.rect(x, 22, 2, 23, MAT.metal[2]);
  for (const x of [13, 18]) p.rect(x, 24, 1, 21, MAT.metal[3]);
  for (let i = 0; i < 14; i++) {
    p.set(9 + i, 26 + i, MAT.metal[3]);
    p.set(22 - i, 26 + i, MAT.metal[3]);
  }
  p.hline(8, 33, 17, MAT.metal[2]);
  // Depósito cilíndrico.
  for (let x = 5; x < 27; x++) {
    const t = (x - 5) / 21;
    const c = t < 0.15 ? MAT.blue[0] : t < 0.55 ? MAT.blue[1] : t < 0.85 ? MAT.blue[2] : MAT.blue[3];
    p.vline(x, 8, 15, c);
  }
  p.hline(5, 12, 22, MAT.blue[3]);
  p.hline(5, 18, 22, MAT.blue[3]);
  p.ellipse(16, 23, 11, 2, MAT.blue[3]);
  p.ellipse(16, 22, 10.5, 1.5, MAT.blue[2]);
  // Techo cónico.
  for (let j = 0; j < 7; j++) {
    const half = 3 + j * 1.6;
    for (let x = Math.round(16 - half); x <= Math.round(16 + half); x++) p.set(x, 2 + j, x < 16 ? MAT.slate[0] : MAT.slate[2]);
  }
  p.set(16, 1, MAT.slate[3]);
  // Escalera y gota.
  for (let y = 9; y < 44; y += 2) p.hline(24, y, 2, MAT.metal[1]);
  p.vline(24, 9, 35, MAT.metal[3]);
  p.ball(13, 15, 2.5, [31, 11, 10, 9], seed);
  // Caseta de bombeo.
  facade(p, 1, 36, 8, 10, MAT.cream, 'plaster', seed);
  p.hline(0, 35, 10, MAT.slate[2]);
  doorAt(p, 3, 39, 3, 6, MAT.teal);
  return p;
}

function powerPlant(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 26, 18, 20);
  // Torre de refrigeración (hiperboloide).
  for (let y = 8; y < 46; y++) {
    const t = (y - 8) / 38;
    const half = 6 + Math.abs(t - 0.62) * 10 * (t < 0.62 ? 0.6 : 1.4);
    const x0 = Math.round(24 - half);
    const x1 = Math.round(24 + half);
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / (x1 - x0 || 1);
      let c = u < 0.2 ? MAT.stone[0] : u < 0.6 ? MAT.stone[1] : u < 0.85 ? MAT.stone[2] : MAT.stone[3];
      if (y % 5 === 0 && u > 0.1) c = MAT.stone[2];
      p.set(x, y, c);
    }
  }
  p.ellipse(24, 8, 6, 1.5, MAT.stone[3]);
  p.ball(22, 4, 3.2, [31, 12, 13, 14], seed);
  p.ball(27, 2, 2.6, [31, 12, 13, 13], seed + 1);
  // Nave de turbinas.
  facade(p, 1, 28, 17, 18, MAT.metal, 'metal', seed);
  flatRoof(p, 0, 23, 19, 6, MAT.metal, seed);
  windowAt(p, 4, 32, 3, 3, { lit: true });
  windowAt(p, 11, 32, 3, 3, { lit: true });
  doorAt(p, 7, 38, 4, 7, MAT.yellow, MAT.metal[2]);
  // Rayo pintado.
  const bolt = [
    [14, 38], [13, 39], [12, 40], [13, 40], [14, 40], [13, 41], [12, 42],
  ];
  for (const [x, y] of bolt) p.set(x!, y!, 4);
  return p;
}

function school(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 18, 30, 28);
  facade(p, 1, 20, 30, 26, MAT.red, 'brick', seed);
  gableRoof(p, 0, 10, 32, 4, 7, MAT.slate);
  for (let f = 0; f < 2; f++) for (const x of [4, 10, 21, 26]) windowAt(p, x, 24 + f * 9, 3, 5, { frame: 12 });
  doorAt(p, 14, 35, 5, 10, MAT.wood);
  // Reloj y rótulo.
  p.ball(16, 26, 3, [31, 12, 13, 14], seed);
  p.set(16, 25, 0);
  p.set(17, 26, 0);
  p.rect(12, 31, 9, 3, 12);
  for (let i = 0; i < 4; i++) p.set(13 + i * 2, 32, 9);
  // Mástil.
  p.vline(30, 2, 18, MAT.metal[2]);
  p.rect(24, 2, 6, 4, 4);
  p.hline(24, 3, 6, 2);
  return p;
}

function clinic(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 2, 16, 28, 30);
  facade(p, 2, 18, 28, 28, MAT.white, 'plaster', seed);
  flatRoof(p, 1, 11, 30, 8, MAT.white, seed);
  // Cruz.
  p.rect(13, 3, 6, 14, 12);
  p.rect(10, 6, 12, 6, 12);
  p.rect(14, 4, 4, 12, MAT.red[1]);
  p.rect(11, 7, 10, 4, MAT.red[1]);
  p.vline(17, 4, 12, MAT.red[2]);
  for (const x of [5, 11, 20, 25]) windowAt(p, x, 22, 3, 4, { frame: 13 });
  p.hline(2, 30, 28, MAT.red[1]);
  p.hline(2, 31, 28, MAT.red[2]);
  doorAt(p, 12, 36, 8, 9, MAT.glass, MAT.metal[2]);
  windowAt(p, 5, 36, 3, 5, { frame: 13 });
  windowAt(p, 25, 36, 3, 5, { frame: 13 });
  return p;
}

function policeStation(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 2, 16, 28, 30);
  facade(p, 2, 18, 28, 28, MAT.white, 'plaster', seed);
  flatRoof(p, 1, 12, 30, 7, MAT.blue, seed);
  // Franja azul y rótulo.
  p.rect(2, 26, 28, 4, MAT.blue[1]);
  p.hline(2, 26, 28, MAT.blue[0]);
  p.hline(2, 29, 28, MAT.blue[2]);
  for (let i = 0; i < 7; i++) p.rect(7 + i * 3, 27, 2, 2, 12);
  // Sirena en el tejado.
  p.rect(14, 8, 4, 4, MAT.metal[2]);
  p.rect(14, 8, 2, 2, MAT.red[1]);
  p.rect(16, 8, 2, 2, MAT.blue[1]);
  p.set(14, 8, 3);
  p.set(17, 8, 11);
  windowAt(p, 5, 20, 4, 4, { frame: 13 });
  windowAt(p, 23, 20, 4, 4, { frame: 13 });
  doorAt(p, 13, 35, 6, 10, MAT.blue, 12);
  windowAt(p, 5, 35, 4, 5, { frame: 13 });
  windowAt(p, 23, 35, 4, 5, { frame: 13 });
  // Coche patrulla.
  p.rect(24, 43, 7, 3, 12);
  p.rect(25, 42, 4, 1, MAT.blue[1]);
  p.set(24, 46, 0);
  p.set(30, 46, 0);
  return p;
}

function plaza(seed: number): Pix {
  const p = new Pix(T, BH);
  // Adoquinado.
  p.rect(0, 16, 32, 32, MAT.stone[1]);
  for (let y = 16; y < 48; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 32; x += 4) p.rect(x, y, 3, 3, MAT.stone[0]);
  p.frame(0, 16, 32, 32, MAT.stone[3]);
  // Fuente central de piedra.
  p.ellipse(16, 33, 9, 6, MAT.stone[3]);
  p.ellipse(16, 32.5, 8, 5, MAT.stone[0]);
  p.ellipse(16, 33, 6.5, 3.8, MAT.blue[1]);
  p.ellipse(15, 32, 3, 1.5, MAT.blue[0]);
  p.rect(15, 24, 3, 9, MAT.stone[1]);
  p.vline(15, 24, 9, MAT.stone[0]);
  p.ellipse(16, 23, 4, 1.6, MAT.stone[0]);
  for (const [x, y] of [[14, 20], [18, 20], [16, 18], [12, 22], [20, 22]] as const) p.set(x, y, 11);
  p.set(16, 21, 31);
  // Farolas y bancos.
  for (const x of [3, 28]) {
    p.vline(x, 18, 12, MAT.metal[3]);
    p.rect(x - 1, 16, 3, 3, MAT.yellow[0]);
    p.set(x, 17, 12);
  }
  p.rect(3, 43, 7, 2, MAT.wood[1]);
  p.hline(3, 42, 7, MAT.wood[2]);
  p.rect(22, 43, 7, 2, MAT.wood[1]);
  p.hline(22, 42, 7, MAT.wood[2]);
  bush(p, 4, 37, 2.5, seed, true);
  bush(p, 28, 37, 2.5, seed + 2, true);
  // Bandera en el mástil.
  p.vline(30, 2, 16, MAT.metal[2]);
  p.rect(24, 2, 6, 2, MAT.red[1]);
  p.rect(24, 4, 6, 2, MAT.yellow[0]);
  p.rect(24, 6, 6, 2, MAT.red[1]);
  return p;
}

function market(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 14, 30, 32);
  facade(p, 1, 20, 30, 26, MAT.cream, 'brick', seed);
  // Tejado de hierro y cristal en arco.
  for (let j = 0; j < 9; j++) {
    const inset = Math.round(Math.sqrt(Math.max(0, 81 - (9 - j) * (9 - j))) / 2);
    p.hline(0 + (4 - inset), 11 + j, 32 - 2 * (4 - inset), j % 3 === 0 ? MAT.metal[2] : MAT.glass[1]);
  }
  p.hline(0, 19, 32, MAT.metal[3]);
  for (let x = 2; x < 32; x += 5) p.vline(x, 11, 9, MAT.metal[2]);
  p.rect(10, 7, 12, 5, MAT.wood[3]);
  p.rect(11, 8, 10, 3, MAT.yellow[0]);
  for (let i = 0; i < 4; i++) p.rect(12 + i * 2, 9, 1, 1, MAT.wood[3]);
  // Puestos con toldos de colores.
  const awn = [MAT.red, MAT.moss, MAT.blue, MAT.yellow];
  for (let k = 0; k < 4; k++) {
    const x = 2 + k * 7;
    for (let i = 0; i < 6; i++) p.vline(x + i, 30, 2, i % 2 ? 12 : awn[k]![1]);
    p.hline(x, 32, 6, awn[k]![2]);
    p.rect(x, 33, 6, 4, MAT.wood[1]);
    for (let i = 0; i < 3; i++) p.set(x + 1 + i * 2, 33, [2, 4, 6, 3][(k + i) % 4]!);
  }
  doorAt(p, 13, 38, 6, 8, MAT.wood);
  return p;
}

function park(seed: number): Pix {
  const p = new Pix(T, BH);
  // Césped cuidado.
  p.rect(0, 16, 32, 32, 5);
  p.dither(0, 16, 32, 32, 23, 0);
  for (let i = 0; i < 40; i++) p.set(Math.floor(hash(i, seed) * 32), 16 + Math.floor(hash(seed, i) * 32), 22);
  // Caminos de grava.
  p.rect(13, 16, 6, 32, MAT.stone[1]);
  p.rect(0, 29, 32, 6, MAT.stone[1]);
  p.dither(13, 16, 6, 32, MAT.stone[0], 1);
  p.dither(0, 29, 32, 6, MAT.stone[0], 1);
  p.vline(13, 16, 32, MAT.stone[2]);
  p.hline(0, 34, 32, MAT.stone[2]);
  // Fuente.
  p.ellipse(16, 32, 6, 4, MAT.stone[3]);
  p.ellipse(16, 31.5, 5, 3, MAT.stone[0]);
  p.ellipse(16, 32, 4, 2.4, MAT.blue[1]);
  p.set(15, 31, MAT.blue[0]);
  p.set(17, 32, 31);
  p.vline(16, 27, 4, 11);
  p.set(15, 27, 31);
  p.set(17, 27, 31);
  // Árboles, bancos y flores.
  tree(p, 6, 20, seed, 'round');
  tree(p, 26, 39, seed + 5, 'round');
  p.rect(22, 22, 6, 2, MAT.wood[1]);
  p.hline(22, 21, 6, MAT.wood[2]);
  p.vline(22, 24, 2, MAT.wood[3]);
  p.vline(27, 24, 2, MAT.wood[3]);
  for (let i = 0; i < 10; i++) p.set(2 + Math.floor(hash(i, seed, 2) * 9), 38 + Math.floor(hash(seed, i, 3) * 8), [2, 4, 12, 3][i % 4]!);
  return p;
}

/* ===================== lugares de vida social (v1.7) ===================== */

/** Letras de 3×5 para rótulos pequeños. */
const MINI: Record<string, string[]> = {
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
};
function miniText(p: Pix, x: number, y: number, text: string, c: number) {
  [...text].forEach((ch, k) => MINI[ch]?.forEach((r, j) => [...r].forEach((b, i) => b === '#' && p.set(x + k * 4 + i, y + j, c))));
}

/** Ciprés: huso alto y estrecho, luz a la izquierda. */
function cypress(p: Pix, x: number, top: number, base: number, seed: number) {
  const m: Mat = [42, 24, 43, 44];
  p.ellipse(x + 2, base + 1, 3.5, 1.2, 24);
  p.vline(x, base - 2, 3, MAT.wood[2]);
  const h = base - 2 - top;
  for (let j = 0; j <= h; j++) {
    const t = j / h;
    const half = t < 0.2 ? 0.4 + t * 9 : t < 0.75 ? 2.2 + (t - 0.2) * 1.2 : 2.9 - (t - 0.75) * 4;
    const r = Math.round(half);
    for (let i = -r; i <= r; i++) {
      const n = hash(x + i, top + j, seed);
      let c = i < -r / 3 ? m[0] : i <= r / 3 ? m[1] : m[2];
      if (n > 0.8) c = c === m[0] ? m[1] : m[2];
      if (i === r || (j % 3 === 2 && n > 0.5 && i > -r)) c = m[3];
      p.set(x + i, top + j, c);
    }
  }
  p.set(x, top - 1, m[1]);
}

/** Mesa redonda de terraza con dos sillas. */
function terraceTable(p: Pix, x: number, y: number, chair: Mat) {
  // Sillas a los lados (respaldo detrás).
  for (const dx of [-3, 3]) {
    p.vline(x + dx + (dx < 0 ? 0 : 1), y - 2, 4, chair[2]);
    p.set(x + dx + (dx < 0 ? 1 : 0), y + 1, chair[1]);
    p.set(x + dx + (dx < 0 ? 0 : 1), y + 2, chair[3]);
    p.set(x + dx + (dx < 0 ? 1 : 0), y + 2, chair[3]);
  }
  p.shadow(x - 1, y + 3, 4, 1);
  p.vline(x + 1, y + 1, 2, MAT.metal[3]);
  p.hline(x - 1, y, 5, MAT.metal[1]);
  p.hline(x - 1, y - 1, 5, 12);
  p.set(x - 1, y - 1, 31);
  p.set(x + 3, y, MAT.metal[2]);
}

function bar(seed: number): Pix {
  const p = new Pix(T, BH);
  // Suelo de la terraza: baldosas de barro.
  for (let y = 37; y < 47; y++) for (let x = 0; x < 32; x++) p.set(x, y, (Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? MAT.terracotta[1] : MAT.terracotta[0]);
  for (let x = 0; x < 32; x++) if (hash(x, seed, 4) > 0.8) p.set(x, 37 + Math.floor(hash(seed, x) * 10), MAT.terracotta[2]);
  p.hline(0, 46, 32, MAT.terracotta[3]);
  p.hline(0, 47, 32, MAT.terracotta[2]);
  castShadow(p, 2, 16, 28, 21);
  facade(p, 2, 18, 28, 20, MAT.white, 'plaster', seed);
  // Zócalo de color, como en los bares de pueblo.
  p.rect(2, 34, 28, 3, MAT.moss[2]);
  p.hline(2, 34, 28, MAT.moss[1]);
  gableRoof(p, 1, 7, 30, 4, 7, MAT.terracotta);
  chimney(p, 6, 3, 6, false, seed);
  // Rótulo «BAR» con bombilla.
  p.rect(9, 19, 15, 8, MAT.wood[3]);
  p.rect(10, 20, 13, 6, MAT.red[2]);
  p.hline(10, 20, 13, MAT.red[1]);
  miniText(p, 11, 21, 'BAR', nightLights ? C.lamp : 12);
  p.set(16, 18, nightLights ? C.lamp : 4);
  windowAt(p, 4, 20, 3, 4, { shutters: undefined });
  windowAt(p, 26, 20, 3, 4);
  // Toldo verde y blanco que cubre la terraza.
  for (let x = 1; x < 31; x++) {
    const stripe = Math.floor((x - 1) / 3) % 2 === 0;
    p.set(x, 27, stripe ? MAT.moss[0] : 31);
    p.vline(x, 28, 3, stripe ? MAT.moss[1] : 12);
    p.set(x, 31, stripe ? MAT.moss[2] : 13);
    if ((x - 1) % 3 === 1) p.set(x, 32, stripe ? MAT.moss[2] : 13);
  }
  p.hline(1, 27, 30, MAT.moss[0]);
  p.vline(1, 32, 12, MAT.metal[2]);
  p.vline(30, 32, 12, MAT.metal[3]);
  // Guirnalda de bombillas bajo el toldo.
  for (let x = 3; x < 30; x += 3) p.set(x, 33 + ((x / 3) % 2), nightLights ? C.lamp : 30);
  // Puerta y ventana de la barra.
  doorAt(p, 13, 31, 6, 6, MAT.wood, MAT.wood[3]);
  p.rect(14, 32, 4, 2, nightLights ? C.lampWarm : MAT.glass[1]);
  p.set(14, 32, nightLights ? C.lamp : MAT.glass[0]);
  p.rect(4, 32, 7, 4, MAT.wood[3]);
  p.rect(5, 32, 5, 3, nightLights ? C.lampWarm : MAT.glass[2]);
  if (!nightLights) p.hline(5, 32, 5, MAT.glass[1]);
  for (let i = 0; i < 3; i++) p.vline(6 + i * 1 + i, 33, 2, [6, 2, 4][i]!);
  p.rect(22, 32, 7, 4, MAT.wood[3]);
  p.rect(23, 32, 5, 3, nightLights ? C.lamp : MAT.glass[2]);
  if (!nightLights) p.hline(23, 32, 5, MAT.glass[1]);
  // Mesas, sillas y un parroquiano.
  terraceTable(p, 7, 41, MAT.wood);
  terraceTable(p, 22, 41, MAT.wood);
  p.set(19, 37, C.hairDark);
  p.set(20, 37, C.hairDark);
  p.rect(19, 38, 2, 1, C.skin);
  p.rect(18, 39, 3, 2, MAT.blue[1]);
  p.set(18, 39, MAT.blue[0]);
  p.set(23, 39, 4); // caña
  p.set(23, 38, 12);
  p.set(6, 39, 2); // vino
  // Macetas en las esquinas.
  p.rect(13, 44, 2, 2, MAT.terracotta[2]);
  bush(p, 14, 43, 1.6, seed, true);
  return p;
}

function chapel(seed: number): Pix {
  const p = new Pix(T, BH);
  const wm = MAT.white;
  castShadow(p, 7, 18, 19, 27);
  // Faldones del tejado que se alejan hacia el fondo desde el hastial.
  const D = 7;
  const edge = (x: number) => 15 + Math.abs(x + 0.5 - 16) * 0.9;
  for (let x = 6; x < 26; x++) {
    const e = Math.round(edge(x));
    for (let k = 1; k <= D; k++) {
      const left = x < 16;
      const row = (k + (x % 2)) % 3 === 0;
      let c = left ? (row ? MAT.terracotta[1] : MAT.terracotta[0]) : row ? MAT.terracotta[3] : MAT.terracotta[2];
      if (k === D) c = MAT.terracotta[3];
      if (k === 1) c = left ? MAT.terracotta[1] : MAT.terracotta[3];
      p.set(x, e - k, c);
    }
  }
  p.vline(16, Math.round(edge(16)) - D, D, MAT.terracotta[0]); // cumbrera
  p.vline(15, Math.round(edge(15)) - D, D, MAT.terracotta[1]);
  // Muro de la fachada con hastial triangular.
  facade(p, 7, 24, 18, 21, wm, 'plaster', seed);
  for (let y = 15; y < 24; y++) {
    const half = (y - 15) / 0.9;
    for (let x = Math.ceil(16 - half); x < 16 + half; x++) p.set(x, y, x < 9 ? wm[0] : x > 22 ? wm[2] : wm[1]);
  }
  for (let x = 7; x < 25; x++) {
    const y = Math.round(edge(x));
    p.set(x, y, 12);
    p.set(x, y + 1, wm[0]);
  }
  // Zócalo de almagra.
  p.rect(7, 41, 18, 3, MAT.terracotta[1]);
  p.hline(7, 41, 18, MAT.terracotta[0]);
  p.hline(7, 44, 18, MAT.terracotta[3]);
  // Espadaña con campana y cruz.
  p.rect(13, 6, 7, 10, wm[1]);
  p.vline(13, 6, 10, wm[0]);
  p.vline(19, 6, 10, wm[2]);
  p.hline(13, 5, 7, wm[0]);
  p.hline(14, 4, 5, wm[1]);
  p.rect(15, 8, 3, 5, MAT.stone[3]);
  p.hline(16, 7, 1, MAT.stone[3]);
  p.rect(15, 10, 3, 2, MAT.yellow[1]);
  p.set(16, 9, MAT.yellow[1]);
  p.set(15, 10, MAT.yellow[0]);
  p.set(17, 11, MAT.yellow[2]);
  p.set(16, 12, MAT.yellow[3]);
  p.vline(16, 0, 4, MAT.metal[3]);
  p.hline(15, 1, 3, MAT.metal[3]);
  // Óculo y puerta de arco de medio punto.
  p.ellipse(16, 21, 1.6, 1.6, MAT.stone[2]);
  p.set(16, 21, nightLights ? C.lamp : MAT.glass[1]);
  p.set(15, 20, MAT.stone[3]);
  p.rect(13, 33, 6, 11, MAT.stone[0]);
  p.rect(14, 34, 4, 10, MAT.wood[2]);
  p.hline(15, 33, 2, MAT.wood[2]);
  p.rect(14, 32, 4, 1, MAT.stone[0]);
  p.hline(15, 31, 2, MAT.stone[0]);
  p.vline(16, 35, 9, MAT.wood[3]);
  p.vline(14, 35, 9, MAT.wood[1]);
  p.set(15, 39, 4);
  p.set(17, 39, 4);
  if (nightLights) p.rect(15, 34, 1, 1, C.lampWarm);
  windowAt(p, 9, 30, 2, 4, { frame: wm[2] });
  windowAt(p, 21, 30, 2, 4, { frame: wm[2] });
  // Escalones, ciprés y banco.
  p.rect(11, 44, 10, 1, MAT.stone[0]);
  p.rect(10, 45, 12, 1, MAT.stone[1]);
  p.hline(10, 46, 12, MAT.stone[3]);
  cypress(p, 28, 14, 43, seed);
  bush(p, 3, 43, 2.5, seed + 1, true);
  p.rect(1, 37, 5, 2, MAT.wood[1]);
  p.hline(1, 36, 5, MAT.wood[2]);
  p.vline(1, 39, 2, MAT.wood[3]);
  p.vline(5, 39, 2, MAT.wood[3]);
  return p;
}

/** Tapia baja encalada vista en 3/4: albardilla arriba y cara al sur. */
function lowWall(p: Pix, x: number, y: number, w: number, h: number) {
  p.hline(x, y, w, 31);
  p.rect(x, y + 1, w, h - 1, MAT.white[1]);
  for (let i = 0; i < w; i++) if (hash(x + i, y, 5) > 0.85) p.set(x + i, y + 1 + Math.floor(hash(y, x + i) * (h - 1)), MAT.white[2]);
  p.hline(x, y + h - 1, w, MAT.white[2]);
  p.hline(x, y + h, w, MAT.white[3]);
}

function tombstone(p: Pix, x: number, y: number, kind: number) {
  p.shadow(x + 1, y + 5, 3, 1);
  if (kind === 0) {
    // Lápida de remate redondo.
    p.rect(x, y + 1, 3, 4, MAT.stone[1]);
    p.set(x + 1, y, MAT.stone[0]);
    p.vline(x, y + 1, 4, MAT.stone[0]);
    p.vline(x + 2, y + 1, 4, MAT.stone[2]);
    p.set(x + 1, y + 2, MAT.stone[3]);
  } else {
    // Cruz blanca.
    p.vline(x + 1, y, 5, 12);
    p.hline(x, y + 1, 3, 12);
    p.set(x + 2, y + 1, 13);
    p.vline(x + 1, y + 3, 2, 13);
  }
  p.set(x + 3, y + 4, [2, 4, 61, 12][(x + y) % 4]!); // flores
}

function cemetery(seed: number): Pix {
  const p = new Pix(T, BH);
  // Césped del recinto con un camino de grava hasta la cancela.
  for (let y = 22; y < 44; y++) for (let x = 1; x < 31; x++) {
    const r = hash(x, y, seed);
    p.set(x, y, r > 0.9 ? 22 : r < 0.12 ? 24 : 23);
  }
  p.rect(13, 24, 6, 20, MAT.stone[1]);
  p.dither(13, 24, 6, 20, MAT.stone[0], 1);
  p.vline(13, 24, 20, MAT.stone[2]);
  for (let i = 0; i < 6; i++) p.set(14 + Math.floor(hash(i, seed, 3) * 5), 25 + Math.floor(hash(seed, i, 4) * 18), MAT.stone[3]);
  // Muro de nichos al fondo, con su tejadillo.
  castShadow(p, 1, 9, 30, 15);
  gableRoof(p, 1, 9, 30, 2, 3, MAT.terracotta);
  p.rect(2, 14, 28, 10, MAT.white[1]);
  p.vline(2, 14, 10, MAT.white[0]);
  p.vline(29, 14, 10, MAT.white[2]);
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 6; k++) {
      const nx = 4 + k * 4 + (k > 2 ? 1 : 0);
      const ny = 15 + r * 3;
      p.rect(nx, ny, 3, 2, MAT.stone[1]);
      p.hline(nx, ny, 3, MAT.stone[0]);
      p.set(nx + 2, ny + 1, MAT.stone[2]);
      if (hash(k, r, seed) > 0.6) p.set(nx + 1, ny + 1, [2, 4, 61][(k + r) % 3]!);
    }
  }
  // Crucifijo en el centro del muro.
  p.vline(16, 14, 8, MAT.stone[3]);
  p.hline(15, 16, 3, MAT.stone[3]);
  p.hline(2, 23, 28, MAT.white[2]);
  p.hline(2, 24, 28, 24);
  // Tapias laterales (se ve su albardilla).
  p.rect(0, 22, 2, 21, 31);
  p.vline(1, 22, 21, MAT.white[1]);
  p.rect(30, 22, 2, 21, MAT.white[1]);
  p.vline(31, 22, 21, MAT.white[2]);
  // Lápidas y cruces.
  for (const [x, y, k] of [
    [8, 26, 0], [3, 32, 1], [8, 33, 0], [21, 26, 1], [21, 33, 0], [26, 32, 0], [3, 37, 0], [8, 38, 1], [21, 38, 1],
  ] as const) tombstone(p, x, y, (k + seed) % 2);
  // Cipreses en las esquinas del fondo.
  cypress(p, 4, 6, 29, seed);
  cypress(p, 27, 4, 29, seed + 3);
  // Tapia delantera con pilares y cancela de hierro.
  lowWall(p, 0, 42, 12, 4);
  lowWall(p, 20, 42, 12, 4);
  for (const x of [11, 19]) {
    p.rect(x, 38, 3, 8, MAT.white[1]);
    p.hline(x, 38, 3, 31);
    p.vline(x, 39, 7, MAT.white[0]);
    p.vline(x + 2, 39, 7, MAT.white[2]);
    p.hline(x, 37, 3, MAT.terracotta[1]);
  }
  for (let x = 14; x < 19; x++) {
    if (x % 2 === 0) p.vline(x, 40, 6, MAT.slate[3]);
    p.set(x, x === 16 ? 39 : 40, MAT.slate[3]);
  }
  p.hline(14, 40, 5, MAT.slate[3]);
  p.hline(14, 43, 5, MAT.slate[3]);
  p.set(16, 38, MAT.slate[3]);
  return p;
}

function library(seed: number): Pix {
  const p = new Pix(T, BH);
  const wall = MAT.cream;
  castShadow(p, 1, 16, 30, 30);
  flatRoof(p, 1, 13, 30, 8, MAT.stone, seed);
  facade(p, 2, 21, 28, 25, wall, 'stone', seed);
  // Cornisa.
  p.hline(1, 21, 30, MAT.stone[0]);
  p.hline(1, 22, 30, MAT.stone[2]);
  // Frontón con un libro abierto en el tímpano.
  for (let y = 11; y < 21; y++) {
    const half = (y - 10) * 1.25;
    for (let x = Math.ceil(16 - half); x < 16 + half; x++) p.set(x, y, wall[1]);
  }
  for (let y = 11; y < 21; y++) {
    const half = (y - 10) * 1.25;
    p.set(Math.ceil(16 - half), y, 12);
    p.set(Math.ceil(16 - half) + 1, y, wall[0]);
    p.set(Math.ceil(16 + half) - 1, y, MAT.stone[2]);
  }
  p.hline(4, 20, 24, MAT.stone[0]);
  p.rect(13, 15, 3, 4, 12);
  p.rect(16, 15, 3, 4, MAT.white[1]);
  p.vline(16, 15, 4, MAT.stone[3]);
  p.hline(13, 19, 6, MAT.stone[3]);
  p.set(14, 16, MAT.stone[2]);
  p.set(17, 16, MAT.stone[2]);
  p.set(14, 17, MAT.stone[2]);
  p.set(17, 17, MAT.stone[2]);
  // Ventanales de medio punto en la planta alta.
  for (const x of [5, 14, 23]) {
    windowAt(p, x, 25, 4, 7);
    p.set(x - 1, 24, wall[1]);
    p.set(x + 4, 24, wall[1]);
    p.set(x, 24, 12);
    p.set(x + 3, 24, 12);
    p.hline(x + 1, 23, 2, 12);
    p.set(x + 1, 22, MAT.stone[0]);
  }
  // Pilastras.
  for (const x of [11, 20]) {
    p.rect(x, 23, 2, 21, wall[0]);
    p.vline(x + 1, 23, 21, wall[2]);
  }
  // Escaparates con lomos de libros.
  const books = [2, 9, 6, 4, 1, 3, 7, 17, 10];
  for (const x0 of [3, 22]) {
    p.rect(x0, 35, 7, 8, MAT.wood[3]);
    p.rect(x0 + 1, 36, 5, 6, nightLights ? C.lampWarm : MAT.glass[2]);
    if (!nightLights) {
      p.hline(x0 + 1, 36, 5, MAT.glass[1]);
      p.set(x0 + 1, 37, MAT.glass[0]);
    }
    p.hline(x0 + 1, 39, 5, MAT.wood[2]);
    for (let i = 0; i < 5; i++) {
      const h = 2 + Math.floor(hash(x0, i, seed) * 2);
      p.vline(x0 + 1 + i, 42 - h, h, books[(x0 + i * 3 + seed) % books.length]!);
    }
    p.hline(x0, 42, 7, MAT.stone[0]);
  }
  doorAt(p, 14, 35, 4, 9, MAT.wood, MAT.stone[0]);
  if (nightLights) p.rect(15, 36, 2, 3, C.lampWarm);
  // Escalinata.
  p.rect(10, 45, 12, 1, MAT.stone[0]);
  p.hline(9, 46, 14, MAT.stone[1]);
  p.hline(9, 47, 14, MAT.stone[3]);
  // Farolillos.
  for (const x of [12, 20]) p.set(x, 34, nightLights ? C.lamp : MAT.metal[3]);
  return p;
}

function sports(seed: number): Pix {
  const p = new Pix(T, BH);
  // Pista exterior (media cancha) con líneas blancas.
  const court = MAT.blue;
  p.rect(0, 31, 32, 17, MAT.stone[2]);
  p.rect(1, 32, 30, 15, court[2]);
  for (let i = 0; i < 40; i++) p.set(1 + Math.floor(hash(i, seed) * 30), 32 + Math.floor(hash(seed, i) * 15), court[3]);
  p.rect(12, 32, 8, 8, MAT.red[2]);
  p.frame(2, 32, 28, 14, 12);
  p.frame(12, 32, 8, 8, 12);
  for (let x = 12; x < 20; x++) {
    const dy = Math.round(Math.sqrt(Math.max(0, 16 - (x + 0.5 - 16) ** 2)) * 0.6);
    p.set(x, 39 + dy, 12);
  }
  for (let x = 4; x < 28; x++) {
    const dx = (x + 0.5 - 16) / 12;
    const dy = Math.round(Math.sqrt(Math.max(0, 1 - dx * dx)) * 10);
    if (dy > 0) p.set(x, 32 + dy, 12);
  }
  p.vline(4, 32, 2, 12);
  p.vline(27, 32, 2, 12);
  p.hline(0, 47, 32, MAT.stone[3]);
  // Nave: muro delantero con remate curvo.
  castShadow(p, 1, 12, 30, 19);
  const arc = (x: number) => 13 + Math.round(((x + 0.5 - 16) / 15) ** 2 * 6);
  // Tejado curvo de chapa (bóveda que se aleja hacia el fondo).
  const D = 7;
  for (let x = 1; x < 31; x++) {
    const a = arc(x);
    const u = (x - 1) / 29;
    const tone = u < 0.22 ? 0 : u < 0.6 ? 1 : u < 0.85 ? 2 : 3;
    for (let k = 1; k <= D; k++) {
      let c = MAT.metal[tone];
      if (k % 2 === 0) c = MAT.metal[Math.min(3, tone + 1)]!;
      if (k === D) c = MAT.metal[3];
      p.set(x, a - k, c);
    }
  }
  for (let y = 0; y < 31; y++) for (let x = 1; x < 31; x++) {
    if (y < arc(x) || y > 30) continue;
    p.set(x, y, MAT.metal[1]);
  }
  facade(p, 1, 20, 30, 11, MAT.brick, 'brick', seed);
  for (let x = 1; x < 31; x++) {
    const a = arc(x);
    for (let y = a; y < 20; y++) p.set(x, y, x % 3 === 2 ? MAT.metal[2] : x === 1 ? MAT.metal[0] : MAT.metal[1]);
    p.set(x, a, 12);
  }
  p.vline(30, arc(30), 20 - arc(30), MAT.metal[3]);
  // Franja de lucernarios y franja de color.
  for (let x = 3; x < 29; x++) if (x % 4 !== 2) p.set(x, 16, nightLights ? C.lamp : MAT.glass[1]);
  for (let x = 3; x < 29; x++) if (x % 4 !== 2) p.set(x, 17, nightLights ? C.lampWarm : MAT.glass[2]);
  p.hline(1, 19, 30, MAT.terracotta[0]);
  p.hline(1, 20, 30, MAT.terracotta[2]);
  // Portón enrollable y puerta acristalada.
  p.rect(3, 23, 7, 8, MAT.metal[3]);
  for (let y = 24; y < 31; y += 2) p.hline(4, y, 5, MAT.metal[2]);
  p.hline(3, 22, 7, MAT.metal[0]);
  doorAt(p, 23, 24, 5, 6, MAT.glass, MAT.metal[2]);
  if (nightLights) p.rect(24, 24, 3, 5, C.lampWarm);
  // Canasta frente a la nave: tablero, aro y red.
  p.vline(16, 26, 6, MAT.metal[3]);
  p.rect(12, 21, 9, 6, 12);
  p.frame(12, 21, 9, 6, MAT.metal[2]);
  p.frame(14, 23, 5, 3, MAT.red[1]);
  p.hline(14, 27, 5, 3);
  p.hline(13, 27, 1, MAT.red[2]);
  p.set(14, 28, 12);
  p.set(16, 28, 12);
  p.set(18, 28, 12);
  p.set(15, 29, 12);
  p.set(17, 29, 12);
  // Balón y banco.
  p.ball(24, 41, 1.6, MAT.terracotta, seed);
  p.set(24, 41, MAT.terracotta[3]);
  p.rect(26, 28, 4, 1, MAT.wood[1]);
  p.set(26, 29, MAT.wood[3]);
  p.set(29, 29, MAT.wood[3]);
  return p;
}

/* ===================== delincuencia y disturbios (v1.8) ===================== */

/** Granito gris frío de muros y garitas: [brillo, base, sombra, oscuro]. */
const GRANITE: Mat = [51, 52, 53, 55];
/** Hormigón claro del módulo de celdas. */
const CONCRETE: Mat = [54, 51, 52, 53];

/** Ventanuco con barrotes (de noche, algunas celdas encendidas). */
function barredWindow(p: Pix, x: number, y: number, w: number, h: number, frame: number) {
  const lit = nightLights && hash(x, y, 31) > 0.45;
  p.rect(x - 1, y - 1, w + 2, h + 2, frame);
  p.rect(x, y, w, h, lit ? C.lampWarm : 26);
  if (lit) p.hline(x, y, w, C.lamp);
  else p.set(x, y, MAT.glass[3]);
  for (let i = x; i < x + w; i += 2) p.vline(i, y, h, lit ? 53 : 52);
  p.hline(x - 1, y + h + 1, w + 2, CONCRETE[3]);
}

/** Concertina de alambre de espino sobre un muro. */
function razorWire(p: Pix, x: number, y: number, w: number) {
  for (let i = 0; i < w; i++) {
    const X = x + i;
    const k = i % 4;
    // Espiras oscuras con brillo arriba: se leen sobre el hormigón claro.
    if (k === 1 || k === 2) {
      p.set(X, y, k === 1 ? 31 : 53);
      p.set(X, y + 2, 55);
    } else {
      p.set(X, y + 1, 55);
    }
    if (k === 3 && hash(X, y) > 0.4) p.set(X, y - 1, 53); // púa
  }
  for (let i = 1; i < w; i += 7) {
    p.vline(x + i, y - 1, 4, 55);
    p.set(x + i + 1, y - 2, 55); // poste acodado hacia dentro
  }
}

/* ============== servicios por niveles (v1.8): cárcel y niveles 2 y 3 ============== */

/** Depósito cilíndrico en 3/4: cuerpo sombreado de izquierda a derecha y tapa elíptica. */
function tank(p: Pix, x: number, y: number, w: number, h: number, m: Mat, lid: Mat = MAT.metal) {
  const r = w / 2;
  const ry = Math.max(1, Math.round(w / 7));
  const curve = (i: number) => {
    const u = (i + 0.5 - r) / r;
    return Math.round(ry * Math.sqrt(Math.max(0, 1 - u * u)));
  };
  for (let i = 0; i < w; i++) {
    const t = i / (w - 1);
    const c = t < 0.18 ? m[0] : t < 0.55 ? m[1] : t < 0.85 ? m[2] : m[3];
    p.vline(x + i, y, h + curve(i), c);
    p.set(x + i, y + h + curve(i), m[3]);
  }
  p.ellipse(x + r, y, r, ry, lid[1]);
  p.ellipse(x + r - 1, y - 0.4, Math.max(1, r - 2.5), Math.max(0.6, ry - 0.8), lid[0]);
  for (let i = 0; i < w; i++) p.set(x + i, y + curve(i), lid[2]);
}

/** Torre de refrigeración (hiperboloide) centrada en cx. */
function coolingTower(p: Pix, cx: number, top: number, bottom: number, waist: number, spread: number, seed: number) {
  for (let y = top; y < bottom; y++) {
    const t = (y - top) / (bottom - top);
    const half = waist + Math.abs(t - 0.62) * spread * (t < 0.62 ? 0.6 : 1.4);
    const x0 = Math.round(cx - half);
    const x1 = Math.round(cx + half);
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / (x1 - x0 || 1);
      let c = u < 0.2 ? MAT.stone[0] : u < 0.6 ? MAT.stone[1] : u < 0.85 ? MAT.stone[2] : MAT.stone[3];
      if (y % 5 === 0 && u > 0.1) c = MAT.stone[2];
      p.set(x, y, c);
    }
  }
  p.ellipse(cx, top, waist + 0.62 * spread * 0.6, 1.5, MAT.stone[3]);
  p.ball(cx - 2, top - 4, 3, [31, 12, 13, 14], seed);
  p.ball(cx + 3, top - 6, 2.4, [31, 12, 13, 13], seed + 1);
}

/** Chimenea alta a franjas rojas y blancas, con baliza. */
function stripedStack(p: Pix, x: number, top: number, bottom: number, seed: number) {
  for (let y = top; y < bottom; y++) {
    const band = Math.floor((y - top) / 4) % 2 === 0 ? MAT.red : MAT.white;
    for (let i = 0; i < 4; i++) p.set(x + i, y, band[i]!);
  }
  p.hline(x - 1, top, 6, MAT.metal[2]);
  p.set(x + 1, top + 1, nightLights ? C.lampWarm : MAT.red[1]);
  p.ball(x + 2, top - 4, 2.4, [31, 12, 13, 14], seed);
  p.ball(x + 4, top - 8, 1.9, [31, 12, 13, 13], seed + 1);
}

/** Vehículo en 3/4: coche patrulla (9 px) o ambulancia (10 px). */
function car(p: Pix, x: number, y: number, kind: 'police' | 'ambulance') {
  const body = MAT.white;
  const w = kind === 'ambulance' ? 10 : 9;
  p.shadow(x + 1, y + 6, w, 1);
  if (kind === 'ambulance') {
    p.rect(x, y - 1, 6, 6, body[1]);
    p.hline(x, y - 1, 6, body[0]);
    p.vline(x, y - 1, 6, body[0]);
    p.rect(x + 6, y + 1, 4, 4, body[1]);
    p.rect(x + 7, y + 1, 2, 2, MAT.glass[1]);
    p.hline(x, y + 3, 10, MAT.red[1]);
    p.rect(x + 2, y, 2, 3, MAT.red[1]);
    p.hline(x + 1, y + 1, 4, MAT.red[1]);
    p.set(x + 1, y - 2, nightLights ? C.lamp : MAT.blue[1]);
    p.set(x + 4, y - 2, nightLights ? C.lampWarm : MAT.red[1]);
  } else {
    p.rect(x + 2, y, 5, 2, body[1]);
    p.rect(x + 3, y, 3, 1, MAT.glass[1]);
    p.rect(x, y + 2, 9, 3, body[1]);
    p.hline(x, y + 2, 9, body[0]);
    p.hline(x, y + 3, 9, MAT.blue[1]);
    p.set(x + 3, y - 1, nightLights ? C.lamp : MAT.blue[1]);
    p.set(x + 5, y - 1, nightLights ? C.lampWarm : MAT.red[1]);
    p.set(x + 8, y + 2, nightLights ? C.lamp : 4);
  }
  p.hline(x, y + 4, w, body[2]);
  for (const dx of kind === 'ambulance' ? [1, 7] : [1, 6]) {
    p.rect(x + dx, y + 5, 2, 1, 0);
    p.set(x + dx, y + 4, 0);
  }
}

/** Foco o farola en un mástil (encendido de noche). */
function floodlight(p: Pix, x: number, top: number, bottom: number) {
  p.vline(x, top + 2, bottom - top - 2, MAT.metal[3]);
  p.rect(x - 1, top, 3, 2, nightLights ? C.lamp : MAT.metal[0]);
  p.hline(x - 1, top + 2, 3, MAT.metal[2]);
}

/** Mástil de antena de celosía con baliza. */
function antenna(p: Pix, x: number, top: number, bottom: number) {
  for (let y = top; y < bottom; y++) {
    p.set(x, y, MAT.metal[2]);
    p.set(x + 2, y, MAT.metal[3]);
    if (y % 2 === 0) p.set(x + 1, y, MAT.metal[1]);
  }
  p.hline(x - 1, top + 3, 5, MAT.metal[2]);
  p.hline(x - 2, top + 7, 7, MAT.metal[2]);
  p.set(x + 1, top - 1, nightLights ? C.lampWarm : MAT.red[1]);
}

/** Banderas de colores en un mástil. */
function flag(p: Pix, x: number, top: number, h: number, colors: readonly number[]) {
  p.vline(x, top, h, MAT.metal[2]);
  colors.forEach((c, k) => p.rect(x + 1, top + k, 5, 1, c));
}

function waterTower2(seed: number): Pix {
  const p = new Pix(T, BH);
  p.shadow(14, 44, 18, 2);
  // Depósito elevado, más alto y grande, a la derecha.
  for (const x of [13, 27]) p.rect(x, 19, 2, 26, MAT.metal[2]);
  for (let i = 0; i < 12; i++) {
    p.set(14 + i, 23 + i, MAT.metal[3]);
    p.set(27 - i, 23 + i, MAT.metal[3]);
  }
  p.hline(13, 30, 16, MAT.metal[2]);
  tank(p, 10, 5, 21, 14, MAT.blue, MAT.slate);
  p.hline(10, 10, 21, MAT.blue[3]);
  p.hline(10, 15, 21, MAT.blue[3]);
  p.ball(16, 12, 2.5, [31, 11, 10, 9], seed);
  p.vline(20, 0, 3, MAT.metal[3]);
  p.set(20, 0, nightLights ? C.lampWarm : MAT.red[1]);
  for (let y = 7; y < 44; y += 2) p.hline(29, y, 2, MAT.metal[1]);
  p.vline(29, 7, 37, MAT.metal[3]);
  // Depósito de tierra.
  tank(p, 17, 36, 11, 8, MAT.stone, MAT.metal);
  p.hline(17, 39, 11, MAT.stone[3]);
  // Caseta de bombeo de ladrillo, más grande.
  castShadow(p, 1, 31, 12, 15);
  facade(p, 1, 33, 12, 13, MAT.brick, 'brick', seed);
  p.hline(0, 32, 14, MAT.blue[2]);
  p.hline(0, 31, 14, MAT.blue[1]);
  p.hline(1, 30, 12, MAT.blue[0]);
  windowAt(p, 3, 35, 2, 3);
  doorAt(p, 7, 38, 4, 7, MAT.teal);
  // Tubería azul entre la caseta, el depósito y la torre.
  p.hline(13, 43, 4, MAT.blue[1]);
  p.hline(13, 44, 4, MAT.blue[3]);
  p.vline(15, 30, 13, MAT.blue[1]);
  p.vline(16, 30, 13, MAT.blue[3]);
  return p;
}

function waterPlant(seed: number): Pix {
  const p = new Pix(T, BH);
  // Depósito elevado esbelto al fondo a la derecha.
  for (const x of [20, 29]) p.rect(x, 14, 2, 21, MAT.metal[2]);
  for (let i = 0; i < 9; i++) {
    p.set(21 + i, 15 + i, MAT.metal[3]);
    p.set(29 - i, 15 + i, MAT.metal[3]);
  }
  tank(p, 17, 3, 15, 12, MAT.blue, MAT.slate);
  p.hline(17, 8, 15, MAT.blue[3]);
  p.ball(22, 10, 2, [31, 11, 10, 9], seed);
  // Edificio de tratamiento.
  castShadow(p, 1, 17, 22, 17);
  facade(p, 1, 20, 22, 14, MAT.white, 'plaster', seed);
  flatRoof(p, 0, 15, 24, 6, MAT.blue, seed);
  p.hline(1, 26, 22, MAT.blue[1]);
  for (const x of [3, 8, 18]) windowAt(p, x, 22, 3, 2, { frame: 13 });
  doorAt(p, 12, 28, 3, 5, MAT.blue, 12);
  p.ball(5, 30, 2, [31, 11, 10, 9], seed);
  // Tubos hacia el depósito.
  p.hline(23, 31, 8, MAT.blue[1]);
  p.hline(23, 32, 8, MAT.blue[3]);
  // Explanada con dos balsas de decantación redondas y puente giratorio.
  p.rect(0, 34, 32, 14, MAT.stone[1]);
  p.dither(0, 34, 32, 14, MAT.stone[0], 1);
  for (const cx of [8, 24]) {
    p.ellipse(cx, 41, 7.5, 5.5, MAT.stone[3]);
    p.ellipse(cx, 40.5, 7, 5, MAT.stone[0]);
    p.ellipse(cx, 41, 6, 4, C.waterDeep);
    p.ellipse(cx - 1, 40.5, 4.5, 2.6, C.water);
    p.set(cx - 3, 39, C.waterLight);
    p.set(cx + 2, 42, C.waterLight);
    p.hline(cx - 6, 41, 13, MAT.metal[2]);
    p.hline(cx - 6, 40, 13, MAT.metal[0]);
    p.rect(cx - 1, 39, 3, 3, MAT.yellow[1]);
    p.set(cx, 39, nightLights ? C.lamp : MAT.yellow[0]);
  }
  p.hline(0, 47, 32, MAT.stone[3]);
  return p;
}

function powerPlant2(seed: number): Pix {
  const p = powerPlant(seed);
  // Segunda chimenea, a franjas, sobre la nave.
  stripedStack(p, 3, 4, 23, seed + 3);
  // Turbina nueva: nave anexa al pie de la torre.
  castShadow(p, 19, 35, 12, 11);
  facade(p, 19, 37, 12, 9, MAT.yellow, 'metal', seed);
  flatRoof(p, 18, 33, 14, 5, MAT.metal, seed);
  tank(p, 21, 29, 5, 4, MAT.metal, MAT.metal);
  windowAt(p, 21, 39, 3, 2, { lit: true });
  windowAt(p, 26, 39, 3, 2, { lit: true });
  p.rect(23, 43, 4, 2, MAT.metal[3]);
  return p;
}

function powerPlant3(seed: number): Pix {
  const p = new Pix(T, BH);
  // Dos torres de refrigeración y la chimenea entre ellas.
  coolingTower(p, 8, 7, 30, 4, 8, seed + 7);
  coolingTower(p, 24, 8, 30, 4.5, 8, seed);
  stripedStack(p, 14, 3, 24, seed + 3);
  // Nave de turbinas moderna.
  castShadow(p, 1, 24, 30, 12);
  facade(p, 1, 26, 30, 10, MAT.metal, 'metal', seed);
  flatRoof(p, 0, 22, 32, 5, MAT.blue, seed);
  for (const x of [3, 8, 21, 26]) windowAt(p, x, 28, 3, 3, { lit: true });
  doorAt(p, 14, 29, 4, 6, MAT.yellow, MAT.metal[2]);
  // Campo de paneles solares en tres filas.
  p.rect(0, 36, 32, 12, MAT.moss[1]);
  p.dither(0, 36, 32, 12, MAT.moss[2], 0);
  for (let r = 0; r < 3; r++) {
    const y = 37 + r * 4;
    for (let x = 1; x < 31; x++) {
      const gap = (x - 1) % 5 === 4;
      p.set(x, y, gap ? MAT.metal[1] : x % 2 ? MAT.glass[0] : MAT.glass[1]);
      p.set(x, y + 1, gap ? MAT.metal[2] : MAT.glass[2]);
      p.set(x, y + 2, MAT.metal[3]);
    }
  }
  return p;
}

function school2(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 18, 30, 28);
  // Ala nueva: moderna, de revoco y con tejado plano.
  facade(p, 20, 24, 11, 22, MAT.cream, 'plaster', seed + 1);
  flatRoof(p, 19, 20, 13, 5, MAT.yellow, seed);
  for (let f = 0; f < 2; f++) windowAt(p, 22, 27 + f * 8, 7, 4, { frame: 13 });
  p.hline(20, 33, 11, MAT.yellow[1]);
  // Edificio antiguo de ladrillo.
  facade(p, 1, 20, 20, 26, MAT.red, 'brick', seed);
  gableRoof(p, 0, 10, 22, 4, 7, MAT.slate);
  for (let f = 0; f < 2; f++) for (const x of [3, 16]) windowAt(p, x, 24 + f * 9, 3, 5, { frame: 12 });
  doorAt(p, 9, 35, 4, 10, MAT.wood);
  p.ball(11, 26, 3, [31, 12, 13, 14], seed);
  p.set(11, 25, 0);
  p.set(12, 26, 0);
  p.rect(7, 31, 8, 3, 12);
  for (let i = 0; i < 3; i++) p.set(8 + i * 2, 32, 9);
  // Mástil con bandera sobre el ala nueva.
  p.vline(30, 2, 18, MAT.metal[2]);
  p.rect(24, 2, 6, 4, 4);
  p.hline(24, 3, 6, 2);
  return p;
}

function school3(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 10, 30, 20);
  // Edificio principal al fondo, con torre del reloj.
  facade(p, 1, 14, 30, 17, MAT.red, 'brick', seed);
  gableRoof(p, 0, 6, 32, 3, 5, MAT.slate);
  facade(p, 12, 4, 8, 11, MAT.cream, 'plaster', seed + 2);
  gableRoof(p, 11, 0, 10, 1, 4, MAT.slate);
  p.ball(16, 9, 2.6, [31, 12, 13, 14], seed);
  p.set(16, 8, 0);
  p.set(16, 7, 0);
  p.set(17, 9, 0);
  for (const x of [3, 8, 22, 27]) windowAt(p, x, 17, 3, 4, { frame: 12 });
  for (const x of [3, 8, 22, 27]) windowAt(p, x, 24, 3, 3, { frame: 12 });
  doorAt(p, 14, 21, 4, 9, MAT.wood);
  p.rect(13, 16, 6, 3, 12);
  for (let i = 0; i < 3; i++) p.set(14 + i * 2, 17, 9);
  // Patio con pista y valla.
  p.rect(0, 31, 32, 17, MAT.stone[1]);
  p.dither(0, 31, 32, 17, MAT.stone[0], 0);
  p.rect(2, 33, 28, 12, MAT.terracotta[1]);
  p.frame(2, 33, 28, 12, 12);
  p.vline(16, 33, 12, 12);
  p.ellipse(16.5, 39, 2.5, 2, 12);
  p.ellipse(16.5, 39, 1.5, 1, MAT.terracotta[1]);
  for (const x of [2, 28]) {
    p.frame(x, 37, 2, 5, 31);
    p.dither(x, 38, 2, 3, MAT.metal[1], 0);
  }
  person(p, 9, 36, MAT.blue[1]);
  person(p, 21, 37, MAT.red[1], C.hairBlond);
  p.ball(13, 41, 1, MAT.white, seed);
  for (let x = 0; x < 32; x += 2) p.vline(x, 45, 3, MAT.metal[2]);
  p.hline(0, 45, 32, MAT.metal[1]);
  p.hline(0, 47, 32, MAT.metal[3]);
  return p;
}

function clinic2(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 2, 12, 28, 34);
  facade(p, 2, 14, 28, 32, MAT.white, 'plaster', seed);
  flatRoof(p, 1, 7, 30, 8, MAT.white, seed);
  // Cruz, más alta.
  p.rect(13, 0, 6, 13, 12);
  p.rect(10, 3, 12, 6, 12);
  p.rect(14, 1, 4, 11, MAT.red[1]);
  p.rect(11, 4, 10, 4, MAT.red[1]);
  p.vline(17, 1, 11, MAT.red[2]);
  for (let f = 0; f < 2; f++) for (const x of [5, 11, 20, 25]) windowAt(p, x, 17 + f * 6, 3, 3, { frame: 13 });
  p.hline(2, 29, 28, MAT.red[1]);
  p.hline(2, 30, 28, MAT.red[2]);
  // Urgencias: marquesina roja sobre la puerta.
  doorAt(p, 11, 36, 8, 9, MAT.glass, MAT.metal[2]);
  p.rect(9, 33, 14, 2, MAT.red[1]);
  p.hline(9, 33, 14, MAT.red[0]);
  p.hline(9, 35, 14, MAT.red[3]);
  p.vline(9, 36, 9, MAT.metal[2]);
  p.vline(22, 36, 9, MAT.metal[2]);
  windowAt(p, 4, 36, 3, 4, { frame: 13 });
  windowAt(p, 25, 33, 3, 3, { frame: 13 });
  car(p, 21, 40, 'ambulance');
  return p;
}

function hospital(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 8, 30, 38);
  facade(p, 1, 11, 30, 35, MAT.white, 'plaster', seed);
  // Azotea con helipuerto.
  flatRoof(p, 0, 2, 32, 10, MAT.white, seed);
  p.ellipse(16, 6.5, 7, 3.4, 4);
  p.ellipse(16, 6.5, 5.8, 2.5, MAT.stone[2]);
  p.vline(14, 5, 3, 12);
  p.vline(18, 5, 3, 12);
  p.hline(14, 6, 5, 12);
  for (const x of [2, 29]) p.set(x, 3, nightLights ? C.lamp : MAT.red[1]);
  // Cruz en la fachada.
  p.rect(13, 12, 6, 7, 12);
  p.rect(15, 12, 2, 7, MAT.red[1]);
  p.rect(13, 14, 6, 3, MAT.red[1]);
  // Tres plantas de ventanas.
  for (let f = 0; f < 3; f++) for (const x of [3, 8, 22, 27]) windowAt(p, x, 13 + f * 6, 3, 3, { frame: 13 });
  for (let f = 1; f < 3; f++) windowAt(p, 14, 13 + f * 6, 4, 3, { frame: 13 });
  p.hline(1, 32, 30, MAT.red[1]);
  p.hline(1, 33, 30, MAT.red[2]);
  // Entrada acristalada con marquesina.
  doorAt(p, 11, 37, 8, 8, MAT.glass, MAT.metal[2]);
  p.rect(9, 34, 14, 2, MAT.red[1]);
  p.hline(9, 34, 14, MAT.red[0]);
  p.vline(9, 36, 9, MAT.metal[2]);
  p.vline(22, 36, 9, MAT.metal[2]);
  car(p, 21, 40, 'ambulance');
  car(p, 0, 40, 'ambulance');
  return p;
}

function policeStation2(seed: number): Pix {
  const p = policeStation(seed);
  // Antena de celosía y bandera en el tejado.
  antenna(p, 25, 0, 13);
  flag(p, 5, 1, 11, [MAT.red[1], MAT.yellow[0], MAT.yellow[0], MAT.red[1]]);
  // Escudo sobre la puerta.
  p.rect(14, 31, 4, 3, MAT.blue[1]);
  p.hline(15, 34, 2, MAT.blue[1]);
  p.hline(15, 32, 2, 4);
  // El coche pequeño se cambia por dos patrullas.
  p.rect(24, 42, 8, 5, NONE);
  castShadow(p, 2, 16, 28, 30);
  windowAt(p, 23, 35, 4, 5, { frame: 13 });
  car(p, 0, 40, 'police');
  car(p, 22, 40, 'police');
  return p;
}

function policeHQ(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 2, 6, 28, 40);
  facade(p, 2, 9, 28, 37, MAT.white, 'plaster', seed);
  flatRoof(p, 1, 4, 30, 6, MAT.blue, seed);
  antenna(p, 25, 0, 5);
  p.rect(5, 2, 4, 3, MAT.metal[2]);
  p.rect(5, 2, 2, 2, MAT.red[1]);
  p.rect(7, 2, 2, 2, MAT.blue[1]);
  // Fachada acristalada central de cuatro plantas.
  p.rect(11, 10, 10, 24, MAT.glass[2]);
  for (let y = 10; y < 34; y++) {
    for (let x = 11; x < 21; x++) {
      const row = (y - 10) % 6;
      const lit = nightLights && hash(x >> 1, Math.floor(y / 6), 9) > 0.35;
      if (row === 5) p.set(x, y, MAT.metal[1]);
      else if (x % 3 === 2) p.set(x, y, MAT.metal[2]);
      else if (lit) p.set(x, y, row < 2 ? C.lamp : C.lampWarm);
      else if (row < 2) p.set(x, y, MAT.glass[1]);
    }
  }
  p.frame(10, 9, 12, 26, MAT.metal[3]);
  for (let f = 0; f < 4; f++) for (const x of [4, 24]) windowAt(p, x, 11 + f * 6, 4, 3, { frame: 13 });
  // Franja azul con rótulo.
  p.rect(2, 35, 28, 3, MAT.blue[1]);
  p.hline(2, 35, 28, MAT.blue[0]);
  for (let i = 0; i < 8; i++) p.rect(5 + i * 3, 36, 2, 1, 12);
  // Escudo y puerta.
  p.rect(14, 26, 4, 4, MAT.blue[1]);
  p.frame(14, 26, 4, 4, 4);
  p.hline(15, 30, 2, 4);
  doorAt(p, 13, 39, 6, 6, MAT.blue, 12);
  car(p, 0, 41, 'police');
  car(p, 22, 41, 'police');
  return p;
}

/** Ventana de celda: hueco oscuro con barrotes. */
function barredWin2(p: Pix, x: number, y: number, w: number, h: number) {
  p.rect(x - 1, y - 1, w + 2, h + 2, MAT.stone[3]);
  p.rect(x, y, w, h, nightLights && hash(x, y, 5) > 0.45 ? C.lampWarm : 26);
  for (let i = x; i < x + w; i += 2) p.vline(i, y, h, MAT.metal[1]);
  p.hline(x - 1, y + h + 1, w + 2, MAT.stone[0]);
}

/** Muro de piedra con concertina encima. */
function prisonWall(p: Pix, x: number, y: number, w: number, h: number, seed: number) {
  facade(p, x, y, w, h, MAT.stone, 'stone', seed);
  p.hline(x, y, w, MAT.stone[0]);
  for (let i = x; i < x + w; i++) {
    if ((i - x) % 5 === 0) p.vline(i, y - 3, 3, MAT.metal[3]);
    else p.set(i, y - 2 - (i % 2), MAT.metal[1]);
  }
}

/** Garita de vigilancia: fuste de piedra, cabina acristalada y tejadillo. */
function watchTower(p: Pix, x: number, top: number, bottom: number, seed: number) {
  castShadow(p, x + 1, top + 6, 5, bottom - top - 6);
  facade(p, x + 1, top + 6, 5, bottom - top - 6, MAT.stone, 'stone', seed);
  p.rect(x, top + 2, 7, 4, MAT.stone[2]);
  p.rect(x + 1, top + 3, 5, 2, nightLights ? C.lamp : MAT.glass[1]);
  p.set(x + 3, top + 3, MAT.stone[3]);
  p.hline(x - 1, top + 6, 9, MAT.stone[3]);
  p.hline(x - 1, top + 5, 9, MAT.stone[0]);
  p.hline(x - 1, top + 1, 9, MAT.slate[2]);
  p.hline(x, top, 7, MAT.slate[1]);
  p.hline(x + 2, top - 1, 3, MAT.slate[0]);
}

/** Pabellón de celdas con tejado plano y ventanas con barrotes. */
function cellBlock(p: Pix, x: number, y: number, w: number, h: number, floors: number, seed: number) {
  castShadow(p, x, y, w, h);
  facade(p, x, y, w, h, MAT.stone, 'brick', seed);
  flatRoof(p, x - 1, y - 5, w + 2, 6, MAT.slate, seed);
  for (let f = 0; f < floors; f++) for (let i = x + 3; i < x + w - 3; i += 5) barredWin2(p, i, y + 3 + f * 6, 3, 3);
}

/** Portón metálico de barrotes. */
function gate(p: Pix, x: number, y: number, w: number, h: number) {
  p.rect(x, y, w, h, MAT.metal[3]);
  for (let i = x + 1; i < x + w - 1; i += 2) p.vline(i, y + 1, h - 1, MAT.metal[1]);
  p.hline(x, y, w, MAT.metal[2]);
}

function jail(seed: number): Pix {
  const p = new Pix(T, BH);
  // Módulo de celdas al fondo: hormigón claro, dos filas de ventanucos.
  castShadow(p, 2, 9, 22, 18);
  flatRoof(p, 2, 6, 22, 6, CONCRETE, seed);
  facade(p, 3, 11, 20, 16, CONCRETE, 'plaster', seed);
  p.hline(3, 18, 20, CONCRETE[2]); // forjado
  for (const x of [5, 10, 15, 20]) {
    barredWindow(p, x, 13, 3, 3, CONCRETE[3]);
    barredWindow(p, x, 20, 3, 3, CONCRETE[3]);
  }
  // Muro perimetral alto de sillería gris con alambrada.
  castShadow(p, 0, 27, 32, 19);
  facade(p, 0, 27, 32, 19, GRANITE, 'stone', seed);
  p.hline(0, 27, 32, 54); // albardilla
  p.hline(0, 28, 32, GRANITE[0]);
  p.hline(0, 29, 32, GRANITE[2]);
  razorWire(p, 0, 24, 22);
  // Portón metálico con remaches y mirilla.
  p.rect(9, 33, 12, 13, 26);
  p.rect(10, 34, 10, 12, 55);
  for (let y = 35; y < 45; y += 3) {
    p.hline(10, y, 10, 53);
    p.set(10, y + 1, 52);
    p.set(19, y + 1, 26);
  }
  p.vline(15, 34, 12, 26);
  p.vline(10, 34, 12, 53);
  for (const x of [11, 18]) for (let y = 36; y < 45; y += 3) p.set(x, y, 51);
  p.rect(12, 37, 2, 1, 0); // mirilla
  p.rect(9, 32, 12, 1, 53);
  p.hline(8, 31, 14, GRANITE[0]);
  // Placa azul sobre el portón y apliques.
  p.rect(11, 29, 8, 2, MAT.blue[2]);
  p.hline(11, 29, 8, MAT.blue[1]);
  for (let i = 0; i < 3; i++) p.set(12 + i * 2, 29, 12);
  for (const x of [7, 22]) {
    p.set(x, 32, nightLights ? C.lamp : 55);
    p.set(x, 33, nightLights ? C.lampWarm : 53);
  }
  // Garita en la esquina: fuste de granito y caseta acristalada.
  castShadow(p, 23, 10, 8, 36);
  facade(p, 24, 12, 6, 34, GRANITE, 'stone', seed + 1);
  p.vline(24, 12, 34, GRANITE[0]);
  p.rect(22, 5, 10, 7, GRANITE[2]);
  p.hline(22, 11, 10, GRANITE[3]);
  p.rect(23, 6, 8, 4, nightLights ? C.lampWarm : MAT.glass[2]);
  if (!nightLights) {
    p.hline(23, 6, 8, MAT.glass[1]);
    p.set(23, 7, MAT.glass[0]);
  } else p.hline(23, 6, 8, C.lamp);
  for (const x of [25, 28]) p.vline(x, 6, 4, GRANITE[3]);
  p.hline(21, 4, 11, GRANITE[1]);
  p.hline(21, 3, 11, 54);
  p.hline(22, 2, 9, GRANITE[2]);
  // Foco sobre la garita.
  p.rect(25, 0, 3, 2, 55);
  p.set(26, 0, nightLights ? C.lamp : 51);
  p.set(27, 1, nightLights ? C.lamp : 54);
  if (nightLights) {
    // Haz del foco barriendo el patio (línea con tramado debajo) y charco de luz ante el portón.
    for (let t = 1; t <= 10; t++) {
      p.set(25 - t, 1 + Math.floor(t / 2), C.lamp);
      if (t % 2 === 0 && t > 2) p.set(25 - t, 2 + Math.floor(t / 2), C.lampWarm);
    }
    p.set(28, 0, C.lampWarm);
    p.set(24, 0, C.lampWarm);
    p.dither(10, 46, 10, 2, C.lamp, 0);
    p.set(7, 34, C.lamp);
    p.set(22, 34, C.lamp);
  }
  // Ventanucos con barrotes en el fuste de la garita.
  barredWindow(p, 26, 18, 2, 3, GRANITE[3]);
  barredWindow(p, 26, 34, 2, 3, GRANITE[3]);
  // Cámara en el muro y matojo.
  p.rect(2, 31, 2, 1, 55);
  p.set(3, 32, nightLights ? 2 : 53);
  bush(p, 3, 45, 1.8, seed);
  return p;
}


function jail2(seed: number): Pix {
  const p = new Pix(T, BH);
  p.rect(0, 34, 32, 14, MAT.dirt[2]);
  p.dither(0, 34, 32, 14, MAT.dirt[1], 1);
  cellBlock(p, 6, 16, 20, 22, 3, seed);
  watchTower(p, 0, 9, 46, seed);
  watchTower(p, 25, 9, 46, seed + 1);
  prisonWall(p, 6, 39, 20, 7, seed);
  gate(p, 12, 39, 8, 7);
  return p;
}

function jail3(seed: number): Pix {
  const p = new Pix(T, BH);
  p.rect(0, 30, 32, 18, MAT.dirt[2]);
  p.dither(0, 30, 32, 18, MAT.dirt[1], 1);
  // Pabellón alto con torre central de control.
  cellBlock(p, 4, 13, 24, 18, 3, seed);
  facade(p, 13, 4, 6, 9, MAT.stone, 'stone', seed + 2);
  p.rect(12, 2, 8, 3, MAT.stone[2]);
  p.rect(13, 3, 6, 1, nightLights ? C.lamp : MAT.glass[1]);
  p.hline(11, 1, 10, MAT.slate[1]);
  p.hline(13, 0, 6, MAT.slate[0]);
  // Doble cerca: muro interior y muro exterior, con garitas en las esquinas.
  prisonWall(p, 4, 32, 24, 6, seed + 3);
  gate(p, 13, 32, 6, 6);
  prisonWall(p, 0, 41, 32, 6, seed + 4);
  gate(p, 12, 41, 8, 6);
  watchTower(p, 0, 9, 41, seed);
  watchTower(p, 25, 9, 41, seed + 1);
  floodlight(p, 10, 37, 41);
  floodlight(p, 21, 37, 41);
  return p;
}

/* ---------------- 2.1: punto limpio, bolsas, ratas y camión ---------------- */

/** Contenedor de 6×6 con tapa, cantos y ruedas. */
function bin(p: Pix, x: number, y: number, m: Mat) {
  p.shadow(x + 1, y + 6, 6, 1);
  p.hline(x, y, 6, m[3]); // tapa
  p.hline(x + 1, y - 1, 4, m[2]);
  p.rect(x, y + 1, 6, 4, m[1]);
  p.vline(x, y + 1, 4, m[0]);
  p.vline(x + 5, y + 1, 4, m[2]);
  p.hline(x + 1, y + 2, 4, m[2]); // boca
  p.set(x + 1, y + 5, 0);
  p.set(x + 4, y + 5, 0);
}

/** Iglú del vidrio (verde). */
function igloo(p: Pix, x: number, y: number) {
  p.shadow(x + 1, y + 6, 7, 1);
  p.ellipse(x + 3.5, y + 4, 3.6, 3.2, MAT.moss[1]);
  p.ellipse(x + 2.5, y + 3, 1.6, 1.4, MAT.moss[0]);
  p.hline(x + 1, y + 6, 6, MAT.moss[3]);
  p.rect(x + 3, y + 1, 2, 1, 0); // boca
}

/** Flechas del reciclaje (cartel de 7×7 sobre un poste). */
function recycleSign(p: Pix, x: number, y: number, post: number) {
  p.vline(x + 3, y + 7, post, MAT.metal[3]);
  p.rect(x, y, 7, 7, 12);
  p.frame(x, y, 7, 7, MAT.moss[2]);
  for (const [dx, dy] of [[3, 1], [2, 2], [4, 2], [1, 4], [5, 4], [2, 5], [3, 5], [4, 5]] as const) p.set(x + dx, y + dy, MAT.moss[1]);
  p.set(x + 3, y + 3, MAT.moss[3]);
}

/** Montón de compost: tierra oscura con restos verdes y vapor. */
function compostPile(p: Pix, x: number, y: number, w: number, seed: number) {
  p.shadow(x + 1, y + 5, w, 1);
  p.ellipse(x + w / 2, y + 3, w / 2, 2.6, MAT.dirt[2]);
  p.ellipse(x + w / 2 - 1, y + 2.4, w / 2 - 1.5, 1.4, MAT.dirt[1]);
  for (let i = 0; i < w; i++) if (hash(i, seed, 7) > 0.6) p.set(x + i, y + 2 + Math.floor(hash(seed, i) * 3), hash(i, seed) > 0.5 ? 23 : MAT.dirt[3]);
}

/** Recinto de hormigón con valla metálica (todos los niveles). */
function cleanYard(p: Pix, seed: number, top: number) {
  p.rect(0, top, 32, 46 - top, CONCRETE[1]);
  p.dither(0, top, 32, 46 - top, CONCRETE[2], seed % 2);
  for (let i = 0; i < 18; i++) p.set(Math.floor(hash(i, seed, 2) * 32), top + Math.floor(hash(seed, i, 3) * (46 - top)), CONCRETE[3]);
  // Marcas amarillas en el suelo (circulación de coches).
  for (let x = 4; x < 28; x += 4) p.hline(x, 44, 2, MAT.yellow[1]);
  // Valla: postes y malla a los lados y delante (hueco de entrada en el centro).
  for (let y = top; y < 46; y += 4) {
    p.vline(0, y, 3, MAT.metal[2]);
    p.vline(31, y, 3, MAT.metal[2]);
  }
  for (const [x0, x1] of [[0, 11], [21, 32]] as const) {
    p.hline(x0, 42, x1 - x0, MAT.metal[2]);
    for (let x = x0; x < x1; x += 3) p.vline(x, 42, 4, MAT.metal[3]);
    p.dither(x0, 43, x1 - x0, 2, MAT.metal[1], 0);
  }
}

/** Nivel 1: nave de chapa, contenedores de colores y el camión aparcado. */
function cleanPoint(seed: number): Pix {
  const p = new Pix(T, BH);
  cleanYard(p, seed, 24);
  // Nave de chapa con portón enrollable.
  castShadow(p, 2, 10, 20, 17);
  flatRoof(p, 2, 8, 20, 5, MAT.metal, seed);
  facade(p, 3, 13, 18, 13, MAT.moss, 'metal', seed);
  p.rect(6, 17, 9, 9, MAT.metal[2]);
  for (let y = 18; y < 26; y += 2) p.hline(6, y, 9, MAT.metal[3]);
  p.hline(6, 17, 9, MAT.metal[0]);
  windowAt(p, 17, 17, 2, 3, { frame: MAT.metal[3] });
  // Rótulo blanco «PUNTO LIMPIO» (dos rayas) sobre el portón.
  p.rect(5, 14, 12, 2, 12);
  p.hline(6, 14, 4, MAT.moss[2]);
  p.hline(11, 15, 5, MAT.moss[2]);
  recycleSign(p, 23, 12, 10);
  // Contenedores: amarillo (envases), azul (papel), verde (vidrio) y marrón (orgánico).
  bin(p, 2, 32, MAT.yellow);
  bin(p, 9, 32, MAT.blue);
  bin(p, 16, 32, MAT.moss);
  bin(p, 23, 32, MAT.wood);
  return p;
}

/** Nivel 2 (reciclaje): más contenedores, iglús del vidrio y una prensa. */
function cleanPoint2(seed: number): Pix {
  const p = new Pix(T, BH);
  cleanYard(p, seed, 20);
  castShadow(p, 1, 6, 20, 16);
  flatRoof(p, 1, 4, 20, 5, MAT.metal, seed);
  facade(p, 2, 9, 18, 12, MAT.moss, 'metal', seed);
  p.rect(4, 13, 8, 8, MAT.metal[2]);
  for (let y = 14; y < 21; y += 2) p.hline(4, y, 8, MAT.metal[3]);
  p.rect(13, 10, 6, 2, 12);
  p.hline(14, 10, 4, MAT.moss[2]);
  windowAt(p, 15, 14, 3, 3, { frame: MAT.metal[3] });
  // Prensa de cartón: cajón gris con balas atadas.
  castShadow(p, 22, 14, 9, 8);
  p.rect(22, 14, 9, 8, MAT.metal[1]);
  p.hline(22, 14, 9, MAT.metal[0]);
  p.vline(30, 14, 8, MAT.metal[3]);
  for (const y of [16, 19]) {
    p.rect(23, y, 6, 2, MAT.wood[1]);
    p.hline(23, y, 6, MAT.wood[0]);
    p.set(25, y, MAT.wood[3]);
  }
  recycleSign(p, 24, 4, 9);
  bin(p, 2, 26, MAT.yellow);
  bin(p, 9, 26, MAT.yellow);
  bin(p, 16, 26, MAT.blue);
  bin(p, 23, 26, MAT.blue);
  igloo(p, 3, 34);
  igloo(p, 12, 34);
  bin(p, 22, 35, MAT.wood);
  return p;
}

/** Nivel 3 (compostaje): planta con montones de compost y sacos de abono. */
function cleanPoint3(seed: number): Pix {
  const p = cleanPoint2(seed);
  // Los montones de compost sustituyen a la mitad de los contenedores del frente.
  p.rect(1, 33, 30, 9, CONCRETE[1]);
  p.dither(1, 33, 30, 9, CONCRETE[2], 1);
  compostPile(p, 1, 34, 10, seed);
  compostPile(p, 12, 35, 9, seed + 1);
  // Sacos de abono apilados (verde con franja blanca).
  for (const [x, y] of [[23, 37], [27, 37], [25, 34]] as const) {
    p.rect(x, y, 4, 3, MAT.moss[2]);
    p.hline(x, y, 4, MAT.moss[1]);
    p.hline(x, y + 1, 4, 12);
  }
  // Vapor del compost (dos volutas).
  if (!nightLights) {
    p.set(5, 31, 12);
    p.set(6, 30, 31);
    p.set(16, 32, 12);
    p.set(15, 31, 31);
  }
  return p;
}

/** Bolsas de basura amontonadas (n = 1–3), 12×8. */
function trashBags(n: number): Pix {
  const p = new Pix(12, 8);
  const spots: [number, number, number][] = [
    [3, 5, 0],
    [8, 5, 1],
    [5.5, 2.6, 2],
  ];
  p.ellipse(6, 7, 6, 1, 24); // sombra
  for (const [x, y, k] of spots.slice(0, Math.max(1, Math.min(3, n)))) {
    const m: Mat = k === 1 ? [53, 55, 0, 0] : [55, 0, 0, 0];
    p.ellipse(x, y, 2.6, 2.2, m[1]);
    p.set(Math.floor(x) - 1, Math.floor(y) - 1, m[0]);
    p.set(Math.floor(x), Math.floor(y) - 2, MAT.yellow[1]); // nudo
  }
  return p;
}

/** Rata de 6×4 (2 fotogramas: la cola se mueve). */
function rat(frame: number, dir: 1 | -1): Pix {
  const p = new Pix(6, 4);
  const set = (x: number, y: number, c: number) => p.set(dir === 1 ? x : 5 - x, y, c);
  for (const [x, y] of [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [4, 2], [4, 1]] as const) set(x, y, 53);
  set(5, 2, 61); // hocico
  set(4, 0, 61); // oreja
  set(4, 1, 0); // ojo
  set(0, frame % 2 ? 1 : 2, 61); // cola
  set(1, 3, 55);
  set(3, 3, 55);
  return p;
}

/** Camión de la basura de 16×11 (2 fotogramas: ruedas y rotativo). */
function garbageTruck(frame: number, dir: 1 | -1): Pix {
  const p = new Pix(16, 11);
  const set = (x: number, y: number, c: number) => p.set(dir === 1 ? x : 15 - x, y, c);
  const rect = (x: number, y: number, w: number, h: number, c: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c);
  };
  rect(1, 10, 14, 1, 24); // sombra
  // Caja compactadora verde con franja blanca.
  rect(0, 2, 10, 6, MAT.moss[1]);
  rect(0, 2, 10, 1, MAT.moss[0]);
  rect(0, 5, 10, 1, 12);
  rect(0, 7, 10, 1, MAT.moss[3]);
  set(0, 3, MAT.moss[3]);
  set(0, 4, MAT.moss[3]);
  // Cabina blanca con luna azul.
  rect(10, 3, 5, 5, 12);
  rect(11, 4, 3, 2, MAT.glass[1]);
  set(13, 4, MAT.glass[0]);
  rect(10, 7, 6, 1, MAT.metal[2]);
  set(15, 6, MAT.yellow[1]); // faro
  // Rotativo naranja que parpadea.
  set(12, 2, frame % 2 ? 3 : 20);
  // Ruedas.
  for (const x of [2, 11]) {
    rect(x, 8, 3, 2, 0);
    set(x + 1, 8 + (frame % 2), MAT.metal[2]);
  }
  return p;
}

/** Farola de parque. */
function lampPost(p: Pix, x: number, y: number) {
  p.vline(x, y, 7, MAT.metal[3]);
  p.rect(x - 1, y - 2, 3, 2, nightLights ? C.lamp : MAT.yellow[0]);
  p.set(x, y - 3, MAT.metal[3]);
}

/** Césped cuidado del parque. */
function lawn(p: Pix, seed: number) {
  p.rect(0, 16, 32, 32, 5);
  p.dither(0, 16, 32, 32, 23, 0);
  for (let i = 0; i < 40; i++) p.set(Math.floor(hash(i, seed) * 32), 16 + Math.floor(hash(seed, i) * 32), 22);
}

/** Parterre con borde de seto y flores. */
function flowerBed(p: Pix, x: number, y: number, w: number, h: number, seed: number) {
  p.rect(x, y, w, h, MAT.leaf[2]);
  p.frame(x, y, w, h, MAT.leaf[3]);
  p.hline(x, y, w, MAT.leaf[1]);
  for (let j = y + 1; j < y + h - 1; j++) for (let i = x + 1; i < x + w - 1; i++) if ((i + j) % 2 === 0) p.set(i, j, [2, 4, 12, 61, 62][Math.floor(hash(i, j, seed) * 5)]!);
}

function park2(seed: number): Pix {
  const p = new Pix(T, BH);
  lawn(p, seed);
  // Paseos en cruz y glorieta de grava.
  p.rect(13, 16, 6, 32, MAT.stone[1]);
  p.rect(0, 29, 32, 6, MAT.stone[1]);
  p.ellipse(16, 32, 11, 7.5, MAT.stone[2]);
  p.ellipse(16, 32, 10, 6.5, MAT.stone[1]);
  for (let y = 16; y < 48; y++) for (let x = 0; x < 32; x++) if (p.get(x, y) === MAT.stone[1] && (x + y) % 2) p.set(x, y, MAT.stone[0]);
  // Fuente de dos tazas.
  p.ellipse(16, 33, 8, 5, MAT.stone[3]);
  p.ellipse(16, 32.5, 7.2, 4.3, MAT.stone[0]);
  p.ellipse(16, 33, 6, 3.4, MAT.blue[1]);
  p.ellipse(14.5, 32, 3, 1.4, MAT.blue[0]);
  p.rect(15, 28, 3, 5, MAT.stone[1]);
  p.vline(15, 28, 5, MAT.stone[0]);
  p.ellipse(16.5, 28, 3.5, 1.4, MAT.stone[0]);
  p.hline(14, 29, 6, MAT.stone[2]);
  p.vline(16, 24, 4, 11);
  p.set(15, 24, 31);
  p.set(17, 24, 31);
  for (const [x, y] of [[11, 31], [21, 31], [13, 35], [19, 35]] as const) p.set(x, y, 31);
  // Parterres en las esquinas, árboles, bancos y farolas.
  flowerBed(p, 1, 37, 10, 8, seed);
  flowerBed(p, 21, 37, 10, 8, seed + 1);
  tree(p, 6, 20, seed, 'round');
  tree(p, 26, 18, seed + 5, 'pine');
  p.rect(22, 25, 6, 2, MAT.wood[1]);
  p.hline(22, 24, 6, MAT.wood[2]);
  lampPost(p, 12, 21);
  lampPost(p, 20, 39);
  return p;
}

function park3(seed: number): Pix {
  const p = new Pix(T, BH);
  lawn(p, seed);
  // Estanque con surtidor, juncos y patos.
  p.ellipse(16, 36, 14, 8, MAT.dirt[0]);
  p.ellipse(16, 36, 13, 7, C.waterDeep);
  p.ellipse(15, 35, 11, 5.5, C.water);
  for (const [x, y] of [[7, 34], [20, 39], [24, 33], [11, 39]] as const) p.hline(x, y, 2, C.waterLight);
  p.ellipse(16, 32, 2.5, 1, MAT.stone[0]);
  p.vline(16, 27, 5, 11);
  p.set(15, 28, 31);
  p.set(17, 28, 31);
  for (const x of [3, 4, 28]) p.vline(x, 39, 3, MAT.moss[2]);
  p.set(4, 38, MAT.wood[3]);
  for (const [x, y] of [[8, 37], [22, 36]] as const) {
    p.rect(x, y, 3, 2, 12);
    p.set(x + 2, y - 1, 12);
    p.set(x + 3, y - 1, 4);
    p.hline(x, y + 2, 3, C.waterDeep);
  }
  // Quiosco de música con tejado a franjas.
  p.ellipse(7, 26, 6.5, 2.5, MAT.stone[3]);
  p.ellipse(7, 25.5, 6, 2, MAT.stone[0]);
  for (const x of [2, 5, 9, 12]) p.vline(x, 20, 6, 12);
  for (let j = 0; j < 6; j++) {
    const half = 1 + j * 1.2;
    for (let x = Math.round(7 - half); x <= Math.round(7 + half); x++) p.set(x, 14 + j, Math.floor((x + 20) / 2) % 2 ? MAT.red[1] : 12);
  }
  p.hline(0, 20, 15, MAT.red[2]);
  p.set(7, 13, 4);
  p.set(7, 25, nightLights ? C.lamp : MAT.stone[1]);
  // Árboles, banco y farolas.
  tree(p, 24, 19, seed + 3, 'round');
  tree(p, 29, 41, seed + 5, 'pine');
  p.rect(16, 21, 6, 2, MAT.wood[1]);
  p.hline(16, 20, 6, MAT.wood[2]);
  lampPost(p, 14, 21);
  lampPost(p, 2, 43);
  bush(p, 30, 27, 2.5, seed, true);
  return p;
}

function library2(seed: number): Pix {
  const p = library(seed);
  // Pórtico de columnas en el cuerpo central.
  p.rect(8, 23, 16, 21, MAT.cream[2]);
  p.hline(8, 23, 16, MAT.cream[3]);
  windowAt(p, 14, 26, 4, 6);
  doorAt(p, 14, 35, 4, 9, MAT.wood, MAT.stone[0]);
  if (nightLights) p.rect(15, 36, 2, 3, C.lampWarm);
  for (const x of [8, 11, 19, 22]) {
    p.rect(x, 24, 2, 20, 12);
    p.vline(x + 1, 24, 20, 13);
    p.hline(x - 1, 23, 4, 31);
    p.hline(x - 1, 44, 4, 13);
  }
  p.hline(7, 22, 18, 31);
  // Faroles a los lados de la escalinata.
  for (const x of [1, 30]) lampPost(p, x, 39);
  return p;
}

function library3(seed: number): Pix {
  const p = new Pix(T, BH);
  // Cúpula de cobre sobre un tambor con ventanas.
  const copper: Mat = [63, 7, 25, 26];
  p.ball(16, 8, 7, copper, seed);
  facade(p, 9, 8, 14, 6, MAT.cream, 'stone', seed);
  for (const x of [11, 15, 19]) {
    p.rect(x, 9, 2, 3, nightLights ? C.lampWarm : MAT.glass[2]);
    p.set(x, 9, nightLights ? C.lamp : MAT.glass[1]);
  }
  p.hline(8, 8, 16, MAT.stone[0]);
  p.rect(15, 0, 2, 2, 4);
  p.set(15, 0, 12);
  p.blit(library2(seed), 0, 0);
  // Estatuas en las esquinas del tejado.
  for (const x of [2, 28]) {
    p.rect(x, 10, 2, 3, MAT.stone[0]);
    p.set(x, 9, MAT.stone[0]);
    p.set(x + 1, 11, MAT.stone[2]);
  }
  return p;
}

function sports2(seed: number): Pix {
  const p = sports(seed);
  // Gradas al pie de la pista.
  p.rect(0, 43, 32, 5, MAT.stone[2]);
  for (let r = 0; r < 2; r++) {
    p.hline(1, 43 + r * 2, 30, MAT.stone[0]);
    for (let x = 1; x < 31; x++) if (x % 2) p.set(x, 44 + r * 2, r ? MAT.yellow[1] : MAT.red[1]);
  }
  p.hline(2, 42, 28, 12);
  // Torres de focos y marcador.
  floodlight(p, 1, 22, 43);
  floodlight(p, 30, 22, 43);
  p.rect(20, 8, 8, 4, 0);
  p.frame(20, 8, 8, 4, MAT.metal[2]);
  for (const x of [21, 22, 25, 26]) p.set(x, 9 + (x % 2), nightLights ? C.lamp : 4);
  p.set(23, 10, 12);
  return p;
}

function sports3(seed: number): Pix {
  const p = sports2(seed);
  // La canasta deja sitio a un ventanal: dentro está la piscina.
  facade(p, 1, 20, 30, 11, MAT.brick, 'brick', seed);
  p.hline(1, 20, 30, MAT.terracotta[2]);
  p.rect(3, 23, 7, 8, MAT.metal[3]);
  for (let y = 24; y < 31; y += 2) p.hline(4, y, 5, MAT.metal[2]);
  p.hline(3, 22, 7, MAT.metal[0]);
  windowAt(p, 13, 23, 7, 4, { frame: 12 });
  doorAt(p, 23, 24, 5, 6, MAT.glass, MAT.metal[2]);
  if (nightLights) p.rect(24, 24, 3, 5, C.lampWarm);
  // Piscina exterior con calles, trampolín y escalerilla.
  p.rect(0, 31, 32, 12, MAT.stone[0]);
  p.dither(0, 31, 32, 12, MAT.stone[1], 0);
  p.rect(3, 32, 26, 10, C.waterDeep);
  p.rect(4, 33, 24, 8, C.water);
  for (let x = 5; x < 27; x += 4) p.hline(x, 33 + (x % 3), 2, C.waterLight);
  for (const y of [35, 38]) for (let x = 3; x < 29; x++) p.set(x, y, x % 2 ? MAT.red[1] : 12);
  p.frame(2, 31, 28, 12, 12);
  p.rect(0, 36, 5, 1, 12);
  p.vline(1, 37, 2, MAT.metal[3]);
  p.vline(26, 31, 3, MAT.metal[1]);
  p.vline(28, 31, 3, MAT.metal[1]);
  p.set(27, 32, MAT.metal[1]);
  // Sombrilla y tumbona.
  p.vline(31, 31, 5, MAT.metal[3]);
  p.hline(29, 30, 3, MAT.red[1]);
  p.hline(30, 29, 2, 12);
  return p;
}

/** Edificio mejorado de cada servicio en los niveles 2 y 3. */
const UPGRADES: Record<string, readonly [() => Pix, () => Pix]> = {
  water: [() => waterTower2(3), () => waterPlant(3)],
  power: [() => powerPlant2(5), () => powerPlant3(5)],
  school: [() => school2(2), () => school3(2)],
  clinic: [() => clinic2(4), () => hospital(4)],
  police: [() => policeStation2(6), () => policeHQ(6)],
  jail: [() => jail2(17), () => jail3(17)],
  park: [() => park2(11), () => park3(11)],
  library: [() => library2(15), () => library3(15)],
  sports: [() => sports2(16), () => sports3(16)],
  firestation: [() => fireStation(18, 2), () => fireStation(18, 3)],
  cleanpoint: [() => cleanPoint2(18), () => cleanPoint3(18)],
  // 2.5: la cooperativa con su almazara o bodega (solo tiene nivel 2).
  coop: [() => coopPix(33, 2), () => coopPix(33, 2)],
};

/**
 * Sprite de 32×48 de un servicio según su nivel (1–3). El nivel 1 es el de
 * `buildingSprite`; el 2 y el 3, el mismo edificio ampliado.
 */
export function serviceSprite(kind: string, id: number, level: number, tod: TimeOfDay = 'day', snow = false): HTMLCanvasElement {
  const lv = Math.max(1, Math.min(3, Math.floor(level) || 1));
  const make = lv > 1 ? UPGRADES[kind]?.[lv - 2] : undefined;
  if (!make) return buildingSprite(kind, id, tod, snow);
  const key = `${kind}-lv${lv}`;
  return snow ? sprite(`snow-${key}`, () => snowify(make()), tod) : sprite(key, make, tod);
}

/** Árbol: copa redonda o pino, con tronco y sombra. */
function tree(p: Pix, x: number, y: number, seed: number, kind: 'round' | 'pine') {
  p.ellipse(x + 3, y + 13, 6, 2, 24);
  p.rect(x - 1, y + 4, 2, 10, MAT.wood[2]);
  p.vline(x - 1, y + 4, 10, MAT.wood[1]);
  if (kind === 'pine') {
    for (let k = 0; k < 3; k++) {
      const yy = y - 8 + k * 5;
      for (let j = 0; j < 7; j++) {
        const half = 1 + j + k;
        for (let i = -half; i <= half; i++) p.set(x + i, yy + j, i < -half / 3 ? MAT.pine[0] : i < half / 2 ? MAT.pine[1] : MAT.pine[2]);
      }
    }
  } else {
    p.ball(x + 2, y + 1, 5, MAT.leaf, seed);
    p.ball(x - 3, y - 1, 4.5, MAT.leaf, seed + 1);
    p.ball(x, y - 5, 5, MAT.leaf, seed + 2);
  }
}

export function treeTile(seed: number): Pix {
  const p = new Pix(T, BH);
  const n = 1 + Math.floor(hash(seed, 1) * 2);
  for (let i = 0; i < n; i++) {
    const tx = 8 + Math.floor(hash(seed, i, 7) * 16);
    const ty = 22 + Math.floor(hash(i, seed, 9) * 12);
    tree(p, tx, ty, seed + i * 11, hash(seed, i) > 0.65 ? 'pine' : 'round');
  }
  if (hash(seed, 5) > 0.5) bush(p, 4 + Math.floor(hash(seed, 6) * 24), 44, 2.5, seed, hash(seed, 8) > 0.6);
  return p;
}

/** Obra en tres fases según el progreso. */
function construction(stage: number, seed: number): Pix {
  const p = new Pix(T, BH);
  p.rect(2, 30, 28, 16, MAT.dirt[2]);
  p.dither(2, 30, 28, 16, MAT.dirt[1], seed % 2);
  for (let i = 0; i < 30; i++) p.set(2 + Math.floor(hash(i, seed) * 28), 30 + Math.floor(hash(seed, i) * 16), MAT.dirt[3]);
  p.frame(2, 30, 28, 16, MAT.dirt[3]);
  if (stage >= 1) facade(p, 5, 28 - stage * 6, 22, 16 + stage * 6, MAT.brick, 'brick', seed);
  if (stage >= 1) for (let x = 7; x < 26; x += 6) p.rect(x, 33 - stage * 3, 3, 4, MAT.stone[3]);
  // Andamio.
  const top = stage >= 1 ? 22 - stage * 6 : 30;
  for (const x of [3, 15, 28]) p.vline(x, top, 46 - top, MAT.yellow[2]);
  for (let y = top + 2; y < 46; y += 6) {
    p.hline(3, y, 26, MAT.wood[1]);
    p.hline(3, y + 1, 26, MAT.wood[3]);
  }
  for (let i = 0; i < 10; i++) p.set(4 + i, 45 - i, MAT.yellow[3]);
  // Material y obreros.
  p.rect(22, 41, 6, 4, MAT.brick[1]);
  p.hline(22, 41, 6, MAT.brick[0]);
  p.ellipse(8, 44, 4, 2, MAT.stone[0]);
  person(p, 10, 38 - (stage ? 0 : 0), 9, 4);
  if (stage >= 1) person(p, 20, top - 7, 3, 4);
  if (stage >= 2) {
    // Cerchas del tejado.
    for (let i = 0; i < 12; i++) {
      p.set(5 + i, 10 - Math.floor(i / 2), MAT.wood[2]);
      p.set(27 - i, 10 - Math.floor(i / 2), MAT.wood[2]);
    }
    p.hline(5, 10, 23, MAT.wood[2]);
  }
  return p;
}

/* ============================ suelo ============================ */

/** Ruido de valor suavizado y continuo entre casillas (coordenadas globales). */
function smooth(x: number, y: number, cell: number, seed: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = (x / cell) - gx;
  const fy = (y / cell) - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(gx, gy, seed);
  const b = hash(gx + 1, gy, seed);
  const c = hash(gx, gy + 1, seed);
  const d = hash(gx + 1, gy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Hierba de la casilla (tx, ty): matas orgánicas que continúan entre casillas. */
export function grassTile(v: number, tx = v, ty = v * 7): Pix {
  const p = new Pix(T, T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const gx = tx * T + x;
      const gy = ty * T + y;
      const n = smooth(gx, gy, 11, 5) * 0.75 + smooth(gx, gy, 4, 9) * 0.25;
      // Pocas manchas y suaves: la hierba no debe competir con los edificios.
      p.set(x, y, n > 0.82 ? 22 : n < 0.13 ? 24 : 23);
    }
  }
  // Briznas: trazo claro arriba y sombra abajo.
  for (let i = 0; i < 7; i++) {
    const x = 1 + Math.floor(hash(i, v, 3) * 29);
    const y = 1 + Math.floor(hash(v, i, 4) * 28);
    p.set(x, y, 22);
    p.set(x + 1, y + 1, 22);
    p.set(x, y + 1, 24);
  }
  if (v % 4 === 0) {
    const fx = 4 + Math.floor(hash(v, 9) * 22);
    const fy = 4 + Math.floor(hash(9, v) * 22);
    const col = [12, 4, 2][v % 3]!;
    p.set(fx, fy, col);
    p.set(fx + 3, fy + 2, col);
    p.set(fx + 1, fy + 4, 4);
  }
  return p;
}

/** Carretera con aceras, bordillo y marcas según las conexiones (N, E, S, O). */
export function roadTile(n: boolean, e: boolean, s: boolean, w: boolean, v: number): Pix {
  const p = new Pix(T, T);
  const SW = 5; // acera
  p.rect(0, 0, T, T, MAT.stone[1]);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if ((x % 8 === 0 || y % 8 === 0) && hash(x, y) > 0.3) p.set(x, y, MAT.stone[2]);
  const x0 = w ? 0 : SW;
  const x1 = e ? T : T - SW;
  const y0 = n ? 0 : SW;
  const y1 = s ? T : T - SW;
  // Asfalto: zona central + brazos.
  const asphalt = (ax: number, ay: number, aw: number, ah: number) => {
    for (let y = ay; y < ay + ah; y++) {
      for (let x = ax; x < ax + aw; x++) {
        const r = hash(x, y, v);
        p.set(x, y, r > 0.92 ? 14 : r < 0.06 ? 26 : 15);
      }
    }
  };
  asphalt(SW, SW, T - 2 * SW, T - 2 * SW);
  if (n) asphalt(SW, 0, T - 2 * SW, SW);
  if (s) asphalt(SW, T - SW, T - 2 * SW, SW);
  if (w) asphalt(0, SW, SW, T - 2 * SW);
  if (e) asphalt(T - SW, SW, SW, T - 2 * SW);
  // Bordillos.
  const curb = MAT.stone[3];
  if (!n) p.hline(x0, SW, x1 - x0, curb);
  if (!s) p.hline(x0, T - SW - 1, x1 - x0, curb);
  if (!w) p.vline(SW, y0, y1 - y0, curb);
  if (!e) p.vline(T - SW - 1, y0, y1 - y0, curb);
  for (const [cx, cy, on] of [
    [SW - 1, SW - 1, n && w],
    [T - SW, SW - 1, n && e],
    [SW - 1, T - SW, s && w],
    [T - SW, T - SW, s && e],
  ] as const) {
    if (on) p.set(cx, cy, curb);
  }
  if (n && !w) p.vline(SW, 0, SW, curb);
  if (n && !e) p.vline(T - SW - 1, 0, SW, curb);
  if (s && !w) p.vline(SW, T - SW, SW, curb);
  if (s && !e) p.vline(T - SW - 1, T - SW, SW, curb);
  if (w && !n) p.hline(0, SW, SW, curb);
  if (w && !s) p.hline(0, T - SW - 1, SW, curb);
  if (e && !n) p.hline(T - SW, SW, SW, curb);
  if (e && !s) p.hline(T - SW, T - SW - 1, SW, curb);
  // Marcas viales.
  const links = [n, e, s, w].filter(Boolean).length;
  if (links <= 2 && (e || w) && !n && !s) for (let x = 2; x < T; x += 8) p.rect(x, 15, 4, 2, 30);
  else if (links <= 2 && (n || s) && !e && !w) for (let y = 2; y < T; y += 8) p.rect(15, y, 2, 4, 30);
  else if (links >= 3) {
    // Pasos de cebra en los accesos.
    if (n) for (let x = SW + 1; x < T - SW - 1; x += 3) p.rect(x, 1, 2, 3, 12);
    if (s) for (let x = SW + 1; x < T - SW - 1; x += 3) p.rect(x, T - 4, 2, 3, 12);
    if (w) for (let y = SW + 1; y < T - SW - 1; y += 3) p.rect(1, y, 3, 2, 12);
    if (e) for (let y = SW + 1; y < T - SW - 1; y += 3) p.rect(T - 4, y, 3, 2, 12);
  }
  // Farola en la acera.
  if (!n && v % 3 === 0) {
    p.vline(T - 3, 0, 4, MAT.metal[3]);
    p.set(T - 3, 0, 4);
  }
  return p;
}

/* ====================== geografía y estaciones (v1.7) ====================== */

/**
 * Distancia (en px) a la tierra más cercana dentro de una casilla de agua,
 * con las esquinas exteriores redondeadas. `side` dice qué orilla manda:
 * 0 N, 1 E, 2 S, 3 O, −1 si no hay tierra.
 */
function shoreDist(x: number, y: number, land: readonly boolean[], R: number): { d: number; side: number } {
  const dist = [y + 0.5, T - x - 0.5, T - y - 0.5, x + 0.5];
  let d = Infinity;
  let side = -1;
  for (let k = 0; k < 4; k++) {
    if (land[k] && dist[k]! < d) {
      d = dist[k]!;
      side = k;
    }
  }
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
    if (!land[a] || !land[b] || dist[a]! >= R || dist[b]! >= R) continue;
    const dc = R - Math.hypot(R - dist[a]!, R - dist[b]!);
    if (dc < d) d = dc;
  }
  return { d, side };
}

/** Ondulación de la orilla: nula en los bordes de la casilla para que encajen. */
function shoreWobble(x: number, y: number, v: number, amp: number): number {
  const taper = Math.min(1, Math.min(x, T - 1 - x, y, T - 1 - y) / 7);
  return (smooth(x + v * 13, y + v * 7, 6, 31) - 0.5) * 2 * amp * taper;
}

/** Hierba de orilla (casi igual que grassTile para que no se note la costura). */
function bankGrass(x: number, y: number, v: number): number {
  const r = hash(x, y, v, 41);
  return r > 0.9 ? 22 : r < 0.06 ? 24 : 23;
}

function liquidTile(land: readonly boolean[], v: number, frame: 0 | 1, sea: boolean): Pix {
  const p = new Pix(T, T);
  const deep = sea ? [49, 50, 8] : [48, 49, 50];
  const vertical = !land[0] && !land[2] ? false : land[1] === false && land[3] === false;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const { d: d0, side } = shoreDist(x, y, land, 9);
      const d = d0 + shoreWobble(x, y, v, 1.6);
      const grass = sea ? 2 : 3;
      let c: number;
      if (d < grass) c = bankGrass(x, y, v);
      else if (sea) {
        // Playa: arena, arena mojada, espuma (avanza y retrocede) y bajío.
        const foam = grass + 5 - frame;
        if (d < grass + 1) c = side === 0 ? MAT.dirt[2] : 45;
        else if (d < foam - 1) c = hash(x, y, v, 5) > 0.88 ? (hash(y, x) > 0.5 ? 30 : 21) : (x + y) % 2 && d < grass + 2 ? 21 : 45;
        else if (d < foam) c = 46;
        else if (d < foam + 1) c = (x + frame) % 3 ? 12 : 31;
        else if (d < foam + 2) c = (x + y + frame) % 2 ? 31 : 48;
        else if (d < foam + 5) c = (x + y) % 2 ? 10 : 49;
        else c = deep[1]!;
      } else if (side === 0) {
        // Orilla norte: se ve el talud de tierra y su sombra en el agua.
        if (d < grass + 1) c = 22;
        else if (d < grass + 2) c = hash(x, 3, v) > 0.7 ? 29 : MAT.dirt[1];
        else if (d < grass + 3) c = hash(x, 4, v) > 0.75 ? 28 : MAT.dirt[2];
        else if (d < grass + 4) c = 50;
        else if (d < grass + 5) c = (x + y) % 2 ? 49 : 50;
        else c = deep[1]!;
      } else {
        // Orilla sur, este u oeste: arena con guijarros y agua somera.
        if (d < grass + 1) c = hash(x, y, v, 6) > 0.8 ? 30 : 45;
        else if (d < grass + 2) c = hash(x, y, v, 7) > 0.7 ? 29 : 46;
        else if (d < grass + 3) c = 10;
        else if (d < grass + 4) c = (x + y) % 2 ? 10 : 49;
        else c = deep[1]!;
      }
      // Pozas profundas en el centro del cauce.
      const inner = Math.min(x, y, T - 1 - x, T - 1 - y) >= 4;
      if (inner && c === deep[1] && d > (sea ? 10 : 8) && smooth(x + v * 5, y + v * 3, 7, sea ? 12 : 13) > 0.55 && (x + y) % 2 === 0) c = deep[2]!;
      p.set(x, y, c);
    }
  }
  // Ondas y destellos que se desplazan entre fotogramas (en el sentido de la corriente).
  const shift = frame * 2;
  for (let gy = 0; gy < 5; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const h1 = hash(gx, gy, v, 17);
      const ox = gx * 8 + Math.floor(h1 * 5) + (vertical ? 0 : shift);
      const oy = gy * 7 + Math.floor(hash(gy, gx, v) * 4) + 1 + (vertical ? shift : 0);
      const len = 2 + Math.floor(hash(gx, gy, 3) * 3);
      for (let i = 0; i < len; i++) {
        const x = (ox + i) % T;
        const y = oy % T;
        const cur = p.get(x, y);
        if (cur !== deep[1] && cur !== deep[2]) continue;
        p.set(x, y, i === 0 ? deep[0]! : sea ? 49 : 10);
        if (p.get(x, y + 1) === deep[1] && i > 0) p.set(x, y + 1, deep[2]!);
      }
      if (hash(gx, gy, v, frame + 21) > 0.7) {
        const x = (gx * 8 + 3 + Math.floor(hash(gy, gx, frame) * 4)) % T;
        const y = (gy * 7 + 4) % T;
        if (p.get(x, y) === deep[1]) p.set(x, y, 31);
      }
    }
  }
  return p;
}

/** Agua de río (n, e, s, w: el vecino de ese lado también es agua). Dos fotogramas. */
export function waterTile(n: boolean, e: boolean, s: boolean, w: boolean, v: number, frame: 0 | 1): Pix {
  return liquidTile([!n, !e, !s, !w], v, frame, false);
}

/** Mar: más hondo y oscuro, con playa y espuma en la orilla. Dos fotogramas. */
export function seaTile(n: boolean, e: boolean, s: boolean, w: boolean, v: number, frame: 0 | 1): Pix {
  return liquidTile([!n, !e, !s, !w], v, frame, true);
}

/** Colina: hierba alta y oscura con relieve y rocas; talud hacia lo que no es colina. */
export function hillTile(v: number, n: boolean, e: boolean, s: boolean, w: boolean): Pix {
  const p = new Pix(T, T);
  // Base: hierba oscura con manchas suaves.
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const k = smooth(x + v * 11, y + v * 5, 7, 23);
      p.set(x, y, k > 0.72 ? ((x + y) % 2 ? 41 : 42) : k < 0.25 ? ((x + y) % 2 ? 43 : 42) : 42);
    }
  }
  // Lomas: montículos redondos con luz arriba a la izquierda.
  const bumps = 1 + (hash(v, 9) > 0.5 ? 1 : 0);
  for (let b = 0; b < bumps; b++) {
    const cx = 9 + hash(v, b, 1) * 14;
    const cy = 9 + hash(v, b, 2) * 12;
    const rx = 6 + hash(v, b, 3) * 3;
    const ry = rx * 0.7;
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const l = -(dx + dy * 1.2);
        let c = 42;
        if (l > 0.75) c = 40;
        else if (l > 0.35) c = 41;
        else if (l > 0.05) c = (x + y) % 2 ? 41 : 42;
        else if (l < -0.85) c = 43;
        else if (l < -0.45) c = (x + y) % 2 ? 43 : 42;
        if (d > 0.82 && l < -0.2) c = 43;
        p.set(x, y, c);
      }
    }
  }
  // Matas altas: brizna clara arriba, sombra abajo.
  for (let i = 0; i < 9; i++) {
    const x = 2 + Math.floor(hash(i, v, 31) * 27);
    const y = 2 + Math.floor(hash(v, i, 32) * 22);
    p.set(x, y, 40);
    p.set(x - 1, y + 1, 41);
    p.set(x + 1, y + 1, 41);
    p.set(x, y + 1, 42);
    p.set(x, y + 2, 44);
    p.set(x + 1, y + 2, 43);
  }
  // Rocas sueltas.
  const rocks = v % 3;
  for (let i = 0; i < rocks; i++) {
    const x = 4 + Math.floor(hash(i, v, 33) * 22);
    const y = 4 + Math.floor(hash(v, i, 34) * 16);
    const w2 = 3 + (hash(i, v, 35) > 0.5 ? 1 : 0);
    p.rect(x, y, w2, 2, 29);
    p.hline(x + 1, y - 1, w2 - 2, 30);
    p.set(x, y, 30);
    p.hline(x + 1, y + 1, w2 - 1, 28);
    p.set(x + w2 - 1, y, 28);
    p.hline(x, y + 2, w2 + 1, 44);
  }
  // Bordes hacia el llano.
  const wob = (k: number) => Math.round((smooth(k + v * 9, v, 5, 37) - 0.5) * 2 * Math.min(1, Math.min(k, T - 1 - k) / 6));
  if (!n) {
    for (let x = 0; x < T; x++) {
      p.set(x, 0, 43);
      p.set(x, 1, 40);
      p.set(x, 2, hash(x, v, 38) > 0.5 ? 41 : 42);
    }
  }
  if (!w) {
    for (let y = 0; y < T; y++) {
      p.set(0, y, 43);
      p.set(1, y, 40);
      p.set(2, y, hash(y, v, 39) > 0.5 ? 41 : 42);
    }
  }
  if (!e) {
    for (let y = 0; y < T; y++) {
      const k = 3 + wob(y);
      for (let i = 0; i <= k; i++) p.set(T - 1 - i, y, i === 0 ? 44 : i === k ? ((y % 2) ? 43 : 42) : i === 1 ? 44 : 43);
    }
  }
  if (!s) {
    // Talud: borde de hierba que cuelga sobre una cara de tierra en sombra.
    for (let x = 0; x < T; x++) {
      const top = 23 + wob(x);
      p.set(x, top - 1, 40);
      for (let y = top; y < T; y++) {
        const t = y - top;
        let c: number;
        if (t === 0) c = 42;
        else if (t === 1) c = 43;
        else if (t === 2) c = hash(x, v, 41) > 0.45 ? 44 : 47;
        else if (t === 3 && hash(x, v, 42) > 0.6) c = 44;
        else c = hash(x, y, v, 2) > 0.78 ? 46 : hash(y, x, v) > 0.88 ? 28 : 47;
        if (!e && x > T - 4 - (y - top) / 3) c = y % 2 ? 47 : 44;
        if (y === T - 1) c = 44;
        p.set(x, y, c);
      }
    }
  }
  return p;
}

/** Puente: tablero con pretiles de piedra; transparente donde se ve el agua. */
export function bridgeTile(horizontal: boolean, v: number): Pix {
  const p = new Pix(T, T);
  // (a, b): a recorre el puente, b lo cruza. Se dibuja igual en los dos sentidos.
  const set = (a: number, b: number, c: number) => (horizontal ? p.set(a, b, c) : p.set(b, a, c));
  for (let a = 0; a < T; a++) {
    for (let b = 5; b < 27; b++) {
      const r = hash(a, b, v);
      set(a, b, r > 0.92 ? 14 : r < 0.06 ? 26 : 15);
    }
    if (a % 8 >= 2 && a % 8 < 6) for (const b of [15, 16]) set(a, b, 30);
    if (a === 0) for (let b = 6; b < 26; b++) set(a, b, b % 2 ? 14 : 26); // junta de dilatación
    // Pretil de arriba/izquierda: albardilla con luz, sombra sobre el tablero.
    set(a, 2, MAT.stone[0]);
    set(a, 3, a % 5 === 0 ? MAT.stone[2] : MAT.stone[1]);
    set(a, 4, MAT.stone[2]);
    set(a, 5, 26);
    // Pretil de abajo/derecha y canto del tablero.
    set(a, 26, MAT.stone[0]);
    set(a, 27, (a + 2) % 5 === 0 || hash(a, v, 9) > 0.9 ? MAT.stone[2] : MAT.stone[1]);
    set(a, 28, MAT.stone[2]);
    set(a, 29, (a + v) % 4 === 0 ? MAT.stone[2] : MAT.stone[3]);
    set(a, 30, MAT.stone[3]);
    set(a, 31, 50); // sombra sobre el agua
  }
  // Postes cada 8 px: cara superior clara y canto sombreado.
  for (let a = 3; a < T; a += 8) {
    for (const b of [1, 25]) {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) set(a + i, b + j, MAT.stone[1]);
      for (let i = 0; i < 3; i++) set(a + i, b, MAT.stone[0]);
      set(a, b + 1, MAT.stone[0]);
      for (let i = 0; i < 3; i++) set(a + i, b + 2, MAT.stone[3]);
    }
  }
  if (!horizontal) {
    // De norte a sur la cara visible de los postes es la de abajo.
    for (let a = 3; a < T; a += 8) for (const b of [1, 25]) for (let i = 0; i < 3; i++) p.set(b + i, a + 2, MAT.stone[3]);
  }
  return p;
}

const SNOW: Record<number, number> = {
  22: 12, 5: 12, 40: 12, 41: 12, 23: 31, 42: 31, 6: 31, 24: 54, 43: 54, 25: 13, 44: 13, 47: 13, 46: 54,
};

/** Hierba nevada: blanco y gris claro con algo de verde asomando. */
export function snowGrass(base: Pix, v: number): Pix {
  const p = new Pix(base.w, base.h);
  for (let y = 0; y < base.h; y++) {
    for (let x = 0; x < base.w; x++) {
      const c = base.get(x, y);
      if (c === NONE) continue;
      const s0 = SNOW[c];
      if (s0 === undefined) {
        p.set(x, y, c);
        continue;
      }
      // Ventisqueros: sombras suaves de la nieve acumulada.
      const drift = smooth(x + v * 17, y + v * 3, 9, 61);
      const r = hash(x, y, v, 53);
      let s = drift > 0.66 ? 12 : drift < 0.3 ? ((x + y) % 2 ? 54 : 31) : 31;
      if (s0 === 54 || s0 === 13) s = drift < 0.45 ? 54 : 31;
      if ((c === 24 || c === 43 || c === 44) && r > 0.9) s = c; // matas que asoman
      else if ((c === 22 || c === 23) && r > 0.985) s = 23;
      p.set(x, y, s);
    }
  }
  // Briznas que asoman en grupos de dos.
  for (let i = 0; i < 3; i++) {
    const x = 2 + Math.floor(hash(i, v, 54) * 27);
    const y = 2 + Math.floor(hash(v, i, 55) * 27);
    if (SNOW[base.get(x, y)] !== undefined) {
      p.set(x, y, 24);
      p.set(x + 1, y - 1, 23);
      p.set(x, y + 1, 54);
    }
  }
  return p;
}

/** Cubre de nieve los tejados y lo alto de un sprite (invierno). */
export function snowify(src: Pix): Pix {
  const p = new Pix(src.w, src.h);
  p.data.set(src.data);
  for (let x = 0; x < src.w; x++) {
    for (let y = 0; y < src.h; y++) {
      const top = src.get(x, y);
      if (top === NONE || src.get(x, y - 1) !== NONE) continue;
      if ((top === 24 || top === 25) && y >= src.h - 20) continue; // sombras en el suelo
      // Capa de 3–5 px que se deshace por abajo, con su sombra.
      const depth = 3 + Math.floor(hash(x, y, 71) * 2.2) + (hash(x >> 2, y, 72) > 0.5 ? 1 : 0);
      for (let k = 0; k <= depth; k++) {
        const c = src.get(x, y + k);
        if (c === NONE || LIGHTS.has(c)) break;
        if (k === depth) {
          if ((x + y) % 2 === 0) p.set(x, y + k, 54);
        } else p.set(x, y + k, k === 0 ? 31 : k === depth - 1 ? 54 : 12);
      }
    }
  }
  return p;
}

/** Solar recalificado: tramado del color de la zona, borde y cartel con la letra. */
export function zoneTile(zone: 'R' | 'C' | 'I' | 'A', base: Pix): Pix {
  const color = ZONE_COLOR[zone];
  const p = new Pix(T, T);
  p.blit(base, 0, 0);
  for (let y = 0; y < T; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < T; x += 4) p.set(x, y, color);
  for (let i = 0; i < T; i += 4) {
    p.hline(i, 0, 2, color);
    p.hline(i, T - 1, 2, color);
    p.vline(0, i, 2, color);
    p.vline(T - 1, i, 2, color);
  }
  // Cartel.
  p.vline(16, 16, 10, MAT.wood[2]);
  p.rect(10, 7, 13, 11, MAT.wood[3]);
  p.rect(11, 8, 11, 9, color);
  p.blit(letter(zone, 0), 14, 9);
  p.shadow(17, 26, 3, 1);
  return p;
}

/** Color de cada zona (2.2: A, tierra de labor). */
export const ZONE_COLOR = { R: 6, C: 10, I: 4, A: 46 } as const;

const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
};

export function letter(ch: 'R' | 'C' | 'I' | 'A', color: number): Pix {
  const rows = FONT[ch]!;
  const p = new Pix(5, 7);
  rows.forEach((r, y) => [...r].forEach((c, x) => c === '#' && p.set(x, y, color)));
  return p;
}

/* ============================ iconos ============================ */

function iconNoWater(): Pix {
  const p = new Pix(11, 13);
  p.rect(0, 0, 11, 13, 0);
  p.rect(1, 1, 9, 11, 12);
  for (let j = 0; j < 9; j++) {
    const half = j < 4 ? Math.floor(j / 1.5) : j < 7 ? 3 : 2 - (j - 7);
    for (let i = -half; i <= half; i++) p.set(5 + i, 2 + j, i < 0 && j > 3 ? 11 : 10);
  }
  for (let i = 0; i < 9; i++) p.set(1 + i, 11 - i, 2);
  return p;
}

function iconNoPower(): Pix {
  const p = new Pix(11, 13);
  p.rect(0, 0, 11, 13, 0);
  p.rect(1, 1, 9, 11, 12);
  const bolt = ['...##', '..##.', '.##..', '#####', '..##.', '.##..', '##...'];
  bolt.forEach((r, y) => [...r].forEach((c, x) => c === '#' && p.set(3 + x, 3 + y, 20)));
  for (let i = 0; i < 9; i++) p.set(1 + i, 11 - i, 2);
  return p;
}

/** Icono de la app (64×64): el ayuntamiento sobre un prado, con margen para iconos «maskable». */
export function iconPix(): Pix {
  const p = new Pix(64, 64);
  p.rect(0, 0, 64, 64, 0);
  p.ellipse(32, 52, 26, 9, 23);
  p.ellipse(32, 51, 24, 7, 22);
  p.blit(townhall(), 16, 6);
  return p;
}

/** RGBA de un Pix (para exportar PNG en el build). */
export function pixRGBA(p: Pix, scale = 1): Uint8Array {
  const W = p.w * scale;
  const out = new Uint8Array(W * p.h * scale * 4);
  for (let y = 0; y < p.h * scale; y++) {
    for (let x = 0; x < W; x++) {
      const idx = p.data[Math.floor(y / scale) * p.w + Math.floor(x / scale)]!;
      const o = (y * W + x) * 4;
      if (idx === NONE) continue;
      const [r, g, b] = RGB[idx]!;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

/* ============================ caché ============================ */

/** Momento del día: el arte se recolorea con tonos de la misma paleta. */
export type TimeOfDay = 'day' | 'dusk' | 'night';

const RGB = PALETTE.map((hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] as const);
/** Luces: no se oscurecen nunca. */
const LIGHTS = new Set<number>([C.lamp, C.lampWarm]);

function nearest(r: number, g: number, b: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < RGB.length; i++) {
    if (LIGHTS.has(i)) continue;
    const [R, G, B] = RGB[i]!;
    const d = (r - R) ** 2 * 0.3 + (g - G) ** 2 * 0.59 + (b - B) ** 2 * 0.11;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Tabla índice → índice para cada momento del día (siempre dentro de la paleta). */
const REMAP: Record<TimeOfDay, number[]> = {
  day: RGB.map((_, i) => i),
  dusk: RGB.map(([r, g, b], i) => (LIGHTS.has(i) ? i : nearest(r * 0.9 + 10, g * 0.8 + 2, b * 0.72 + 12))),
  night: RGB.map(([r, g, b], i) => (LIGHTS.has(i) ? i : nearest(r * 0.34 + 8, g * 0.44 + 8, b * 0.6 + 28))),
};

const cache = new Map<string, HTMLCanvasElement>();

export function toCanvas(p: Pix, tod: TimeOfDay = 'day'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = p.w;
  c.height = p.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(p.w, p.h);
  const map = REMAP[tod];
  for (let i = 0; i < p.data.length; i++) {
    const idx = p.data[i]!;
    if (idx === NONE) continue;
    const [r, g, b] = RGB[map[idx]!]!;
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Color RGBA empaquetado (Uint32) de cada índice, por momento del día. */
const PACKED: Record<TimeOfDay, Uint32Array> = {
  day: packed('day'),
  dusk: packed('dusk'),
  night: packed('night'),
};
function packed(tod: TimeOfDay): Uint32Array {
  // Los 4 bytes en orden RGBA leídos como Uint32 de la plataforma (vale con cualquier endianness).
  const bytes = new Uint8Array(REMAP[tod].length * 4);
  REMAP[tod].forEach((c, i) => bytes.set([...RGB[c]!, 255], i * 4));
  return new Uint32Array(bytes.buffer);
}
/** Un ImageData por tamaño, reutilizado (2.5.1: crear uno por casilla daba tirones y basura al repintar el suelo). */
const scratch = new Map<number, { img: ImageData; px: Uint32Array }>();

/** Pinta un Pix opaco directamente en un contexto (sin canvas intermedio). */
export function putPix(ctx: CanvasRenderingContext2D, p: Pix, dx: number, dy: number, tod: TimeOfDay = 'day'): void {
  const k = p.w * 65536 + p.h;
  let s = scratch.get(k);
  if (!s) {
    const img = ctx.createImageData(p.w, p.h);
    s = { img, px: new Uint32Array(img.data.buffer) };
    scratch.set(k, s);
  }
  const map = PACKED[tod];
  const { px } = s;
  const d = p.data;
  for (let i = 0; i < d.length; i++) {
    const idx = d[i]!;
    // putImageData copia tal cual: lo transparente (NONE) queda transparente, como con un ImageData nuevo.
    px[i] = idx === NONE ? 0 : map[idx]!;
  }
  ctx.putImageData(s.img, dx, dy);
}

export function sprite(key: string, make: () => Pix, tod: TimeOfDay = 'day'): HTMLCanvasElement {
  const k = `${key}@${tod}`;
  let c = cache.get(k);
  if (!c) {
    nightLights = tod === 'night';
    try {
      c = toCanvas(make(), tod);
    } finally {
      nightLights = false;
    }
    cache.set(k, c);
  }
  return c;
}

/** Clave de caché y generador de cada edificio (null: no es un edificio conocido). */
function buildingSpec(kind: string, id: number, rank = VILLA_RANK): [string, () => Pix] | null {
  // 2.1: las viviendas cambian de tejado con el rango del pueblo (otra entrada de la caché).
  const r = rank === VILLA_RANK ? '' : `r${rank}`;
  switch (kind) {
    case 'townhall':
      return ['townhall', townhall];
    case 'water':
      return ['water', () => waterTower(3)];
    case 'power':
      return ['power', () => powerPlant(5)];
    case 'park':
      return ['park', () => park(11)];
    case 'school':
      return ['school', () => school(2)];
    case 'clinic':
      return ['clinic', () => clinic(4)];
    case 'police':
      return ['police', () => policeStation(6)];
    case 'plaza':
      return ['plaza', () => plaza(8)];
    case 'market':
      return ['market', () => market(9)];
    case 'bar':
      return ['bar', () => bar(12)];
    case 'chapel':
      return ['chapel', () => chapel(13)];
    case 'cemetery':
      return ['cemetery', () => cemetery(14)];
    case 'library':
      return ['library', () => library(15)];
    case 'sports':
      return ['sports', () => sports(16)];
    case 'jail':
      return ['jail', () => jail(17)];
    // 2.1: emergencias.
    case 'firestation':
      return ['firestation', () => fireStation(18, 1)];
    case 'civilprotection':
      return ['civilprotection', () => civilPost(19)];
    case 'dike':
      return ['dike-tool', () => {
        const p = new Pix(T, BH);
        p.blit(dikePix(), 0, 16);
        return p;
      }];
    case 'cleanpoint':
      return ['cleanpoint', () => cleanPoint(18)];
    // 2.3: el patrimonio (en el mapa, render usa heritageSprite con su forma; aquí, el rollo).
    case 'heritage':
      return ['heritage-rollo', rollo];
    // 2.4 «Vida».
    case 'nursery':
      return ['nursery', () => nurseryPix(27)];
    case 'residence':
      return ['residence', () => residencePix(28)];
    case 'busstation':
      return ['busstation', () => busStationPix(29)];
    // 2.5: vivienda protegida.
    case 'vpo':
      return ['vpo', () => vpoPix(32)];
    case 'sewage':
      return ['sewage', () => sewagePix(30)];
    case 'solar':
      return ['solar', () => solarPix(31)];
    case 'wind':
      return ['wind-0', () => windPix(0)];
    // 2.5 «Comarca».
    case 'coop':
      return ['coop', () => coopPix(33, 1)];
    case 'post':
      return ['post', () => postPix(34)];
    case 'factory':
      return [`factory${id % 4}`, () => factory(id % 4)];
    // 2.2: sin saber el cultivo, una finca de cereal (el render usa farmSprite con el suyo).
    case 'farm':
      return [`farm-secano-${id % 3}`, () => farmSecano(id % 3)];
    case 'shop':
      return [`shop${id % 16}`, () => shop(id % 16)];
    case 'house':
      return [`house${id % 4}${r}`, () => cottage(id % 4, rank)];
    case 'res':
      return [`res${id % 256}${r}`, () => apartment(Math.floor(hash(id, 77) * 256), rank)];
    default:
      return null;
  }
}

/** Sprite de 32×48 de un edificio. Las viviendas y tiendas varían con su id. */
export function buildingSprite(kind: string, id: number, tod: TimeOfDay = 'day', snow = false, rank = VILLA_RANK): HTMLCanvasElement {
  const spec = buildingSpec(kind, id, rank);
  if (!spec) return constructionSprite(0, id, tod);
  const [key, make] = spec;
  // v1.7: en invierno con nieve, tejados nevados (otra entrada de la caché).
  return snow ? sprite(`snow-${key}`, () => snowify(make()), tod) : sprite(key, make, tod);
}

/**
 * 2.5: bloque de la zona R según la densidad a la que ha crecido (0 el de siempre,
 * 1 media, 2 alta). El muro varía con el id como el bloque bajo.
 */
export function resSprite(level: number, id: number, tod: TimeOfDay = 'day', snow = false, rank = VILLA_RANK): HTMLCanvasElement {
  const lv = Math.max(0, Math.min(2, Math.floor(level) || 0));
  if (lv === 0) return buildingSprite('res', id, tod, snow, rank);
  const seed = Math.floor(hash(id, 77) * 256);
  const key = `res-d${lv}-${seed}`;
  const make = () => denseBlock(seed, lv);
  return snow ? sprite(`snow-${key}`, () => snowify(make()), tod) : sprite(key, make, tod);
}

/**
 * Ayuntamiento según su nivel (1–5), 32×48 (v1.8): 1 casa consistorial
 * pequeña; 2 con espadaña y reloj; 3 más ancho con balcón y banderas; 4 el
 * de siempre, con torre del reloj (el de `buildingSprite('townhall', …)`);
 * 5 palacio municipal con cúpula y escalinata.
 */
export function townhallSprite(level: number, tod: TimeOfDay = 'day', snow = false): HTMLCanvasElement {
  const lv = Math.max(1, Math.min(5, Math.round(level) || 1));
  if (lv === 4) return buildingSprite('townhall', 0, tod, snow);
  const make = [townhall1, townhall2, townhall3, townhall, townhall5][lv - 1]!;
  const key = `townhall-n${lv}`;
  return snow ? sprite(`snow-${key}`, () => snowify(make()), tod) : sprite(key, make, tod);
}

/* -------------------- destrozos tras unos disturbios (v1.8) -------------------- */

/** Cristal roto: hueco oscuro, esquirlas en el marco y brasas al fondo. */
function smash(p: Pix, x: number, y: number, w: number, h: number, seed: number) {
  p.rect(x, y, w, h, 26);
  p.hline(x, y, w, 0);
  // Esquirlas que quedan pegadas al marco.
  const a = Math.max(2, Math.round(Math.min(w, h) * 0.6));
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a - j; i++) p.set(x + i, y + j, i + j === a - j - 1 ? MAT.glass[0] : MAT.glass[1]);
  }
  const b = Math.max(1, a - 1);
  for (let j = 0; j < b; j++) {
    for (let i = 0; i < b - j; i++) p.set(x + w - 1 - i, y + h - 1 - j, i === 0 && j === 0 ? MAT.glass[3] : MAT.glass[2]);
  }
  if (w > 5) {
    p.set(x + w - 1, y, MAT.glass[1]);
    p.set(x + w - 2, y, MAT.glass[1]);
    p.set(x + w - 1, y + 1, MAT.glass[2]);
  }
  // Brasas: de noche brillan.
  for (let i = 0; i < Math.max(1, w / 3); i++) {
    const ex = x + 1 + Math.floor(hash(i, seed, 7) * Math.max(1, w - 2));
    p.set(ex, y + h - 1, nightLights ? C.lampWarm : i % 2 ? 3 : 20);
  }
  if (h > 4) p.set(x + Math.floor(w / 2), y + h - 2, nightLights ? C.lamp : 3);
}

/** Tablones clavados sobre un hueco (n tablas, ligeramente torcidas). */
function planks(p: Pix, x: number, y: number, w: number, h: number, seed: number) {
  // El hueco queda a oscuras detrás de las tablas.
  p.rect(x, y, w, h, 26);
  const n = h >= 8 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const by = y + Math.round(((k + 0.5) * h) / n) - 1;
    // Una de las tablas, algo torcida.
    const tilt = k === n - 1 && hash(k, seed, 3) > 0.4 && w > 4;
    for (let i = -1; i <= w; i++) {
      const dy = tilt && i > w / 2 ? 1 : 0;
      p.set(x + i, by + dy, MAT.wood[0]);
      p.set(x + i, by + dy + 1, MAT.wood[2]);
    }
    p.set(x, by, 53); // clavos
    p.set(x + w - 1, by + (tilt ? 1 : 0), 53);
  }
}

/** Cristales por el suelo. */
function shards(p: Pix, x: number, y: number, w: number, seed: number) {
  for (let i = 0; i < w; i++) {
    const r = hash(x + i, y, seed);
    if (r > 0.55) p.set(x + i, y + Math.floor(hash(seed, x + i) * 3), r > 0.85 ? 31 : r > 0.7 ? MAT.glass[0] : MAT.glass[1]);
  }
}

/** Pintada: firma de 9×4 con un goterón. */
const TAG = ['.##.#..##', '#...##.#.', '.##.#.###', '...#.....'];
function graffiti(p: Pix, x: number, y: number, seed: number) {
  const col = [62, 61, 63, 2][seed % 4]!;
  const dark = [1, 2, 7, 16][seed % 4]!;
  TAG.forEach((r, j) =>
    [...r].forEach((ch, i) => {
      if (ch !== '#') return;
      p.set(x + i, y + j, col);
      if (p.get(x + i + 1, y + j + 1) !== col && j < 3) p.set(x + i + 1, y + j + 1, dark);
    }),
  );
}

/** Tizne que sube desde un hueco quemado. */
function soot(p: Pix, x: number, y: number, w: number, h: number, seed: number) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const edge = Math.abs(i + 0.5 - w / 2) / (w / 2);
      const d = (1 - j / h) * (1 - edge * 0.6);
      if (hash(x + i, y - j, seed) < d * 0.75 && (i + j) % 2 === 0) p.set(x + i, y - j, j < h / 3 ? 55 : 53);
    }
  }
}

/** Columna de humo oscuro que se aleja hacia la derecha. */
function smokeColumn(p: Pix, x: number, seed: number) {
  let top = 0;
  while (top < p.h && p.get(x, top) === NONE) top++;
  const dark: Mat = [C.smoke, C.smokeMid, C.smokeDark, 55];
  const light: Mat = [12, C.smoke, C.smokeMid, C.smokeDark];
  const puffs = [
    [-1, 0, 3, dark],
    [2, -3, 3.2, dark],
    [4, -7, 2.6, dark],
    [6, -10, 2.2, light],
    [7, -13, 1.7, light],
  ] as const;
  for (const [dx, dy, r, m] of puffs) {
    const cy = top + dy;
    if (cy + r < 1) continue;
    p.ball(x + dx, cy, r, m, seed + dx);
  }
  // Ceniza y pavesas.
  for (let i = 0; i < 4; i++) p.set(x - 2 + Math.floor(hash(i, seed, 9) * 8), Math.max(0, top - 3 - Math.floor(hash(seed, i, 9) * 8)), i % 2 ? 53 : nightLights ? C.lampWarm : 3);
}

/** Toldo rasgado: un jirón arrancado y tiras colgando. */
function tearAwning(p: Pix, x0: number, x1: number, y: number, seed: number) {
  for (let x = x0; x <= x1; x++) {
    const depth = 1 + Math.floor(hash(x, seed, 5) * 3);
    for (let j = 0; j < depth; j++) p.set(x, y + 4 - j, NONE);
  }
  for (const x of [x0 + 1, x1 - 1]) {
    const c = p.get(x, y + 1);
    for (let j = 0; j < 3; j++) p.set(x, y + 3 + j, j === 2 ? MAT.stone[3] : c);
  }
}

function damage(p: Pix, kind: string, seed: number): Pix {
  switch (kind) {
    case 'shop':
      soot(p, 21, 17, 6, 5, seed);
      smash(p, 22, 18, 4, 5, seed);
      planks(p, 14, 18, 4, 5, seed);
      graffiti(p, 9, 26, seed);
      tearAwning(p, 9, 15, 30, seed);
      smash(p, 5, 36, 13, 7, seed);
      planks(p, 22, 35, 5, 9, seed + 1);
      shards(p, 3, 45, 17, seed);
      smokeColumn(p, 23, seed);
      break;
    case 'house':
      soot(p, 7, 29, 7, 4, seed);
      smash(p, 8, 30, 5, 6, seed);
      planks(p, 21, 30, 4, 6, seed);
      graffiti(p, 19, 37, seed);
      shards(p, 5, 44, 11, seed);
      smokeColumn(p, 10, seed);
      break;
    case 'res':
      smash(p, 6, 38, 4, 5, seed);
      planks(p, 23, 38, 4, 5, seed);
      planks(p, 14, 37, 5, 8, seed + 1);
      soot(p, 5, 37, 6, 6, seed);
      graffiti(p, 20, 44 - 4, seed);
      shards(p, 3, 45, 12, seed);
      smokeColumn(p, 9, seed);
      break;
    case 'bar':
      smash(p, 5, 32, 5, 3, seed);
      planks(p, 23, 32, 5, 3, seed);
      tearAwning(p, 17, 24, 27, seed);
      graffiti(p, 20, 21, seed);
      shards(p, 2, 44, 14, seed);
      smokeColumn(p, 8, seed);
      break;
    default:
      graffiti(p, 3, 38, seed);
      shards(p, 2, 45, 28, seed);
      smokeColumn(p, 12, seed);
  }
  return p;
}

/**
 * Edificio destrozado tras unos disturbios (v1.8): el mismo sprite con el
 * escaparate roto, tablones, toldo rasgado, pintada y humo. Pensado sobre
 * todo para tiendas; con otros edificios, pintada, cristales y humo.
 */
export function damagedSprite(kind: string, id: number, tod: TimeOfDay = 'day'): HTMLCanvasElement {
  const spec = buildingSpec(kind, id);
  if (!spec) return constructionSprite(0, id, tod);
  const [key, make] = spec;
  // La semilla solo depende de lo que ya distingue la clave de caché.
  const seed = kind === 'shop' || kind === 'house' || kind === 'res' || kind === 'factory' ? id % 4 : 0;
  return sprite(`dmg-${key}`, () => damage(make(), kind, seed), tod);
}

export const constructionSprite = (stage: number, id: number, tod: TimeOfDay = 'day') => sprite(`obra${stage}-${id % 3}`, () => construction(stage, id % 3), tod);
/** Árbol con dos fotogramas de viento (la copa se mece 1 px). */
export const treeSprite = (v: number, frame = 0, tod: TimeOfDay = 'day', snow = false) =>
  sprite(`${snow ? 'snow-' : ''}tree${v}-${frame}`, () => {
    const p = frame ? sway(treeTile(v), 30) : treeTile(v);
    return snow ? snowify(p) : p;
  }, tod);
export const iconSprite = (k: 'noWater' | 'noPower') => sprite(`icon-${k}`, k === 'noWater' ? iconNoWater : iconNoPower);
export const letterSprite = (ch: 'R' | 'C' | 'I' | 'A', color: number) => sprite(`L${ch}${color}`, () => letter(ch, color));

/** Desplaza 1 px a la derecha las filas por encima de `rows` (la copa, no el tronco). */
function sway(p: Pix, rows: number): Pix {
  const out = new Pix(p.w, p.h);
  for (let y = 0; y < p.h; y++) {
    const dx = y < rows - 8 ? 1 : 0;
    for (let x = 0; x < p.w; x++) {
      const c = p.data[y * p.w + x]!;
      if (c !== NONE) out.set(x + dx, y, c);
    }
  }
  return out;
}

/* ============================ vecinos ============================ */

const SKINS = [C.skin, C.skinTan, C.skinBrown, C.skinDark];
const HAIRS = [C.hairDark, C.hairBlond, C.hairRed, C.hairGray, 36, 17];
const SHIRTS: Mat[] = [MAT.red, MAT.blue, MAT.moss, MAT.yellow, MAT.plum, MAT.teal, MAT.terracotta];
const TROUSERS = [8, 15, 26, 35, 25];

/**
 * Vecino caminando, 7×12 px a la escala del mapa (4 fotogramas). Mira a la
 * derecha (dir 1) o a la izquierda (dir −1). El retrato de la ficha usa el
 * mismo diseño a 12×18.
 */
export function walker(variant: number, frame: number, dir: 1 | -1): Pix {
  const p = new Pix(7, 12);
  const skin = SKINS[variant % SKINS.length]!;
  const hair = HAIRS[Math.floor(variant / 4) % HAIRS.length]!;
  const shirt = SHIRTS[Math.floor(variant / 3) % SHIRTS.length]!;
  const trousers = TROUSERS[Math.floor(variant / 7) % TROUSERS.length]!;
  const longHair = hash(variant, 3) > 0.5;
  const fx = (x: number) => (dir === 1 ? x : 6 - x);
  const set = (x: number, y: number, c: number) => p.set(fx(x), y, c);
  // Sombra en el suelo.
  for (let x = 1; x < 6; x++) set(x, 11, 24);
  // Cabeza.
  for (const [x, y] of [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [3, 3]]) set(x!, y!, skin);
  set(4, 2, 0); // ojo
  for (let x = 2; x <= 4; x++) set(x, 0, hair);
  set(1, 1, hair);
  if (longHair) {
    set(1, 2, hair);
    set(1, 3, hair);
  }
  // Tronco con luz a la izquierda.
  for (let y = 4; y <= 7; y++) for (let x = 2; x <= 4; x++) set(x, y, shirt[1]);
  for (let y = 4; y <= 7; y++) set(4, y, shirt[2]);
  set(2, 4, shirt[0]);
  // Brazos (balanceo).
  const swing = [0, 1, 0, -1][frame % 4]!;
  set(1, 5 + Math.max(0, swing), shirt[2]);
  set(5, 5 + Math.max(0, -swing), shirt[2]);
  set(1, 6 + Math.max(0, swing), skin);
  set(5, 6 + Math.max(0, -swing), skin);
  // Piernas (4 fotogramas).
  const legs = [
    [[2, 3], [4, 3]],
    [[2, 2], [4, 4]],
    [[3, 3], [3, 3]],
    [[2, 4], [4, 2]],
  ][frame % 4]!;
  const [[lx, ly], [rx, ry]] = legs as [[number, number], [number, number]];
  set(3, 8, trousers);
  for (let y = 8; y < 8 + ly; y++) set(lx, y, trousers);
  for (let y = 8; y < 8 + ry; y++) set(rx, y, trousers);
  set(lx, 8 + ly, 0);
  set(rx, 8 + ry, 0);
  return p;
}

/** Retrato de la ficha: vecino de frente, 12×18 px (spec §8.1). */
export function portrait(variant: number): Pix {
  const p = new Pix(12, 18);
  const skin = SKINS[variant % SKINS.length]!;
  const hair = HAIRS[Math.floor(variant / 4) % HAIRS.length]!;
  const shirt = SHIRTS[Math.floor(variant / 3) % SHIRTS.length]!;
  const trousers = TROUSERS[Math.floor(variant / 7) % TROUSERS.length]!;
  const longHair = hash(variant, 3) > 0.5;
  // Cabeza (5×5) con luz a la izquierda.
  p.rect(4, 2, 4, 5, skin);
  p.vline(3, 3, 3, skin);
  p.vline(8, 3, 3, skin);
  p.vline(7, 2, 5, SKINS[Math.min(3, SKINS.indexOf(skin) + 1)]!);
  p.set(5, 4, 0);
  p.set(7, 4, 0);
  p.hline(5, 6, 2, MAT.red[2]);
  // Pelo.
  p.hline(4, 0, 4, hair);
  p.hline(3, 1, 6, hair);
  p.set(3, 2, hair);
  p.set(8, 2, hair);
  if (longHair) {
    p.vline(2, 2, 6, hair);
    p.vline(9, 2, 6, hair);
  }
  // Cuello y tronco.
  p.hline(5, 7, 2, skin);
  p.rect(2, 8, 8, 5, shirt[1]);
  p.vline(2, 8, 5, shirt[0]);
  p.vline(9, 8, 5, shirt[2]);
  p.hline(3, 8, 6, shirt[0]);
  p.vline(1, 9, 3, shirt[1]);
  p.vline(10, 9, 3, shirt[2]);
  p.set(1, 12, skin);
  p.set(10, 12, skin);
  // Piernas y zapatos.
  p.rect(3, 13, 6, 1, trousers);
  p.rect(3, 14, 2, 3, trousers);
  p.rect(7, 14, 2, 3, trousers);
  p.hline(3, 17, 2, 0);
  p.hline(7, 17, 2, 0);
  return p;
}

export const portraitSprite = (variant: number) => sprite(`portrait${variant}`, () => portrait(variant));

export const walkerSprite = (variant: number, frame: number, dir: 1 | -1, tod: TimeOfDay = 'day') =>
  sprite(`walker${variant}-${frame}-${dir}`, () => walker(variant, frame, dir), tod);

/* -------------------- manifestantes y policía (v1.8) -------------------- */

/**
 * Pancartas de 9×5: w fondo, s franja, # letra oscura, L letra en el color
 * del fondo (sobre la franja), e canto inferior en sombra.
 */
const SIGNS: { rows: string[]; bg: number; stripe: number }[] = [
  { rows: ['sssssssss', 'wwwwwwwww', 'w#w##w#ww', 'w##w#w##w', 'eeeeeeeee'], bg: 12, stripe: 2 },
  { rows: ['wwwwwwwww', 'w##ww#w#w', 'w#www##ww', 'sssssssss', 'eeeeeeeee'], bg: 21, stripe: 9 },
  { rows: ['ssswwwwww', 'ssw##w#ww', 'ssw#ww##w', 'ssswwwwww', 'eeeeeeeee'], bg: 12, stripe: 6 },
  { rows: ['wwwwwwwww', 'sLsLLsLss', 'sLLsLsLLs', 'wwwwwwwww', 'eeeeeeeee'], bg: 21, stripe: 62 },
];

/**
 * Vecino manifestándose: 9×18 px (4 fotogramas), con una pancarta en alto
 * en un palo. `sign` 0–3 elige el diseño; la pancarta no se refleja con
 * `dir` (las letras se leen igual hacia los dos lados).
 */
export function marcher(variant: number, frame: number, dir: 1 | -1, sign: number): Pix {
  const p = new Pix(9, 18);
  const body = walker(variant, frame, dir);
  const shirt = SHIRTS[Math.floor(variant / 3) % SHIRTS.length]!;
  const skin = SKINS[variant % SKINS.length]!;
  // El cuerpo del paseante, sin los brazos que balancea (aquí sujetan el palo).
  for (let y = 0; y < body.h; y++) {
    for (let x = 0; x < body.w; x++) {
      const c = body.data[y * body.w + x]!;
      const arm = (x === 1 || x === 5) && y >= 5 && y <= 7;
      if (c !== NONE && !arm) p.set(x + 1, y + 6, c);
    }
  }
  const fx = (x: number) => (dir === 1 ? x : 8 - x);
  // Palo por delante del cuerpo, del cartel a la cadera.
  const bob = frame % 2; // el palo sube y baja un píxel con el paso
  for (let y = 5; y <= 14; y++) p.set(fx(7), y, y < 7 + bob ? 47 : 46);
  // Brazos: los dos agarran el palo, uno alto y otro bajo.
  p.set(fx(6), 10, shirt[2]);
  p.set(fx(7), 10, skin);
  p.set(fx(6), 12, shirt[1]);
  p.set(fx(7), 12, skin);
  p.set(fx(2), 10, shirt[2]); // hombro de atrás
  // Pancarta.
  const s = SIGNS[((sign % 4) + 4) % 4]!;
  const col: Record<string, number> = { w: s.bg, s: s.stripe, '#': 15, L: s.bg, e: s.bg === 12 ? 13 : 30 };
  s.rows.forEach((r, j) =>
    [...r].forEach((ch, i) => {
      const c = col[ch];
      if (c !== undefined) p.set(i, j + bob, c);
    }),
  );
  p.set(0, bob, s.rows[0]![0] === 's' ? s.stripe : 31); // brillo en la esquina de la luz
  return p;
}

export const marcherSprite = (variant: number, frame: number, dir: 1 | -1, sign: number, tod: TimeOfDay = 'day') =>
  sprite(`marcher${variant}-${frame}-${dir}-${sign}`, () => marcher(variant, frame, dir, sign), tod);

/**
 * Agente de la policía local, 7×12 px como `walker` (4 fotogramas): gorra
 * con visera, uniforme azul marino y chaleco amarillo reflectante.
 */
export function policeWalker(frame: number, dir: 1 | -1): Pix {
  const p = new Pix(7, 12);
  const skin = C.skinTan;
  const fx = (x: number) => (dir === 1 ? x : 6 - x);
  const set = (x: number, y: number, c: number) => p.set(fx(x), y, c);
  for (let x = 1; x < 6; x++) set(x, 11, 24);
  // Cabeza y gorra con visera.
  for (const [x, y] of [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [3, 3]]) set(x!, y!, skin);
  set(4, 2, 0);
  set(1, 0, 8);
  set(2, 0, 9);
  set(3, 0, 8);
  set(4, 0, 8);
  set(2, 1, 8); // cinta de la gorra
  set(3, 1, 4); // placa
  set(4, 1, 8);
  set(5, 1, 26); // visera
  set(1, 1, C.hairDark);
  // Chaleco reflectante con banda plateada.
  for (let y = 4; y <= 7; y++) for (let x = 2; x <= 4; x++) set(x, y, 40);
  for (let y = 4; y <= 7; y++) set(4, y, 22);
  set(2, 4, 59);
  set(3, 4, 8); // cuello del uniforme
  for (let x = 2; x <= 4; x++) set(x, 6, x === 4 ? 52 : 54);
  set(2, 7, 26); // cinturón
  set(3, 7, 26);
  set(4, 7, 26);
  // Brazos con manga azul marino (balanceo).
  const swing = [0, 1, 0, -1][frame % 4]!;
  set(1, 5 + Math.max(0, swing), 8);
  set(5, 5 + Math.max(0, -swing), 57);
  set(1, 6 + Math.max(0, swing), skin);
  set(5, 6 + Math.max(0, -swing), skin);
  // Pantalón azul marino y botas.
  const legs = [
    [[2, 3], [4, 3]],
    [[2, 2], [4, 4]],
    [[3, 3], [3, 3]],
    [[2, 4], [4, 2]],
  ][frame % 4]!;
  const [[lx, ly], [rx, ry]] = legs as [[number, number], [number, number]];
  set(3, 8, 57);
  for (let y = 8; y < 8 + ly; y++) set(lx, y, 8);
  for (let y = 8; y < 8 + ry; y++) set(rx, y, 57);
  set(lx, 8 + ly, 0);
  set(rx, 8 + ry, 0);
  return p;
}

/** 2.1: bolsas de basura, ratas y el camión de la basura. */
export const trashBagsSprite = (n: number, tod: TimeOfDay = 'day') => sprite(`bolsas-${n}`, () => trashBags(n), tod);
export const ratSprite = (frame: number, dir: 1 | -1, tod: TimeOfDay = 'day') => sprite(`rata-${frame % 2}-${dir}`, () => rat(frame, dir), tod);
export const truckSprite = (frame: number, dir: 1 | -1, tod: TimeOfDay = 'day') => sprite(`camion-${frame % 2}-${dir}`, () => garbageTruck(frame, dir), tod);

export const policeSprite = (frame: number, dir: 1 | -1, tod: TimeOfDay = 'day') =>
  sprite(`policia-${frame}-${dir}`, () => policeWalker(frame, dir), tod);

/**
 * Ladrón huyendo, 7×12 px como `walker` (4 fotogramas): ropa oscura, gorro
 * de lana, antifaz y un saco al hombro (a la espalda).
 */
export function thiefWalker(frame: number, dir: 1 | -1): Pix {
  const p = new Pix(7, 12);
  const skin = C.skin;
  const fx = (x: number) => (dir === 1 ? x : 6 - x);
  const set = (x: number, y: number, c: number) => p.set(fx(x), y, c);
  for (let x = 1; x < 6; x++) set(x, 11, 24);
  // Cabeza con gorro y antifaz.
  for (const [x, y] of [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [3, 3]]) set(x!, y!, skin);
  set(2, 0, 53);
  set(3, 0, 55);
  set(4, 0, 55);
  set(2, 1, 55);
  set(3, 1, 0); // antifaz
  set(4, 1, 0);
  set(5, 1, 0);
  set(4, 1, 12); // ojo
  // Saco al hombro, a la espalda.
  set(1, 1, 47);
  set(0, 2, 45);
  set(1, 2, 45);
  set(0, 3, 45);
  set(1, 3, 46);
  set(0, 4, 46);
  set(1, 4, 46);
  set(0, 5, 47);
  set(1, 5, 47);
  set(2, 3, skin); // mano que sujeta el saco
  // Jersey oscuro.
  for (let y = 4; y <= 7; y++) for (let x = 2; x <= 4; x++) set(x, y, 55);
  for (let y = 4; y <= 7; y++) set(4, y, 26);
  set(2, 4, 53);
  set(3, 4, 53);
  // Brazo delantero corriendo.
  const swing = [0, 1, 0, -1][frame % 4]!;
  set(5, 5 + Math.max(0, -swing), 26);
  set(5, 6 + Math.max(0, -swing), skin);
  // Piernas: zancada más larga que al pasear.
  const legs = [
    [[2, 3], [4, 3]],
    [[1, 2], [5, 3]],
    [[3, 3], [3, 3]],
    [[2, 3], [5, 2]],
  ][frame % 4]!;
  const [[lx, ly], [rx, ry]] = legs as [[number, number], [number, number]];
  set(3, 8, 26);
  for (let y = 8; y < 8 + ly; y++) set(lx, y, 26);
  for (let y = 8; y < 8 + ry; y++) set(rx, y, 15);
  set(lx, 8 + ly, 0);
  set(rx, 8 + ry, 0);
  return p;
}

export const thiefSprite = (frame: number, dir: 1 | -1, tod: TimeOfDay = 'day') =>
  sprite(`ladron-${frame}-${dir}`, () => thiefWalker(frame, dir), tod);

/**
 * Destello de aviso de 16×16 (4 fotogramas): estrella que se abre en un
 * anillo. Usa los tonos de luz, que no se oscurecen de noche.
 */
export function sparkle(frame: number): Pix {
  const p = new Pix(16, 16);
  const f = ((frame % 4) + 4) % 4;
  const ring = (r: number, c: number, dotted: boolean) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
        if (Math.abs(d - r) < 0.55 && (!dotted || (x + y) % 2 === 0)) p.set(x, y, c);
      }
    }
  };
  const star = (len: number, core: number) => {
    for (let k = 1; k <= len; k++) {
      const c = k === len ? C.lampWarm : C.lamp;
      p.set(8 + k - 1, 7, c);
      p.set(7 - k + 1, 8, c);
      p.set(7, 7 - k + 1, c);
      p.set(8, 8 + k - 1, c);
      p.set(7 - k + 1, 7, c);
      p.set(8 + k - 1, 8, c);
      p.set(8, 7 - k + 1, c);
      p.set(7, 8 + k - 1, c);
    }
    p.rect(7, 7, 2, 2, core);
  };
  if (f === 0) star(3, C.lamp);
  else if (f === 1) {
    ring(4, C.lampWarm, false);
    star(5, C.lamp);
  } else if (f === 2) {
    ring(6, C.lampWarm, false);
    ring(5, 4, true);
    star(3, C.lamp);
    for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12]] as const) p.set(x, y, C.lamp);
  } else {
    ring(7.2, 4, true);
    star(2, C.lampWarm);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]] as const) p.set(x, y, C.lampWarm);
  }
  return p;
}

export const sparkleSprite = (frame: number, tod: TimeOfDay = 'day') => sprite(`destello${frame % 4}`, () => sparkle(frame), tod);

/** Bocanada de humo (3 tamaños). */
export function puff(size: number): Pix {
  const r = 1.2 + size * 0.9;
  const d = Math.ceil(r * 2) + 2;
  const p = new Pix(d, d);
  p.ball(d / 2, d / 2, r, [12, C.smoke, C.smokeMid, C.smokeDark], size);
  return p;
}
export const puffSprite = (size: number, tod: TimeOfDay = 'day') => sprite(`puff${size}`, () => puff(size), tod);

/* -------------------- 2.1: emergencias -------------------- */

/** Camión de bomberos aparcado (para los sprites de edificio), 11×6. */
function truckParked(p: Pix, x: number, y: number, cistern: boolean) {
  p.shadow(x + 1, y + 6, 11, 1);
  p.rect(x, y + 1, 8, 4, MAT.red[1]);
  p.hline(x, y + 1, 8, MAT.red[0]);
  if (cistern) {
    p.rect(x + 1, y - 1, 6, 2, MAT.metal[1]);
    p.hline(x + 1, y - 1, 6, MAT.metal[0]);
  } else {
    p.hline(x, y, 8, MAT.metal[2]); // escalera
    for (let i = 0; i < 8; i += 2) p.set(x + i, y, MAT.metal[0]);
  }
  p.rect(x + 8, y + 2, 3, 3, MAT.red[1]);
  p.rect(x + 9, y + 2, 2, 1, MAT.glass[1]);
  p.hline(x, y + 4, 11, MAT.red[3]);
  p.hline(x + 1, y + 3, 6, 12);
  for (const dx of [1, 8]) p.rect(x + dx, y + 5, 2, 1, 0);
  p.set(x + 9, y + 1, nightLights ? C.lampWarm : 4);
}

/** Parque de bomberos por niveles: 1 nave con portón y torre de mangueras; 2 con cisterna; 3 con dos portones y foco. */
function fireStation(seed: number, level: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 1, 14, 30, 32);
  // Torre de secado de mangueras.
  const towerTop = level >= 3 ? 2 : 6;
  facade(p, 22, towerTop + 4, 9, 42 - towerTop, MAT.brick, 'brick', seed);
  flatRoof(p, 21, towerTop, 11, 5, MAT.slate, seed);
  windowAt(p, 25, towerTop + 9, 3, 4, { frame: 12 });
  windowAt(p, 25, towerTop + 19, 3, 4, { frame: 12 });
  // Nave principal.
  facade(p, 1, 20, 22, 26, MAT.red, 'brick', seed);
  flatRoof(p, 0, 14, 23, 7, MAT.red, seed);
  // Franja blanca con el rótulo (rayas como letras).
  p.rect(2, 22, 20, 4, 12);
  for (let i = 0; i < 6; i++) p.rect(4 + i * 3, 23, 2, 2, MAT.red[2]);
  // Portones (uno o dos), con lamas y marco blanco.
  const doors: [number, number][] = level >= 3 ? [[3, 8], [12, 8]] : [[4, 14]];
  for (const [dx, dw] of doors) {
    p.frame(dx - 1, 28, dw + 2, 18, 12);
    p.rect(dx, 29, dw, 16, MAT.red[3]);
    for (let y = 30; y < 45; y += 2) p.hline(dx, y, dw, MAT.red[2]);
    p.hline(dx, 29, dw, nightLights ? C.lampWarm : MAT.metal[1]);
  }
  // Sirena (fija: sin destellos) y escudo.
  p.rect(10, 11, 3, 3, MAT.metal[2]);
  p.set(11, 11, nightLights ? C.lampWarm : MAT.red[0]);
  p.ball(26, towerTop + 2, 1.6, MAT.yellow, seed);
  if (level >= 2) truckParked(p, 19, 40, true);
  if (level >= 3) {
    floodlight(p, 30, 26, 40);
    p.hline(2, 47, 20, MAT.stone[2]);
  }
  return p;
}

/** Caseta de protección civil: casita blanca con franja naranja y el triángulo azul en un círculo naranja. */
function civilPost(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 4, 22, 24, 24);
  facade(p, 4, 26, 24, 20, MAT.white, 'plaster', seed);
  gableRoof(p, 3, 18, 26, 3, 6, MAT.terracotta);
  // Franja naranja.
  p.hline(4, 34, 24, 3);
  p.hline(4, 35, 24, MAT.red[1]);
  // Emblema: círculo naranja con triángulo azul.
  p.ball(16, 30, 3.4, [4, 3, 19, 18], seed);
  for (let j = 0; j < 4; j++) p.hline(16 - j, 28 + j, 1 + j * 2, MAT.blue[1]);
  doorAt(p, 13, 38, 6, 7, MAT.blue, 12);
  windowAt(p, 7, 38, 3, 4, { frame: 12 });
  windowAt(p, 23, 38, 3, 4, { frame: 12 });
  // Sacos terreros y un cono.
  for (const x of [1, 4, 26]) p.ball(x + 1, 45, 1.6, [45, 46, 47, 47], seed + x);
  p.set(30, 42, 3);
  p.rect(29, 43, 3, 2, 3);
  p.hline(29, 44, 3, 12);
  return p;
}

/** Dique de piedra en la orilla (casilla de 32×32, sobre el suelo). */
export function dikePix(): Pix {
  const p = new Pix(T, T);
  // Muro de sillares.
  p.rect(0, 10, 32, 14, MAT.stone[1]);
  for (let row = 0; row < 3; row++) {
    const y = 10 + row * 5;
    p.hline(0, y, 32, MAT.stone[0]);
    p.hline(0, y + 4, 32, MAT.stone[3]);
    for (let x = (row % 2) * 4; x < 32; x += 8) p.vline(x, y, 5, MAT.stone[2]);
  }
  p.hline(0, 24, 32, MAT.stone[3]);
  p.dither(0, 25, 32, 3, MAT.stone[2], 0);
  // Remate y sacos terreros.
  p.hline(0, 9, 32, MAT.stone[0]);
  for (let x = 2; x < 32; x += 6) p.ball(x + 1, 8, 1.6, [45, 46, 47, 47], x);
  return p;
}
export const dikeSprite = (tod: TimeOfDay = 'day') => sprite('dique', dikePix, tod);

/** Llamas y humo sobre un edificio que arde (2 fotogramas, sin destellos: se mecen). */
export function flamesPix(frame: number): Pix {
  const p = new Pix(T, BH);
  const f = frame % 2;
  const flame = (cx: number, base: number, h: number, k: number) => {
    for (let j = 0; j < h; j++) {
      const w = Math.max(1, Math.round((1 - j / h) * 3 + (j % 2 === f ? 0.5 : 0)));
      const sway = (j > h / 2 ? (f ? 1 : -1) : 0) * (k % 2 ? 1 : -1);
      const c = j < h * 0.35 ? 4 : j < h * 0.7 ? 3 : MAT.red[1];
      p.hline(cx - Math.floor(w / 2) + sway, base - j, w, c);
    }
    p.set(cx + (f ? 1 : -1), base - h - 1, MAT.red[2]);
  };
  // Lenguas de fuego en ventanas y tejado.
  flame(8, 34, 7 + f, 0);
  flame(24, 36, 6 + (1 - f), 1);
  flame(15, 22, 10 + f * 2, 2);
  flame(21, 20, 7 + (1 - f) * 2, 3);
  // Humo que sube.
  const smoke: Mat = [C.smoke, C.smokeMid, C.smokeDark, 55];
  p.ball(14 + f, 8, 3.2, smoke, 7);
  p.ball(19 - f, 3, 2.6, smoke, 9);
  p.ball(10, 12 - f, 2.2, smoke, 11);
  return p;
}
export const flamesSprite = (frame: number, tod: TimeOfDay = 'day') => sprite(`llamas${frame % 2}`, () => flamesPix(frame), tod);

/** Aviso de riesgo de incendio sobre el edificio: llama pequeña en un rombo amarillo, 11×13. */
function riskIcon(): Pix {
  const p = new Pix(11, 13);
  for (let j = 0; j < 11; j++) {
    const w = j <= 5 ? j * 2 + 1 : (10 - j) * 2 + 1;
    p.hline(5 - Math.floor(w / 2), j, w, 0);
  }
  for (let j = 1; j < 10; j++) {
    const w = j <= 5 ? j * 2 - 1 : (10 - j) * 2 - 1;
    if (w > 0) p.hline(5 - Math.floor(w / 2), j, w, 4);
  }
  // Llama.
  p.vline(5, 3, 5, MAT.red[1]);
  p.hline(4, 5, 3, MAT.red[1]);
  p.hline(4, 6, 3, 3);
  p.set(5, 6, 4);
  p.hline(4, 7, 3, MAT.red[1]);
  p.hline(3, 12, 5, 24);
  return p;
}
export const riskSprite = () => sprite('icon-riesgo', riskIcon);

/** Camión de bomberos por la calle, 14×9, mirando a la derecha (dir 1) o a la izquierda; 2 fotogramas de ruedas. */
export function fireTruckPix(frame: number, dir: 1 | -1): Pix {
  const p = new Pix(14, 9);
  const fx = (x: number) => (dir === 1 ? x : 13 - x);
  const set = (x: number, y: number, c: number) => p.set(fx(x), y, c);
  const rect = (x: number, y: number, w: number, h: number, c: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c);
  };
  for (let x = 1; x < 13; x++) set(x, 8, 24); // sombra
  rect(0, 2, 10, 4, MAT.red[1]);
  rect(0, 2, 10, 1, MAT.red[0]);
  rect(10, 3, 3, 3, MAT.red[1]);
  rect(11, 3, 2, 1, MAT.glass[1]);
  rect(0, 5, 13, 1, MAT.red[3]);
  rect(1, 4, 8, 1, 12);
  // Escalera en el techo.
  rect(0, 1, 10, 1, MAT.metal[2]);
  for (let i = frame % 2; i < 10; i += 2) set(i, 1, MAT.metal[0]);
  // Faro fijo (sin destellos).
  set(12, 2, 4);
  // Ruedas.
  for (const x of [2, 10]) {
    rect(x, 6, 2, 2, 0);
    set(x + (frame % 2), 6, 55);
  }
  return p;
}
export const fireTruckSprite = (frame: number, dir: 1 | -1, tod: TimeOfDay = 'day') => sprite(`bomberos-${frame % 2}-${dir}`, () => fireTruckPix(frame, dir), tod);

/** Ambulancia por la calle, 13×9 (sin destellos: la luz azul está quieta). */
export function ambulancePix(frame: number, dir: 1 | -1): Pix {
  const p = new Pix(13, 9);
  const fx = (x: number) => (dir === 1 ? x : 12 - x);
  const set = (x: number, y: number, c: number) => p.set(fx(x), y, c);
  const rect = (x: number, y: number, w: number, h: number, c: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c);
  };
  for (let x = 1; x < 12; x++) set(x, 8, 24);
  rect(0, 1, 8, 5, 12);
  rect(0, 1, 8, 1, 31);
  rect(8, 3, 4, 3, 12);
  rect(9, 3, 2, 1, MAT.glass[1]);
  rect(0, 4, 12, 1, MAT.red[1]);
  rect(3, 2, 1, 3, MAT.red[1]);
  rect(2, 3, 3, 1, MAT.red[1]);
  rect(0, 5, 12, 1, 13);
  set(1, 0, MAT.blue[1]);
  for (const x of [1, 9]) {
    rect(x, 6, 2, 2, 0);
    set(x + (frame % 2), 6, 55);
  }
  return p;
}
export const ambulanceSprite = (frame: number, dir: 1 | -1, tod: TimeOfDay = 'day') => sprite(`ambulancia-${frame % 2}-${dir}`, () => ambulancePix(frame, dir), tod);

/** Edificio quemado: el mismo sprite con hollín en ventanas y tejado, vigas negras y humo. */
function burn(p: Pix, seed: number): Pix {
  const burnt: Record<number, number> = { 12: 30, 31: 29, 21: 28, 20: 27, 19: 27, 18: 26, 3: 17, 2: 16, 4: 19, 10: 15, 11: 14, 9: 26 };
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const c = p.get(x, y);
      if (c === NONE) continue;
      const k = hash(x, y, seed, 41);
      if (k < 0.45) p.set(x, y, burnt[c] ?? (k < 0.15 ? 26 : c));
    }
  }
  soot(p, 6, 30, 8, 10, seed);
  soot(p, 20, 30, 8, 10, seed + 1);
  // Vigas quemadas en el tejado.
  let top = 0;
  while (top < p.h && p.get(16, top) === NONE) top++;
  for (const x of [9, 15, 22]) p.vline(x, top + 1, 5, 0);
  shards(p, 2, 45, 28, seed);
  smokeColumn(p, 15, seed);
  return p;
}

/** Edificio destrozado por el fuego (2.1). */
export function burntSprite(kind: string, id: number, tod: TimeOfDay = 'day'): HTMLCanvasElement {
  const spec = buildingSpec(kind, id);
  if (!spec) return constructionSprite(0, id, tod);
  const [key, make] = spec;
  return sprite(`quemado-${key}`, () => burn(make(), id % 3), tod);
}

/* ============================ el campo (2.2) ============================ */

export type CropKind = 'secano' | 'regadio' | 'olivar' | 'vinedo';
const OLIVE: Mat = [41, 42, 25, 44];

/** Casa de labor pequeña (encalada, teja) en la esquina de la finca. */
function farmhouse(p: Pix, x: number, y: number, seed: number) {
  p.shadow(x + 1, y + 13, 12, 2);
  p.rect(x, y + 5, 11, 8, MAT.white[1]);
  p.vline(x, y + 5, 8, MAT.white[0]);
  p.vline(x + 10, y + 5, 8, MAT.white[2]);
  // Tejado a un agua.
  for (let j = 0; j < 5; j++) p.hline(x - 1, y + j, 13, j === 0 ? MAT.terracotta[0] : j % 2 ? MAT.terracotta[1] : MAT.terracotta[2]);
  p.hline(x - 1, y + 4, 13, MAT.terracotta[3]);
  // Puerta y ventanuco.
  p.rect(x + 2, y + 8, 3, 5, MAT.wood[2]);
  p.set(x + 4, y + 10, MAT.wood[0]);
  p.rect(x + 7, y + 7, 2, 2, hash(seed, 3) > 0.5 ? 8 : 26);
}

/** Surcos: filas horizontales de tierra con su sombra. */
function furrows(p: Pix, y0: number, light: number, dark: number, step: number) {
  p.rect(0, y0, T, BH - y0, light);
  for (let y = y0 + 1; y < BH; y += step) p.hline(0, y, T, dark);
}

function farmSecano(seed: number): Pix {
  const p = new Pix(T, BH);
  // Cereal dorado en hileras, con espigas sueltas.
  furrows(p, 16, 4, 37, 3);
  for (let y = 18; y < BH; y += 3) for (let x = 0; x < T; x += 2) if (hash(x, y, seed) > 0.55) p.set(x, y - 1, 12);
  p.dither(0, 16, T, 3, 20, 0);
  // Una paca de paja.
  p.rect(22, 38, 6, 4, 20);
  p.hline(22, 38, 6, 4);
  p.hline(22, 41, 6, 19);
  p.shadow(23, 42, 6, 1);
  farmhouse(p, 2, 8, seed);
  return p;
}

function farmRegadio(seed: number): Pix {
  const p = new Pix(T, BH);
  // Huerta: tierra oscura en surcos, hortalizas en fila y una acequia.
  furrows(p, 16, 46, 47, 4);
  for (let y = 18; y < 44; y += 4) {
    for (let x = 1 + ((y / 4) % 2); x < T - 1; x += 4) {
      p.set(x, y, 41);
      p.set(x + 1, y, 42);
      p.set(x, y - 1, 40);
      if (hash(x, y, seed) > 0.7) p.set(x + 1, y - 1, 2);
    }
  }
  p.hline(0, 44, T, 47);
  p.rect(0, 45, T, 2, C.water);
  for (let x = 0; x < T; x += 5) p.set(x + (seed % 3), 45, C.waterLight);
  p.hline(0, 47, T, 47);
  farmhouse(p, 19, 8, seed);
  return p;
}

function farmOlivar(seed: number): Pix {
  const p = new Pix(T, BH);
  // Tierra clara de olivar con olivos en marco real.
  p.rect(0, 16, T, 32, 45);
  p.dither(0, 16, T, 32, 46, seed % 2);
  for (let i = 0; i < 18; i++) p.set(Math.floor(hash(i, seed) * T), 16 + Math.floor(hash(seed, i) * 32), 29);
  const spots: [number, number][] = [[8, 26], [24, 24], [8, 41], [24, 40]];
  for (const [x, y] of spots) {
    p.ellipse(x + 2, y + 6, 5, 1.6, 47);
    p.rect(x - 1, y + 1, 2, 5, 35);
    p.set(x, y + 2, 34);
    p.ball(x - 2, y - 1, 3.5, OLIVE, seed + x);
    p.ball(x + 2, y - 2, 3.5, OLIVE, seed + y);
    // Aceitunas.
    if (hash(x, y, seed) > 0.3) p.set(x + 1, y, 36);
  }
  return p;
}

function farmVinedo(seed: number): Pix {
  const p = new Pix(T, BH);
  // Cepas en espaldera: postes, hojas y racimos.
  p.rect(0, 16, T, 32, 45);
  p.dither(0, 16, T, 32, 46, 1);
  for (let y = 22; y < BH; y += 6) {
    p.hline(0, y + 2, T, 47);
    for (let x = 1; x < T; x += 5) {
      p.vline(x, y - 2, 4, MAT.wood[2]);
      p.set(x + 1, y - 2, 23);
      p.rect(x + 1, y - 1, 3, 2, 23);
      p.set(x + 2, y - 1, 22);
      p.set(x + 3, y, 24);
      if (hash(x, y, seed) > 0.45) {
        p.set(x + 2, y + 1, 1);
        p.set(x + 3, y + 1, 62);
      }
    }
  }
  farmhouse(p, 2, 4, seed);
  return p;
}

const FARM_MAKERS: Record<CropKind, (seed: number) => Pix> = { secano: farmSecano, regadio: farmRegadio, olivar: farmOlivar, vinedo: farmVinedo };

/** 2.2: finca según su cultivo (surcos, huerta, olivos o cepas), 32×48. */
export function farmSprite(crop: CropKind, id: number, tod: TimeOfDay = 'day', snow = false): HTMLCanvasElement {
  const seed = id % 3;
  const key = `farm-${crop}-${seed}`;
  const make = () => FARM_MAKERS[crop](seed);
  return snow ? sprite(`snow-${key}`, () => snowify(make()), tod) : sprite(key, make, tod);
}

/* ===================== 2.3: patrimonio (según el terreno) ===================== */

export type HeritageVariantArt = 'faro' | 'molino' | 'castillo' | 'rollo';

/** Faro junto al mar: torre encalada con franjas rojas sobre las rocas y la linterna arriba. */
function lighthouse(): Pix {
  const p = new Pix(T, BH);
  // Rocas de la base.
  p.ball(9, 42, 5, MAT.stone, 3);
  p.ball(22, 43, 4.5, MAT.stone, 5);
  p.ball(15, 44, 4, MAT.stone, 7);
  castShadow(p, 12, 12, 8, 30);
  // Torre que se estrecha hacia arriba.
  for (let y = 12; y < 41; y++) {
    const half = 3 + Math.floor((y - 12) / 9);
    const band = Math.floor((y - 12) / 6) % 2 === 1;
    const m = band ? MAT.red : MAT.white;
    for (let x = 16 - half; x < 16 + half; x++) p.set(x, y, x === 16 - half ? m[0] : x >= 16 + half - 1 ? m[2] : m[1]);
  }
  // Puerta y ventanucos.
  p.rect(15, 36, 3, 5, MAT.wood[2]);
  p.set(16, 36, MAT.wood[1]);
  p.set(16, 22, MAT.glass[2]);
  p.set(16, 29, MAT.glass[2]);
  // Galería, linterna y cúpula.
  p.hline(11, 11, 10, MAT.metal[2]);
  p.hline(11, 12, 10, MAT.metal[3]);
  p.rect(13, 6, 6, 5, nightLights ? C.lamp : MAT.glass[1]);
  p.vline(13, 6, 5, MAT.metal[2]);
  p.vline(18, 6, 5, MAT.metal[2]);
  if (nightLights) {
    p.hline(3, 8, 9, C.lampWarm);
    p.hline(20, 8, 10, C.lampWarm);
  } else p.set(15, 7, 12);
  p.hline(13, 5, 6, MAT.red[2]);
  p.hline(14, 4, 4, MAT.red[2]);
  p.hline(15, 3, 2, MAT.red[3]);
  p.set(16, 2, MAT.metal[3]);
  return p;
}

/** Molino de agua junto al río: casa de piedra con la rueda de paletas al costado. */
function watermill(): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 4, 24, 18, 20);
  // Casa de piedra con tejado a un agua.
  facade(p, 4, 26, 18, 18, MAT.stone, 'stone', 4);
  for (let x = 3; x < 23; x++) for (let y = 0; y < 6; y++) p.set(x, 20 + y + Math.floor((22 - x) / 6), y === 0 ? MAT.terracotta[0] : (x + y) % 3 === 0 ? MAT.terracotta[2] : MAT.terracotta[1]);
  p.rect(10, 35, 5, 9, MAT.wood[2]);
  p.vline(12, 36, 8, MAT.wood[3]);
  windowAt(p, 6, 31, 3, 3, { frame: MAT.stone[3], lit: nightLights });
  windowAt(p, 17, 31, 3, 3, { frame: MAT.stone[3], lit: nightLights });
  // Canal de agua que baja a la rueda.
  p.rect(22, 27, 9, 2, MAT.wood[1]);
  p.hline(22, 26, 9, C.waterLight);
  // Rueda de paletas.
  p.ellipse(25, 37, 6, 6, MAT.wood[3]);
  p.ellipse(25, 37, 4.5, 4.5, MAT.wood[1]);
  p.ellipse(25, 37, 3, 3, MAT.wood[3]);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    p.set(Math.round(25 + Math.cos(a) * 5), Math.round(37 + Math.sin(a) * 5), MAT.wood[0]);
    p.set(Math.round(25 + Math.cos(a) * 2), Math.round(37 + Math.sin(a) * 2), MAT.wood[2]);
  }
  p.rect(24, 36, 2, 2, MAT.metal[3]);
  // Agua al pie de la rueda.
  p.hline(19, 44, 13, C.water);
  p.hline(20, 45, 11, C.waterDeep);
  p.set(22, 43, C.waterLight);
  p.set(28, 43, C.waterLight);
  return p;
}

/** Castillo en la colina: torre del homenaje almenada entre dos torreones, con su bandera. */
function castle(): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 2, 22, 28, 22);
  const merlons = (x: number, y: number, w: number) => {
    for (let i = 0; i < w; i += 2) p.rect(x + i, y - 2, 1, 2, MAT.stone[i === 0 ? 0 : 1]);
  };
  // Muralla.
  facade(p, 2, 30, 28, 14, MAT.stone, 'stone', 9);
  merlons(2, 30, 28);
  // Torreones.
  facade(p, 1, 24, 6, 20, MAT.stone, 'stone', 10);
  merlons(1, 24, 6);
  facade(p, 25, 24, 6, 20, MAT.stone, 'stone', 11);
  merlons(25, 24, 6);
  // Torre del homenaje.
  facade(p, 10, 12, 12, 22, MAT.stone, 'stone', 12);
  merlons(10, 12, 12);
  p.rect(15, 18, 2, 3, nightLights ? C.lamp : MAT.stone[3]);
  p.rect(12, 24, 1, 2, MAT.stone[3]);
  p.rect(19, 24, 1, 2, MAT.stone[3]);
  p.set(4, 30, MAT.stone[3]);
  p.set(27, 30, MAT.stone[3]);
  // Puerta de arco con rastrillo.
  p.rect(13, 37, 6, 7, MAT.stone[3]);
  p.hline(14, 36, 4, MAT.stone[3]);
  for (let x = 14; x < 18; x += 2) p.vline(x, 37, 6, MAT.metal[2]);
  p.hline(13, 40, 6, MAT.metal[2]);
  // Bandera.
  p.vline(16, 2, 9, MAT.metal[3]);
  p.rect(17, 2, 5, 3, MAT.red[1]);
  p.hline(17, 3, 5, MAT.yellow[1]);
  return p;
}

/** Rollo de justicia con plaza porticada: soportales de piedra al fondo y la columna en el centro. */
function rollo(): Pix {
  const p = new Pix(T, BH);
  // Soportales (pórtico con arcos) al fondo.
  facade(p, 1, 14, 30, 18, MAT.cream, 'plaster', 6);
  for (let x = 1; x < 31; x++) p.set(x, 13, MAT.terracotta[2]);
  p.hline(1, 12, 30, MAT.terracotta[1]);
  for (let i = 0; i < 4; i++) {
    windowAt(p, 4 + i * 7, 16, 3, 3, { frame: MAT.cream[3], shutters: MAT.wood, lit: nightLights });
    const ax = 2 + i * 7;
    p.rect(ax + 1, 24, 5, 8, MAT.stone[3]);
    p.hline(ax + 2, 23, 3, MAT.stone[3]);
    p.vline(ax, 23, 9, MAT.stone[1]);
  }
  p.vline(30, 23, 9, MAT.stone[1]);
  // Suelo empedrado de la plaza.
  for (let y = 32; y < 47; y++) for (let x = 0; x < 32; x++) p.set(x, y, hash(x, y, 31) > 0.82 ? MAT.stone[2] : (x + y) % 4 === 0 ? MAT.stone[0] : MAT.stone[1]);
  // Gradas del rollo.
  p.rect(10, 42, 12, 2, MAT.stone[2]);
  p.hline(10, 42, 12, MAT.stone[0]);
  p.rect(12, 40, 8, 2, MAT.stone[2]);
  p.hline(12, 40, 8, MAT.stone[0]);
  // Columna, capitel y cruz de remate.
  p.shadow(17, 41, 4, 1);
  p.rect(15, 18, 3, 22, MAT.white[1]);
  p.vline(15, 18, 22, MAT.white[0]);
  p.vline(17, 18, 22, MAT.white[2]);
  p.rect(14, 16, 5, 2, MAT.white[2]);
  p.hline(14, 16, 5, MAT.white[0]);
  p.vline(16, 11, 5, MAT.metal[3]);
  p.hline(15, 12, 3, MAT.metal[3]);
  bush(p, 3, 41, 2, 4, true);
  bush(p, 28, 41, 2, 5, true);
  return p;
}

const HERITAGE_MAKERS: Record<HeritageVariantArt, () => Pix> = { faro: lighthouse, molino: watermill, castillo: castle, rollo };

/** 2.3: sprite del patrimonio según su forma (la decide el terreno, `heritageVariant`). */
export function heritageSprite(variant: HeritageVariantArt, tod: TimeOfDay = 'day', snow = false): HTMLCanvasElement {
  const key = `heritage-${variant}`;
  const make = HERITAGE_MAKERS[variant];
  return snow ? sprite(`snow-${key}`, () => snowify(make()), tod) : sprite(key, make, tod);
}

/* ================= 2.3: grandes obras por fases (2×2) y la gran empresa ================= */

/** Andamio: postes amarillos y tablones de madera sobre una zona. */
function scaffold(p: Pix, x0: number, x1: number, top: number, bottom: number) {
  for (let x = x0; x <= x1; x += 8) p.vline(x, top, bottom - top, MAT.yellow[2]);
  p.vline(x1, top, bottom - top, MAT.yellow[2]);
  for (let y = top + 2; y < bottom; y += 6) {
    p.hline(x0, y, x1 - x0 + 1, MAT.wood[1]);
    p.hline(x0, y + 1, x1 - x0 + 1, MAT.wood[3]);
  }
  for (let i = 0; i < Math.min(12, bottom - top); i++) p.set(x0 + 1 + i, bottom - 1 - i, MAT.yellow[3]);
}

/** Grúa torre: mástil, pluma y gancho. */
function crane(p: Pix, x: number, top: number, bottom: number, reach: number) {
  for (let y = top; y < bottom; y++) {
    p.set(x, y, MAT.yellow[1]);
    p.set(x + 2, y, MAT.yellow[2]);
    if (y % 3 === 0) p.set(x + 1, y, MAT.yellow[3]);
  }
  p.hline(x - 4, top, reach + 6, MAT.yellow[1]);
  p.hline(x - 4, top + 1, reach + 6, MAT.yellow[3]);
  p.rect(x - 6, top - 1, 3, 4, MAT.stone[3]);
  p.vline(x + reach, top + 2, 6, MAT.metal[3]);
  p.rect(x + reach - 1, top + 8, 3, 2, MAT.metal[2]);
}

/** Solar de obra con valla (fase 0). */
function siteGround(p: Pix, x: number, y: number, w: number, h: number, seed: number) {
  p.rect(x, y, w, h, MAT.dirt[2]);
  p.dither(x, y, w, h, MAT.dirt[1], seed % 2);
  for (let i = 0; i < w; i++) p.set(x + Math.floor(hash(i, seed) * w), y + Math.floor(hash(seed, i) * h), MAT.dirt[3]);
  // Valla de obra (tablas blancas y rojas) en el borde de delante.
  for (let i = 0; i < w; i += 2) p.set(x + i, y + h - 2, i % 8 < 4 ? 12 : MAT.red[1]);
  p.hline(x, y + h - 1, w, MAT.wood[3]);
}

/**
 * Obra a medias: el suelo de obra, lo construido de abajo arriba según las
 * fases hechas (`done` de `phases`), andamios sobre lo que falta y grúa.
 */
function inProgress(full: Pix, done: number, phases: number, ground: { x: number; y: number; w: number; h: number }, top: number, seed: number): Pix {
  if (done >= phases) return full;
  const p = new Pix(full.w, full.h);
  siteGround(p, ground.x, ground.y, ground.w, ground.h, seed);
  const bottom = ground.y + ground.h - 2;
  const cut = Math.round(bottom - (bottom - top) * (done / phases));
  for (let y = cut; y < full.h; y++) {
    for (let x = 0; x < full.w; x++) {
      const c = full.get(x, y);
      if (c !== NONE) p.set(x, y, c);
    }
  }
  scaffold(p, ground.x + 4, ground.x + ground.w - 5, Math.max(top, cut - 10), bottom);
  crane(p, ground.x + ground.w - 14, Math.max(2, top - 6), bottom, 10);
  p.rect(ground.x + 6, bottom - 5, 7, 4, MAT.brick[1]);
  p.hline(ground.x + 6, bottom - 5, 7, MAT.brick[0]);
  person(p, ground.x + 18, bottom - 8, 9, 4);
  return p;
}

/** Estación de tren: andén, vías y edificio de viajeros con reloj. */
function stationPix(seed: number): Pix {
  const p = new Pix(2 * T, BH + T);
  p.rect(0, 16, 64, 64, MAT.stone[2]);
  p.dither(0, 16, 64, 64, MAT.stone[1], 1);
  // Vías delante (traviesas de madera y raíles de metal).
  p.rect(0, 66, 64, 12, MAT.dirt[2]);
  for (let x = 1; x < 64; x += 4) p.rect(x, 67, 2, 10, MAT.wood[2]);
  p.hline(0, 69, 64, MAT.metal[1]);
  p.hline(0, 74, 64, MAT.metal[1]);
  p.hline(0, 79, 64, MAT.stone[3]);
  // Andén con marquesina.
  p.rect(2, 58, 60, 8, MAT.stone[0]);
  p.hline(2, 65, 60, MAT.stone[3]);
  for (let x = 6; x < 60; x += 12) p.vline(x, 46, 12, MAT.metal[3]);
  p.rect(2, 44, 60, 3, MAT.teal[1]);
  p.hline(2, 44, 60, MAT.teal[0]);
  p.hline(2, 46, 60, MAT.teal[3]);
  // Edificio de viajeros.
  castShadow(p, 10, 14, 46, 30);
  facade(p, 10, 22, 44, 22, MAT.cream, 'plaster', seed);
  gableRoof(p, 8, 10, 48, 6, 6, MAT.terracotta);
  for (const x of [14, 22, 38, 46]) windowAt(p, x, 28, 4, 7, { frame: 12, lit: nightLights });
  doorAt(p, 29, 31, 6, 13, MAT.wood);
  // Reloj en el frontón.
  p.ball(32, 16, 3.5, MAT.white, seed);
  p.vline(32, 14, 2, MAT.metal[3]);
  p.hline(32, 16, 2, MAT.metal[3]);
  return p;
}

/** Feria regional: casetas de lona a rayas y una noria. */
function fairPix(seed: number): Pix {
  const p = new Pix(2 * T, BH + T);
  p.rect(0, 16, 64, 64, MAT.dirt[1]);
  p.dither(0, 16, 64, 64, MAT.dirt[0], seed % 2);
  // Noria a la izquierda.
  const cx = 18;
  const cy = 28;
  for (let a = 0; a < 96; a++) {
    const t = (a / 96) * Math.PI * 2;
    p.set(Math.round(cx + Math.cos(t) * 14), Math.round(cy + Math.sin(t) * 14), MAT.metal[1]);
  }
  p.vline(cx - 6, cy, 34, MAT.metal[3]);
  p.vline(cx + 6, cy, 34, MAT.metal[3]);
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * Math.PI * 2;
    for (let r = 0; r < 14; r++) p.set(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), MAT.metal[2]);
    p.rect(Math.round(cx + Math.cos(t) * 14) - 1, Math.round(cy + Math.sin(t) * 14), 3, 3, [MAT.red[1], MAT.blue[1], MAT.yellow[1], MAT.teal[1]][k % 4]!);
  }
  // Casetas a rayas.
  for (const [x, y, m] of [[34, 34, MAT.red], [48, 42, MAT.blue], [30, 56, MAT.yellow], [46, 62, MAT.red]] as const) {
    castShadow(p, x, y, 16, 14);
    p.rect(x, y + 6, 14, 8, MAT.white[1]);
    for (let i = 0; i < 14; i += 4) p.rect(x + i, y + 6, 2, 8, m[1]);
    for (let i = 0; i < 7; i++) p.hline(x + 7 - i, y + i - 1, i * 2 + 1, i % 2 ? m[2] : MAT.white[1]);
    p.hline(x, y + 13, 14, MAT.wood[3]);
  }
  // Banderines.
  for (let x = 2; x < 62; x += 3) p.set(x, 77 - (x % 6 === 2 ? 1 : 0), [MAT.red[1], MAT.yellow[1], MAT.blue[1]][x % 3]!);
  return p;
}

/** Estadio: graderío de piedra alrededor del césped y cuatro torres de luz. */
function stadiumPix(seed: number): Pix {
  const p = new Pix(2 * T, BH + T);
  p.rect(0, 16, 64, 64, MAT.stone[2]);
  for (let r = 0; r < 4; r++) p.ellipse(32, 48 - r, 31 - r * 2, 30 - r * 2, r % 2 ? MAT.stone[0] : MAT.stone[1]);
  p.ellipse(32, 48, 22, 20, MAT.moss[1]);
  for (let y = 30; y < 68; y += 4) for (let x = 10; x < 54; x++) if (p.get(x, y) === MAT.moss[1]) p.set(x, y, MAT.moss[0]);
  p.frame(18, 36, 28, 24, 12);
  p.hline(18, 48, 28, 12);
  p.ellipse(32, 48, 3, 3, 12);
  p.ellipse(32, 48, 2, 2, MAT.moss[1]);
  // Público (puntos de colores en las gradas).
  for (let i = 0; i < 110; i++) {
    const t = hash(i, seed) * Math.PI * 2;
    const r = 0.8 + hash(seed, i) * 0.14;
    p.set(Math.round(32 + Math.cos(t) * 30 * r), Math.round(47 + Math.sin(t) * 29 * r), [MAT.red[1], MAT.blue[1], MAT.yellow[0], 12][i % 4]!);
  }
  for (const [x, y] of [[3, 24], [60, 24], [3, 74], [60, 74]] as const) {
    p.vline(x, y - 14, 15, MAT.metal[3]);
    p.rect(x - 2, y - 16, 5, 3, nightLights ? C.lamp : MAT.metal[0]);
  }
  p.hline(0, 79, 64, MAT.stone[3]);
  return p;
}

/** Catedral: fachada de piedra con dos torres y rosetón. */
function cathedralPix(seed: number): Pix {
  const p = new Pix(2 * T, BH + T);
  p.rect(0, 64, 64, 16, MAT.stone[1]);
  p.dither(0, 64, 64, 16, MAT.stone[0], 0);
  castShadow(p, 6, 8, 54, 58);
  facade(p, 16, 24, 32, 42, MAT.cream, 'stone', seed);
  for (const x of [4, 46]) {
    facade(p, x, 12, 14, 54, MAT.cream, 'stone', seed + x);
    for (let i = 0; i < 7; i++) p.hline(x + 7 - i, 5 + i, i * 2 + 1, MAT.slate[i % 2 ? 2 : 1]);
    windowAt(p, x + 5, 20, 4, 8, { frame: 12 });
  }
  for (let i = 0; i < 10; i++) p.hline(32 - i * 2, 14 + i, i * 4 + 1, MAT.cream[i % 3 === 0 ? 0 : 1]);
  p.ball(32, 34, 6, MAT.glass, seed);
  p.ellipse(32, 34, 2, 2, nightLights ? C.lampWarm : MAT.red[1]);
  doorAt(p, 27, 50, 10, 16, MAT.wood);
  p.hline(26, 49, 12, MAT.cream[0]);
  return p;
}

/** Puente de piedra sobre el río: arco y pretiles (el agua se ve por debajo y a los lados). */
function stoneBridgePix(horizontal: boolean, seed: number): Pix {
  const p = new Pix(T, BH);
  if (horizontal) {
    // El tablero va de izquierda a derecha; debajo, el arco (hueco: se ve el agua).
    facade(p, 0, 24, 32, 18, MAT.stone, 'stone', seed);
    for (let x = 4; x < 28; x++) {
      const d = Math.round(Math.sqrt(Math.max(0, 144 - (x - 16) ** 2)) * 0.8);
      for (let y = 42 - d; y < 42; y++) p.set(x, y, NONE);
      p.set(x, 41 - d, MAT.stone[3]);
    }
    p.rect(0, 18, 32, 6, MAT.stone[1]);
    p.dither(0, 19, 32, 4, MAT.stone[0], seed % 2);
    p.hline(0, 17, 32, MAT.stone[0]);
    p.hline(0, 23, 32, MAT.stone[3]);
    for (let x = 1; x < 32; x += 5) p.rect(x, 14, 3, 3, MAT.stone[1]);
  } else {
    // Tablero de arriba abajo: pretiles a los lados.
    p.rect(9, 16, 14, 32, MAT.stone[1]);
    p.dither(10, 16, 12, 32, MAT.stone[0], seed % 2);
    for (let y = 16; y < 48; y += 4) p.hline(9, y, 14, MAT.stone[2]);
    p.rect(7, 12, 3, 36, MAT.stone[0]);
    p.rect(22, 12, 3, 36, MAT.stone[2]);
    p.vline(25, 14, 34, MAT.stone[3]);
  }
  return p;
}

/** Fábrica de la gran empresa: nave grande de dientes de sierra, dos chimeneas y muelle de carga. */
function bigFactoryPix(seed: number): Pix {
  const p = new Pix(2 * T, BH + T);
  p.rect(0, 16, 64, 64, MAT.stone[2]);
  p.dither(0, 60, 64, 20, MAT.stone[1], 0);
  castShadow(p, 2, 18, 60, 44);
  facade(p, 2, 34, 58, 28, MAT.metal, 'metal', seed);
  // Tejado en dientes de sierra (con lucernarios).
  for (let k = 0; k < 6; k++) {
    const x = 2 + k * 10;
    for (let i = 0; i < 10; i++) {
      const hgt = Math.round(i * 0.8);
      for (let y = 34 - hgt; y < 34; y++) p.set(x + i, y, i < 2 ? MAT.glass[1] : MAT.slate[1]);
    }
  }
  // Chimeneas a rayas.
  for (const x of [8, 18]) {
    p.rect(x, 2, 5, 32, MAT.brick[1]);
    for (let y = 4; y < 34; y += 8) p.rect(x, y, 5, 2, 12);
    p.vline(x + 4, 2, 32, MAT.brick[3]);
  }
  // Muelle de carga y portones.
  for (const x of [26, 38, 50]) {
    p.rect(x, 46, 8, 16, MAT.metal[3]);
    for (let y = 47; y < 62; y += 2) p.hline(x + 1, y, 6, MAT.metal[2]);
  }
  windowAt(p, 6, 44, 10, 6, { frame: 12, lit: nightLights });
  p.rect(40, 66, 14, 8, MAT.blue[1]);
  p.hline(40, 66, 14, MAT.blue[0]);
  p.hline(0, 79, 64, MAT.stone[3]);
  return p;
}

/**
 * 2.3: sprite de una gran obra según las fases hechas (`done` de `phases`):
 * 64×80 en las 2×2 (se ancla en la casilla de arriba a la izquierda, ocupa
 * 2×2 casillas y sobresale 16 px por arriba) y 32×48 el puente de piedra
 * (`horizontal`: el tablero va de izquierda a derecha). La fábrica de la gran
 * empresa usa `kind = 'bigfactory'` (sin fases: `done = phases`).
 */
export function landmarkSprite(kind: string, done: number, phases: number, tod: TimeOfDay = 'day', snow = false, horizontal = true): HTMLCanvasElement {
  const make = (): Pix => {
    if (kind === 'bridge') {
      const full = stoneBridgePix(horizontal, 21);
      if (done >= phases) return full;
      // A medias: pilares en el agua y el arco que sube con andamios.
      const q = new Pix(T, BH);
      const cut = Math.round(46 - 32 * (done / phases));
      for (let y = cut; y < BH; y++) for (let x = 0; x < T; x++) if (full.get(x, y) !== NONE) q.set(x, y, full.get(x, y));
      q.rect(2, 30, 4, 18, MAT.stone[2]);
      q.rect(26, 30, 4, 18, MAT.stone[2]);
      scaffold(q, 3, 28, Math.max(14, cut - 8), 46);
      return q;
    }
    const full = kind === 'station' ? stationPix(22) : kind === 'fair' ? fairPix(23) : kind === 'stadium' ? stadiumPix(24) : kind === 'cathedral' ? cathedralPix(25) : bigFactoryPix(26);
    return inProgress(full, done, phases, { x: 0, y: 16, w: 64, h: 64 }, kind === 'stadium' || kind === 'fair' ? 18 : 6, 27);
  };
  const key = `lm-${kind}-${done}-${phases}-${horizontal ? 'h' : 'v'}`;
  return snow ? sprite(`snow-${key}`, () => snowify(make()), tod) : sprite(key, make, tod);
}

/* ======================= 2.4 «Vida»: cuidados, agua, energía y transporte ======================= */

/** Línea de un píxel (Bresenham) con el color dado. */
function line(p: Pix, x0: number, y0: number, x1: number, y1: number, c: number): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    p.set(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Guardería: casita amarilla con tejado rojo, tobogán, arenero y valla de colores. */
function nurseryPix(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 10, 26, 20, 19);
  facade(p, 10, 28, 20, 16, MAT.yellow, 'plaster', seed);
  gableRoof(p, 8, 19, 24, 4, 7, RED_TILE);
  // Rótulo con tres cubos de letras (rojo, azul, verde).
  p.rect(13, 30, 14, 4, 12);
  p.rect(14, 31, 3, 2, 2);
  p.rect(18, 31, 3, 2, 10);
  p.rect(22, 31, 3, 2, 6);
  windowAt(p, 13, 36, 3, 3, { frame: 12, flowers: true });
  windowAt(p, 25, 36, 3, 3, { frame: 12 });
  doorAt(p, 18, 36, 4, 7, MAT.blue, 12);
  // Tobogán: escalera, plataforma y la rampa roja.
  p.vline(2, 31, 13, MAT.metal[2]);
  p.vline(4, 31, 13, MAT.metal[2]);
  for (let y = 33; y < 44; y += 2) p.hline(2, y, 3, MAT.metal[1]);
  p.hline(1, 31, 5, MAT.wood[1]);
  line(p, 5, 31, 9, 42, MAT.red[1]);
  line(p, 6, 31, 10, 42, MAT.red[2]);
  p.hline(9, 43, 2, MAT.red[2]);
  // Arenero con un cubo.
  p.rect(1, 44, 8, 3, MAT.wood[2]);
  p.rect(2, 45, 6, 1, 21);
  p.set(4, 44, 10);
  // Valla de colores.
  for (let x = 11; x < 31; x += 2) p.vline(x, 45, 2, [2, 4, 10, 6][(x >> 1) % 4]!);
  p.hline(11, 46, 20, MAT.wood[2]);
  return p;
}

/** Residencia de mayores: dos plantas, balcón corrido con flores, banco con un abuelo y rampa. */
function residencePix(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 2, 16, 28, 30);
  facade(p, 2, 20, 28, 25, MAT.cream, 'plaster', seed);
  gableRoof(p, 1, 10, 30, 4, 8, MAT.terracotta);
  // Planta alta: cuatro ventanas con flores y el balcón corrido.
  for (const x of [5, 11, 18, 24]) windowAt(p, x, 23, 3, 4, { frame: 12, flowers: true });
  p.hline(3, 30, 26, MAT.wood[2]);
  for (let x = 3; x < 29; x += 2) p.set(x, 29, MAT.wood[1]);
  // Planta baja: ventanas, puerta acristalada y rampa.
  windowAt(p, 5, 34, 3, 4, { frame: 12 });
  windowAt(p, 24, 34, 3, 4, { frame: 12 });
  p.rect(12, 34, 8, 10, MAT.glass[2]);
  p.rect(12, 34, 8, 4, MAT.glass[1]);
  p.vline(16, 34, 10, 12);
  p.frame(11, 33, 10, 12, 12);
  // Placa verde (centro de mayores).
  p.rect(14, 31, 4, 2, MAT.moss[1]);
  p.set(15, 31, 12);
  line(p, 21, 44, 26, 41, MAT.stone[1]);
  p.hline(21, 45, 7, MAT.stone[2]);
  // Banco con un abuelo de pelo gris y su bastón.
  p.hline(1, 46, 8, MAT.wood[1]);
  p.set(1, 47, MAT.wood[3]);
  p.set(8, 47, MAT.wood[3]);
  person(p, 3, 39, MAT.plum[1], C.hairGray);
  p.vline(8, 41, 5, MAT.wood[3]);
  p.set(7, 41, MAT.wood[3]);
  bush(p, 29, 45, 2.5, seed, true);
  return p;
}

/** Autobús interurbano de 16×8: blanco con franja azul, ventanillas y ruedas que giran. */
export function busPix(frame: number, dir: 1 | -1): Pix {
  const p = new Pix(16, 8);
  const fx = (x: number) => (dir === 1 ? x : 15 - x);
  const set = (x: number, y: number, c: number) => p.set(fx(x), y, c);
  const rect = (x: number, y: number, w: number, h: number, c: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c);
  };
  for (let x = 1; x < 15; x++) set(x, 7, 24); // sombra
  rect(0, 1, 16, 5, 12);
  rect(0, 0, 15, 1, 31);
  // Ventanillas con montantes y el parabrisas delante.
  rect(1, 2, 12, 2, MAT.glass[1]);
  for (let x = 4; x < 13; x += 3) rect(x, 2, 1, 2, 12);
  rect(13, 1, 3, 3, MAT.glass[0]);
  set(15, 1, MAT.glass[2]);
  rect(0, 4, 16, 1, MAT.blue[1]);
  rect(0, 5, 16, 1, 13);
  set(15, 4, 4); // faro
  set(0, 4, MAT.red[1]); // piloto
  for (const x of [2, 11]) {
    rect(x, 5, 2, 2, 0);
    set(x + (frame % 2), 6, 55);
  }
  return p;
}
export const busSprite = (frame: number, dir: 1 | -1, tod: TimeOfDay = 'day') => sprite(`autobus-${frame % 2}-${dir}`, () => busPix(frame, dir), tod);

/** Estación de autobuses: caseta con taquilla, marquesina con andén, señal azul y un autobús parado. */
function busStationPix(seed: number): Pix {
  const p = new Pix(T, BH);
  // Andén de asfalto con las plazas pintadas.
  p.rect(0, 36, 32, 11, MAT.stone[2]);
  p.dither(0, 36, 32, 11, MAT.stone[3], seed % 2);
  p.hline(0, 36, 32, MAT.stone[1]);
  for (let x = 1; x < 32; x += 4) p.hline(x, 46, 2, 12);
  // Caseta con taquilla.
  castShadow(p, 1, 22, 13, 14);
  facade(p, 1, 23, 13, 13, MAT.white, 'plaster', seed);
  flatRoof(p, 0, 19, 15, 5, MAT.blue, seed);
  windowAt(p, 3, 28, 4, 3, { frame: 12 });
  doorAt(p, 9, 28, 3, 7, MAT.blue, 12);
  // Rótulo azul.
  p.rect(3, 24, 9, 2, MAT.blue[1]);
  p.hline(4, 24, 2, 12);
  p.hline(7, 25, 4, 12);
  // Marquesina: dos postes y la cubierta.
  p.vline(16, 27, 10, MAT.metal[2]);
  p.vline(30, 27, 10, MAT.metal[2]);
  p.rect(15, 24, 17, 3, MAT.teal[1]);
  p.hline(15, 24, 17, MAT.teal[0]);
  p.hline(15, 26, 17, MAT.teal[3]);
  p.hline(17, 33, 12, MAT.wood[1]); // banco
  // Señal de parada en su poste.
  p.vline(26, 12, 12, MAT.metal[2]);
  p.ball(26, 11, 2.6, MAT.blue, seed);
  p.set(26, 11, 12);
  p.set(25, 10, 12);
  // Autobús parado en el andén.
  p.blit(busPix(0, -1), 15, 37);
  return p;
}

/** Depuradora: dos balsas redondas (una con el puente que gira), caseta de control y tubería. */
function sewagePix(seed: number): Pix {
  const p = new Pix(T, BH);
  const tank = (cx: number, cy: number, rx: number, ry: number) => {
    p.ellipse(cx, cy + 1, rx + 1, ry + 1, MAT.stone[3]);
    p.ellipse(cx, cy, rx + 1, ry + 1, MAT.stone[1]);
    p.ellipse(cx, cy, rx, ry, C.waterDeep);
    p.ellipse(cx - 1, cy - 1, rx - 2, ry - 2, 7);
    p.dither(cx - rx + 2, cy - 1, rx * 2 - 4, 2, 63, seed % 2);
  };
  tank(10, 37, 9, 6);
  tank(23, 25, 7, 5);
  // Puente giratorio de la balsa grande.
  p.hline(2, 37, 17, MAT.metal[1]);
  p.hline(2, 38, 17, MAT.metal[3]);
  p.rect(9, 35, 3, 3, MAT.metal[0]);
  // Caseta de control.
  castShadow(p, 22, 36, 9, 9);
  facade(p, 22, 37, 9, 9, MAT.white, 'plaster', seed);
  flatRoof(p, 21, 34, 11, 4, MAT.teal, seed);
  windowAt(p, 24, 40, 2, 2, { frame: 12 });
  p.rect(28, 41, 2, 5, MAT.teal[2]);
  // Tubería de la balsa pequeña a la grande.
  p.hline(14, 30, 5, MAT.metal[2]);
  p.vline(14, 30, 3, MAT.metal[2]);
  p.set(18, 30, MAT.metal[0]);
  return p;
}

/** Placas solares: tres filas de paneles azules con su cuadrícula, patas y el inversor. */
function solarPix(seed: number): Pix {
  const p = new Pix(T, BH);
  for (const [i, y] of [[0, 21], [1, 29], [2, 37]] as const) {
    const x = 2 + (i % 2);
    p.shadow(x + 1, y + 7, 26, 2);
    p.rect(x, y, 27, 6, MAT.blue[2]);
    p.hline(x, y, 27, MAT.glass[0]);
    p.hline(x, y + 1, 27, MAT.blue[1]);
    for (let k = x + 4; k < x + 27; k += 5) p.vline(k, y, 6, MAT.blue[3]);
    p.hline(x, y + 3, 27, MAT.blue[3]);
    p.hline(x, y + 5, 27, MAT.metal[2]);
    p.set(x + 1 + Math.floor(hash(seed, i) * 24), y + 2, 12); // reflejo
    for (const lx of [x + 2, x + 24]) p.vline(lx, y + 6, 2, MAT.metal[3]);
  }
  // Inversor con su piloto verde.
  p.rect(26, 44, 4, 3, MAT.metal[1]);
  p.set(27, 45, 6);
  return p;
}

/**
 * Molino de viento (aerogenerador) de 32×48: torre blanca que se estrecha,
 * góndola y tres aspas. `frame` (0–2) gira las aspas 40° cada vez (con tres
 * aspas, a los 120° se repite).
 */
function windPix(frame: number): Pix {
  const p = new Pix(T, BH);
  p.ellipse(16, 46, 5, 1.5, MAT.stone[2]);
  p.shadow(18, 44, 6, 2);
  for (let y = 13; y < 46; y++) {
    const w = 2 + Math.floor((y - 13) / 11);
    const x0 = 16 - Math.floor(w / 2);
    p.hline(x0, y, w, 12);
    p.set(x0 + w - 1, y, 13);
    p.set(x0, y, 31);
  }
  p.hline(15, 40, 3, MAT.red[1]); // franja
  p.rect(15, 42, 2, 3, MAT.metal[2]); // puerta
  // Góndola.
  p.rect(15, 10, 7, 3, 12);
  p.hline(15, 12, 7, 13);
  p.set(21, 10, 13);
  // Aspas.
  const hx = 15;
  const hy = 11;
  for (let k = 0; k < 3; k++) {
    const a = ((frame % 3) * 40 + k * 120 - 90) * (Math.PI / 180);
    line(p, hx, hy, hx + Math.cos(a) * 11, hy + Math.sin(a) * 11, 31);
    line(p, hx + Math.cos(a + 1.2), hy + Math.sin(a + 1.2), hx + Math.cos(a) * 6 + Math.cos(a + 1.2), hy + Math.sin(a) * 6 + Math.sin(a + 1.2), 13);
  }
  p.ball(hx + 0.5, hy + 0.5, 1.6, MAT.metal, 3);
  return p;
}

/** 2.4: el molino con las aspas en la posición `frame` (0–2), con nieve si toca. */
export function windSprite(frame: number, tod: TimeOfDay = 'day', snow = false): HTMLCanvasElement {
  const f = ((frame % 3) + 3) % 3;
  return snow ? sprite(`snow-wind-${f}`, () => snowify(windPix(f)), tod) : sprite(`wind-${f}`, () => windPix(f), tod);
}

/** Hoguera de San Juan de 16×16: troncos cruzados y llamas (2 fotogramas, sin destellos). */
export function bonfirePix(frame: number): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 14, 7, 1.5, 24);
  line(p, 2, 14, 13, 10, MAT.wood[3]);
  line(p, 3, 10, 14, 14, MAT.wood[2]);
  line(p, 2, 13, 13, 9, MAT.wood[1]);
  const f = frame % 2;
  p.ellipse(8, 9 - f, 4, 4, MAT.red[1]);
  p.ellipse(8 - f, 8 - f, 3, 3.5, 3);
  p.ellipse(8, 8, 1.6, 2.6, 4);
  p.set(8 - f, 3 + f, 3);
  p.set(6 + 2 * f, 4, 2);
  p.set(8, 6, 12);
  p.set(11 - f, 2, 4);
  return p;
}
export const bonfireSprite = (frame: number, tod: TimeOfDay = 'day') => sprite(`hoguera-${frame % 2}`, () => bonfirePix(frame), tod);

/* ---------------- 2.5 «Comarca» ---------------- */

/** Cooperativa agraria: nave con portalón, sacos y una báscula; en el nivel 2, los depósitos de la almazara o la bodega. */
function coopPix(seed: number, level: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 2, 24, 22, 22);
  facade(p, 2, 28, 22, 17, MAT.cream, 'plaster', seed);
  gableRoof(p, 1, 20, 24, 4, 8, MAT.terracotta);
  // Portalón de madera y rótulo verde.
  doorAt(p, 9, 34, 8, 11, MAT.wood, 12);
  p.rect(6, 30, 14, 3, MAT.moss[1]);
  p.hline(8, 31, 10, 12);
  windowAt(p, 4, 35, 2, 3, { frame: 12 });
  windowAt(p, 20, 35, 2, 3, { frame: 12 });
  // Sacos de grano junto a la puerta.
  for (const [x, y] of [[25, 42], [28, 42], [26, 39]] as const) {
    p.ellipse(x + 1, y + 2, 2, 2, MAT.wood[0]);
    p.set(x + 1, y, MAT.wood[2]);
  }
  if (level >= 2) {
    // Depósitos de acero de la almazara o la bodega.
    for (const x of [25, 29]) {
      p.rect(x, 24, 3, 14, MAT.metal[1]);
      p.vline(x, 24, 14, MAT.metal[0]);
      p.vline(x + 2, 24, 14, MAT.metal[2]);
      p.hline(x, 23, 3, MAT.metal[2]);
    }
    p.hline(25, 30, 7, MAT.metal[3]);
  } else {
    // Remolque con paja.
    p.rect(24, 32, 7, 4, MAT.yellow[1]);
    p.dither(24, 32, 7, 4, MAT.yellow[2], seed % 2);
    p.hline(24, 36, 7, MAT.wood[2]);
    p.set(25, 37, MAT.metal[3]);
    p.set(29, 37, MAT.metal[3]);
  }
  return p;
}

/** Oficina de correos: fachada amarilla, rótulo, buzón en la acera y una bici de reparto. */
function postPix(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 4, 22, 22, 24);
  facade(p, 4, 26, 22, 19, MAT.yellow, 'plaster', seed);
  flatRoof(p, 3, 22, 24, 5, MAT.yellow, seed);
  // Rótulo azul con el sobre.
  p.rect(7, 28, 16, 4, MAT.blue[1]);
  p.rect(13, 29, 4, 2, 12);
  p.set(14, 29, MAT.blue[2]);
  p.set(15, 29, MAT.blue[2]);
  windowAt(p, 7, 35, 4, 4, { frame: 12 });
  windowAt(p, 19, 35, 4, 4, { frame: 12 });
  doorAt(p, 13, 36, 4, 9, MAT.blue, 12);
  // Buzón amarillo en su poste.
  p.vline(28, 40, 6, MAT.metal[2]);
  p.rect(26, 36, 5, 5, MAT.yellow[1]);
  p.hline(26, 36, 5, MAT.yellow[2]);
  p.hline(27, 38, 3, MAT.yellow[3]);
  // Bici de reparto apoyada.
  p.ellipse(2, 44, 1, 1, MAT.metal[3]);
  p.ellipse(6, 44, 1, 1, MAT.metal[3]);
  line(p, 2, 44, 4, 41, MAT.red[1]);
  line(p, 4, 41, 6, 44, MAT.red[1]);
  p.rect(4, 40, 3, 2, MAT.yellow[1]);
  return p;
}
