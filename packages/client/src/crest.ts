import { baseCrest, type Crest, type CrestPiece, type GameState } from '@bitopolis/sim';
import { MAT, Pix, sprite, type TimeOfDay } from './sprites.ts';

/**
 * 2.1: escudo del pueblo y cartel de la entrada, dibujados por código con la
 * paleta cerrada. El escudo sale del estado (`state.rank.crest`): campo,
 * partición y piezas (una por rango) de un menú cerrado.
 */

/** Piezas de 7×7 (# = metal). */
const PIECES: Record<CrestPiece, string[]> = {
  torre: ['#.#.#.#', '#######', '.#####.', '.##.##.', '.##.##.', '.#####.', '#######'],
  puente: ['.......', '#######', '##...##', '#.....#', '.......', '.##.##.', '#..#..#'],
  espiga: ['...#...', '..###..', '.#.#.#.', '..###..', '.#.#.#.', '..###..', '...#...'],
  ola: ['.......', '.##..##', '#..##..', '.......', '.##..##', '#..##..', '.......'],
  arbol: ['..###..', '.#####.', '#######', '.#####.', '...#...', '...#...', '.#####.'],
  monte: ['...#...', '..###..', '..###..', '.#####.', '.#####.', '#######', '#######'],
  rueda: ['.#.#.#.', '#######', '.##.##.', '###.###', '.##.##.', '#######', '.#.#.#.'],
  campana: ['...#...', '..###..', '.#####.', '.#####.', '.#####.', '#######', '...#...'],
  libro: ['.......', '##...##', '#.#.#.#', '#..#..#', '#..#..#', '#######', '.......'],
  llave: ['.###...', '#...#..', '.###...', '..#....', '..##...', '..#....', '..##...'],
  sol: ['#..#..#', '.#####.', '.#####.', '#######', '.#####.', '.#####.', '#..#..#'],
  estrella: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
};

/** Borde del escudo según el rango: piedra, bronce, plata, oro y oro claro. */
const RIM = [29, 19, 12, 4, 60];
const GOLD = 4;
const SILVER = 12;
export const CREST_W = 20;
export const CREST_H = 28;

/** Ancho del escudo en la fila y (0–23 del cuerpo): recto arriba y en punta abajo. */
function inset(y: number): number {
  return y < 13 ? 0 : Math.min(9, Math.floor((y - 12) * 0.85));
}

function piece(p: Pix, kind: CrestPiece, ox: number, oy: number, color: number, scale = 1): void {
  PIECES[kind].forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && p.rect(ox + x * scale, oy + y * scale, scale, scale, color)));
}

/** Escudo de 20×28: 4 filas de corona (ciudad y capital) y 24 de cuerpo. */
export function crestPix(crest: Crest, rank: number): Pix {
  const p = new Pix(CREST_W, CREST_H);
  const top = 4;
  const metal = crest.field === 2 || crest.field === 1 ? GOLD : SILVER;
  const rim = RIM[Math.max(0, Math.min(4, rank))]!;
  // Cuerpo: borde oscuro, filete del rango y campo (partido o cortado con metal).
  const inside = (x: number, y: number) => y >= 0 && y < 24 && x >= inset(y) && x < CREST_W - inset(y);
  const near = (x: number, y: number, d: number) => !inside(x - d, y) || !inside(x + d, y) || !inside(x, y - d) || !inside(x, y + d);
  for (let y = 0; y < 24; y++) {
    for (let x = inset(y); x < CREST_W - inset(y); x++) {
      let c = crest.field;
      if (crest.split === 1 && x >= CREST_W / 2) c = metal;
      if (crest.split === 2 && y >= 12) c = metal;
      p.set(x, top + y, near(x, y, 1) ? 0 : near(x, y, 2) ? rim : c);
    }
  }
  // Luz arriba a la izquierda (tramado).
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6 - (y - 2); x++) if ((x + y) % 2 === 0 && p.get(x, top + y) === crest.field) p.set(x, top + y, crest.field === 0 ? 15 : 31);
  // Piezas: una grande; dos, a los lados o arriba y abajo; tres o cuatro, en cuarteles.
  const ink = (x: number, y: number) => {
    const under = p.get(x + 3, y + 3);
    return under === GOLD || under === SILVER ? crest.field : metal;
  };
  const list = crest.pieces.slice(0, 4);
  if (list.length === 1) piece(p, list[0]!, 3, top + 3, ink(3, top + 3), 2);
  else if (list.length === 2) {
    const spots = crest.split === 2 ? [[6, top + 3], [6, top + 13]] : [[2, top + 7], [11, top + 7]];
    list.forEach((k, i) => piece(p, k, spots[i]![0]!, spots[i]![1]!, ink(spots[i]![0]!, spots[i]![1]!)));
  } else {
    const spots = [[2, top + 3], [11, top + 3], [6, top + 12], [6, top + 12]];
    if (list.length === 4) spots.splice(2, 2, [2, top + 11], [11, top + 11]);
    list.forEach((k, i) => piece(p, k, spots[i]![0]!, spots[i]![1]!, ink(spots[i]![0]!, spots[i]![1]!)));
  }
  // Corona: mural (ciudad) o real (capital comarcal); la villa, un listel.
  if (rank >= 4) {
    p.rect(3, 2, 14, 2, GOLD);
    for (const x of [3, 9, 15]) p.rect(x, 0, 2, 2, GOLD);
    p.set(10, 2, 2);
    p.set(6, 2, 9);
    p.set(13, 2, 9);
    p.hline(3, 3, 14, 19);
  } else if (rank >= 3) {
    p.rect(3, 1, 14, 3, 29);
    for (const x of [3, 7, 11, 15]) p.rect(x, 0, 2, 1, 29);
    p.hline(3, 3, 14, 27);
    p.set(6, 2, 0);
    p.set(13, 2, 0);
  } else if (rank >= 2) p.hline(4, 3, 12, rim);
  return p;
}

