import { type GameState, Tile, Zone } from '@bitopolis/sim';
import { happinessMarks, type LayerId, layerCanvas } from './layers.ts';
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
  if (hour >= 21 || hour < 6) return 'night';
  if (hour === 6 || hour === 7 || hour === 19 || hour === 20) return 'dusk';
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

/** Suelo, carreteras y solares en un canvas a escala 1 (se rehace si cambia). */
function drawGround(state: GameState, tod: TimeOfDay): HTMLCanvasElement {
  const { w, h, tiles, zones } = state.map;
  const isRoad = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] === Tile.Road;
  const occupied = new Set(state.buildings.map((b) => b.y * w + b.x));
  const all = new Pix(w * T, h * T);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = Math.floor(hash(x, y, 1) * GRASS_VARIANTS);
      if (tiles[i] === Tile.Road) {
        const n = isRoad(x, y - 1);
        const e = isRoad(x + 1, y);
        const s = isRoad(x, y + 1);
        const o = isRoad(x - 1, y);
        const rv = Math.floor(hash(x, y, 2) * 6);
        const key = `${+n}${+e}${+s}${+o}-${rv}`;
        let tile = roadCache.get(key);
        if (!tile) roadCache.set(key, (tile = roadTile(n, e, s, o, rv)));
        all.blit(tile, x * T, y * T);
        continue;
      }
      const z = zones[i]!;
      const g = grassTile(v, x, y);
      all.blit(z !== Zone.None && !occupied.has(i) ? zoneTile(ZONE_LETTER[z]!, g) : g, x * T, y * T);
    }
  }
  return toCanvas(all, tod);
}

const roadCache = new Map<string, Pix>();

/** Imagen de las herramientas: un sprite reducido a su caja. */
export function toolCanvas(kind: string): HTMLCanvasElement {
  return buildingSprite(kind, 1);
}

export { toCanvas };

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  opts: { preview?: Preview | null; selected?: { x: number; y: number } | null; time: number; reducedMotion: boolean; layer?: LayerId },
): void {
  const z = cam.zoom;
  const ts = T * z;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = P(25);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const tod = timeOfDay(state.tick);
  const sig = mapSignature(state);
  if (!ground || `${sig}${tod}` !== groundSig) {
    ground = drawGround(state, tod);
    groundSig = `${sig}${tod}`;
  }
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
  ctx.drawImage(ground, -cam.x, -cam.y, ground.width * z, ground.height * z);

  // La capa va sobre el suelo y bajo los edificios, para no taparlos.
  const layer = opts.layer ?? 'none';
  const overlay = layer === 'happiness' ? null : layerCanvas(state, layer);
  if (overlay) ctx.drawImage(overlay, -cam.x, -cam.y, overlay.width * z, overlay.height * z);

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
      ctx.drawImage(buildingSprite(b.kind, b.id, tod), px, py, ts, BH * z);
      // Humo de chimeneas (fábricas, central y casas): bocanadas que suben y crecen.
      const chimneys = b.kind === 'factory' ? [[27, 0]] : b.kind === 'power' ? [[23, 2]] : b.kind === 'house' ? [[23, 6]] : [];
      for (const [cx, cy] of chimneys) {
        for (let k = 0; k < 3; k++) {
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
}
