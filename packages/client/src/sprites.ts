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
const SHUTTERS: Mat[] = [MAT.moss, MAT.teal, MAT.red, MAT.blue];

function cottage(seed: number): Pix {
  const p = new Pix(T, BH);
  castShadow(p, 3, 26, 25, 20);
  // Jardín con valla.
  for (let x = 1; x < 31; x += 3) {
    p.vline(x, 41, 5, MAT.wood[1]);
    p.set(x, 41, MAT.wood[0]);
  }
  p.hline(1, 43, 30, MAT.wood[2]);
  facade(p, 4, 26, 24, 18, MAT.cream, 'plaster', seed);
  gableRoof(p, 2, 13, 28, 6, 8, MAT.terracotta);
  chimney(p, 21, 8, 7, true, seed);
  windowAt(p, 8, 30, 5, 6, { shutters: MAT.moss, flowers: true });
  windowAt(p, 21, 30, 4, 6, { shutters: MAT.moss });
  doorAt(p, 14, 34, 5, 9);
  bush(p, 3, 44, 3, seed, true);
  bush(p, 28, 44, 3, seed + 3, true);
  return p;
}

function apartment(seed: number): Pix {
  const p = new Pix(T, BH);
  const [wall, tex] = WALLS[seed % WALLS.length]!;
  const roof = ROOFS[(seed >> 3) % ROOFS.length]!;
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
      p.set(x, y, n > 0.77 ? 22 : n < 0.17 ? 24 : 23);
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

/** Solar recalificado: tramado del color de la zona, borde y cartel con la letra. */
export function zoneTile(zone: 'R' | 'C' | 'I', base: Pix): Pix {
  const color = { R: 6, C: 10, I: 4 }[zone];
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

const FONT: Record<string, string[]> = {
  R: ['####.', '#...#', '####.', '#..#.', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
};

export function letter(ch: 'R' | 'C' | 'I', color: number): Pix {
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
  dusk: RGB.map(([r, g, b], i) => (LIGHTS.has(i) ? i : nearest(r * 0.8 + 18, g * 0.62 + 4, b * 0.6 + 14))),
  night: RGB.map(([r, g, b], i) => (LIGHTS.has(i) ? i : nearest(r * 0.3 + 6, g * 0.34 + 8, b * 0.55 + 26))),
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

/** Sprite de 32×48 de un edificio. Las viviendas y tiendas varían con su id. */
export function buildingSprite(kind: string, id: number, tod: TimeOfDay = 'day'): HTMLCanvasElement {
  const s = (key: string, make: () => Pix) => sprite(key, make, tod);
  switch (kind) {
    case 'townhall':
      return s('townhall', townhall);
    case 'water':
      return s('water', () => waterTower(3));
    case 'power':
      return s('power', () => powerPlant(5));
    case 'park':
      return s('park', () => park(11));
    case 'school':
      return s('school', () => school(2));
    case 'clinic':
      return s('clinic', () => clinic(4));
    case 'police':
      return s('police', () => policeStation(6));
    case 'plaza':
      return s('plaza', () => plaza(8));
    case 'market':
      return s('market', () => market(9));
    case 'factory':
      return s(`factory${id % 4}`, () => factory(id % 4));
    case 'shop':
      return s(`shop${id % 16}`, () => shop(id % 16));
    case 'house':
      return s(`house${id % 4}`, () => cottage(id % 4));
    case 'res':
      return s(`res${id % 256}`, () => apartment(Math.floor(hash(id, 77) * 256)));
    default:
      return constructionSprite(0, id, tod);
  }
}

export const constructionSprite = (stage: number, id: number, tod: TimeOfDay = 'day') => sprite(`obra${stage}-${id % 3}`, () => construction(stage, id % 3), tod);
/** Árbol con dos fotogramas de viento (la copa se mece 1 px). */
export const treeSprite = (v: number, frame = 0, tod: TimeOfDay = 'day') => sprite(`tree${v}-${frame}`, () => (frame ? sway(treeTile(v), 30) : treeTile(v)), tod);
export const iconSprite = (k: 'noWater' | 'noPower') => sprite(`icon-${k}`, k === 'noWater' ? iconNoWater : iconNoPower);
export const letterSprite = (ch: 'R' | 'C' | 'I', color: number) => sprite(`L${ch}${color}`, () => letter(ch, color));

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

/** Bocanada de humo (3 tamaños). */
export function puff(size: number): Pix {
  const r = 1.2 + size * 0.9;
  const d = Math.ceil(r * 2) + 2;
  const p = new Pix(d, d);
  p.ball(d / 2, d / 2, r, [12, C.smoke, C.smokeMid, C.smokeDark], size);
  return p;
}
export const puffSprite = (size: number, tod: TimeOfDay = 'day') => sprite(`puff${size}`, () => puff(size), tod);
