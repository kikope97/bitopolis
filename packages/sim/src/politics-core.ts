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

export interface Party {
  leaderId: number;
  leaderName: string;
  name: string;
  faction: Faction;
  founded: number;
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
  factions: Record<Faction, { satisfaction: number; demand: string | null; members: number }>;
  /** Campaña del jugador por facción (0–3) y tick de la última. */
  campaign: Record<Faction, number>;
  lastCampaign: number;
  /** Nivel de impuestos que notan los vecinos (0–2): sube al momento y baja despacio. */
  perceivedTax: { ibi: number; tasas: number; plusvalia: number };
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
    factions: Object.fromEntries(FACTIONS.map((f) => [f, { satisfaction: 50, demand: null, members: 0 }])) as Politics['factions'],
    campaign: { jubilados: 0, jovenes: 0, empresarios: 0, ecologistas: 0 },
    lastCampaign: -1,
    perceivedTax: { ibi: 1, tasas: 1, plusvalia: 1 },
  };
}

