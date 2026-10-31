import { type GameState, Tile, Zone } from '@bitopolis/sim';
import { happinessMarks, type LayerId, layerCanvas, missingMarks, NEED_ICON } from './layers.ts';
import { pixelIcon } from './icons.ts';

/** Iconos de la capa «Qué falta», creados una vez. */
const iconCache = new Map<string, HTMLCanvasElement>();
const icon = (name: string) => iconCache.get(name) ?? iconCache.set(name, pixelIcon(name)).get(name)!;
import { liveParticles, squash } from './fx.ts';
import { C, PALETTE } from './palette.ts';
import {
  BH,
  buildingSprite,
  constructionSprite,
  grassTile,
  hash,
  iconSprite,
  Pix,
  puffSprite,
  putPix,
  roadTile,
  T,
  type TimeOfDay,
  toCanvas,
  treeSprite,
  walkerSprite,
  zoneTile,
} from './sprites.ts';

export interface Camera {
  /** Desplazamiento en píxeles de pantalla (de dispositivo). */
  x: number;
  y: number;
  /** Escala entera: píxeles de dispositivo por píxel de sprite. */
  zoom: number;
}

export interface Preview {
  tiles: { x: number; y: number }[];
  ok: boolean;
}

const P = (i: number) => PALETTE[i]!;
const ZONE_LETTER: Record<number, 'R' | 'C' | 'I'> = { [Zone.R]: 'R', [Zone.C]: 'C', [Zone.I]: 'I' };
const GRASS_VARIANTS = 8;
const TREE_VARIANTS = 12;

let ground: HTMLCanvasElement | null = null;
let groundSig = '';

function mapSignature(state: GameState): string {
  let a = 0;
  let b = 0;
  const { tiles, zones } = state.map;
  for (let i = 0; i < tiles.length; i++) {
    a = (Math.imul(a, 31) + tiles[i]! * 7 + zones[i]!) | 0;
    b = (b + tiles[i]! * (i + 1) + zones[i]! * 3 * (i + 7)) | 0;
  }
  let c = 0;
  for (const bd of state.buildings) c = (Math.imul(c, 33) + bd.y * 977 + bd.x) | 0;
  return `${a}:${b}:${c}`;
}


/** Hora del juego → momento del día (1 tick = 1 hora; el día empieza a las 8:00). */
export function timeOfDay(tick: number): TimeOfDay {
  const hour = (tick + 8) % 24;
  if (hour >= 22 || hour < 5) return 'night';
  if (hour === 5 || hour === 6 || hour === 20 || hour === 21) return 'dusk';
  return 'day';
}

interface Run {
  x: number;
  y: number;
  len: number;
  horizontal: boolean;
}
let runs: Run[] = [];
let runsSig = '';

/** Tramos rectos de carretera (para que los vecinos paseen por las aceras). */
function roadRuns(state: GameState): Run[] {
  const { w, h, tiles } = state.map;
  const road = (x: number, y: number) => tiles[y * w + x] === Tile.Road;
  const out: Run[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!road(x, y) || (x > 0 && road(x - 1, y))) continue;
      let len = 1;
      while (x + len < w && road(x + len, y)) len++;
      if (len >= 2) out.push({ x, y, len, horizontal: true });
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (!road(x, y) || (y > 0 && road(x, y - 1))) continue;
      let len = 1;
      while (y + len < h && road(x, y + len)) len++;
      if (len >= 2) out.push({ x, y, len, horizontal: false });
    }
  }
  return out;
}

interface Walker {
  /** Posición de los pies en píxeles de sprite (escala 1). */
  fx: number;
  fy: number;
  dir: 1 | -1;
  frame: number;
  variant: number;
}

