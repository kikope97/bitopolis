import { type GameState, Tile, Zone } from '@bitopolis/sim';
import { happinessMarks, type LayerId, layerCanvas } from './layers.ts';
import { PALETTE } from './palette.ts';
import {
  BH,
  buildingSprite,
  constructionSprite,
  grassTile,
  hash,
  iconSprite,
  Pix,
  roadTile,
  T,
  toCanvas,
  treeSprite,
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


/** Suelo, carreteras y solares en un canvas a escala 1 (se rehace si cambia). */
function drawGround(state: GameState): HTMLCanvasElement {
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
  return toCanvas(all);
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

  const sig = mapSignature(state);
  if (!ground || sig !== groundSig) {
    ground = drawGround(state);
    groundSig = sig;
  }
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

  // Objetos de atrás hacia delante: fila a fila.
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x * ts - cam.x;
      const py = (y * T - (BH - T)) * z - cam.y;
      const b = byTile.get(y * w + x);
      if (!b) {
        if (tiles[y * w + x] === Tile.Tree) {
          ctx.drawImage(treeSprite(Math.floor(hash(x, y, 3) * TREE_VARIANTS)), px, py, ts, BH * z);
        }
        continue;
      }
      if (!b.built) {
        const p = projects.get(b.id);
        const frac = p ? Math.min(1, p.workerDaysDone / p.workerDaysNeeded) : 0;
        ctx.drawImage(constructionSprite(frac < 0.34 ? 0 : frac < 0.67 ? 1 : 2, b.id), px, py, ts, BH * z);
        // Barra de progreso.
        const by = y * ts - cam.y + ts - 5 * z;
        ctx.fillStyle = P(0);
        ctx.fillRect(px + 3 * z, by, ts - 6 * z, 4 * z);
        ctx.fillStyle = P(6);
        ctx.fillRect(px + 4 * z, by + z, Math.round((ts - 8 * z) * frac), 2 * z);
        continue;
      }
      ctx.drawImage(buildingSprite(b.kind, b.id), px, py, ts, BH * z);
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
