import { ambulanceFor, type GameState, isWater, Terrain, Tile, trashStateOf, truckRoutes, Zone } from '@bitopolis/sim';
import { happinessMarks, type LayerId, layerCanvas, missingMarks, NEED_ICON } from './layers.ts';
import { pixelIcon } from './icons.ts';

/** Iconos de la capa «Qué falta», creados una vez. */
const iconCache = new Map<string, HTMLCanvasElement>();
const icon = (name: string) => iconCache.get(name) ?? iconCache.set(name, pixelIcon(name)).get(name)!;
import { liveParticles, squash } from './fx.ts';
import { signSprite } from './crest.ts';
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
  bridgeTile,
  hillTile,
  seaTile,
  snowGrass,
  walkerSprite,
  waterTile,
  damagedSprite,
  marcherSprite,
  policeSprite,
  ratSprite,
  trashBagsSprite,
  truckSprite,
  serviceSprite,
  sparkleSprite,
  thiefSprite,
  townhallSprite,
  zoneTile,
  ambulanceSprite,
  burntSprite,
  dikeSprite,
  fireTruckSprite,
  flamesSprite,
  farmSprite,
  riskSprite,
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
const ZONE_LETTER: Record<number, 'R' | 'C' | 'I' | 'A'> = { [Zone.R]: 'R', [Zone.C]: 'C', [Zone.I]: 'I', [Zone.A]: 'A' };
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

/** Fotograma del agua (0/1) y si nieva: los fija render() antes de pintar el suelo. */
let waterFrame: 0 | 1 = 0;
let snowing = false;

function tileKey(state: GameState, x: number, y: number, occupied: Set<number>): string {
  const { w, h, tiles, zones } = state.map;
  const ter = state.map.terrain ?? [];
  const i = y * w + x;
  // Fuera del mapa cuenta como agua (el río y el mar siguen más allá).
  const wet = (xx: number, yy: number) => xx < 0 || yy < 0 || xx >= w || yy >= h || isWater(ter[yy * w + xx]);
  const t = ter[i] ?? 0;
  if (tiles[i] === Tile.Road) {
    const r = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && tiles[yy * w + xx] === Tile.Road;
    // v1.7: carretera sobre el río = puente.
    if (t === Terrain.River) return `b${+(r(x - 1, y) || r(x + 1, y))}${+wet(x, y - 1)}${+wet(x + 1, y)}${+wet(x, y + 1)}${+wet(x - 1, y)}${waterFrame}`;
    return `r${+r(x, y - 1)}${+r(x + 1, y)}${+r(x, y + 1)}${+r(x - 1, y)}`;
  }
  const nesw = `${+wet(x, y - 1)}${+wet(x + 1, y)}${+wet(x, y + 1)}${+wet(x - 1, y)}`;
  if (t === Terrain.River) return `w${nesw}${waterFrame}${+snowing}`;
  if (t === Terrain.Sea) return `s${nesw}${waterFrame}${+snowing}`;
  const zone = zones[i] !== Zone.None && !occupied.has(i) ? zones[i] : 0;
  if (t === Terrain.Hill) {
    const hill = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && ter[yy * w + xx] === Terrain.Hill;
    return `h${+hill(x, y - 1)}${+hill(x + 1, y)}${+hill(x, y + 1)}${+hill(x - 1, y)}${zone}${+snowing}`;
  }
  return `g${zone}${+snowing}`;
}

/** Superpone `top` sobre `base` (lo transparente de `top` deja ver `base`). */
function over(base: Pix, top: Pix): Pix {
  const out = new Pix(base.w, base.h);
  out.data.set(base.data);
  for (let k = 0; k < top.data.length; k++) if (top.data[k]! >= 0) out.data[k] = top.data[k]!;
  return out;
}
const terrainCache = new Map<string, Pix>();

