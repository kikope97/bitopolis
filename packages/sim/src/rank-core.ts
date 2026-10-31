import { hash32 } from './hash.ts';
import { Terrain } from './terrain.ts';

/**
 * 2.1: tipos y escudo inicial de los rangos del pueblo, sin dependencias del
 * estado (state.ts lo usa al crear la partida; la lógica está en rank.ts).
 */

export const CREST_PIECES = ['torre', 'puente', 'espiga', 'ola', 'arbol', 'monte', 'rueda', 'campana', 'libro', 'llave', 'sol', 'estrella'] as const;
export type CrestPiece = (typeof CREST_PIECES)[number];

export const MOTTOS = {
  trabajo_y_concordia: 'Trabajo y concordia',
  pan_agua_y_fiesta: 'Pan, agua y fiesta',
  pequeno_pero_valiente: 'Pequeño pero valiente',
  de_la_tierra_su_gente: 'De la tierra, su gente',
  siempre_adelante: 'Siempre adelante',
  unidos_crecemos: 'Unidos crecemos',
  al_rio_la_vida: 'Al río le debemos la vida',
  mirando_al_mar: 'Mirando al mar',
  lo_que_el_monte_da: 'Lo que el monte da',
  muy_leal_y_noble: 'Muy leal y muy noble',
  puertas_abiertas: 'Puertas abiertas',
  cuentas_claras: 'Cuentas claras',
} as const;
export type Motto = keyof typeof MOTTOS;
export const MOTTO_IDS = Object.keys(MOTTOS) as Motto[];

/** Campo del escudo: colores de la paleta (gules, azur, sinople, púrpura, sable). */
export const CREST_FIELDS = [2, 9, 24, 1, 0] as const;

export interface Crest {
  /** Índice de la paleta del campo. */
  field: number;
  /** 0 liso, 1 partido (en dos), 2 cortado (arriba y abajo). */
  split: 0 | 1 | 2;
  pieces: CrestPiece[];
  motto: Motto | null;
}
export interface CrestVote {
  /** Rango que se celebra. */
  rank: number;
  opened: number;
  due: number;
  pieces: CrestPiece[];
  mottos: Motto[];
}
export interface TownRank {
  /** Índice en RANKS (0 aldea … 4 capital comarcal). */
  level: number;
  since: number;
  crest: Crest;
  vote: CrestVote | null;
}

/** Escudo de la aldea (al empezar o al migrar): campo, partición y una pieza según el terreno. */
export function baseCrest(seed: number, terrain: readonly number[]): Crest {
  const h = hash32(seed, 7);
  const options: CrestPiece[] = [];
  if (terrain.includes(Terrain.Sea)) options.push('ola');
  if (terrain.includes(Terrain.Hill)) options.push('monte');
  if (terrain.includes(Terrain.River)) options.push('ola');
  options.push('espiga');
  return {
    field: CREST_FIELDS[h % CREST_FIELDS.length]!,
    split: ((h >>> 8) % 3) as 0 | 1 | 2,
    pieces: [options[(h >>> 12) % options.length]!],
    motto: null,
  };
}

/** Rango inicial (aldea, o el que ya tenía un pueblo de antes al migrar). */
export function emptyRank(seed: number, terrain: readonly number[], level = 0, tick = 0): TownRank {
  return { level, since: tick, crest: baseCrest(seed, terrain), vote: null };
}
