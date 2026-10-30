import { grassTile, putPix, walkerSprite, buildingSprite, treeSprite } from './sprites.ts';

/** Horizonte del pueblo en la pantalla de inicio, hecho con los mismos sprites del juego. */
export function drawSkyline(): void {
  const c = document.querySelector<HTMLCanvasElement>('#skyline');
  const g = c?.getContext('2d');
  if (!c || !g) return;
  g.imageSmoothingEnabled = false;
  for (let x = 0; x < 10; x++) putPix(g, grassTile(x, x, 3), x * 32, 48);
  const row: [string, number][] = [
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
  row.forEach(([kind, v], i) => g.drawImage(kind === 'tree' ? treeSprite(v) : buildingSprite(kind, v), i * 32, 0, 32, 48));
  g.drawImage(walkerSprite(5, 1, 1), 100, 50, 7, 12);
  g.drawImage(walkerSprite(22, 2, -1), 214, 51, 7, 12);
}