/** Vecinos paseando: posición determinista a partir del tiempo (ida y vuelta por un tramo). */
function walkers(state: GameState, time: number, still: boolean, tod: TimeOfDay): Walker[] {
  if (!runs.length) return [];
  const pop = state.citizens.length;
  const n = Math.min(60, Math.ceil(pop / 2), runs.length * 3);
  const count = tod === 'night' ? Math.ceil(n * 0.25) : n;
  const out: Walker[] = [];
  for (let i = 0; i < count; i++) {
    const run = runs[Math.floor(hash(i, 1, runs.length) * runs.length)]!;
    const span = (run.len - 1) * T;
    const speed = 9 + hash(i, 2) * 8; // px de sprite por segundo
    const t = still ? hash(i, 5) * 2 * span : (time / 1000) * speed + hash(i, 3) * 2 * span;
    const u = t % (2 * span || 1);
    const forward = u < span;
    const along = forward ? u : 2 * span - u;
    const lane = hash(i, 4) > 0.5;
    const fx = run.horizontal ? run.x * T + along + 16 : run.x * T + (lane ? 3 : 29);
    const fy = run.horizontal ? run.y * T + (lane ? 4 : 30) : run.y * T + along + 16;
    out.push({ fx, fy, dir: forward === lane ? 1 : -1, frame: still ? 0 : Math.floor(time / 170 + i) % 4, variant: Math.floor(hash(i, 6) * 64) });
  }
  return out;
}

/**
 * Suelo, carreteras y solares: un canvas a escala 1 por momento del día. Solo
 * se repintan las casillas que cambian (antes se rehacía el mapa entero con
 * cada edificio nuevo y en cada cambio de hora, y eso daba tirones).
 */
interface Ground {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  keys: string[];
  w: number;
  h: number;
}
const grounds = new Map<TimeOfDay, Ground>();

function tileKey(state: GameState, x: number, y: number, occupied: Set<number>): string {
  const { w, h, tiles, zones } = state.map;
  const i = y * w + x;
  if (tiles[i] === Tile.Road) {
    const r = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && tiles[yy * w + xx] === Tile.Road;
    return `r${+r(x, y - 1)}${+r(x + 1, y)}${+r(x, y + 1)}${+r(x - 1, y)}`;
  }
  return `g${zones[i] !== Zone.None && !occupied.has(i) ? zones[i] : 0}`;
}

function tilePix(state: GameState, x: number, y: number, key: string): Pix {
  if (key[0] === 'r') {
    const rv = Math.floor(hash(x, y, 2) * 6);
    const k = `${key.slice(1)}-${rv}`;
    let tile = roadCache.get(k);
    if (!tile) roadCache.set(k, (tile = roadTile(key[1] === '1', key[2] === '1', key[3] === '1', key[4] === '1', rv)));
    return tile;
  }
  // La hierba (ruido suave, lo más caro) se calcula una vez por casilla.
  const gi = y * 4096 + x;
  let g = grassCache.get(gi);
  if (!g) grassCache.set(gi, (g = grassTile(Math.floor(hash(x, y, 1) * GRASS_VARIANTS), x, y)));
  const z = Number(key.slice(1));
  return z ? zoneTile(ZONE_LETTER[z]!, g) : g;
}

const grassCache = new Map<number, Pix>();

function groundFor(state: GameState, tod: TimeOfDay, budget = Infinity): HTMLCanvasElement {
  const { w, h } = state.map;
  let g = grounds.get(tod);
  if (!g || g.w !== w || g.h !== h) {
    const canvas = document.createElement('canvas');
    canvas.width = w * T;
    canvas.height = h * T;
    g = { canvas, ctx: canvas.getContext('2d')!, keys: new Array<string>(w * h).fill(''), w, h };
    grounds.set(tod, g);
  }
  const occupied = new Set(state.buildings.map((b) => b.y * w + b.x));
  let left = budget;
  for (let y = 0; y < h && left > 0; y++) {
    for (let x = 0; x < w && left > 0; x++) {
      const key = tileKey(state, x, y, occupied);
      if (g.keys[y * w + x] === key) continue;
      g.keys[y * w + x] = key;
      putPix(g.ctx, tilePix(state, x, y, key), x * T, y * T, tod);
      left--;
    }
  }
  return g.canvas;
}

