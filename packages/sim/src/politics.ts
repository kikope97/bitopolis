import { TICKS_PER_DAY, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import {
  HONEYMOON,
  CAMPAIGN_COST,
  MOTION_MONTHS,
  RIVAL_PROMISE_MONTHS,
  CAMPAIGN_EFFECT,
  CAMPAIGN_EFFECT_OPP,
  CAMPAIGN_MAX,
  CAMPAIGN_MONTHS,
  ELECTION_MONTHS,
  OPPOSITION_APPROVAL,
  OPPOSITION_POP,
  POLL_WARN_MONTHS,
  VOTE_ABSTENTION_BASE,
} from './balance.ts';
import { BUILD_NAMES, buildCost, governmentCommand } from './commands.ts';
import { felt, saturated, taxLevels, updateFeltTaxes } from './economy.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { hash32 } from './hash.ts';
import { addHook, addMemory } from './social.ts';
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
  const lv = felt(state);
  const out: string[] = [];
  if (f === 'jubilados') {
    if (!has('clinic')) out.push('un centro de salud');
    else if (saturated(state, 'clinic')) out.push('otro centro de salud');
    if (avgAtHomes(state, state.fields.crime, members) > 25 && (!has('police') || saturated(state, 'police'))) out.push('más seguridad');
    if (lv.ibi === 'high') out.push('bajar el IBI');
  } else if (f === 'jovenes') {
    if (freeHomes(state) < 2 && state.demand.R > 30) out.push('vivienda');
    if (members.filter((c) => c.jobId === null).length > members.length * 0.3) out.push('empleo en el pueblo');
    if (!has('park')) out.push('un parque');
    if (!has('school')) out.push('un colegio');
    else if (saturated(state, 'school')) out.push('otro colegio');
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
    state.politics.factions[f] = { satisfaction, demand: unmet[0] ?? null, demands: unmet.slice(0, 2), unmet, members: members.length };
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
  // En la oposición, cada punto pesa el doble (es lo único que se puede hacer).
  const governs = state.politics.mayor === 'player';
  p += (governs ? 1 : -1) * state.politics.campaign[f] * (governs ? CAMPAIGN_EFFECT : CAMPAIGN_EFFECT_OPP);
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
  // Promete lo que más pide su facción (si gobierna, tendrá un año para cumplirlo).
  const need = p.factions[faction].demand;
  const promises = need ? [{ faction, need, deadline: p.nextElection + RIVAL_PROMISE_MONTHS * TICKS_PER_MONTH, status: 'pending' as const, fromMotion: false }] : [];
  p.party = { leaderId: leader.id, leaderName: leader.name, name: PARTY_NAMES[faction], faction, founded: state.tick, promises };
  addMemory(state, leader, 'fundo_partido', 5, 3);
  addHook(state, 'rival_politico', [leader.id]);
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
  // El empate lo gana quien gobierna.
  const winner: 'player' | 'rival' = unopposed || playerVotes > rivalVotes || (playerVotes === rivalVotes && playerGoverns) ? 'player' : 'rival';
  p.history.push({ tick: state.tick, player: unopposed ? t.gov + t.opp : playerVotes, rival: unopposed ? 0 : rivalVotes, abstention: t.abstention, winner, rivalName: p.party?.name ?? null, unopposed });
  if (p.history.length > 10) p.history.splice(0, p.history.length - 10);
  if (unopposed) {
    pushEvent(state, 'election', `Elecciones del año ${year}: sin candidatura rival, ${playerGoverns ? 'sigues de alcalde' : 'vuelves a la alcaldía'}`);
    p.mayor = 'player';
  } else if (winner === 'player') {
    const loser = state.citizens.find((c) => c.id === p.party!.leaderId);
    if (loser) addMemory(state, loser, 'perdio_elecciones', 5, -4);
    pushEvent(state, 'election', `Elecciones del año ${year}: ganas con ${playerVotes} votos frente a ${rivalVotes} de «${p.party!.name}»${playerGoverns ? '' : '. Vuelves a la alcaldía'}`);
    p.mayor = 'player';
    p.party = null;
  } else {
    const leader = p.party!;
    const winnerC = state.citizens.find((c) => c.id === leader.leaderId);
    if (winnerC) addMemory(state, winnerC, 'gano_elecciones', 5, 6);
    pushEvent(state, 'election', `Elecciones del año ${year}: gana «${leader.name}» con ${rivalVotes} votos frente a tus ${playerVotes}. ${leader.leaderName} es ${playerGoverns ? 'el nuevo alcalde' : 'reelegido'}; tú pasas a la oposición`);
    p.mayor = leader.leaderId;
  }
  for (const c of state.citizens) {
    if (c.named && c.vote) addMemory(state, c, 'voto', 1, 0);
    c.vote = undefined;
  }
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
const LOG_MAX = 20;

/** Lo que hace el gobierno rival: sale en el diario y queda en su registro (v1.3). */
function rivalAct(state: GameState, text: string): void {
  pushEvent(state, 'politics', text);
  const log = state.politics.log;
  log.push({ tick: state.tick, text });
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}

const LEVEL_TEXT = { low: 'bajo', medium: 'medio', high: 'alto' } as const;

function rivalGovern(state: GameState): void {
  const p = state.politics;
  if (p.mayor === 'player' || !p.party) return;
  const f = p.party.faction;
  const taxesBefore = JSON.stringify(taxLevels(state));
  // Impuestos según la facción; con déficit y la caja baja, como cualquier gobierno, los sube.
  const last = state.stats.at(-1);
  const deficit = !!last && last.income < last.expenses && state.treasury < 10_000;
  const want = deficit ? 'high' : f === 'empresarios' || f === 'jubilados' ? 'low' : 'medium';
  if (deficit && state.taxesSplit) governmentCommand(state, { type: 'SetTaxes', ibi: 'high', tasas: 'high' });
  else if (state.taxesSplit) {
    if (f === 'jubilados') governmentCommand(state, { type: 'SetTaxes', ibi: 'low', tasas: 'medium' });
    else if (f === 'empresarios') governmentCommand(state, { type: 'SetTaxes', ibi: 'medium', tasas: 'low' });
    else governmentCommand(state, { type: 'SetTaxes', ibi: 'medium', tasas: 'medium' });
  } else if (state.taxLevel !== want) governmentCommand(state, { type: 'SetTax', level: want });
  // Promesas fiscales: si no hay déficit, las cumple bajando ese impuesto.
  const owesTax = (need: string) => p.party!.promises.some((x) => x.status === 'pending' && x.need === need);
  if (!deficit && owesTax('bajar el IBI')) governmentCommand(state, state.taxesSplit ? { type: 'SetTaxes', ibi: 'low' } : { type: 'SetTax', level: 'low' });
  if (!deficit && owesTax('bajar los impuestos')) governmentCommand(state, state.taxesSplit ? { type: 'SetTaxes', tasas: 'low', ibi: 'low' } : { type: 'SetTax', level: 'low' });
  if (JSON.stringify(taxLevels(state)) !== taxesBefore) {
    const t = taxLevels(state);
    const what = state.taxesSplit ? `IBI ${LEVEL_TEXT[t.ibi]}, tasas ${LEVEL_TEXT[t.tasas]}` : `impuestos en ${LEVEL_TEXT[t.ibi]}`;
    rivalAct(state, `El alcalde ${p.party.leaderName} cambia los impuestos: ${what}${deficit ? ' (hay déficit)' : ''}`);
  }
  // Con deuda seria, recorta: derriba su último parque o casa municipal (como haría cualquiera).
  if (state.treasury < -5_000) {
    const cut = [...state.buildings].reverse().find((b) => (b.kind === 'park' || b.kind === 'house') && b.built);
    if (cut && governmentCommand(state, { type: 'Demolish', x: cut.x, y: cut.y })) rivalAct(state, `El alcalde ${p.party.leaderName} recorta gastos: derriba ${cut.kind === 'park' ? 'un parque' : 'una casa municipal'}`);
  }
  // Una obra al mes si hay caja, por orden de prioridad de la facción.
  if (deficit) return;
  // Primero, lo prometido que se resuelve con una obra.
  const owed = p.party.promises.filter((x) => x.status === 'pending' && NEED_BUILD[x.need]).map((x) => NEED_BUILD[x.need]!);
  for (const kind of [...owed, ...FACTION_BUILD[f]]) {
    const exists = state.buildings.filter((b) => b.kind === kind).length;
    if (kind !== 'house' && kind !== 'park' && exists > 0 && !saturated(state, kind as never)) continue;
    // Como mucho un parque por cada 25 vecinos y una casa municipal por cada 15.
    if (kind === 'park' && exists >= Math.ceil(state.citizens.length / 25)) continue;
    if (kind === 'house' && exists >= Math.ceil(state.citizens.length / 15)) continue;
    if (state.treasury < buildCost(kind as never) + 3_000) break;
    const spot = freeSpot(state);
    if (!spot) break;
    if (governmentCommand(state, { type: 'Build', kind: kind as never, x: spot.x, y: spot.y })) {
      rivalAct(state, `El alcalde ${p.party.leaderName} empieza ${BUILD_NAMES[kind]?.toLowerCase() === 'parque' ? 'un parque' : `la obra: ${BUILD_NAMES[kind]}`}`);
      break;
    }
  }
}

/** Obra que resuelve una exigencia (para que el gobierno rival la priorice). */
/** Exigencias que se resuelven bajando un impuesto. */
const TAX_NEEDS = new Set(['bajar el IBI', 'bajar los impuestos']);

const NEED_BUILD: Record<string, string> = {
  'un centro de salud': 'clinic',
  'un colegio': 'school',
  'otro colegio': 'school',
  'otro centro de salud': 'clinic',
  'un parque': 'park',
  'más seguridad': 'police',
  vivienda: 'house',
};

/** Promesas del rival: cumplidas si la exigencia ya no falta; rotas si vence el plazo gobernando. */
function checkRivalPromises(state: GameState): void {
  const p = state.politics;
  if (!p.party) return;
  for (const pr of p.party.promises) {
    if (pr.status !== 'pending') continue;
    const governing = p.mayor === p.party.leaderId;
    if (!p.factions[pr.faction].unmet.includes(pr.need) && governing) {
      pr.status = 'kept';
      rivalAct(state, `«${p.party.name}» cumple lo prometido a ${FACTION_TEXT[pr.faction].toLowerCase()}: ${pr.need}`);
    } else if (governing && state.tick > pr.deadline) {
      pr.status = 'broken';
      // Una promesa rota es munición para la oposición: esa facción se acerca al jugador.
      p.campaign[pr.faction] = Math.min(CAMPAIGN_MAX, p.campaign[pr.faction] + 2);
      rivalAct(state, `«${p.party.name}» incumple su promesa a ${FACTION_TEXT[pr.faction].toLowerCase()} (${pr.need}). Lo recordarán en las urnas`);
    }
  }
}

/* ---------------- mociones desde la oposición ---------------- */

export function canMotion(state: GameState, f: Faction): { ok: boolean; error?: string } {
  const p = state.politics;
  if (p.mayor === 'player' || !p.party) return { ok: false, error: 'Las mociones se presentan desde la oposición' };
  if (p.lastMotion >= 0 && state.tick - p.lastMotion < TICKS_PER_MONTH) return { ok: false, error: 'Solo una moción al mes' };
  if (!p.factions[f].demand) return { ok: false, error: `${FACTION_TEXT[f]} no piden nada ahora mismo` };
  if (p.party.promises.some((x) => x.status === 'pending' && x.need === p.factions[f].demand)) return { ok: false, error: 'El gobierno ya se comprometió a eso' };
  const need = p.factions[f].demand;
  if (p.motions.some((m) => m.need === need && state.tick - m.tick < MOTION_MONTHS * TICKS_PER_MONTH)) return { ok: false, error: 'Ya llevaste eso al pleno hace menos de 6 meses' };
  return { ok: true };
}

/**
 * Moción: el jugador lleva al pleno lo que pide una facción. El gobierno rival la acepta
 * si es de su facción o si hay caja para hacerla (y queda comprometido 6 meses); si la
 * rechaza, esa facción se acerca al jugador.
 */
export function motion(state: GameState, f: Faction): void {
  const p = state.politics;
  const party = p.party!;
  const need = p.factions[f].demand!;
  p.lastMotion = state.tick;
  const buildable = NEED_BUILD[need];
  // Lo que el gobierno puede hacer: una obra (si hay caja) o bajar un impuesto. Lo demás lo rechaza (salvo si es de su facción).
  const doable = buildable ? state.treasury >= buildCost(buildable as never) + 5_000 : TAX_NEEDS.has(need);
  const approved = f === party.faction || doable;
  p.motions.push({ need, faction: f, tick: state.tick, approved });
  if (p.motions.length > 24) p.motions.splice(0, p.motions.length - 24);
  if (approved) {
    party.promises.push({ faction: f, need, deadline: state.tick + MOTION_MONTHS * TICKS_PER_MONTH, status: 'pending', fromMotion: true });
    pushEvent(state, 'politics', `El pleno aprueba tu moción: ${need} para ${FACTION_TEXT[f].toLowerCase()}. El gobierno tiene ${MOTION_MONTHS} meses para cumplirla`);
  } else {
    p.campaign[f] = Math.min(CAMPAIGN_MAX, p.campaign[f] + 2);
    pushEvent(state, 'politics', `El gobierno rechaza tu moción (${need}). ${FACTION_TEXT[f]} toman nota`);
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
  updateFeltTaxes(state);
  updateFactions(state);
  p.approval = playerApproval(state);
  if (state.tick % TICKS_PER_MONTH === 0) {
    foundParty(state);
    // Primero se miran las promesas (con el pueblo tal como está), luego gobierna.
    checkRivalPromises(state);
    rivalGovern(state);
  }
  warnings(state);
  if (state.tick >= p.nextElection) holdElection(state);
}

/* ---------------- campaña del jugador ---------------- */

export function canCampaign(state: GameState): { ok: boolean; error?: string } {
  const p = state.politics;
  if (!politicsActive(state)) return { ok: false, error: `La política empieza con ${OPPOSITION_POP} vecinos` };
  // En la oposición se puede hacer campaña todo el mandato; gobernando, el último año.
  const governing = p.mayor === 'player';
  if (governing && p.nextElection - state.tick > CAMPAIGN_MONTHS * TICKS_PER_MONTH) return { ok: false, error: `Gobernando, la campaña empieza ${CAMPAIGN_MONTHS} meses antes de las elecciones` };
  if (p.lastCampaign >= 0 && state.tick - p.lastCampaign < TICKS_PER_MONTH) return { ok: false, error: 'Solo una campaña al mes' };
  if (governing && state.treasury < CAMPAIGN_COST) return { ok: false, error: `Cada acto cuesta ${CAMPAIGN_COST} €` };
  return { ok: true };
}

export function campaign(state: GameState, f: Faction): void {
  const p = state.politics;
  if (p.mayor === 'player') transfer(state, TREASURY, OUTSIDE, CAMPAIGN_COST, 'actos');
  // Los actos de campaña suben hasta 3; mociones rechazadas y promesas rotas, hasta CAMPAIGN_MAX.
  p.campaign[f] = Math.max(p.campaign[f], Math.min(3, p.campaign[f] + 1));
  p.lastCampaign = state.tick;
  pushEvent(state, 'politics', `Haces campaña entre ${FACTION_TEXT[f].toLowerCase()}: escuchas lo que piden (${p.factions[f].demand ?? 'que todo siga así'})`);
}

/** Días que faltan para las próximas elecciones. */
export function daysToElection(state: GameState): number {
  return Math.max(0, Math.ceil((state.politics.nextElection - state.tick) / TICKS_PER_DAY));
}
