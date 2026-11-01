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
  VOTE_ABSTENTION_BASE, TURN, TRASH, LISTS, RIVAL_PROMISES, TOURISM } from './balance.ts';
import { levelOf } from './levels.ts';
import { protectedHeritage } from './tourism.ts';
import { BUILD_NAMES, buildCost, governmentCommand } from './commands.ts';
import { rivalBudget } from './civic.ts';
import { felt, saturated, taxLevels, updateFeltTaxes } from './economy.ts';
import { OUTSIDE, ownIncome, TREASURY, transfer } from './money.ts';
import { hash32 } from './hash.ts';
import { addHook, addMemory } from './social.ts';
import { buildingAt, type Citizen, type GameState, hasAdjacentRoad, pushEvent, Tile, tileIndex } from './state.ts';
import { freeHomes } from './tick.ts';
import { greenFaction, riverDirty } from './waterworks.ts';

/**
 * Elecciones (spec §5.8, v1.0): facciones con exigencias opuestas, intención
 * de voto, avisos con antelación, oposición emergente y, si pierdes, la
 * oposición. Todo determinista: votos por esperanza (sin azar) y la IA solo
 * elige el voto de los vecinos con nombre entre opciones cerradas.
 */

export {
  emptyPolitics,
  FACTION_STYLE,
  FACTION_TEXT,
  FACTIONS,
  PROMISE_CHECKS,
  RIVAL_STYLES,
  STYLE_TEXT,
  type ElectionResult,
  type Faction,
  type Party,
  type Politics,
  type PromiseCheck,
  type RivalPromise,
  type RivalStyle,
} from './politics-core.ts';
import { FACTION_TEXT, type Faction, FACTIONS, PARTY_NAMES, type Party, type RivalPromise, type RivalStyle } from './politics-core.ts';

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
    // 2.1: la basura en la calle les pesa.
    if (avgAtHomes(state, state.fields.dirt ?? [], members) > TRASH.dirtyField / 2) out.push('recogida de basura');
    if (!has('park')) out.push('un parque');
    const factories = state.buildings.filter((b) => b.kind === 'factory').length;
    const shops = state.buildings.filter((b) => b.kind === 'shop').length;
    if (factories > shops + 2) out.push('menos industria');
    // 2.4: el río sucio.
    if (riverDirty(state)) out.push('un río limpio');
  }
  return out;
}

