import { type GameState, Tile } from '@bitopolis/sim';
import { PALETTE } from './palette.ts';

export const TILE = 16;

const BUILDING_COLORS: Record<string, [number, number]> = {
  townhall: [PALETTE.indexOf('#b13e53'), PALETTE.indexOf('#ffcd75')],
  house: [PALETTE.indexOf('#ef7d57'), PALETTE.indexOf('#f4f4f4')],
  water: [PALETTE.indexOf('#41a6f6'), PALETTE.indexOf('#73eff7')],
  power: [PALETTE.indexOf('#ffcd75'), PALETTE.indexOf('#333c57')],
};

/** Render provisional (v0.0): bloques de color de la paleta cerrada. */
export function render(ctx: CanvasRenderingContext2D, state: GameState, cam: { x: number; y: number; zoom: number }) {
  const { w, h, tiles } = state.map;
  const s = TILE * cam.zoom;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PALETTE[0]!;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[y * w + x];
      ctx.fillStyle = t === Tile.Road ? PALETTE[15]! : t === Tile.Tree ? PALETTE[6]! : PALETTE[5]!;
      ctx.fillRect(x * s - cam.x, y * s - cam.y, s, s);
      if (t === Tile.Tree) {
        ctx.fillStyle = PALETTE[7]!;
        ctx.fillRect(x * s - cam.x + s / 4, y * s - cam.y + s / 4, s / 2, s / 2);
      }
    }
  }
  for (const b of state.buildings) {
    const [body, roof] = BUILDING_COLORS[b.kind] ?? [1, 2];
    const px = b.x * s - cam.x;
    const py = b.y * s - cam.y;
    ctx.fillStyle = PALETTE[body]!;
    ctx.fillRect(px + cam.zoom, py + s / 3, s - 2 * cam.zoom, (s * 2) / 3 - cam.zoom);
    ctx.fillStyle = PALETTE[roof]!;
    ctx.fillRect(px, py, s, s / 3);
  }
}
