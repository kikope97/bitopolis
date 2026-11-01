import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { ELECTION_MONTHS } from './balance.ts';

/** Tipos y estado inicial de la política (sin dependencias: lo importa state.ts). */
export const FACTIONS = ['jubilados', 'jovenes', 'empresarios', 'ecologistas'] as const;
export type Faction = (typeof FACTIONS)[number];

export const FACTION_TEXT: Record<Faction, string> = {
  jubilados: 'Jubilados',
  jovenes: 'Jóvenes',
  empresarios: 'Empresarios',
  ecologistas: 'Ecologistas',
};

export const PARTY_NAMES: Record<Faction, string> = {
  jubilados: 'Plataforma de Mayores',
  jovenes: 'Jóvenes por Bitópolis',
  empresarios: 'Bitópolis Emprende',
  ecologistas: 'Bitópolis Verde',
};

/** 2.2: estilo del rival, de los rasgos de su líder (cambia lo que promete y cómo gobierna). */
export const RIVAL_STYLES = ['populista', 'tecnico', 'conservador', 'verde'] as const;
export type RivalStyle = (typeof RIVAL_STYLES)[number];

export const STYLE_TEXT: Record<RivalStyle, string> = {
  populista: 'Populista',
  tecnico: 'Técnico',
  conservador: 'Conservador',
  verde: 'Verde',
};

/** Estilo que se le supone a una facción (partidas de antes de la 2.2). */
export const FACTION_STYLE: Record<Faction, RivalStyle> = {
  jubilados: 'conservador',
  jovenes: 'populista',
  empresarios: 'tecnico',
  ecologistas: 'verde',
};

/**
 * 2.2: cómo se comprueba una promesa. `exigencia`: deja de faltar lo que pedía
 * la facción; `impuestos`: no los sube; `empleo`: más vecinos con trabajo;
 * `deuda`: caja saneada con superávit.
 */
export const PROMISE_CHECKS = ['exigencia', 'impuestos', 'empleo', 'deuda'] as const;
export type PromiseCheck = (typeof PROMISE_CHECKS)[number];

/** Compromiso del partido rival (v1.1): se cumple si la exigencia deja de faltar en el pueblo. */
export interface RivalPromise {
  /** 2.2: tipo de comprobación (las de antes, `exigencia`). */
  check: PromiseCheck;
  /** 2.2: referencia medida al llegar al gobierno (nivel de impuestos o vecinos con trabajo). */
  base?: number;
  faction: Faction;
  /** Texto de la exigencia del motor (p. ej. «un centro de salud»). */
  need: string;
  /** Hasta cuándo tiene para cumplirla (solo cuenta si gobierna). */
  deadline: number;
  status: 'pending' | 'kept' | 'broken';
  /** Nació de una moción del jugador en la oposición. */
  fromMotion: boolean;
}

export interface Party {
  leaderId: number;
  leaderName: string;
  name: string;
  faction: Faction;
  founded: number;
  promises: RivalPromise[];
  /** 2.2: estilo (de los rasgos del líder). */
  style: RivalStyle;
  /** 2.2: lo último que dijo gobernando (la IA, filtrado). */
  speech?: { tick: number; text: string };
}

export interface ElectionResult {
  tick: number;
  /** Votos (esperados) al jugador, al rival y abstención. */
  player: number;
  rival: number;
  abstention: number;
  winner: 'player' | 'rival';
  rivalName: string | null;
  unopposed: boolean;
  /** 2.2: votos de cada candidatura (para la noche electoral con una barra por lista). */
  lists?: { leaderId: number; name: string; leaderName: string; faction: Faction; votes: number }[];
  /** 2.2: nombre de quien gana si es otra candidatura. */
  winnerName?: string | null;
}

export interface Politics {
  nextElection: number;
  /** Quién gobierna: el jugador o un vecino (id) tras ganar unas elecciones. */
  mayor: 'player' | number;
  /** Partido rival: en la oposición, o en el gobierno si ganó. */
  party: Party | null;
  history: ElectionResult[];
  /** Avisos de popularidad ya dados antes de las próximas elecciones (meses). */
  warned: number[];
  /** Intención de voto al jugador (0–100), recalculada cada día. */
  approval: number;
  /** Satisfacción de cada facción (0–100) y su exigencia principal. */
  /** `unmet`: todas las exigencias sin cumplir; `demands`: las 2 primeras (lo que se enseña). */
  factions: Record<Faction, { satisfaction: number; demand: string | null; demands: string[]; unmet: string[]; members: number }>;
  /** Campaña del jugador por facción (0–3) y tick de la última. */
  campaign: Record<Faction, number>;
  lastCampaign: number;
  /** Nivel de impuestos que notan los vecinos (0–2): sube al momento y baja despacio. */
  perceivedTax: { ibi: number; tasas: number; plusvalia: number };
  /** Última moción del jugador en la oposición (una al mes). */
  lastMotion: number;
  /** Mociones presentadas (la misma exigencia no se repite en 6 meses) y su resultado. */
  motions: { need: string; faction: Faction; tick: number; approved: boolean }[];
  /** v1.3: lo que ha hecho el gobierno rival (obras, impuestos, recortes, promesas), lo último al final. */
  log: { tick: number; text: string }[];
  /**
   * 2.2: candidaturas (hasta `LISTS.max`, una por líder). Incluye una copia de
   * `party` (la fuente de verdad es `party`; `syncLists` la copia, nunca la misma
   * referencia, para que el hash sea igual en el cliente y en el servidor).
   */
  lists: Party[];
  /** 2.2: mes (tick / mes) en que la IA gobernó por el rival; ese mes no gobiernan las reglas. */
  rivalAiMonth?: number;
}

export function emptyPolitics(tick = 0): Politics {
  const period = ELECTION_MONTHS * TICKS_PER_MONTH;
  return {
    nextElection: (Math.floor(tick / period) + 1) * period,
    mayor: 'player',
    party: null,
    history: [],
    warned: [],
    approval: 60,
    factions: Object.fromEntries(FACTIONS.map((f) => [f, { satisfaction: 50, demand: null, demands: [] as string[], unmet: [] as string[], members: 0 }])) as Politics['factions'],
    campaign: { jubilados: 0, jovenes: 0, empresarios: 0, ecologistas: 0 },
    lastCampaign: -1,
    perceivedTax: { ibi: 1, tasas: 1, plusvalia: 1 },
    lastMotion: -1,
    motions: [],
    log: [],
    lists: [],
  };
}