export function updateFactions(state: GameState): void {
  for (const f of FACTIONS) {
    const members = state.citizens.filter((c) => factionOf(state, c) === f);
    const unmet = unmetDemands(state, f, members);
    const happy = members.length ? members.reduce((a, c) => a + c.happiness, 0) / members.length : 50;
    // Con un gobierno rival, las exigencias de su propia facción pesan a su favor.
    const bonus =
      (state.politics.mayor !== 'player' && state.politics.party?.faction === f ? 10 : 0) +
      // 2.1: el reciclaje (punto limpio de nivel 2 o más) contenta a los ecologistas.
      (f === 'ecologistas' && state.buildings.some((b) => b.kind === 'cleanpoint' && b.built && levelOf(b) >= 2) ? TRASH.recyclingFaction : 0) +
      // 2.3: el entorno protegido del patrimonio no gusta a los empresarios (sin industria nueva).
      (f === 'empresarios' && protectedHeritage(state) ? TOURISM.protect.ownerMood : 0) +
      // 2.4: placas, molinos y depuradora contentan a los ecologistas.
      (f === 'ecologistas' ? greenFaction(state) : 0);
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
  // 2.2: la facción de cada candidatura tira hacia ella (la del gobierno rival, hacia el gobierno).
  for (const l of candidacies(state)) if (f === l.faction) p += state.politics.mayor === l.leaderId ? LISTS.factionPull : -LISTS.factionPull;
  // En la oposición, cada punto pesa el doble (es lo único que se puede hacer).
  const governs = state.politics.mayor === 'player';
  p += (governs ? 1 : -1) * state.politics.campaign[f] * (governs ? CAMPAIGN_EFFECT : CAMPAIGN_EFFECT_OPP);
  // Luna de miel: el primer año tras unas elecciones, el descontento aún se achaca a quien gobernaba antes.
  const last = state.politics.history.at(-1);
  if (last) p += Math.max(0, 1 - (state.tick - last.tick) / (12 * TICKS_PER_MONTH)) * HONEYMOON;
  // 2.0: la actitud que decide la IA (−2…2) mueve su voto dentro de un margen.
  if (c.attitude) p += c.attitude * TURN.attitudeVote * (governs ? 1 : -1);
  return Math.max(0.05, Math.min(0.95, p));
}

/** Quien se presenta: el jugador o una candidatura (id de su líder). */
export type Contender = 'player' | number;

export interface Tally {
  gov: number;
  opp: number;
  abstention: number;
  /** 2.2: votos de cada candidato (el que gobierna primero, luego la oposición en orden; el jugador antes que las listas). */
  votes: { who: Contender; votes: number }[];
}

/** Candidatos de la oposición (a quienes se reparte el voto contra el gobierno). */
export function oppositionOf(state: GameState): Contender[] {
  const p = state.politics;
  const lists = candidacies(state).map((l) => l.leaderId);
  return p.mayor === 'player' ? lists : ['player', ...lists.filter((id) => id !== p.mayor)];
}

/** Afinidad (sin azar) de un vecino de la facción `f` con un candidato de la oposición. */
function affinity(state: GameState, f: Faction, who: Contender): number {
  if (who === 'player') return LISTS.affinityPlayer + state.politics.campaign[f] * LISTS.affinityCampaign;
  const l = candidacies(state).find((x) => x.leaderId === who);
  return l && l.faction === f ? LISTS.affinitySame : LISTS.affinityOther;
}

/**
 * Recuento esperado: votos al gobierno, a la oposición y abstención. 2.2: el
 * voto de la oposición se reparte entre sus candidatos por afinidad de facción
 * (esperanza, sin azar).
 */
export function tally(state: GameState): Tally {
  const p = state.politics;
  let gov = 0;
  let opp = 0;
  let abstention = 0;
  const others = oppositionOf(state);
  const per = new Map<Contender, number>(others.map((w) => [w, 0]));
  // Reparto por facción: los pesos solo dependen de la facción.
  const share = new Map<Faction, number[]>();
  for (const f of FACTIONS) {
    const w = others.map((o) => affinity(state, f, o));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    share.set(f, w.map((x) => x / sum));
  }
  const giveOpp = (c: Citizen, v: number) => {
    opp += v;
    const sh = share.get(factionOf(state, c))!;
    others.forEach((o, i) => per.set(o, per.get(o)! + v * sh[i]!));
  };
  for (const c of state.citizens) {
    if (c.named && c.vote) {
      if (c.vote === 'gobierno') gov++;
      else if (c.vote === 'oposicion') giveOpp(c, 1);
      else abstention++;
      continue;
    }
    const sup = govSupport(state, c);
    const abs = VOTE_ABSTENTION_BASE + 0.15 * (1 - Math.abs(sup - 0.5) * 2);
    gov += (1 - abs) * sup;
    giveOpp(c, (1 - abs) * (1 - sup));
    abstention += abs;
  }
  const votes: Tally['votes'] = [{ who: p.mayor, votes: Math.round(gov) }, ...others.map((o) => ({ who: o, votes: Math.round(per.get(o)!) }))];
  return { gov: Math.round(gov), opp: Math.round(opp), abstention: Math.round(abstention), votes };
}

/** Intención de voto al jugador (0–100). */
export function playerApproval(state: GameState): number {
  const t = tally(state);
  const total = t.gov + t.opp;
  if (total === 0) return 50;
  const gov = (t.gov / total) * 100;
  if (state.politics.mayor === 'player') return Math.round(gov);
  // En la oposición, su parte del voto (con otras listas, el voto contra el gobierno se reparte).
  const mine = t.votes.find((v) => v.who === 'player')?.votes ?? 0;
  return Math.round((mine / total) * 100);
}

/** Probabilidad de votar al gobierno (para la decisión por reglas de los vecinos con nombre). */
export function voteLean(state: GameState, c: Citizen): number {
  return govSupport(state, c);
}

/* ---------------- candidaturas (2.2) ---------------- */

/** Copia sin referencias compartidas (el hash ha de ser igual en el cliente y en el servidor). */
function cloneParty(x: Party): Party {
  return JSON.parse(JSON.stringify(x)) as Party;
}

/**
 * Candidaturas tal como están ahora: `lists` con la entrada del partido
 * principal sustituida por `party` (la fuente de verdad).
 */
export function candidacies(state: GameState): Party[] {
  const p = state.politics;
  const lists = p.lists ?? [];
  if (!p.party) return lists;
  const out = lists.map((l) => (l.leaderId === p.party!.leaderId ? p.party! : l));
  return out.some((l) => l === p.party) ? out : [p.party, ...out];
}

/** Copia `party` en su entrada de `lists` (y la añade si faltaba). */
export function syncLists(state: GameState): void {
  const p = state.politics;
  p.lists ??= [];
  if (!p.party) return;
  const i = p.lists.findIndex((l) => l.leaderId === p.party!.leaderId);
  if (i >= 0) p.lists[i] = cloneParty(p.party);
  else p.lists.unshift(cloneParty(p.party));
}

/** Estilo de un líder por sus rasgos (los ecologistas, verdes). */
export function styleOf(c: Citizen, faction: Faction): RivalStyle {
  if (faction === 'ecologistas') return 'verde';
  const t = c.traits;
  // El rasgo más fuerte manda (terco, ahorrador o sociable; la ambición la tienen todos los que se presentan); a igualdad, por este orden.
  const best = (
    [
      ['conservador', t.terco],
      ['tecnico', t.ahorro],
      ['populista', t.social],
    ] as const
  ).reduce((a, x) => (x[1] > a[1] ? x : a));
  return best[0];
}

const PROMISE_NEED = { impuestos: 'no subir impuestos', empleo: 'crear empleo', deuda: 'sanear la deuda' } as const;

/**
 * Hasta `RIVAL_PROMISES.max` promesas de un menú cerrado: lo que más pide su
 * facción y, según su estilo, «no subir impuestos», «crear empleo» o «sanear la deuda».
 */
export function promisesFor(state: GameState, faction: Faction, style: RivalStyle, deadline: number): RivalPromise[] {
  const demands = state.politics.factions[faction].unmet;
  const last = state.stats.at(-1);
  const debt = state.treasury < RIVAL_PROMISES.cleanTreasury || (!!last && ownIncome(last) < last.expenses);
  const extra: (keyof typeof PROMISE_NEED)[] =
    style === 'populista' ? ['impuestos', 'empleo'] : style === 'tecnico' ? ['deuda', 'empleo'] : style === 'conservador' ? ['impuestos', 'deuda'] : ['impuestos'];
  const out: RivalPromise[] = [];
  const add = (check: RivalPromise['check'], need: string) => {
    if (out.length < RIVAL_PROMISES.max && !out.some((x) => x.need === need)) out.push({ check, faction, need, deadline, status: 'pending', fromMotion: false });
  };
  if (demands[0]) add('exigencia', demands[0]);
  for (const k of extra) if (k !== 'deuda' || debt) add(k, PROMISE_NEED[k]);
  // Los verdes (y quien tenga sitio) prometen también la segunda exigencia.
  if (demands[1]) add('exigencia', demands[1]);
  return out;
}

function newParty(state: GameState, leader: Citizen): Party {
  const faction = factionOf(state, leader);
  const style = styleOf(leader, faction);
  const deadline = state.politics.nextElection + RIVAL_PROMISE_MONTHS * TICKS_PER_MONTH;
  return { leaderId: leader.id, leaderName: leader.name, name: PARTY_NAMES[faction], faction, founded: state.tick, promises: promisesFor(state, faction, style, deadline), style };
}

/** Añade una candidatura (si no hay partido principal, pasa a serlo). */
function addList(state: GameState, party: Party): void {
  const p = state.politics;
  p.lists ??= [];
  if (!p.party) p.party = party;
  p.lists.push(cloneParty(party));
  syncLists(state);
}

/** ¿Puede este vecino presentar su propia candidatura? (2.2) */
export function canPresent(state: GameState, c: Citizen): { ok: true } | { ok: false; error: string } {
  const p = state.politics;
  if (!politicsActive(state) || state.citizens.length < OPPOSITION_POP) return { ok: false, error: 'Aún no hay política en el pueblo' };
  if (!c.named || c.age < LISTS.minAge) return { ok: false, error: `Hace falta tener ${LISTS.minAge} años` };
  if (c.traits.ambicion < LISTS.minAmbition) return { ok: false, error: 'No tiene ambición para presentarse' };
  const left = p.nextElection - state.tick;
  if (left <= 0 || left > LISTS.months * TICKS_PER_MONTH) return { ok: false, error: `Solo en los ${LISTS.months} meses antes de las elecciones` };
  const lists = candidacies(state);
  if (lists.length >= LISTS.max) return { ok: false, error: `Ya hay ${LISTS.max} candidaturas` };
  if (p.mayor === c.id || lists.some((l) => l.leaderId === c.id)) return { ok: false, error: 'Ya encabeza una candidatura' };
  const f = factionOf(state, c);
  if (lists.some((l) => l.faction === f)) return { ok: false, error: 'Su facción ya tiene candidatura' };
  if (p.factions[f].satisfaction >= LISTS.maxSatisfaction) return { ok: false, error: 'Su facción no está tan descontenta' };
  if (c.money < LISTS.cost) return { ok: false, error: `Presentarse cuesta ${LISTS.cost} €` };
  return { ok: true };
}

/** El vecino se presenta: paga de su bolsillo y su candidatura entra en las listas. */
export function presentCandidacy(state: GameState, c: Citizen): string {
  if (!canPresent(state, c).ok) return 'al final no se presenta';
  transfer(state, c.id, OUTSIDE, LISTS.cost, 'candidatura');
  const party = newParty(state, c);
  addList(state, party);
  addMemory(state, c, 'fundo_partido', 5, 3);
  addHook(state, 'rival_politico', [c.id]);
  const vs = state.politics.mayor === 'player' ? '' : ` contra el gobierno de ${state.politics.party?.leaderName ?? 'el rival'}`;
  pushEvent(state, 'politics', `${c.name} presenta su candidatura, «${party.name}»${vs}`, { ref: c.id });
  return `presenta su candidatura «${party.name}» a las elecciones`;
}

/** Modo normal (y vecinos sin IA): un vecino que puede se presenta, como mucho uno al mes (por hash, sin dados). */
function rulePresent(state: GameState): void {
  const month = Math.floor(state.tick / TICKS_PER_MONTH);
  // Ronda 18: los vecinos con IA se presentan en su turno; si la IA no respondió el último, por reglas.
  const answered = state.ai?.log.at(-1)?.source === 'ia';
  const ai = (c: Citizen) => answered && state.aiMode && c.named && !!state.ai && state.ai.share > 0;
  const can = state.citizens.filter((c) => !ai(c) && canPresent(state, c).ok);
  if (!can.length) return;
  const score = (c: Citizen) => c.traits.ambicion + c.traits.social + c.grudge * 2 - c.happiness;
  const best = can.sort((a, b) => score(b) - score(a) || a.id - b.id)[0]!;
  if (hash32(state.seed, best.id, month, 2_2) % 100 < LISTS.ruleChance) presentCandidacy(state, best);
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
  // Promete lo que más pide su facción y lo de su estilo (si gobierna, tendrá un año para cumplirlo).
  const party = newParty(state, leader);
  addList(state, party);
  addMemory(state, leader, 'fundo_partido', 5, 3);
  addHook(state, 'rival_politico', [leader.id]);
  pushEvent(state, 'politics', `${leader.name} funda «${party.name}» y se presentará a las elecciones`, { ref: leader.id });
}

/**
 * Candidaturas cuyo líder ya no está: se quitan. Si era el partido principal,
 * se disuelve (y si gobernaba, vuelves); la siguiente lista pasa a ser la principal.
 * Se llama al final de cada hora (`step`) para que nunca quede un líder que no está.
 */
export function politicsPrune(state: GameState): void {
  const p = state.politics;
  if (!p.party && !p.lists?.length) return;
  const alive = (id: number) => state.citizens.some((c) => c.id === id);
  if (p.party && !alive(p.party.leaderId)) {
    pushEvent(state, 'politics', `«${p.party.name}» se disuelve: ${p.party.leaderName} se ha ido del pueblo${p.mayor !== 'player' ? '. Vuelves a la alcaldía' : ''}`);
    p.party = null;
    p.mayor = 'player';
  }
  const lists = p.lists ?? [];
  for (const l of lists) {
    if (alive(l.leaderId)) continue;
    if (!state.events.some((e) => e.kind === 'politics' && e.tick === state.tick && e.text.startsWith(`«${l.name}»`))) pushEvent(state, 'politics', `«${l.name}» retira su candidatura: ${l.leaderName} se ha ido del pueblo`);
  }
  p.lists = lists.filter((l) => alive(l.leaderId));
  if (!p.party && p.lists.length) p.party = cloneParty(p.lists[0]!);
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
  syncLists(state);
  const lists = candidacies(state);
  const t = tally(state);
  const playerGoverns = p.mayor === 'player';
  const unopposed = lists.length === 0;
  const votesOf = (who: Contender) => t.votes.find((v) => v.who === who)?.votes ?? 0;
  // Gana quien más votos tiene; el empate lo gana quien gobierna (y, si no, el primero en la lista).
  let best: Contender = p.mayor;
  for (const v of t.votes) if (v.votes > votesOf(best)) best = v.who;
  const playerVotes = votesOf('player');
  const rivals = lists.map((l) => ({ l, votes: votesOf(l.leaderId) }));
  const top = best !== 'player' ? rivals.find((r) => r.l.leaderId === best)! : [...rivals].sort((a, b) => b.votes - a.votes)[0];
  const winner: 'player' | 'rival' = unopposed || best === 'player' ? 'player' : 'rival';
  p.history.push({
    tick: state.tick,
    player: unopposed ? t.gov + t.opp : playerVotes,
    rival: unopposed ? 0 : (top?.votes ?? 0),
    abstention: t.abstention,
    winner,
    rivalName: top?.l.name ?? null,
    unopposed,
    lists: rivals.map((r) => ({ leaderId: r.l.leaderId, name: r.l.name, leaderName: r.l.leaderName, faction: r.l.faction, votes: r.votes })),
    winnerName: winner === 'rival' ? top!.l.leaderName : null,
  });
  if (p.history.length > 10) p.history.splice(0, p.history.length - 10);
  const others = (n: number) => (n > 1 ? ` (${n} candidaturas)` : '');
  if (unopposed) {
    pushEvent(state, 'election', `Elecciones del año ${year}: sin candidatura rival, ${playerGoverns ? 'sigues de alcalde' : 'vuelves a la alcaldía'}`);
    p.mayor = 'player';
  } else if (winner === 'player') {
    for (const r of rivals) {
      const loser = state.citizens.find((c) => c.id === r.l.leaderId);
      if (loser) addMemory(state, loser, 'perdio_elecciones', 5, -4);
    }
    pushEvent(state, 'election', `Elecciones del año ${year}: ganas con ${playerVotes} votos frente a ${top!.votes} de «${top!.l.name}»${others(rivals.length)}${playerGoverns ? '' : '. Vuelves a la alcaldía'}`);
    p.mayor = 'player';
    p.party = null;
    p.lists = [];
  } else {
    const leader = top!.l;
    for (const r of rivals) {
      const c = state.citizens.find((x) => x.id === r.l.leaderId);
      if (c) addMemory(state, c, r.l === leader ? 'gano_elecciones' : 'perdio_elecciones', 5, r.l === leader ? 6 : -4);
    }
    const again = p.mayor === leader.leaderId;
    const you = playerGoverns ? 'tú pasas a la oposición' : 'tú sigues en la oposición';
    pushEvent(state, 'election', `Elecciones del año ${year}: gana «${leader.name}» con ${top!.votes} votos frente a tus ${playerVotes}${others(rivals.length)}. ${leader.leaderName} es ${again ? 'reelegido' : 'el nuevo alcalde'}; ${you}`);
    p.mayor = leader.leaderId;
    // Quien gana es el partido principal; las demás listas se disuelven tras las elecciones.
    const party = cloneParty(leader);
    // Al llegar al gobierno, lo medible se mide desde ahora.
    if (!again) for (const pr of party.promises) if (pr.check === 'impuestos' || pr.check === 'empleo') delete pr.base;
    p.party = party;
    p.lists = [];
    syncLists(state);
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

export const FACTION_BUILD: Record<Faction, string[]> = {
  jubilados: ['clinic', 'police', 'park'],
  jovenes: ['school', 'park', 'house'],
  empresarios: ['police', 'house', 'park'],
  ecologistas: ['park', 'park', 'clinic'],
};

function freeSpot(state: GameState): { x: number; y: number } | null {
  return freeSpots(state, 1)[0] ?? null;
}

/** 2.2: los `n` sitios libres junto a carretera más cerca del ayuntamiento (orden fijo). */
export function freeSpots(state: GameState, n: number): { x: number; y: number }[] {
  const th = state.buildings.find((b) => b.kind === 'townhall');
  const cx = th?.x ?? Math.floor(state.map.w / 2);
  const cy = th?.y ?? Math.floor(state.map.h / 2);
  const all: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < state.map.h; y++) {
    for (let x = 0; x < state.map.w; x++) {
      if (state.map.tiles[tileIndex(state, x, y)] === Tile.Road || buildingAt(state, x, y) || !hasAdjacentRoad(state, x, y)) continue;
      all.push({ x, y, d: Math.abs(x - cx) + Math.abs(y - cy) });
    }
  }
  // Orden estable: distancia y, a igualdad, el primero en recorrer el mapa (como antes).
  all.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  return all.slice(0, n).map(({ x, y }) => ({ x, y }));
}

/** El alcalde rival gobierna a fin de mes según las prioridades de su facción. */
const LOG_MAX = 20;

/** Lo que hace el gobierno rival: sale en el diario y queda en su registro (v1.3). */
export function rivalAct(state: GameState, text: string): void {
  pushEvent(state, 'politics', text);
  const log = state.politics.log;
  log.push({ tick: state.tick, text });
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}

export const LEVEL_TEXT = { low: 'bajo', medium: 'medio', high: 'alto' } as const;

/** Las reglas del gobierno rival (también el respaldo cuando la IA no responde). */
export function rivalGovern(state: GameState): void {
  const p = state.politics;
  if (p.mayor === 'player' || !p.party) return;
  const f = p.party.faction;
  rivalBudget(state, f);
  const taxesBefore = JSON.stringify(taxLevels(state));
  // Impuestos según la facción; con déficit y la caja baja, como cualquier gobierno, los sube.
  const last = state.stats.at(-1);
  const deficit = !!last && ownIncome(last) < last.expenses && state.treasury < 10_000;
  // Margen (ronda 09): tras subir por déficit, solo baja con superávit claro y caja holgada.
  // Sin margen, subía y bajaba cada mes y el registro se llenaba de cambios de impuestos.
  const calm = !last || (ownIncome(last) > last.expenses * 1.1 && state.treasury > 15_000);
  // 2.2: si prometió no subirlos, las reglas cumplen (el déficit se aguanta sin obras); el populista los quiere bajos.
  const noRaise = p.party.promises.some((x) => x.status === 'pending' && x.check === 'impuestos');
  const want = deficit && !noRaise ? 'high' : f === 'empresarios' || f === 'jubilados' || p.party.style === 'populista' ? 'low' : 'medium';
  if (deficit && noRaise) {
    /* lo prometido: no se tocan */
  } else if (deficit && state.taxesSplit) governmentCommand(state, { type: 'SetTaxes', ibi: 'high', tasas: 'high' });
  else if (!deficit && !calm) {
    /* entre el déficit y la calma: se deja como está */
  } else if (state.taxesSplit) {
    if (f === 'jubilados') governmentCommand(state, { type: 'SetTaxes', ibi: 'low', tasas: 'medium' });
    else if (f === 'empresarios') governmentCommand(state, { type: 'SetTaxes', ibi: 'medium', tasas: 'low' });
    else governmentCommand(state, { type: 'SetTaxes', ibi: 'medium', tasas: 'medium' });
  } else if (state.taxLevel !== want) governmentCommand(state, { type: 'SetTax', level: want });
  // Promesas fiscales: si no hay déficit, las cumple bajando ese impuesto.
  const owesTax = (need: string) => p.party!.promises.some((x) => x.status === 'pending' && x.need === need);
  if (calm && owesTax('bajar el IBI')) governmentCommand(state, state.taxesSplit ? { type: 'SetTaxes', ibi: 'low' } : { type: 'SetTax', level: 'low' });
  if (calm && owesTax('bajar los impuestos')) governmentCommand(state, state.taxesSplit ? { type: 'SetTaxes', tasas: 'low', ibi: 'low' } : { type: 'SetTax', level: 'low' });
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
    // Ronda 18: no repite la misma obra (hacía un colegio cada mes) hasta medio año después.
    if (recentlyBuilt(state, kind)) continue;
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

/** ¿El gobierno rival empezó esta obra (o hay una igual a medias) en los últimos 6 meses? */
export function recentlyBuilt(state: GameState, kind: string): boolean {
  if (state.buildings.some((b) => b.kind === kind && !b.built)) return true;
  const name = BUILD_NAMES[kind];
  if (!name) return false;
  const since = state.tick - 6 * TICKS_PER_MONTH;
  return state.politics.log.some((l) => l.tick > since && l.text.includes(name) && /empieza|construir/i.test(l.text));
}

/** Obra que resuelve una exigencia (para que el gobierno rival la priorice). */
/** Exigencias que se resuelven bajando un impuesto. */
const TAX_NEEDS = new Set(['bajar el IBI', 'bajar los impuestos']);

export const NEED_BUILD: Record<string, string> = {
  'un centro de salud': 'clinic',
  'un colegio': 'school',
  'otro colegio': 'school',
  'otro centro de salud': 'clinic',
  'un parque': 'park',
  'más seguridad': 'police',
  vivienda: 'house',
  'recogida de basura': 'cleanpoint',
};

/** Nivel de impuestos como número (0 bajo … 2 alto, sumado si van separados). */
export function taxSum(state: GameState): number {
  const n = { low: 0, medium: 1, high: 2 } as const;
  const t = taxLevels(state);
  return state.taxesSplit ? n[t.ibi] + n[t.tasas] : n[t.ibi];
}

const employed = (state: GameState) => state.citizens.filter((c) => c.jobId !== null).length;

/**
 * Promesas del rival (2.2: cada una con su comprobación medible). Solo cuentan
 * gobernando: `exigencia`, cumplida si ya no falta; `impuestos`, rota si los sube
 * y cumplida al vencer el plazo; `empleo`, cumplida con `RIVAL_PROMISES.jobs`
 * vecinos más con trabajo; `deuda`, cumplida con la caja saneada y superávit.
 * Lo que sigue pendiente al vencer el plazo, rota.
 */
export function checkRivalPromises(state: GameState): void {
  const p = state.politics;
  if (!p.party) return;
  if (p.mayor !== p.party.leaderId) return;
  const last = state.stats.at(-1);
  for (const pr of p.party.promises) {
    if (pr.status !== 'pending') continue;
    const check = pr.check ?? 'exigencia';
    let kept = false;
    let broken = false;
    if (check === 'exigencia') kept = !p.factions[pr.faction].unmet.includes(pr.need);
    else if (check === 'impuestos') {
      pr.base ??= taxSum(state);
      if (taxSum(state) > pr.base) broken = true;
      else kept = state.tick > pr.deadline;
    } else if (check === 'empleo') {
      pr.base ??= employed(state);
      kept = employed(state) >= pr.base + RIVAL_PROMISES.jobs;
    } else kept = state.treasury >= RIVAL_PROMISES.cleanTreasury && !!last && ownIncome(last) >= last.expenses;
    if (!kept && !broken && state.tick > pr.deadline) broken = true;
    if (kept && !broken) {
      pr.status = 'kept';
      rivalAct(state, `«${p.party.name}» cumple lo prometido a ${FACTION_TEXT[pr.faction].toLowerCase()}: ${pr.need}`);
    } else if (broken) {
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
    party.promises.push({ check: 'exigencia', faction: f, need, deadline: state.tick + MOTION_MONTHS * TICKS_PER_MONTH, status: 'pending', fromMotion: true });
    syncLists(state);
    pushEvent(state, 'politics', `El pleno aprueba tu moción: ${need} para ${FACTION_TEXT[f].toLowerCase()}. El gobierno tiene ${MOTION_MONTHS} meses para cumplirla`);
  } else {
    p.campaign[f] = Math.min(CAMPAIGN_MAX, p.campaign[f] + 2);
    pushEvent(state, 'politics', `El gobierno rechaza tu moción (${need}). ${FACTION_TEXT[f]} toman nota`);
  }
}

/* ---------------- ciclo ---------------- */

export function politicsDay(state: GameState): void {
  const p = state.politics;
  // Si el líder de una candidatura se va del pueblo, se retira (y si gobernaba, vuelves).
  politicsPrune(state);
  updateFeltTaxes(state);
  updateFactions(state);
  p.approval = playerApproval(state);
  if (state.tick % TICKS_PER_MONTH === 0) {
    foundParty(state);
    // 2.2: vecinos que se presentan (por reglas; los que piensan con IA, en su turno).
    rulePresent(state);
    // Primero se miran las promesas (con el pueblo tal como está), luego gobierna.
    checkRivalPromises(state);
    // 2.2: si el mes pasado gobernó la IA del rival (`applyRivalPicks`), las reglas no lo hacen.
    const month = Math.floor(state.tick / TICKS_PER_MONTH);
    // Las reglas cubren el mes que acaba (m-1); la IA, el que empieza: no se pisan.
    if (p.rivalAiMonth !== month - 1) rivalGovern(state);
  }
  warnings(state);
  if (state.tick >= p.nextElection) holdElection(state);
  syncLists(state);
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