/** Prepara poco a poco los suelos de los otros momentos del día (sin tirones al cambiar de hora). */
const TODS: TimeOfDay[] = ['day', 'dusk', 'night'];
let warmSig = '';
let warmDone = new Set<TimeOfDay>();
function warmGrounds(state: GameState, current: TimeOfDay, sig: string) {
  if (sig !== warmSig) {
    warmSig = sig;
    warmDone = new Set();
  }
  const next = TODS.find((t) => t !== current && !warmDone.has(t));
  if (!next) return;
  const g = grounds.get(next);
  const before = g ? g.keys.filter(Boolean).length : 0;
  groundFor(state, next, 96);
  const after = grounds.get(next)!.keys.filter(Boolean).length;
  // Sin cambios pendientes en esta pasada: listo hasta que cambie el mapa.
  if (g && after === before) warmDone.add(next);
}

const roadCache = new Map<string, Pix>();

/** Imagen de las herramientas: un sprite reducido a su caja. */
export function toolCanvas(kind: string): HTMLCanvasElement {
  return buildingSprite(kind, 1);
}

export { toCanvas };

/* ---------- farolas (v1.3) ---------- */

/** Farola en esta casilla de carretera: algunas, junto a edificios (no en mitad del campo). */
function lampAt(state: GameState, byTile: Map<number, unknown>, x: number, y: number): boolean {
  if (hash(x, y, 11) > 0.14) return false;
  const { w } = state.map;
  return byTile.has(y * w + x - 1) || byTile.has(y * w + x + 1) || byTile.has((y - 1) * w + x) || byTile.has((y + 1) * w + x);
}

const halos = new Map<string, HTMLCanvasElement>();
/** Halo tramado (sin alfa ni colores fuera de la paleta): más denso cerca de la bombilla. */
function haloSprite(tod: TimeOfDay): HTMLCanvasElement {
  const key = tod;
  let c = halos.get(key);
  if (c) return c;
  const R = 13;
  c = document.createElement('canvas');
  c.width = c.height = R * 2 + 1;
  const g = c.getContext('2d')!;
  g.fillStyle = P(tod === 'night' ? C.lampWarm : C.lamp);
  // Trama Bayer 4×4: degradado uniforme, más denso cerca de la bombilla (sin rayas).
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const strength = tod === 'night' ? 0.55 : 0.35;
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      // Un poco aplastado: la luz cae sobre el suelo.
      const d = Math.hypot(x, y * 1.3) / R;
      if (d >= 1) continue;
      const level = (1 - d) * (1 - d) * strength * 16;
      if (level > BAYER[((y + 64) % 4) * 4 + ((x + 64) % 4)]!) g.fillRect(x + R, y + R, 1, 1);
    }
  }
  halos.set(key, c);
  return c;
}

