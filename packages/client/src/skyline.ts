import { PALETTE } from './palette.ts';
import { lowMotion } from './prefs.ts';
import { grassTile, putPix, walkerSprite, buildingSprite, treeSprite } from './sprites.ts';

/**
 * Horizonte del pueblo en la pantalla de inicio, hecho con los mismos sprites
 * del juego. Desde la v1.3 se mueve: nubes que pasan y vecinos que caminan.
 * Con movimiento reducido, queda quieto.
 */
const ROW: [string, number][] = [
  ['tree', 3],
  ['house', 2],
  ['shop', 5],
  ['townhall', 1],
  ['res', 7],
  ['water', 1],
  ['house', 3],
  ['school', 1],
  ['tree', 9],
  ['factory', 2],
];

let town: HTMLCanvasElement | null = null;
function townLayer(): HTMLCanvasElement {
  if (town) return town;
  town = document.createElement('canvas');
  town.width = 320;
  town.height = 64;
  const g = town.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  for (let x = 0; x < 10; x++) putPix(g, grassTile(x, x, 3), x * 32, 48);
  ROW.forEach(([kind, v], i) => g.drawImage(kind === 'tree' ? treeSprite(v) : buildingSprite(kind, v), i * 32, 0, 32, 48));
  return town;
}

/** Nube de píxeles (dos tonos de la paleta). */
function cloud(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  g.fillStyle = PALETTE[12];
  g.fillRect(x + 2, y, 6 * size, 2);
  g.fillRect(x, y + 2, 10 * size, 3);
  g.fillStyle = PALETTE[13];
  g.fillRect(x + 1, y + 5, 8 * size, 1);
}

const WALKERS = [
  { variant: 5, y: 50, speed: 9, start: 100 },
  { variant: 22, y: 51, speed: -7, start: 214 },
  { variant: 13, y: 52, speed: 5, start: 20 },
];

function frame(g: CanvasRenderingContext2D, t: number, still: boolean): void {
  g.clearRect(0, 0, 320, 64);
  const s = t / 1000;
  const clouds = [
    { x: 30, y: 3, size: 1, speed: 3 },
    { x: 190, y: 8, size: 1.4, speed: 2 },
  ];
  for (const c of clouds) cloud(g, still ? c.x : Math.round(((c.x + s * c.speed) % 360) - 20), c.y, c.size);
  g.drawImage(townLayer(), 0, 0);
  for (const w of WALKERS) {
    const x = still ? w.start : Math.round((((w.start + s * w.speed) % 340) + 340) % 340) - 10;
    const step = still ? 0 : Math.floor(s * 6 + w.variant) % 2;
    g.drawImage(walkerSprite(w.variant, still ? 1 : step + 1, w.speed > 0 ? 1 : -1), x, w.y, 7, 12);
  }
}

let raf = 0;
export function drawSkyline(): void {
  const c = document.querySelector<HTMLCanvasElement>('#skyline');
  const g = c?.getContext('2d');
  if (!c || !g) return;
  g.imageSmoothingEnabled = false;
  cancelAnimationFrame(raf);
  let last = 0;
  const loop = (t: number) => {
    if (!c.isConnected) return;
    // Solo mientras se ve la pantalla de inicio (si no, se mira cada medio segundo);
    // a unos 12 fotogramas por segundo basta.
    if (c.offsetParent === null || lowMotion()) {
      if (lowMotion()) frame(g, 0, true);
      setTimeout(() => (raf = requestAnimationFrame(loop)), 500);
      return;
    }
    if (t - last > 80) {
      frame(g, t, false);
      last = t;
    }
    raf = requestAnimationFrame(loop);
  };
  frame(g, 0, true);
  raf = requestAnimationFrame(loop);
}