function tilePix(state: GameState, x: number, y: number, key: string): Pix {
  const b = (k: number) => key[k] === '1';
  if (key[0] === 'w' || key[0] === 's' || key[0] === 'b') {
    const v = Math.floor(hash(x, y, 9) * 4);
    const k = `${key}-${v}`;
    let tile = terrainCache.get(k);
    if (!tile) {
      if (key[0] === 'b') {
        // Puente: agua debajo (abierta a lo largo del cauce) y el tablero encima.
        const horiz = b(1);
        const fr = Number(key[6]) as 0 | 1;
        const water = waterTile(horiz || b(2), !horiz || b(3), horiz || b(4), !horiz || b(5), v, fr);
        tile = over(water, bridgeTile(horiz, v));
      } else {
        const fr = Number(key[5]) as 0 | 1;
        tile = (key[0] === 'w' ? waterTile : seaTile)(b(1), b(2), b(3), b(4), v, fr);
        // Con nieve, también la hierba de la orilla.
        if (key[6] === '1') tile = snowGrass(tile, v);
      }
      terrainCache.set(k, tile);
    }
    return tile;
  }
  if (key[0] === 'h') {
    const v = Math.floor(hash(x, y, 1) * GRASS_VARIANTS);
    const k = `${key}-${v}`;
    let tile = terrainCache.get(k);
    if (!tile) {
      let p = hillTile(v, b(1), b(2), b(3), b(4));
      if (key[6] === '1') p = snowGrass(p, v);
      const z = Number(key[5]);
      tile = z ? zoneTile(ZONE_LETTER[z]!, p) : p;
      terrainCache.set(k, tile);
    }
    return tile;
  }
  if (key[0] === 'r') {
    const rv = Math.floor(hash(x, y, 2) * 6);
    const k = `${key.slice(1)}-${rv}`;
    let tile = roadCache.get(k);
    if (!tile) roadCache.set(k, (tile = roadTile(key[1] === '1', key[2] === '1', key[3] === '1', key[4] === '1', rv)));
    return tile;
  }
  // La hierba (ruido suave, lo más caro) se calcula una vez por casilla (y nevada, otra).
  const snow = key[2] === '1';
  const gi = y * 4096 + x + (snow ? 1 << 24 : 0);
  let g = grassCache.get(gi);
  if (!g) {
    g = grassTile(Math.floor(hash(x, y, 1) * GRASS_VARIANTS), x, y);
    if (snow) g = snowGrass(g, Math.floor(hash(x, y, 1) * 4));
    grassCache.set(gi, g);
  }
  const z = Number(key[1]);
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

/** Sprite de un edificio: destrozado, el ayuntamiento según su nivel (v1.8) o el normal. */
function bSprite(b: GameState['buildings'][number], tod: TimeOfDay, snowing: boolean, state: GameState): HTMLCanvasElement {
  // 2.1: lo que destrozó el fuego, quemado (no con pintadas como en los disturbios).
  if (b.damaged) return b.damaged.cause === 'fuego' ? burntSprite(b.kind, b.id, tod) : damagedSprite(b.kind, b.id, tod);
  if (b.kind === 'townhall') return townhallSprite(state.townhallLevel ?? 1, tod, snowing);
  if (b.level && b.level > 1) return serviceSprite(b.kind, b.id, b.level, tod, snowing);
  // 2.2: la finca, según su cultivo.
  if (b.kind === 'farm' && b.crop) return farmSprite(b.crop, b.id, tod, snowing);
  // 2.1: los tejados de las viviendas cambian con el rango del pueblo.
  return buildingSprite(b.kind, b.id, tod, snowing, state.rank?.level ?? 2);
}

/**
 * 2.1: dónde va el cartel del pueblo: junto al final de la calle del
 * ayuntamiento (la entrada), en la primera casilla libre de hierba o árbol.
 */
let signSig = '';
let signAt: number | null = null;
export function signSpot(state: GameState, sig = mapSignature(state)): { x: number; y: number } | null {
  if (sig === signSig) return signAt === null ? null : { x: signAt % state.map.w, y: Math.floor(signAt / state.map.w) };
  signSig = sig;
  signAt = null;
  const { w, h, tiles } = state.map;
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  if (!hall) return null;
  const y = hall.y + 1;
  if (y >= h) return null;
  let x = hall.x;
  while (x > 0 && tiles[y * w + x - 1] === Tile.Road) x--;
  const used = new Set(state.buildings.map((b) => b.y * w + b.x));
  const free = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < w && cy < h && tiles[cy * w + cx] !== Tile.Road && !used.has(cy * w + cx) && !isWater(state.map.terrain?.[cy * w + cx]) && (state.map.zones[cy * w + cx] ?? 0) === Zone.None;
  for (const [dx, dy] of [[-1, 1], [-1, 0], [0, 1], [-1, -1], [-2, 1], [-2, 0], [0, 2], [-1, 2]] as const) {
    if (free(x + dx, y + dy)) {
      signAt = (y + dy) * w + x + dx;
      break;
    }
  }
  return signAt === null ? null : { x: signAt % w, y: Math.floor(signAt / w) };
}

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
  opts: { preview?: Preview | null; selected?: { x: number; y: number } | null; cursor?: { x: number; y: number } | null; time: number; reducedMotion: boolean; layer?: LayerId; highlight?: { x: number; y: number; since: number } | null },
): void {
  const z = cam.zoom;
  const ts = T * z;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = P(25);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const tod = timeOfDay(state.tick);
  // v1.7: el agua se mueve (dos fotogramas lentos) y la nieve cubre el suelo y los tejados.
  waterFrame = opts.reducedMotion ? 0 : ((Math.floor(opts.time / 1200) % 2) as 0 | 1);
  snowing = state.weather?.kind === 'nieve';
  const mapSig = mapSignature(state);
  const sig = `${mapSig}${waterFrame}${+snowing}`;
  if (`${sig}${tod}` !== groundSig) {
    ground = groundFor(state, tod);
    groundSig = `${sig}${tod}`;
  } else warmGrounds(state, tod, sig);
  if (runsSig !== mapSig) {
    runs = roadRuns(state);
    runsSig = mapSig;
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

  const sign = signSpot(state, mapSig);
  const byTile = new Map<number, GameState['buildings'][number]>();
  for (const b of state.buildings) byTile.set(b.y * w + b.x, b);
  // 2.1: diques en la orilla.
  const dikes = new Set(state.dikes ?? []);
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
      if (!b && dikes.has(y * w + x)) {
        ctx.drawImage(dikeSprite(tod), px, y * ts - cam.y, ts, ts);
        continue;
      }
      if (!b) {
        if (sign && sign.x === x && sign.y === y) {
          ctx.drawImage(signSprite(state, tod), px, py, ts, BH * z);
          continue;
        }
        if (tiles[y * w + x] === Tile.Tree) {
          // Viento: la copa se mece con un desfase por árbol.
          const frame = still ? 0 : Math.floor(opts.time / 900 + hash(x, y, 4) * 4) % 2;
          ctx.drawImage(treeSprite(Math.floor(hash(x, y, 3) * TREE_VARIANTS), frame, tod, snowing), px, py, ts, BH * z);
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
      if (sx === 1 && sy === 1) ctx.drawImage(bSprite(b, tod, snowing, state), px, py, ts, BH * z);
      else {
        const dw = Math.round(ts * sx);
        const dh = Math.round(BH * z * sy);
        ctx.drawImage(bSprite(b, tod, snowing, state), px + Math.round((ts - dw) / 2), py + BH * z - dh, dw, dh);
      }
      // 2.1: llamas (2 fotogramas, sin destellos) y aviso de riesgo encima.
      if (b.fire) {
        const frame = still ? 0 : Math.floor(opts.time / 280 + b.id) % 2;
        // Ronda 17: con el zoom lejano del móvil, llamas más grandes para que el fuego se vea.
        const big = ts < 26 ? 2 : 1;
        ctx.drawImage(flamesSprite(frame, tod), px - (ts * (big - 1)) / 2, py - BH * z * (big - 1), ts * big, BH * z * big);
        for (let k = 0; k < 3; k++) {
          const life = still ? (k + 0.5) / 3 : ((opts.time / 1800 + k / 3 + hash(b.id, k, 5) * 0.2) % 1);
          puffs.push({ x: x * T + 14 + Math.round(life * 6 + Math.sin(life * 5 + b.id) * 2), y: y * T - (BH - T) + 4 - Math.round(life * 18), size: Math.min(2, 1 + Math.floor(life * 2)) });
        }
      } else if (b.risk) ctx.drawImage(riskSprite(), px + 2 * z, py + 2 * z, 11 * z, 13 * z);
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
      // v1.8 (petición del creador): el icono sale cuando el problema dura (un día o más) y,
      // si pasa de una semana, parpadea para llamar la atención. Recién terminado no avisa.
      if (b.kind !== 'water' && b.kind !== 'power' && b.kind !== 'park') {
        let ix = px + ts - 12 * z;
        const iy = py + 2 * z;
        const show = (days: number | undefined) => (days ?? 0) >= 1 && ((days ?? 0) < 7 || blink);
        if (!b.hasWater && show(b.dryDays)) {
          ctx.drawImage(iconSprite('noWater'), ix, iy, 11 * z, 13 * z);
          ix -= 12 * z;
        }
        if (!b.hasPower && show(b.darkDays)) ctx.drawImage(iconSprite('noPower'), ix, iy, 11 * z, 13 * z);
      }
      // 2.1: basura sin recoger: bolsas al pie del edificio y, con ratas, una que corretea y el icono en el tejado.
      const dirty = trashStateOf(b);
      if (dirty !== 'limpio') {
        const fy = y * ts - cam.y + ts - 9 * z;
        ctx.drawImage(trashBagsSprite(dirty === 'ratas' ? 3 : 2, tod), px + 19 * z, fy, 12 * z, 8 * z);
        if (dirty === 'ratas') {
          const t = still ? 0 : Math.floor(opts.time / 110 + b.id) % 36;
          const off = t < 18 ? t : 36 - t;
          ctx.drawImage(ratSprite(t, t < 18 ? 1 : -1, tod), px + (2 + off) * z, fy + 4 * z, 6 * z, 4 * z);
          if (blink) ctx.drawImage(icon('rat'), px + 2 * z, py + 2 * z, 12 * z, 12 * z);
        }
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
    // Ronda 13: sobre cada vivienda (o solar R), UN icono: lo que más falta, con marco rojo
    // (falta) o amarillo a trazos (llega, pero lleno), y «+N» si hay más. Muy alejado, solo un punto.
    const cssTile = ts / Math.max(1, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    for (const m of missingMarks(state)) {
      if (!m.needs.length) continue;
      const top = m.needs[0]!;
      const built = state.buildings.some((b) => b.x === m.x && b.y === m.y);
      const falta = top.status === 'falta';
      if (cssTile < 22) {
        // Punto de 10×10 con borde claro: rojo lleno si falta, amarillo con hueco si está lleno.
        const cx = m.x * ts - cam.x + 11 * z;
        const cy = (m.y * T - (built ? BH - T : 0) + 6) * z - cam.y;
        ctx.fillStyle = P(12);
        ctx.fillRect(cx - z, cy - z, 12 * z, 12 * z);
        ctx.fillStyle = P(falta ? 2 : 4);
        ctx.fillRect(cx, cy, 10 * z, 10 * z);
        if (!falta) {
          ctx.fillStyle = P(0);
          ctx.fillRect(cx + 3 * z, cy + 3 * z, 4 * z, 4 * z);
        }
        continue;
      }
      const px = m.x * ts - cam.x + 8 * z;
      const py = (m.y * T - (built ? BH - T : 0)) * z - cam.y + 2 * z;
      // Marco de 2 px: rojo continuo o amarillo a trazos (no solo el color distingue).
      ctx.fillStyle = P(falta ? 2 : 4);
      ctx.fillRect(px - 2 * z, py - 2 * z, 18 * z, 18 * z);
      if (!falta) {
        ctx.fillStyle = P(0);
        for (let k = 0; k < 18; k += 4) {
          ctx.fillRect(px - 2 * z + k * z, py - 2 * z, 2 * z, 2 * z);
          ctx.fillRect(px - 2 * z + k * z, py + 14 * z, 2 * z, 2 * z);
        }
      }
      ctx.fillStyle = P(0);
      ctx.fillRect(px, py, 14 * z, 14 * z);
      ctx.drawImage(icon(NEED_ICON[top.key]), px + z, py + z, 12 * z, 12 * z);
      if (m.needs.length > 1) {
        // «+N»: cuadradito con tantos puntos como necesidades más (hasta 3).
        ctx.fillStyle = P(0);
        ctx.fillRect(px + 16 * z, py, 6 * z, 9 * z);
        ctx.fillStyle = P(12);
        for (let k = 0; k < Math.min(3, m.needs.length - 1); k++) ctx.fillRect(px + 18 * z, py + (1 + k * 3) * z, 2 * z, 2 * z);
      }
    }
  }

  drawProtest(ctx, state, cam, opts.time, opts.reducedMotion, tod);
  drawPolice(ctx, state, cam, opts.time, opts.reducedMotion, tod);
  drawTrucks(ctx, state, cam, opts.time, opts.reducedMotion, tod);
  drawThief(ctx, state, cam, opts.time, opts.reducedMotion, tod);
  drawFireTrucks(ctx, state, cam, opts.time, opts.reducedMotion, tod);
  drawAmbulance(ctx, state, cam, opts.time, opts.reducedMotion, tod);
  if (opts.highlight) drawHighlight(ctx, cam, opts.highlight, opts.time, opts.reducedMotion);
  drawWeather(ctx, state, opts.time, opts.reducedMotion);

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

/**
 * v1.7: lluvia y nieve sobre el mapa (sin destellos: la tormenta no hace
 * relámpagos en pantalla). Con movimiento reducido, quietas y más escasas.
 */
function drawWeather(ctx: CanvasRenderingContext2D, state: GameState, time: number, still: boolean): void {
  const k = state.weather?.kind;
  if (k !== 'lluvia' && k !== 'tormenta' && k !== 'nieve') return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const unit = Math.max(1, Math.round(W / 400));
  const n = Math.round(((W * H) / (unit * unit * 2600)) * (k === 'tormenta' ? 1.8 : 1) * (still ? 0.4 : 1));
  const t = still ? 0 : time / 1000;
  if (k === 'nieve') {
    ctx.fillStyle = P(12);
    for (let i = 0; i < n; i++) {
      const x = (hash(i, 1) * W + Math.sin(t + i) * 6 * unit) % W;
      const y = (hash(i, 2) * H + t * (14 + hash(i, 3) * 10) * unit) % H;
      const sz = (hash(i, 4) > 0.7 ? 2 : 1) * unit;
      ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
    return;
  }
  ctx.fillStyle = P(k === 'tormenta' ? 13 : 11);
  for (let i = 0; i < n; i++) {
    const x = (hash(i, 1) * W + t * 40 * unit) % W;
    const y = (hash(i, 2) * H + t * 260 * unit) % H;
    // Gota: trazo inclinado de 1 px de ancho.
    for (let j = 0; j < 4; j++) ctx.fillRect(Math.round(x - j * unit), Math.round(y + j * 2 * unit), unit, 2 * unit);
  }
}

/* ---------- v1.8: marcha por el barrio, policía y caminos por las calles ---------- */

const pathCache = new Map<string, { x: number; y: number }[]>();
/** Camino más corto por carretera entre dos sitios (desde la carretera más cercana a cada uno). */
function roadPath(state: GameState, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
  const { w, h, tiles } = state.map;
  const key = `${from.x},${from.y}>${to.x},${to.y}:${mapSignature(state)}`;
  const hit = pathCache.get(key);
  if (hit) return hit;
  const nearestRoad = (p: { x: number; y: number }) => {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== Tile.Road) continue;
      const d = Math.abs((i % w) - p.x) + Math.abs(Math.floor(i / w) - p.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const start = nearestRoad(from);
  const goal = nearestRoad(to);
  let out: { x: number; y: number }[] = [];
  if (start >= 0 && goal >= 0) {
    const prev = new Map<number, number>([[start, -1]]);
    const queue = [start];
    while (queue.length) {
      const i = queue.shift()!;
      if (i === goal) break;
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (tiles[j] !== Tile.Road || prev.has(j)) continue;
        prev.set(j, i);
        queue.push(j);
      }
    }
    if (prev.has(goal)) {
      for (let i = goal; i !== -1; i = prev.get(i)!) out.push({ x: i % w, y: Math.floor(i / w) });
      out = out.reverse();
    }
  }
  if (pathCache.size > 40) pathCache.clear();
  pathCache.set(key, out);
  return out;
}

/** Punto (en píxeles de sprite) a `d` casillas del inicio del camino, y hacia dónde mira. */
function along(path: { x: number; y: number }[], d: number): { fx: number; fy: number; dir: 1 | -1 } {
  const k = Math.max(0, Math.min(path.length - 1, d));
  const i = Math.floor(k);
  const a = path[i]!;
  const b = path[Math.min(path.length - 1, i + 1)]!;
  const t = k - i;
  return { fx: (a.x + (b.x - a.x) * t + 0.5) * T, fy: (a.y + (b.y - a.y) * t + 0.5) * T + 6, dir: b.x < a.x ? -1 : 1 };
}

/** Cuándo se vio por primera vez cada suceso animado (la animación va en tiempo real). */
const seenAt = new Map<string, number>();
/** Ronda 14: al llegar la cámara, las animaciones empiezan de nuevo (para verlas enteras). */
export function restartAnimations(): void {
  seenAt.clear();
}
function sinceSeen(key: string, time: number): number {
  if (!seenAt.has(key)) {
    if (seenAt.size > 50) seenAt.clear();
    seenAt.set(key, time);
  }
  return time - seenAt.get(key)!;
}

/**
 * v1.8 (petición del creador): la manifestación, durante un día, es un grupo de
 * vecinos con pancartas que sale de su barrio y recorre las calles hasta el
 * ayuntamiento; allí se concentran. Cuanto más grande, más gente (hasta 30).
 */
function drawProtest(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, time: number, still: boolean, tod: TimeOfDay): void {
  const e = [...state.events].reverse().find((x) => x.kind === 'protest');
  if (!e || state.tick - e.tick > 24) return;
  const crowd = Math.min(30, Number(/unas (\d+) personas/.exec(e.text)?.[1] ?? 0));
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  if (!crowd || !hall) return;
  const z = cam.zoom;
  const a = state.associations?.find((x) => x.id === e.ref);
  const from = a?.x !== undefined && a.y !== undefined ? marchStart(state, { x: a.x, y: a.y }, hall) : null;
  const path = from ? roadPath(state, from, { x: hall.x, y: hall.y + 1 }) : [];
  // Recorrido a 1,2 casillas por segundo; quien llega, se queda en la plaza.
  const walked = still ? Infinity : (sinceSeen(`p${e.tick}`, time) / 1000) * 1.2;
  for (let i = 0; i < crowd; i++) {
    const behind = i * 0.18;
    const d = walked - behind;
    let fx: number;
    let fy: number;
    let dir: 1 | -1 = i % 2 ? 1 : -1;
    let frame = 0;
    if (path.length > 1 && d < path.length - 1) {
      if (d < 0) continue; // aún no ha salido
      const p = along(path, d);
      fx = p.fx + ((i % 2) - 0.5) * 8;
      fy = p.fy + ((i % 3) - 1) * 3;
      dir = p.dir;
      frame = Math.floor(time / 170 + i) % 4;
    } else {
      // Concentración ante el ayuntamiento, en filas.
      const col = (i % 10) - 4.5;
      const row = Math.floor(i / 10);
      fx = (hall.x + 0.5) * T + col * 8 + (hash(i, 31) - 0.5) * 3;
      fy = (hall.y + 1) * T + 10 + row * 7;
    }
    const bob = still ? 0 : Math.floor(time / 400 + i) % 2;
    const variant = Math.floor(hash(i, 32) * 64);
    if (i % 2 === 0) {
      const img = marcherSprite(variant, frame, dir, (i / 2) % 4, tod);
      ctx.drawImage(img, (fx - 4) * z - cam.x, (fy - 17 - bob) * z - cam.y, img.width * z, img.height * z);
    } else {
      const img = walkerSprite(variant, frame, dir, tod);
      ctx.drawImage(img, (fx - 3) * z - cam.x, (fy - 11 - bob) * z - cam.y, 7 * z, 12 * z);
    }
  }
}

/**
 * Ronda 14: la marcha sale de una calle a 6–10 casillas del ayuntamiento (la
 * más cercana al barrio de la asociación), para que se vea recorrer calles
 * aunque la asociación sea del centro.
 */
const startCache = new Map<string, { x: number; y: number }>();
function marchStart(state: GameState, home: { x: number; y: number }, hall: { x: number; y: number }): { x: number; y: number } {
  const key = `${home.x},${home.y}:${mapSignature(state)}`;
  const hit = startCache.get(key);
  if (hit) return hit;
  const { w, h, tiles } = state.map;
  let best = home;
  let bestD = Infinity;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== Tile.Road) continue;
      const fromHall = Math.abs(x - hall.x) + Math.abs(y - hall.y);
      if (fromHall < 6 || fromHall > 10) continue;
      const d = Math.abs(x - home.x) + Math.abs(y - home.y);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  if (startCache.size > 20) startCache.clear();
  startCache.set(key, best);
  return best;
}

/** v1.8: tras un robo resuelto, un agente va de la comisaría a la tienda (medio día). */
function drawPolice(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, time: number, still: boolean, tod: TimeOfDay): void {
  const e = [...state.events].reverse().find((x) => x.kind === 'crime' && x.text.includes('policía detiene'));
  if (!e || state.tick - e.tick > 12 || e.ref === undefined) return;
  const shop = state.buildings.find((b) => b.id === e.ref);
  if (!shop) return;
  const station = state.buildings
    .filter((b) => b.kind === 'police' && b.built)
    .sort((p, q) => Math.abs(p.x - shop.x) + Math.abs(p.y - shop.y) - (Math.abs(q.x - shop.x) + Math.abs(q.y - shop.y)))[0];
  if (!station) return;
  const path = roadPath(state, station, shop);
  if (path.length < 2) return;
  const z = cam.zoom;
  const d = still ? path.length - 1 : Math.min(path.length - 1, (sinceSeen(`c${e.tick}`, time) / 1000) * 2);
  const p = along(path, d);
  for (const [k, off] of [[0, -4], [1, 4]] as const) {
    const img = policeSprite(Math.floor(time / 150 + k) % 4, p.dir, tod);
    ctx.drawImage(img, (p.fx - 3 + off) * z - cam.x, (p.fy - 11) * z - cam.y, img.width * z, img.height * z);
  }
}

/**
 * 2.1: recorrido del camión de cada punto limpio: un paseo continuo por sus
 * calles de hoy (ida y vuelta por cada ramal). Se rehace cada día de juego.
 */
let truckCache: { key: string; paths: { x: number; y: number }[][] } | null = null;
export function truckPaths(state: GameState): { x: number; y: number }[][] {
  const snow = state.weather?.kind === 'nieve';
  const key = `${Math.floor(state.tick / 24)}:${mapSignature(state)}:${state.buildings.length}:${+snow}`;
  if (truckCache?.key === key) return truckCache.paths;
  const { w } = state.map;
  const paths: { x: number; y: number }[][] = [];
  for (const r of truckRoutes(state, snow)) {
    if (r.roads.length < 2) continue;
    const set = new Set(r.roads);
    const seen = new Set<number>([r.roads[0]!]);
    const walk: number[] = [r.roads[0]!];
    const stack: number[] = [r.roads[0]!];
    while (stack.length) {
      const i = stack[stack.length - 1]!;
      const next = [i + 1, i - 1, i + w, i - w].find((j) => set.has(j) && !seen.has(j) && (j === i + w || j === i - w || Math.floor(j / w) === Math.floor(i / w)));
      if (next !== undefined) {
        seen.add(next);
        stack.push(next);
        walk.push(next);
      } else {
        stack.pop();
        if (stack.length) walk.push(stack[stack.length - 1]!);
      }
    }
    paths.push(walk.map((i) => ({ x: i % w, y: Math.floor(i / w) })));
  }
  truckCache = { key, paths };
  return paths;
}

function drawTrucks(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, time: number, still: boolean, tod: TimeOfDay): void {
  const z = cam.zoom;
  truckPaths(state).forEach((path, k) => {
    const d = still ? 0 : ((time / 1000) * 2.5 + k * 7) % (path.length - 1);
    const p = along(path, d);
    const img = truckSprite(Math.floor(time / 250), p.dir, tod);
    ctx.drawImage(img, (p.fx - 8) * z - cam.x, (p.fy - 10) * z - cam.y, 16 * z, 11 * z);
  });
}

/**
 * v1.8: robo sin resolver. Durante unas horas de juego, el ladrón sale
 * corriendo de la tienda con el saco por la calle, alejándose del centro.
 */
function drawThief(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, time: number, still: boolean, tod: TimeOfDay): void {
  const e = [...state.events].reverse().find((x) => x.kind === 'crime' && x.text.includes('el ladrón escapa'));
  if (!e || state.tick - e.tick > 8 || e.ref === undefined) return;
  const shop = state.buildings.find((b) => b.id === e.ref);
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  if (!shop) return;
  // Hacia la carretera más alejada del ayuntamiento a pocas casillas.
  let best: { x: number; y: number } | null = null;
  let bestD = -1;
  const { w, h, tiles } = state.map;
  for (let dy = -8; dy <= 8; dy++)
    for (let dx = -8; dx <= 8; dx++) {
      const x = shop.x + dx;
      const y = shop.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] !== Tile.Road) continue;
      const d = hall ? Math.abs(x - hall.x) + Math.abs(y - hall.y) : Math.abs(dx) + Math.abs(dy);
      if (d > bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  if (!best) return;
  const path = roadPath(state, shop, best);
  if (path.length < 2) return;
  const z = cam.zoom;
  // Ronda 14: más despacio y en bucle mientras dura el suceso, para que dé tiempo a verlo.
  const d = still ? 1 : ((sinceSeen(`t${e.tick}`, time) / 1000) * 1.3) % (path.length - 1);
  const p = along(path, d);
  const img = thiefSprite(Math.floor(time / 90) % 4, p.dir, tod);
  ctx.drawImage(img, (p.fx - 3) * z - cam.x, (p.fy - 11) * z - cam.y, img.width * z, img.height * z);
}

/**
 * 2.1: con un incendio que los bomberos pueden apagar, el camión rojo sale del
 * parque y va por las calles hasta el fuego; allí se queda hasta que se apaga.
 */
function drawFireTrucks(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, time: number, still: boolean, tod: TimeOfDay): void {
  const z = cam.zoom;
  for (const b of state.buildings) {
    if (!b.fire?.covered) continue;
    const station = state.buildings
      .filter((s) => s.kind === 'firestation' && s.built)
      .sort((p, q) => Math.abs(p.x - b.x) + Math.abs(p.y - b.y) - (Math.abs(q.x - b.x) + Math.abs(q.y - b.y)))[0];
    if (!station) continue;
    const path = roadPath(state, station, b);
    if (path.length < 2) continue;
    const d = still ? path.length - 1 : Math.min(path.length - 1, (sinceSeen(`f${b.id}-${b.fire.since}`, time) / 1000) * 3);
    const p = along(path, d);
    const img = fireTruckSprite(still || d >= path.length - 1 ? 0 : Math.floor(time / 120) % 2, p.dir, tod);
    ctx.drawImage(img, (p.fx - 7) * z - cam.x, (p.fy - 9) * z - cam.y, img.width * z, img.height * z);
  }
}

/** 2.1: en una urgencia que se salva, la ambulancia (sin destellos) va del centro de salud a la casa. */
function drawAmbulance(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera, time: number, still: boolean, tod: TimeOfDay): void {
  const e = [...state.events].reverse().find((x) => x.kind === 'fire' && (x.text.startsWith('Urgencia') || x.text.includes('la ambulancia llega')));
  if (!e || state.tick - e.tick > 10 || e.ref === undefined) return;
  const home = state.buildings.find((b) => b.id === e.ref);
  const clinic = home ? ambulanceFor(state, home) : undefined;
  if (!home || !clinic) return;
  const path = roadPath(state, clinic, home);
  if (path.length < 2) return;
  const z = cam.zoom;
  const d = still ? path.length - 1 : Math.min(path.length - 1, (sinceSeen(`a${e.tick}`, time) / 1000) * 2.5);
  const p = along(path, d);
  const img = ambulanceSprite(still || d >= path.length - 1 ? 0 : Math.floor(time / 120) % 2, p.dir, tod);
  ctx.drawImage(img, (p.fx - 6) * z - cam.x, (p.fy - 9) * z - cam.y, img.width * z, img.height * z);
}

/** v1.8: destello sobre lo que ha hecho volver a x1 (unos segundos). */
function drawHighlight(ctx: CanvasRenderingContext2D, cam: Camera, hl: { x: number; y: number; since: number }, time: number, still: boolean): void {
  const age = time - hl.since;
  if (age > 4000) return;
  const z = cam.zoom;
  const cx = (hl.x + 0.5) * T * z - cam.x;
  const cy = (hl.y + 0.2) * T * z - cam.y;
  const frame = still ? 2 : Math.floor(age / 120) % 4;
  // Anillo que late alrededor.
  ctx.strokeStyle = P(12);
  ctx.lineWidth = 2 * z;
  const r = (T * 0.8 + (still ? 0 : (Math.floor(age / 250) % 2) * 3)) * z;
  ctx.strokeRect(Math.round(cx - r), Math.round(cy - r), Math.round(r * 2), Math.round(r * 2.4));
  const img = sparkleSprite(frame);
  ctx.drawImage(img, cx - 8 * z, cy - 26 * z, 16 * z, 16 * z);
}