function drawLamp(ctx: CanvasRenderingContext2D, px: number, py: number, z: number, tod: TimeOfDay): void {
  // Poste en la esquina de la casilla; la luz, solo al atardecer y de noche.
  const lx = px + 27 * z;
  const ly = py + 6 * z;
  if (tod !== 'day') {
    const halo = haloSprite(tod);
    ctx.drawImage(halo, lx - 13 * z, ly - 6 * z, halo.width * z, halo.height * z);
  }
  ctx.fillStyle = P(0);
  ctx.fillRect(lx, ly, z, 9 * z);
  ctx.fillRect(lx - z, ly + 9 * z, 3 * z, z);
  ctx.fillStyle = P(tod === 'day' ? 14 : C.lampWarm);
  ctx.fillRect(lx - z, ly - z, 3 * z, 2 * z);
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  opts: { preview?: Preview | null; selected?: { x: number; y: number } | null; cursor?: { x: number; y: number } | null; time: number; reducedMotion: boolean; layer?: LayerId },
): void {
  const z = cam.zoom;
  const ts = T * z;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = P(25);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const tod = timeOfDay(state.tick);
  const sig = mapSignature(state);
  if (`${sig}${tod}` !== groundSig) {
    ground = groundFor(state, tod);
    groundSig = `${sig}${tod}`;
  } else warmGrounds(state, tod, sig);
  if (runsSig !== sig) {
    runs = roadRuns(state);
    runsSig = sig;
  }
  const still = opts.reducedMotion;
  const people = walkers(state, opts.time, still, tod);
  const byRow = new Map<number, Walker[]>();
  for (const p of people) {
    const row = Math.floor((p.fy - 1) / T);
    const list = byRow.get(row) ?? [];
    list.push(p);
    byRow.set(row, list);
  }
  const puffs: { x: number; y: number; size: number }[] = [];
  if (ground) {
    // Solo el trozo visible del suelo (escalar el mapa entero cada fotograma es caro).
    const sx = Math.max(0, Math.floor(cam.x / z));
    const sy = Math.max(0, Math.floor(cam.y / z));
    const sw = Math.min(ground.width - sx, Math.ceil(ctx.canvas.width / z) + 2);
    const sh = Math.min(ground.height - sy, Math.ceil(ctx.canvas.height / z) + 2);
    if (sw > 0 && sh > 0) ctx.drawImage(ground, sx, sy, sw, sh, sx * z - cam.x, sy * z - cam.y, sw * z, sh * z);
  }

  // La capa va sobre el suelo y bajo los edificios, para no taparlos.
  const layer = opts.layer ?? 'none';
  const overlay = layer === 'happiness' ? null : layerCanvas(state, layer);
  if (overlay) {
    const sx = Math.max(0, Math.floor(cam.x / z));
    const sy = Math.max(0, Math.floor(cam.y / z));
    const sw = Math.min(overlay.width - sx, Math.ceil(ctx.canvas.width / z) + 2);
    const sh = Math.min(overlay.height - sy, Math.ceil(ctx.canvas.height / z) + 2);
    if (sw > 0 && sh > 0) ctx.drawImage(overlay, sx, sy, sw, sh, sx * z - cam.x, sy * z - cam.y, sw * z, sh * z);
  }

  const { w, h, tiles } = state.map;
  // Rango visible (con margen para lo que sobresale hacia arriba).
  const x0 = Math.max(0, Math.floor(cam.x / ts) - 1);
  const x1 = Math.min(w - 1, Math.ceil((cam.x + ctx.canvas.width) / ts) + 1);
  const y0 = Math.max(0, Math.floor(cam.y / ts) - 1);
  const y1 = Math.min(h - 1, Math.ceil((cam.y + ctx.canvas.height) / ts) + 2);

  const byTile = new Map<number, GameState['buildings'][number]>();
  for (const b of state.buildings) byTile.set(b.y * w + b.x, b);
  const projects = new Map(state.projects.map((p) => [p.buildingId, p]));
  const blink = opts.reducedMotion || Math.floor(opts.time / 600) % 2 === 0;

  const drawWalkers = (row: number) => {
    for (const p of byRow.get(row) ?? []) {
      const img = walkerSprite(p.variant, p.frame, p.dir, tod);
      ctx.drawImage(img, (p.fx - 3) * z - cam.x, (p.fy - 11) * z - cam.y, 7 * z, 12 * z);
    }
  };
  for (let row = y0 - 2; row < y0; row++) drawWalkers(row);
  // Objetos de atrás hacia delante: fila a fila.
  for (let y = y0; y <= y1; y++) {
    drawWalkers(y);
    for (let x = x0; x <= x1; x++) {
      const px = x * ts - cam.x;
      const py = (y * T - (BH - T)) * z - cam.y;
      const b = byTile.get(y * w + x);
      if (!b && tiles[y * w + x] === Tile.Road && lampAt(state, byTile, x, y)) drawLamp(ctx, px, y * ts - cam.y, z, tod);
      if (!b) {
        if (tiles[y * w + x] === Tile.Tree) {
          // Viento: la copa se mece con un desfase por árbol.
          const frame = still ? 0 : Math.floor(opts.time / 900 + hash(x, y, 4) * 4) % 2;
          ctx.drawImage(treeSprite(Math.floor(hash(x, y, 3) * TREE_VARIANTS), frame, tod), px, py, ts, BH * z);
        }
        continue;
      }
      if (!b.built) {
        const p = projects.get(b.id);
        const frac = p ? Math.min(1, p.workerDaysDone / p.workerDaysNeeded) : 0;
        ctx.drawImage(constructionSprite(frac < 0.34 ? 0 : frac < 0.67 ? 1 : 2, b.id, tod), px, py, ts, BH * z);
        // Barra de progreso.
        const by = y * ts - cam.y + ts - 5 * z;
        ctx.fillStyle = P(0);
        ctx.fillRect(px + 3 * z, by, ts - 6 * z, 4 * z);
        ctx.fillStyle = P(6);
        ctx.fillRect(px + 4 * z, by + z, Math.round((ts - 8 * z) * frac), 2 * z);
        continue;
      }
      // Squash & stretch al terminarse (anclado abajo, en el centro).
      const [sx, sy] = squash(b.id, opts.time);
      if (sx === 1 && sy === 1) ctx.drawImage(buildingSprite(b.kind, b.id, tod), px, py, ts, BH * z);
      else {
        const dw = Math.round(ts * sx);
        const dh = Math.round(BH * z * sy);
        ctx.drawImage(buildingSprite(b.kind, b.id, tod), px + Math.round((ts - dw) / 2), py + BH * z - dh, dw, dh);
      }
      // Humo de chimeneas (fábricas, central y casas): bocanadas que suben y crecen.
      // En casas solo alguna chimenea y una bocanada: que no parezca contaminación.
      const homeSmoke = b.kind === 'house' && hash(b.id, 9) < 0.2;
      const chimneys = b.kind === 'factory' ? [[27, 0]] : b.kind === 'power' ? [[23, 2]] : homeSmoke ? [[23, 6]] : [];
      for (const [cx, cy] of chimneys) {
        for (let k = 0; k < (homeSmoke ? 1 : 3); k++) {
          const life = still ? (k + 0.5) / 3 : ((opts.time / 2600 + k / 3 + hash(b.id, k) * 0.2) % 1);
          puffs.push({ x: x * T + cx! + Math.round(life * 4 + Math.sin(life * 6 + b.id) * 1.5), y: y * T - (BH - T) + cy! - Math.round(life * 14), size: Math.min(2, Math.floor(life * 3)) });
        }
      }
      // Agua de la fuente (parque y plaza): el chorro sube y baja.
      if ((b.kind === 'park' || b.kind === 'plaza') && !still) {
        const jet = Math.floor(opts.time / 220) % 3;
        const fxp = px + 16 * z;
        const fyp = py + (b.kind === 'park' ? 26 : 22) * z;
        ctx.fillStyle = P(C.waterLight);
        ctx.fillRect(fxp, fyp - jet * z, z, (2 + jet) * z);
        ctx.fillStyle = P(12);
        ctx.fillRect(fxp + (jet - 1) * 2 * z, fyp - (jet + 1) * z, z, z);
      }
      if (b.kind !== 'water' && b.kind !== 'power' && b.kind !== 'park' && blink) {
        let ix = px + ts - 12 * z;
        const iy = py + 2 * z;
        if (!b.hasWater) {
          ctx.drawImage(iconSprite('noWater'), ix, iy, 11 * z, 13 * z);
          ix -= 12 * z;
        }
        if (!b.hasPower) ctx.drawImage(iconSprite('noPower'), ix, iy, 11 * z, 13 * z);
      }
    }
  }

  for (const d of liveParticles(opts.time)) {
    ctx.fillStyle = P(d.color);
    ctx.fillRect(Math.round(d.x) * z - cam.x, Math.round(d.y) * z - cam.y, d.size * z, d.size * z);
  }
  for (const f of puffs) {
    const img = puffSprite(f.size, tod);
    ctx.drawImage(img, (f.x - img.width / 2) * z - cam.x, (f.y - img.height / 2) * z - cam.y, img.width * z, img.height * z);
  }

  if (layer === 'happiness') {
    // Marca de 10×10 con la trama del nivel sobre cada vivienda habitada.
    for (const m of happinessMarks(state)) {
      const px = m.x * ts - cam.x + 11 * z;
      const py = (m.y * T - (BH - T)) * z - cam.y + 2 * z;
      ctx.fillStyle = P(0);
      ctx.fillRect(px - z, py - z, 12 * z, 12 * z);
      ctx.fillStyle = P(m.color);
      for (let y = 0; y < 10; y += 2) {
        for (let x = 0; x < 10; x += 2) {
          const gx = x / 2;
          const gy = y / 2;
          const on = m.lv === 0 ? (gx + gy) % 4 === 0 : m.lv === 1 ? (gx + gy) % 2 === 0 && gy % 2 === 0 : m.lv === 2 ? (gx + gy) % 2 === 0 : true;
          if (on) ctx.fillRect(px + x * z, py + y * z, 2 * z, 2 * z);
        }
      }
    }
  }

  if (layer === 'missing') {
    // Sobre cada vivienda (o solar R), los iconos de lo que falta: rojo debajo si falta, amarillo si está lleno.
    for (const m of missingMarks(state)) {
      if (!m.needs.length) continue;
      const shown = m.needs.slice(0, 4);
      const cols = Math.min(2, shown.length);
      const rows = Math.ceil(shown.length / 2);
      const built = state.buildings.some((b) => b.x === m.x && b.y === m.y);
      const px = m.x * ts - cam.x + (T - cols * 14) / 2 * z;
      const py = (m.y * T - (built ? BH - T : 0)) * z - cam.y + 2 * z;
      ctx.fillStyle = P(0);
      ctx.fillRect(px - z, py - z, (cols * 14 + 1) * z, (rows * 15 + 1) * z);
      shown.forEach((need, k) => {
        const ix = px + (k % 2) * 14 * z;
        const iy = py + Math.floor(k / 2) * 15 * z;
        ctx.drawImage(icon(NEED_ICON[need.key]), ix + z, iy, 12 * z, 12 * z);
        ctx.fillStyle = P(need.status === 'falta' ? 2 : 4);
        ctx.fillRect(ix + z, iy + 12 * z, 12 * z, 2 * z);
      });
    }
  }

  const corner = (tx: number, ty: number, color: number, thick: number) => {
    const px = tx * ts - cam.x;
    const py = ty * ts - cam.y;
    const L = 8 * z;
    const t = thick * z;
    ctx.fillStyle = P(color);
    ctx.fillRect(px, py, L, t);
    ctx.fillRect(px, py, t, L);
    ctx.fillRect(px + ts - L, py, L, t);
    ctx.fillRect(px + ts - t, py, t, L);
    ctx.fillRect(px, py + ts - t, L, t);
    ctx.fillRect(px, py + ts - L, t, L);
    ctx.fillRect(px + ts - L, py + ts - t, L, t);
    ctx.fillRect(px + ts - t, py + ts - L, t, L);
  };
  if (opts.preview) {
    for (const t of opts.preview.tiles) corner(t.x, t.y, opts.preview.ok ? 12 : 2, 2);
  }
  if (opts.selected) corner(opts.selected.x, opts.selected.y, 4, 2);
  // Cursor de teclado: esquinas blancas gruesas (se distingue de la selección por forma y color).
  if (opts.cursor) corner(opts.cursor.x, opts.cursor.y, 12, 3);
}
