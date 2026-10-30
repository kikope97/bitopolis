import { TICKS_PER_DAY, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import {
  HONEYMOON,
  CAMPAIGN_EFFECT,
  CAMPAIGN_MONTHS,
  ELECTION_MONTHS,
  OPPOSITION_APPROVAL,
  OPPOSITION_POP,
  POLL_WARN_MONTHS,
  VOTE_ABSTENTION_BASE,
} from './balance.ts';
import { BUILD_NAMES, buildCost, governmentCommand } from './commands.ts';
import { taxLevels } from './economy.ts';
import { hash32 } from './hash.ts';
import { addMemory } from './social.ts';
import { buildingAt, type Citizen, type GameState, hasAdjacentRoad, pushEvent, Tile, tileIndex } from './state.ts';
import { freeHomes } from './tick.ts';

/**
 * Elecciones (spec §5.8, v1.0): facciones con exigencias opuestas, intención
 * de voto, avisos con antelación, oposición emergente y, si pierdes, la
 * oposición. Todo determinista: votos por esperanza (sin azar) y la IA solo
 * elige el voto de los vecinos con nombre entre opciones cerradas.
 */

export { emptyPolitics, FACTION_TEXT, FACTIONS, type ElectionResult, type Faction, type Party, type Politics } from './politics-core.ts';
import { FACTION_TEXT, type Faction, FACTIONS, PARTY_NAMES } from './politics-core.ts';

/** Facción de un vecino (por edad, negocio y rasgos). */
export function factionOf(state: GameState, c: Citizen): Faction {
  if (c.age >= 62) return 'jubilados';
  if (c.age < 32) return 'jovenes';
  if (state.buildings.some((b) => b.owner === c.id) || c.traits.ambicion >= 65) return 'empresarios';
  return 'ecologistas';
}

/** Activas a partir de OPPOSITION_POP vecinos (o si ya hay partido). */
export function politicsActive(state: GameState): boolean {
  return state.citizens.length >= OPPOSITION_POP || state.politics.party !== null || state.politics.mayor !== 'player';
}

function avgAtHomes(state: GameState, field: number[], members: Citizen[]): number {
  let sum = 0;
  let n = 0;
  for (const c of members) {
    const home = state.buildings.find((b) => b.id === c.homeId);
    if (!home) continue;
    sum += field[tileIndex(state, home.x, home.y)] ?? 0;
    n++;
  }
  return n ? sum / n : 0;
}

/** Exigencias de cada facción con los datos del pueblo (las no cumplidas restan). */
function unmetDemands(state: GameState, f: Faction, members: Citizen[]): string[] {
  const has = (k: string) => state.buildings.some((b) => b.kind === k && b.built);
  const lv = taxLevels(state);
  const out: string[] = [];
  if (f === 'jubilados') {
    if (!has('clinic')) out.push('un centro de salud');
    if (avgAtHomes(state, state.fields.crime, members) > 25 && !has('police')) out.push('más seguridad');
    if (lv.ibi === 'high') out.push('bajar el IBI');
  } else if (f === 'jovenes') {
    if (freeHomes(state) < 2 && state.demand.R > 30) out.push('vivienda');
    if (members.filter((c) => c.jobId === null).length > members.length * 0.3) out.push('empleo en el pueblo');
    if (!has('park')) out.push('un parque');
    if (!has('school')) out.push('un colegio');
  } else if (f === 'empresarios') {
    if (lv.tasas === 'high' || lv.ibi === 'high') out.push('bajar los impuestos');
    if (!has('shop') || state.demand.C > 40) out.push('más comercio');
    if (state.bankrupt || state.treasury < 0) out.push('sanear las cuentas');
  } else {
    if (avgAtHomes(state, state.fields.pollution, members) > 20) out.push('menos contaminación');
    if (!has('park')) out.push('un parque');
    const factories = state.buildings.filter((b) => b.kind === 'factory').length;
    const shops = state.buildings.filter((b) => b.kind === 'shop').length;
    if (factories > shops + 2) out.push('menos industria');
  }
  return out;
}

export function updateFactions(state: GameState): void {
  for (const f of FACTIONS) {
    const members = state.citizens.filter((c) => factionOf(state, c) === f);
    const unmet = unmetDemands(state, f, members);
    const happy = members.length ? members.reduce((a, c) => a + c.happiness, 0) / members.length : 50;
    // Con un gobierno rival, las exigencias de su propia facción pesan a su favor.
    const bonus = state.politics.mayor !== 'player' && state.politics.party?.faction === f ? 10 : 0;
    const satisfaction = Math.max(0, Math.min(100, Math.round(happy * 0.6 + 40 - unmet.length * 14 + bonus)));
    state.politics.factions[f] = { satisfaction, demand: unmet[0] ?? null, members: members.length };
  }
}

/** Probabilidad (0–1) de que un vecino vote al gobierno actual. */
function govSupport(state: GameState, c: Citizen): number {
  const fs = state.politics.factions[factionOf(state, c)].satisfaction;
  const s = c.happiness * 0.55 + fs * 0.45 - c.grudge * 0.6;
  let p = (s - 30) / 45;
  // Los vecinos de la facción del partido rival tiran hacia él; la campaña del jugador, hacia el jugador.
  const f = factionOf(state, c);
  if (state.politics.party && f === state.politics.party.faction) p += state.politics.mayor === 'player' ? -0.12 : 0.12;
  p += (state.politics.mayor === 'player' ? 1 : -1) * state.politics.campaign[f] * CAMPAIGN_EFFECT;
  // Luna de miel: el primer año tras unas elecciones, el descontento aún se achaca a quien gobernaba antes.
  const last = state.politics.history.at(-1);
  if (last) p += Math.max(0, 1 - (state.tick - last.tick) / (12 * TICKS_PER_MONTH)) * HONEYMOON;
  return Math.max(0.05, Math.min(0.95, p));
}

/** Recuento esperado: votos al gobierno, a la oposición y abstención. */
export function tally(state: GameState): { gov: number; opp: number; abstention: number } {
  let gov = 0;
  let opp = 0;
  let abstention = 0;
  for (const c of state.citizens) {
    if (c.named && c.vote) {
      if (c.vote === 'gobierno') gov++;
      else if (c.vote === 'oposicion') opp++;
      else abstention++;
      continue;
    }
    const p = govSupport(state, c);
    const abs = VOTE_ABSTENTION_BASE + 0.15 * (1 - Math.abs(p - 0.5) * 2);
    gov += (1 - abs) * p;
    opp += (1 - abs) * (1 - p);
    abstention += abs;
  }
  return { gov: Math.round(gov), opp: Math.round(opp), abstention: Math.round(abstention) };
}

/** Intención de voto al jugador (0–100). */
export function playerApproval(state: GameState): number {
  const t = tally(state);
  const total = t.gov + t.opp;
  if (total === 0) return 50;
  const gov = (t.gov / total) * 100;
  return Math.round(state.politics.mayor === 'player' ? gov : 100 - gov);
}

/** Probabilidad de votar al gobierno (para la decisión por reglas de los vecinos con nombre). */
export function voteLean(state: GameState, c: Citizen): number {
  return govSupport(state, c);
}

/* ---------------- oposición emergente ---------------- */

function foundParty(state: GameState): void {
  const p = state.politics;
  if (p.party || !politicsActive(state)) return;
  if (state.citizens.length < OPPOSITION_POP) return;
  // Solo en los 24 meses anteriores a las elecciones y con la intención de voto baja.
  if (p.nextElection - state.tick > 24 * TICKS_PER_MONTH || p.approval >= OPPOSITION_APPROVAL) return;
  const candidates = state.citizens.filter((c) => c.named && c.age >= 25);
  if (!candidates.length) return;
  const score = (c: Citizen) => c.traits.social + c.traits.ambicion + c.grudge * 2 - c.happiness + (hash32(c.id, state.seed) % 10);
  const leader = candidates.sort((a, b) => score(b) - score(a))[0]!;
  const faction = factionOf(state, leader);
  p.party = { leaderId: leader.id, leaderName: leader.name, name: PARTY_NAMES[faction], faction, founded: state.tick };
  addMemory(state, leader, 'fundo_partido', 5, 3);
  pushEvent(state, 'politics', `${leader.name} funda «${PARTY_NAMES[faction]}» y se presentará a las elecciones`, { ref: leader.id });
}

/* ---------------- avisos de popularidad ---------------- */

function warnings(state: GameState): void {
  const p = state.politics;
  const monthsLeft = Math.round((p.nextElection - state.tick) / TICKS_PER_MONTH);
  for (const m of POLL_WARN_MONTHS) {
    if (monthsLeft !== m || p.warned.includes(m)) continue;
    p.warned.push(m);
    if (!politicsActive(state)) continue;
    const rival = p.party ? ` frente a «${p.party.name}»` : '';
    const who = p.mayor === 'player' ? 'Tu intención de voto' : 'Tu intención de voto desde la oposición';
    const verdict = p.approval >= 55 ? 'vas por delante' : p.approval >= 45 ? 'está muy reñido' : 'vas por detrás';
    pushEvent(state, 'politics', `Faltan ${m} ${m === 1 ? 'mes' : 'meses'} para las elecciones. ${who}: ${p.approval} %${rival} (${verdict})`);
  }
}

/* ---------------- elecciones ---------------- */

function holdElection(state: GameState): void {
  const p = state.politics;
  const year = tickToDate(state.tick).year;
  const t = tally(state);
  const playerGoverns = p.mayor === 'player';
  const playerVotes = playerGoverns ? t.gov : t.opp;
  const rivalVotes = playerGoverns ? t.opp : t.gov;
  const unopposed = !p.party;
  const winner: 'player' | 'rival' = unopposed || playerVotes >= rivalVotes ? 'player' : 'rival';
  p.history.push({ tick: state.tick, player: unopposed ? t.gov + t.opp : playerVotes, rival: unopposed ? 0 : rivalVotes, abstention: t.abstention, winner, rivalName: p.party?.name ?? null, unopposed });
  if (p.history.length > 10) p.history.splice(0, p.history.length - 10);
  if (unopposed) {
    pushEvent(state, 'election', `Elecciones del año ${year}: sin candidatura rival, ${playerGoverns ? 'sigues de alcalde' : 'vuelves a la alcaldía'}`);
    p.mayor = 'player';
  } else if (winner === 'player') {
    pushEvent(state, 'election', `Elecciones del año ${year}: ganas con ${playerVotes} votos frente a ${rivalVotes} de «${p.party!.name}»${playerGoverns ? '' : '. Vuelves a la alcaldía'}`);
    p.mayor = 'player';
    p.party = null;
  } else {
    const leader = p.party!;
    pushEvent(state, 'election', `Elecciones del año ${year}: gana «${leader.name}» con ${rivalVotes} votos frente a tus ${playerVotes}. ${leader.leaderName} es ${playerGoverns ? 'el nuevo alcalde' : 'reelegido'}; tú pasas a la oposición`);
    p.mayor = leader.leaderId;
  }
  for (const c of state.citizens) c.vote = undefined;
  p.warned = [];
  p.campaign = { jubilados: 0, jovenes: 0, empresarios: 0, ecologistas: 0 };
  p.nextElection += ELECTION_MONTHS * TICKS_PER_MONTH;
}

/* ---------------- gobierno rival ---------------- */

const FACTION_BUILD: Record<Faction, string[]> = {
  jubilados: ['clinic', 'police', 'park'],
  jovenes: ['school', 'park', 'house'],
  empresarios: ['police', 'house', 'park'],
  ecologistas: ['park', 'park', 'clinic'],
};

function freeSpot(state: GameState): { x: number; y: number } | null {
  const th = state.buildings.find((b) => b.kind === 'townhall');
  const cx = th?.x ?? Math.floor(state.map.w / 2);
  const cy = th?.y ?? Math.floor(state.map.h / 2);
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < state.map.h; y++) {
    for (let x = 0; x < state.map.w; x++) {
      if (state.map.tiles[tileIndex(state, x, y)] === Tile.Road || buildingAt(state, x, y) || !hasAdjacentRoad(state, x, y)) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  return best;
}

/** El alcalde rival gobierna a fin de mes según las prioridades de su facción. */
function rivalGovern(state: GameState): void {
  const p = state.politics;
  if (p.mayor === 'player' || !p.party) return;
  const f = p.party.faction;
  // Impuestos según la facción.
  const want = f === 'empresarios' ? 'low' : f === 'jubilados' ? 'low' : 'medium';
  if (state.taxesSplit) {
    if (f === 'jubilados') governmentCommand(state, { type: 'SetTaxes', ibi: 'low', tasas: 'medium' });
    else if (f === 'empresarios') governmentCommand(state, { type: 'SetTaxes', ibi: 'medium', tasas: 'low' });
    else governmentCommand(state, { type: 'SetTaxes', ibi: 'medium', tasas: 'medium' });
  } else if (state.taxLevel !== want) governmentCommand(state, { type: 'SetTax', level: want });
  // Una obra al mes si hay caja, por orden de prioridad de la facción.
  for (const kind of FACTION_BUILD[f]) {
    const exists = state.buildings.filter((b) => b.kind === kind).length;
    if (kind !== 'house' && kind !== 'park' && exists > 0) continue;
    if (state.treasury < buildCost(kind as never) + 3_000) break;
    const spot = freeSpot(state);
    if (!spot) break;
    if (governmentCommand(state, { type: 'Build', kind: kind as never, x: spot.x, y: spot.y })) {
      pushEvent(state, 'politics', `El alcalde ${p.party.leaderName} empieza ${BUILD_NAMES[kind]?.toLowerCase() === 'parque' ? 'un parque' : `la obra: ${BUILD_NAMES[kind]}`}`);
      break;
    }
  }
}

/* ---------------- ciclo ---------------- */

export function politicsDay(state: GameState): void {
  const p = state.politics;
  // Si el líder del partido se va del pueblo, el partido se disuelve (y si gobernaba, vuelves).
  if (p.party && !state.citizens.some((c) => c.id === p.party!.leaderId)) {
    pushEvent(state, 'politics', `«${p.party.name}» se disuelve: ${p.party.leaderName} se ha ido del pueblo${p.mayor !== 'player' ? '. Vuelves a la alcaldía' : ''}`);
    p.party = null;
    p.mayor = 'player';
  }
  updateFactions(state);
  p.approval = playerApproval(state);
  if (state.tick % TICKS_PER_MONTH === 0) {
    foundParty(state);
    rivalGovern(state);
  }
  warnings(state);
  if (state.tick >= p.nextElection) holdElection(state);
}

/* ---------------- campaña del jugador ---------------- */

export function canCampaign(state: GameState): { ok: boolean; error?: string } {
  const p = state.politics;
  if (!politicsActive(state)) return { ok: false, error: `La política empieza con ${OPPOSITION_POP} vecinos` };
  if (p.nextElection - state.tick > CAMPAIGN_MONTHS * TICKS_PER_MONTH) return { ok: false, error: `La campaña empieza ${CAMPAIGN_MONTHS} meses antes de las elecciones` };
  if (p.lastCampaign >= 0 && state.tick - p.lastCampaign < TICKS_PER_MONTH) return { ok: false, error: 'Solo una campaña al mes' };
  return { ok: true };
}

export function campaign(state: GameState, f: Faction): void {
  const p = state.politics;
  p.campaign[f] = Math.min(3, p.campaign[f] + 1);
  p.lastCampaign = state.tick;
  pushEvent(state, 'politics', `Haces campaña entre ${FACTION_TEXT[f].toLowerCase()}: escuchas lo que piden (${p.factions[f].demand ?? 'que todo siga así'})`);
}

/** Días que faltan para las próximas elecciones. */
export function daysToElection(state: GameState): number {
  return Math.max(0, Math.ceil((state.politics.nextElection - state.tick) / TICKS_PER_DAY));
}
