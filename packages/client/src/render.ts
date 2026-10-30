import { type GameState, Tile, Zone } from '@bitopolis/sim';
import { PALETTE } from './palette.ts';
import { buildingSprite, iconSprite, letterSprite, S, scaffoldSprite, treeSprite } from './sprites.ts';

export interface Camera {
  /** Desplazamiento en píxeles de pantalla. */
  x: number;
  y: number;
  /** Escala entera: píxeles de pantalla por píxel de sprite. */
  zoom: number;
}

export interface Preview {
  tiles: { x: number; y: number }[];
  ok: boolean;
}

export const ZONE_COLOR: Record<number, number> = { [Zone.R]: 6, [Zone.C]: 10, [Zone.I]: 4 };
export const ZONE_LETTER: Record<number, 'R' | 'C' | 'I'> = { [Zone.R]: 'R', [Zone.C]: 'C', [Zone.I]: 'I' };

const P = (i: number) => PALETTE[i]!;

function hash2(x: number, y: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h ^= h >>> 13;
  return (h >>> 0) % 997;
}

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
  // Los edificios tapan zonas: también cuentan.
  return `${a}:${b}:${state.buildings.length}`;
}

/** Suelo, carreteras y zonas en un canvas a escala 1 (se redibuja si cambia). */
function drawGround(state: GameState): HTMLCanvasElement {
  const { w, h, tiles, zones } = state.map;
  const c = ground ?? document.createElement('canvas');
  c.width = w * S;
  c.height = h * S;
  const g = c.getContext('2d')!;
  const isRoad = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] === Tile.Road;
  const occupied = new Set(state.buildings.map((b) => b.y * w + b.x));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x * S;
      const py = y * S;
      const t = tiles[y * w + x];
      g.fillStyle = P(23);
      g.fillRect(px, py, S, S);
      const r = hash2(x, y);
      g.fillStyle = P(r % 2 ? 22 : 24);
      g.fillRect(px + (r % 13), py + ((r >> 3) % 13), 1, 2);
      g.fillRect(px + ((r >> 2) % 14), py + ((r >> 5) % 14), 2, 1);
      if (t === Tile.Road) {
        g.fillStyle = P(14);
        g.fillRect(px, py, S, S);
        const n = isRoad(x, y - 1);
        const s = isRoad(x, y + 1);
        const e = isRoad(x + 1, y);
        const o = isRoad(x - 1, y);
        g.fillStyle = P(15);
        g.fillRect(px + 2, py + 2, S - 4, S - 4);
        if (n) g.fillRect(px + 2, py, S - 4, 2);
        if (s) g.fillRect(px + 2, py + S - 2, S - 4, 2);
        if (o) g.fillRect(px, py + 2, 2, S - 4);
        if (e) g.fillRect(px + S - 2, py + 2, 2, S - 4);
        g.fillStyle = P(30);
        if ((e || o) && !n && !s) for (let i = 1; i < S; i += 6) g.fillRect(px + i, py + 7, 3, 1);
        else if ((n || s) && !e && !o) for (let i = 1; i < S; i += 6) g.fillRect(px + 7, py + i, 1, 3);
      } else if (t === Tile.Tree) {
        g.drawImage(treeSprite(), px, py);
      }
      const z = zones[y * w + x]!;
      if (z !== Zone.None && t !== Tile.Road && !occupied.has(y * w + x)) {
        // Patrón + letra: la zona nunca depende solo del color.
        g.fillStyle = P(ZONE_COLOR[z]!);
        for (let i = 0; i < S; i += 4) {
          g.fillRect(px + i, py, 2, 1);
          g.fillRect(px + i, py + S - 1, 2, 1);
          g.fillRect(px, py + i, 1, 2);
          g.fillRect(px + S - 1, py + i, 1, 2);
        }
        g.fillStyle = P(0);
        g.fillRect(px + 5, py + 4, 5, 7);
        g.drawImage(letterSprite(ZONE_LETTER[z]!, ZONE_COLOR[z]!), px + 6, py + 5);
      }
    }
  }
  return c;
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  opts: { preview?: Preview | null; selected?: { x: number; y: number } | null; time: number; reducedMotion: boolean },
): void {
  const z = cam.zoom;
  const ts = S * z;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = P(0);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const sig = mapSignature(state);
  if (!ground || sig !== groundSig) {
    ground = drawGround(state);
    groundSig = sig;
  }
  ctx.drawImage(ground, -cam.x, -cam.y, ground.width * z, ground.height * z);

  const projects = new Map(state.projects.map((p) => [p.buildingId, p]));
  const blink = opts.reducedMotion || Math.floor(opts.time / 600) % 2 === 0;
  const sorted = [...state.buildings].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of sorted) {
    const px = b.x * ts - cam.x;
    const py = b.y * ts - cam.y;
    if (px < -ts || py < -ts || px > ctx.canvas.width || py > ctx.canvas.height) continue;
    if (!b.built) {
      ctx.drawImage(scaffoldSprite(), px, py, ts, ts);
      const p = projects.get(b.id);
      if (p) {
        const frac = Math.min(1, p.workerDaysDone / p.workerDaysNeeded);
        ctx.fillStyle = P(0);
        ctx.fillRect(px + z, py + ts - 3 * z, ts - 2 * z, 3 * z);
        ctx.fillStyle = P(5);
        ctx.fillRect(px + 2 * z, py + ts - 2 * z, Math.round((ts - 4 * z) * frac), z);
      }
      continue;
    }
    ctx.drawImage(buildingSprite(b.kind, b.id), px, py, ts, ts);
    if (b.kind !== 'water' && b.kind !== 'power' && blink) {
      let ix = px + ts - 8 * z;
      if (!b.hasWater) {
        ctx.drawImage(iconSprite('noWater'), ix, py - 2 * z, 7 * z, 7 * z);
        ix -= 8 * z;
      }
      if (!b.hasPower) ctx.drawImage(iconSprite('noPower'), ix, py - 2 * z, 7 * z, 7 * z);
    }
  }

  if (opts.preview) {
    ctx.fillStyle = P(opts.preview.ok ? 12 : 2);
    for (const t of opts.preview.tiles) {
      const px = t.x * ts - cam.x;
      const py = t.y * ts - cam.y;
      ctx.fillRect(px, py, ts, z);
      ctx.fillRect(px, py + ts - z, ts, z);
      ctx.fillRect(px, py, z, ts);
      ctx.fillRect(px + ts - z, py, z, ts);
    }
  }
  if (opts.selected) {
    const px = opts.selected.x * ts - cam.x;
    const py = opts.selected.y * ts - cam.y;
    ctx.fillStyle = P(4);
    for (const [dx, dy, w, h] of [
      [0, 0, 4, 1],
      [0, 0, 1, 4],
      [12, 0, 4, 1],
      [15, 0, 1, 4],
      [0, 15, 4, 1],
      [0, 12, 1, 4],
      [12, 15, 4, 1],
      [15, 12, 1, 4],
    ] as const) {
      ctx.fillRect(px + dx * z, py + dy * z, w * z, h * z);
    }
  }
}