/** Escudo del estado (o el de la aldea si la partida aún no lo tiene). */
export function crestOf(state: GameState): { crest: Crest; rank: number } {
  return { crest: state.rank?.crest ?? baseCrest(state.seed, state.map.terrain ?? []), rank: state.rank?.level ?? 0 };
}

const key = (crest: Crest, rank: number) => `crest-${crest.field}${crest.split}${crest.pieces.join('.')}-${rank}`;

/** Canvas del escudo para la interfaz (se escala con CSS sin suavizar). */
export function crestCanvas(state: GameState, cls = 'crest'): HTMLCanvasElement {
  const { crest, rank } = crestOf(state);
  const src = sprite(key(crest, rank), () => crestPix(crest, rank));
  const c = document.createElement('canvas');
  c.width = CREST_W;
  c.height = CREST_H;
  c.className = cls;
  c.setAttribute('aria-hidden', 'true');
  c.getContext('2d')?.drawImage(src, 0, 0);
  return c;
}

/** Color del tablero del cartel según el rango: madera, crema, blanco, azul de carretera y verde. */
const BOARD = [MAT.wood, MAT.cream, MAT.white, MAT.blue, MAT.moss] as const;

/** Cartel de la entrada (32×48 como un árbol): dos postes, tablero, escudo y una marca por rango. */
export function signPix(crest: Crest, rank: number): Pix {
  const p = new Pix(32, 48);
  const r = Math.max(0, Math.min(4, rank));
  const board = BOARD[r]!;
  // Sombra y postes.
  p.ellipse(16, 45, 12, 2, 24);
  for (const x of [7, 24]) {
    p.vline(x, 30, 15, MAT.wood[2]);
    p.vline(x + 1, 30, 15, MAT.wood[3]);
  }
  // Tablero con marco.
  p.rect(2, 14, 28, 18, 0);
  p.rect(3, 15, 26, 16, board[1]);
  p.hline(3, 15, 26, board[0]);
  p.hline(3, 30, 26, board[2]);
  // Escudo a la mitad (10×14, cada 2×2 del grande a un píxel).
  const big = crestPix(crest, r);
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 10; x++) {
      const c = big.get(x * 2 + 1, y * 2 + 1);
      if (c >= 0) p.set(5 + x, 16 + y, c);
    }
  }
  // Rango: tantas marcas como rango (+1), de oro, y unas «letras» de rótulo.
  const text = r === 3 ? 12 : 0;
  for (let i = 0; i <= r; i++) p.rect(17 + i * 2, 26, 1, 2, r >= 3 ? GOLD : 2);
  for (let i = 0; i < 3; i++) p.hline(17, 18 + i * 3, 10 - (i % 2) * 3, text);
  return p;
}

export function signSprite(state: GameState, tod: TimeOfDay): HTMLCanvasElement {
  const { crest, rank } = crestOf(state);
  return sprite(`sign-${key(crest, rank)}`, () => signPix(crest, rank), tod);
}
