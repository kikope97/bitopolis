/**
 * 2.0: el director del pueblo. El motor propone sucesos posibles con datos
 * reales (quién, dónde y por qué) y la IA elige cuáles pasan esta semana, el
 * foco y la crónica. El motor decide si salen bien y cuánto cuestan.
 *
 * Para que sea justo: presupuesto de drama según el descontento real, aviso
 * previo de todo lo malo («Se está cociendo»), topes al mes y, si el alcalde
 * lo hace bien, al menos un suceso bueno por cada dos malos. Sin respuesta,
 * las reglas de siempre tiran los dados (ver `directorOwns`).
 */
import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { type Association, callProtest, CAUSE_ASK, CAUSE_TEXT, foundAssociation, freshCauses } from './associations.ts';
import { ASSOCIATIONS, CRIME, DIRECTOR, TRASH } from './balance.ts';

const CRIME_HOT_DAYS = CRIME.hotDays;
import { homeRobbery, robbery, stationsFor } from './crime.ts';
import { burnable, fireCovered, ignite, placeName, scare, scareCandidates } from './fire.ts';
import type { Brewing } from './director-core.ts';
import { canFound, freeShopLot } from './economy.ts';
import { FARM_NAME, farmOutlook, feastCandidates, HARVEST_NAME, hail, hailCandidates, harvestFeast } from './farm.ts';
import { offerErrand } from './errands.ts';
import { publishEdition } from './press.ts';
import { applyRivalPicks } from './rival-ai.ts';
import { hash32 } from './hash.ts';
import { debtBand, totalDebt } from './household.ts';
import { transfer } from './money.ts';
import { factionOf } from './politics.ts';
import { FACTION_TEXT, FACTIONS, type Faction } from './politics-core.ts';
import { addHook, addMemory, relation, setRelation } from './social.ts';
import { type Citizen, type GameState, pushEvent } from './state.ts';
import { setDirectorImpl, type TurnLog } from './turns.ts';
import { BUILD_NAMES } from './commands.ts';
import { trashServed, trashStateOf } from './trash-core.ts';
import { rumoredTenders, scandal, worksName } from './tenders.ts';
import { streetCandidates } from './streets.ts';
import { applyVolunteers, LANDMARK_NAMES, landmarksInProgress } from './landmarks.ts';
import { applyTouristNoise, applyTvReport, HERITAGE_NAMES, heritageOf, heritageVariant, ruralHomes, touristNoiseCandidate, tvReportCandidate } from './tourism.ts';
import { announceEre, bigFactory, ereCandidate, hireBatch, hireCandidates } from './region.ts';

const plural = (n: number) => (n === 1 ? 'un edificio' : `${n} edificios`);

export const DIRECTOR_KINDS = ['robo_tienda', 'robo_casa', 'asociacion', 'manifestacion', 'pelea', 'reconciliacion', 'gratitud', 'rumor', 'oposicion', 'local', 'encuentro', 'ayuda', 'incendio', 'susto', 'ratas', 'licitacion', 'homenaje', 'cosecha', 'granizo', 'voluntarios_obra', 'polemica_obra', 'reportaje_tv', 'turistas_ruido', 'ere_gran_empresa', 'contrata_vecinos'] as const;
export type DirectorKind = (typeof DIRECTOR_KINDS)[number];

export interface DirectorCandidate {
  /** «tipo:dato», p. ej. «robo_tienda:42» o «pelea:12_30». */
  id: string;
  kind: DirectorKind;
  bad: boolean;
  /** Qué pasaría, en una frase. */
  text: string;
  /** El dato del juego que lo justifica. */
  why: string;
  /** Ronda 16: los datos lo justifican tanto que cabe aunque el pueblo esté contento. */
  owed?: boolean;
}

/** Lo que elige la IA (ya validado por forma; el motor lo vuelve a validar al aplicarlo). */
export interface DirectorChoice {
  sucesos: { id: string; motivo: string }[];
  avisos: { id: string; motivo: string }[];
  /** 2.1: titulares de El Eco de Bitópolis (sobre = vecino o edificio del que habla). */
  titulares?: { seccion: 'sucesos' | 'cartas' | 'anuncios'; texto: string; sobre?: number; suceso?: string }[];
  /** 2.1: el encargo con historia (id de `errandCandidates`) y la carta con la que lo pide un vecino. */
  encargo?: { id: string; carta: string };
  /** 2.2: pies de foto del álbum (momento por tick y tipo). */
  pies?: { tick: number; kind: string; texto: string }[];
  /** 2.2: el gobierno del rival con IA (ids de `rivalMenu` y su discurso). */
  rival?: { picks: string[]; discurso: string };
}

const first = (c: Citizen) => c.name.split(' ')[0]!;
const crimeAt = (state: GameState, x: number, y: number) => state.fields.crime[y * state.map.w + x] ?? 0;
const byId = (state: GameState, id: number) => state.citizens.find((c) => c.id === id);
/** Felicidad media del pueblo (0 sin vecinos). */
const townHappiness = (state: GameState) => (state.citizens.length ? state.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.length : 0);
const pairId = (a: number, b: number) => `${Math.min(a, b)}_${Math.max(a, b)}`;

/* ---------------- el menú ---------------- */

/** Sucesos posibles ahora mismo, con datos reales. Determinista y corto (el prompt lo recibe entero). */
export function directorMenu(state: GameState): DirectorCandidate[] {
  const out: DirectorCandidate[] = [];
  const add = (list: DirectorCandidate[]) => out.push(...list.slice(0, DIRECTOR.perKind));
  const named = state.citizens.filter((c) => c.named);
  // Ronda 16: lo robado hace poco no vuelve al menú (antes siempre caían las mismas tiendas).
  const cool = DIRECTOR.robbedCooldownDays * TICKS_PER_DAY;
  const robbed = (b: { x: number; y: number }) => state.justice.hot.some((h) => h.x === b.x && h.y === b.y && h.until - state.tick > (CRIME_HOT_DAYS * TICKS_PER_DAY - cool));
  const unpoliced = (b: { x: number; y: number }) => stationsFor(state, b.x, b.y).length === 0;

  // Robos (solo donde la delincuencia lo justifica).
  add(
    state.buildings
      .filter((b) => b.kind === 'shop' && b.built && !b.damaged && b.cash > 0 && crimeAt(state, b.x, b.y) >= DIRECTOR.robCrime && !robbed(b))
      .sort((a, b) => crimeAt(state, b.x, b.y) - crimeAt(state, a.x, a.y) || a.id - b.id)
      .map((b) => ({
        id: `robo_tienda:${b.id}`,
        kind: 'robo_tienda',
        bad: true,
        text: `Roban en ${b.name ?? 'una tienda'}`,
        why: `delincuencia ${Math.round(crimeAt(state, b.x, b.y))} en su calle${unpoliced(b) ? ' y sin policía cerca' : ''}`,
        owed: unpoliced(b) && crimeAt(state, b.x, b.y) >= DIRECTOR.owedCrime,
      })),
  );
  add(
    state.buildings
      .filter((b) => (b.kind === 'house' || b.kind === 'res') && b.built && crimeAt(state, b.x, b.y) >= DIRECTOR.robCrime && !robbed(b) && state.citizens.some((c) => c.homeId === b.id && c.money > 0))
      .sort((a, b) => crimeAt(state, b.x, b.y) - crimeAt(state, a.x, a.y) || a.id - b.id)
      .map((b) => {
        const who = state.citizens.filter((c) => c.homeId === b.id).sort((x, y) => y.money - x.money)[0]!;
        return { id: `robo_casa:${b.id}`, kind: 'robo_casa', bad: true, text: `Entran a robar en casa de ${who.name}`, why: `delincuencia ${Math.round(crimeAt(state, b.x, b.y))} en su calle` };
      }),
  );

  // 2.1: incendios (solo en edificios en riesgo, que ya se avisó en el registro) y sustos que acaban bien.
  add(
    state.buildings
      .filter((b) => b.risk && burnable(b) && !b.fire && !b.damaged)
      .sort((a, b) => a.risk!.since - b.risk!.since || a.id - b.id)
      .map((b) => ({
        id: `incendio:${b.id}`,
        kind: 'incendio',
        bad: true,
        text: `Se declara un incendio en ${placeName(b)}`,
        why: `riesgo de incendio por ${b.risk!.why}${fireCovered(state, b) ? ' (los bomberos llegan)' : ' y sin bomberos cerca'}`,
      })),
  );
  add(
    scareCandidates(state).map((c) => ({
      id: `susto:${c.id}`,
      kind: 'susto',
      bad: false,
      text: `${c.name} se pone mal y la ambulancia llega a tiempo`,
      why: `tiene ${c.age} años y vive cerca del centro de salud con ambulancia`,
    })),
  );
  // 2.1: plaga de ratas donde la basura lleva días sin recogerse (con ratas ya, lo justifican los datos).
  const served = trashServed(state);
  add(
    state.buildings
      .filter((b) => b.built && (b.trash ?? 0) >= TRASH.dirtyAt && !served.has(b.id))
      .sort((a, b) => (b.trash ?? 0) - (a.trash ?? 0) || a.id - b.id)
      .map((b) => {
        const who = state.citizens.find((c) => c.homeId === b.id || c.jobId === b.id);
        const where = b.name ?? (who ? `casa de ${who.name}` : (BUILD_NAMES[b.kind] ?? 'una calle').toLowerCase());
        return {
          id: `ratas:${b.id}`,
          kind: 'ratas' as const,
          bad: true,
          text: `Una plaga de ratas sale de la basura junto a ${where} y se extiende por la calle`,
          why: `${trashStateOf(b) === 'ratas' ? 'ya hay ratas' : 'bolsas amontonadas'} y no pasa el camión de la basura`,
          owed: trashStateOf(b) === 'ratas',
        };
      }),
  );

  // 2.2: el campo. La fiesta de la cosecha (o de la vendimia) en el mes de cosecha; el granizo, solo tras una tormenta.
  add(
    feastCandidates(state).map((b) => ({
      id: `cosecha:${b.id}`,
      kind: 'cosecha' as const,
      bad: false,
      text: `${b.crop === 'vinedo' ? 'Fiesta de la vendimia' : 'Fiesta de la cosecha'} en ${FARM_NAME[b.crop!]}`,
      why: `es el mes de ${HARVEST_NAME[b.crop!]} y la cosecha viene ${farmOutlook(b)}`,
    })),
  );
  add(
    hailCandidates(state).map((b) => ({
      id: `granizo:${b.id}`,
      kind: 'granizo' as const,
      bad: true,
      text: `Una granizada arrasa parte de ${FARM_NAME[b.crop!]}`,
      why: `ha habido tormenta hace poco y la cosecha sigue en el campo (prevista ${farmOutlook(b)})`,
    })),
  );

  // Asociaciones y manifestaciones.
  add(
    freshCauses(state).map(([cause, cs]) => ({ id: `asociacion:${cause}`, kind: 'asociacion', bad: true, text: `Los vecinos que piden ${CAUSE_ASK[cause]} fundan una asociación`, why: `${cs.length} vecinos con la misma queja: ${CAUSE_TEXT[cause]}` })),
  );
  add(
    (state.associations ?? [])
      .filter((a) => a.protestDay < 0 && a.promiseUntil < 0 && state.tick - Math.max(a.founded, a.lastProtest, a.lastMeeting) >= TICKS_PER_MONTH)
      .map((a) => {
        const months = Math.floor((state.tick - Math.max(a.founded, a.lastProtest, a.lastMeeting)) / TICKS_PER_MONTH);
        return {
          id: `manifestacion:${a.id}`,
          kind: 'manifestacion',
          bad: true,
          text: `La ${a.name} convoca una manifestación`,
          why: `${a.members.length} socios; piden ${CAUSE_ASK[a.cause]} y nadie les ha recibido en ${months === 1 ? 'un mes' : `${months} meses`}`,
          owed: months > ASSOCIATIONS.patienceMonths,
        };
      }),
  );

  // Relaciones: peleas por la política, reconciliaciones, encuentros.
  const pelea: DirectorCandidate[] = [];
  const paz: DirectorCandidate[] = [];
  for (const a of named) {
    for (const r of a.relations) {
      if (r.id <= a.id) continue;
      const b = byId(state, r.id);
      if (!b) continue;
      if ((r.kind === 'amistad' || r.kind === 'pareja') && (a.attitude ?? 0) * (b.attitude ?? 0) < 0 && Math.abs((a.attitude ?? 0) - (b.attitude ?? 0)) >= 2) {
        pelea.push({ id: `pelea:${pairId(a.id, b.id)}`, kind: 'pelea', bad: true, text: `${first(a)} y ${first(b)} discuten por el alcalde`, why: `uno le apoya y el otro no` });
      }
      if (r.kind === 'rivalidad' || r.kind === 'rencor') paz.push({ id: `reconciliacion:${pairId(a.id, b.id)}`, kind: 'reconciliacion', bad: false, text: `${first(a)} y ${first(b)} hacen las paces`, why: `se llevan mal (${r.kind})` });
    }
  }
  add(pelea);
  add(paz);
  const meet: DirectorCandidate[] = [];
  for (const a of named) {
    if (a.relations.length >= 4 || a.jobId === null) continue;
    const b = named.find((x) => x.id > a.id && x.jobId === a.jobId && !relation(a, x.id) && x.relations.length < 4);
    if (b) meet.push({ id: `encuentro:${pairId(a.id, b.id)}`, kind: 'encuentro', bad: false, text: `${first(a)} y ${first(b)} se hacen amigos`, why: 'trabajan en el mismo sitio y no se conocían' });
  }
  add(meet);

  // Ayuda entre amigos: quien va holgado echa una mano a quien no llega.
  const help: DirectorCandidate[] = [];
  for (const b of named) {
    if (b.money >= 50 && totalDebt(b) === 0) continue;
    const r = b.relations.find((x) => (x.kind === 'amistad' || x.kind === 'pareja') && (byId(state, x.id)?.money ?? 0) >= DIRECTOR.helpAmount * 4);
    const a = r ? byId(state, r.id) : undefined;
    if (a) help.push({ id: `ayuda:${a.id}_${b.id}`, kind: 'ayuda', bad: false, text: `${first(a)} le echa una mano a ${first(b)}, que no llega a fin de mes`, why: `${first(b)} va muy justo y tiene deudas (${debtBand(b)})` });
  }
  add(help);

  // Gratitud: quienes están contentos con el alcalde lo dicen en público.
  add(
    named
      .filter((c) => (c.attitude ?? 0) >= 1 && c.happiness >= 65)
      .sort((a, b) => b.happiness - a.happiness || a.id - b.id)
      .map((c) => ({ id: `gratitud:${c.id}`, kind: 'gratitud', bad: false, text: `${c.name} da las gracias al alcalde en público`, why: `felicidad ${Math.round(c.happiness)} y le apoya` })),
  );

  // Rumores (con plantilla, sobre lo que ha hecho el alcalde de verdad).
  const recent = state.ai?.mayor.at(-1);
  if (recent) {
    out.push(
      recent.big
        ? { id: 'rumor:malo', kind: 'rumor', bad: true, text: `Corre el rumor de que, después de que el alcalde ${recent.text}, vendrán más medidas así`, why: 'lo último que ha hecho el alcalde' }
        : { id: 'rumor:bueno', kind: 'rumor', bad: false, text: `En el bar se comenta que el alcalde ${recent.text} y que eso traerá cosas buenas`, why: 'lo último que ha hecho el alcalde' },
    );
  }

  // La oposición (si existe y gobierna el jugador) da un mitin a la facción más descontenta.
  const p = state.politics;
  if (p.party && p.mayor === 'player') {
    const f = [...FACTIONS].sort((a, b) => p.factions[a].satisfaction - p.factions[b].satisfaction)[0]!;
    out.push({ id: `oposicion:${f}`, kind: 'oposicion', bad: true, text: `«${p.party.name}» da un mitin entre ${FACTION_TEXT[f].toLowerCase()}`, why: `es la facción más descontenta (${Math.round(p.factions[f].satisfaction)})` });
  }

  // 2.2: el escándalo de la obra del primo (solo con el rumor ya corriendo en el bar).
  add(
    rumoredTenders(state).map((t) => {
      const councillor = byId(state, t.councillorId ?? -1);
      return {
        id: `licitacion:${t.buildingId}`,
        kind: 'licitacion' as const,
        bad: true,
        text: `Estalla el escándalo de la obra de ${worksName(t.kind)}`,
        why: `la obra fue para el negocio de un amigo del concejal${councillor ? ` ${first(councillor)}` : ''} y ya se comenta en el bar`,
        owed: state.tick >= (t.revealAt ?? 0),
      };
    }),
  );
  // 2.2: homenaje: con el pleno abierto y la calle sin dedicar, el pueblo pide un nombre.
  const st = state.pleno?.street;
  if (st && !st.done) {
    add(
      streetCandidates(state)
        .filter((c) => st.candidates.includes(c.id) && st.candidates[0] !== c.id)
        .map((c) => ({ id: `homenaje:${c.id}`, kind: 'homenaje' as const, bad: false, text: `El pueblo pide una calle para ${c.name}`, why: c.why.toLowerCase() })),
    );
  }

  // 2.3: metas grandes (obras, turismo y la gran empresa).
  out.push(...bigGoalCandidates(state).slice(0, DIRECTOR.perKind * 3));

  // Una historia: dos vecinos quieren el único local libre.
  const founders = named.filter((c) => canFound(state, c));
  if (founders.length >= 2 && freeShopLot(state) !== null && state.hooks.length < 3) {
    const [a, b] = founders;
    if (relation(a!, b!.id)?.kind !== 'pareja') out.push({ id: `local:${pairId(a!.id, b!.id)}`, kind: 'local', bad: false, text: `${first(a!)} y ${first(b!)} quieren el mismo local para abrir un negocio`, why: 'solo queda un local libre' });
  }
  return out;
}

/** Impuestos altos (alguno) o la caja justa: lo que hace discutir lo que cuesta una obra. */
function moneyTight(state: GameState): string | null {
  const high = state.taxesSplit ? (['ibi', 'tasas', 'plusvalia'] as const).some((k) => state.taxes[k] === 'high') : state.taxLevel === 'high';
  if (high) return 'los impuestos están altos';
  if (state.treasury < DIRECTOR.tightTreasury) return 'la caja del ayuntamiento va justa';
  return null;
}

/** La facción (con vecinos con nombre) que más pagó el mes pasado, y cuánto. */
function payingFaction(state: GameState): { f: Faction; members: Citizen[] } | null {
  const by = new Map<Faction, { paid: number; members: Citizen[] }>();
  for (const c of state.citizens) {
    if (!c.named) continue;
    const f = factionOf(state, c);
    const e = by.get(f) ?? { paid: 0, members: [] };
    e.paid += c.last?.out ?? 0;
    e.members.push(c);
    by.set(f, e);
  }
  const best = [...by.entries()].filter(([, e]) => e.members.length >= 2).sort((a, b) => b[1].paid - a[1].paid || FACTIONS.indexOf(a[0]) - FACTIONS.indexOf(b[0]))[0];
  return best ? { f: best[0], members: best[1].members } : null;
}

/** 2.3: sucesos de las grandes obras, el turismo y la gran empresa (con datos reales). */
function bigGoalCandidates(state: GameState): DirectorCandidate[] {
  const out: DirectorCandidate[] = [];
  const unemployed = state.citizens.filter((c) => c.jobId === null && c.unemployedSince !== undefined).length;
  for (const lm of landmarksInProgress(state)) {
    const name = LANDMARK_NAMES[lm.kind].toLowerCase();
    const inWorks = lm.phaseUntil !== -1 && !lm.paused;
    // Voluntarios: una vez por fase (la fase en obra va más rápida o la siguiente sale más barata).
    if (lm.helped !== lm.phase && (inWorks || lm.phase > 0) && !lm.discount) {
      out.push({ id: `voluntarios_obra:${lm.id}`, kind: 'voluntarios_obra', bad: false, text: `Vecinos voluntarios echan una mano en ${name}`, why: `${inWorks ? `la fase ${lm.phase + 1} de ${lm.phases} está en obra` : `van ${lm.phase} de ${lm.phases} fases`}${unemployed ? ` y hay ${unemployed} vecinos en paro` : ''}` });
    }
    // Polémica: solo con algo ya gastado y el dinero justo (o impuestos altos); una vez por fase.
    const tight = moneyTight(state);
    const payer = tight && lm.spent > 0 && lm.polemic !== lm.phase ? payingFaction(state) : null;
    if (payer) {
      out.push({ id: `polemica_obra:${lm.id}`, kind: 'polemica_obra', bad: true, text: `Polémica en el pueblo por lo que cuesta ${name}`, why: `lleva ${lm.spent} € del ayuntamiento, ${tight} y quienes más pagan son los ${FACTION_TEXT[payer.f].toLowerCase()}` });
    }
  }
  const her = heritageOf(state);
  if (her && tvReportCandidate(state)) {
    out.push({ id: `reportaje_tv:${her.id}`, kind: 'reportaje_tv', bad: false, text: `La tele hace un reportaje sobre ${HERITAGE_NAMES[heritageVariant(state, her.x, her.y)]}`, why: `el pueblo tiene patrimonio${state.tourism.visitors ? ` y ya vienen visitantes (${state.tourism.visitors} el mes pasado)` : ''}` });
  }
  if (touristNoiseCandidate(state)) {
    const n = ruralHomes(state).length;
    out.push({ id: 'turistas_ruido:casas', kind: 'turistas_ruido', bad: true, text: 'Los vecinos de las casas rurales se quejan del ruido de los turistas', why: `${n === 1 ? 'una casa rural' : `${n} casas rurales`} y ${state.tourism.visitors} visitantes el mes pasado` });
  }
  const r = state.region;
  const ere = ereCandidate(state);
  const crisis = r?.phase === 'crisis' || (r?.warned && r.next === 'crisis');
  const fab = bigFactory(state);
  if (ere && crisis && fab) {
    out.push({ id: `ere_gran_empresa:${fab.id}`, kind: 'ere_gran_empresa', bad: true, text: `${ere.company} anuncia un ERE (la mitad de la plantilla, en unos meses)`, why: r?.phase === 'crisis' ? 'crisis en la comarca: las fábricas venden menos' : 'se acerca una crisis en la comarca', owed: r?.phase === 'crisis' });
  }
  const hire = hireCandidates(state);
  if (fab && hire.free > 0 && hire.citizenIds.length) {
    out.push({ id: `contrata_vecinos:${fab.id}`, kind: 'contrata_vecinos', bad: false, text: `${state.bigCompany!.name} contrata a vecinos del pueblo`, why: `tiene ${hire.free} puestos libres y hay ${hire.citizenIds.length} vecinos sin trabajo en el pueblo` });
  }
  return out;
}

/* ---------------- presupuesto de drama ---------------- */

const monthOf = (tick: number) => Math.floor(tick / TICKS_PER_MONTH);

/** Sucesos malos que caben este turno, y por qué. */
export function dramaBudget(state: GameState, menu?: DirectorCandidate[]): { bad: number; why: string } {
  const happy = townHappiness(state);
  const discontent = 100 - happy;
  const d = state.ai?.drama && state.ai.drama.month === monthOf(state.tick) ? state.ai.drama : { bad: 0, good: 0 };
  // Ronda 16: cupo del mes gradual con el descontento (sin escalón), igual a cualquier velocidad.
  const span = DIRECTOR.badFullDiscontent - DIRECTOR.badFromDiscontent;
  const monthCap = Math.max(0, Math.min(DIRECTOR.maxBadPerMonth, Math.round((DIRECTOR.maxBadPerMonth * (discontent - DIRECTOR.badFromDiscontent)) / span)));
  let bad = Math.max(0, Math.min(2, monthCap - d.bad));
  let why = bad ? `descontento ${Math.round(discontent)}: caben ${bad} malos (${d.bad} de ${monthCap} este mes)` : monthCap ? `ya van ${d.bad} sucesos malos este mes` : `el pueblo está contento (felicidad ${Math.round(happy)})`;
  if (bad && happy >= DIRECTOR.fairHappiness && d.bad >= 2 * (d.good + 1)) {
    bad = 0;
    why = 'el alcalde lo hace bien: antes toca algo bueno';
  }
  // Lo que justifican los datos pasa aunque el pueblo esté contento (uno al mes): la seguridad no sale gratis.
  if (!bad && d.bad === 0) {
    const m = menu ?? directorMenu(state);
    const owed = m.find((c) => c.owed);
    if (owed) {
      bad = 1;
      why = `aunque el pueblo esté contento, ${owed.why}`;
    }
  }
  return { bad, why };
}

/* ---------------- aplicar ---------------- */

/** Avisos vigentes (sin los que caducan o ya no son posibles). No toca el estado. */
function liveBrewing(state: GameState, menu: DirectorCandidate[]): Brewing[] {
  const ai = state.ai;
  if (!ai) return [];
  const ttl = DIRECTOR.brewingDays * TICKS_PER_DAY;
  return (ai.brewing ?? []).filter((b) => state.tick - b.since <= ttl && menu.some((m) => m.id === b.id));
}

/** Aplica lo que eligió el director. Devuelve las líneas para «Qué está pasando». */
export function applyDirector(state: GameState, choice: DirectorChoice): TurnLog['lines'] {
  const ai = state.ai!;
  const menu = directorMenu(state);
  const brewing = (ai.brewing = liveBrewing(state, menu));
  const opened = ai.turn?.opened ?? state.tick;
  const month = monthOf(state.tick);
  if (!ai.drama || ai.drama.month !== month) ai.drama = { month, bad: 0, good: 0 };
  const budget = dramaBudget(state, menu);
  let bad = budget.bad;
  let good = DIRECTOR.maxGood;
  let total = DIRECTOR.maxEvents;
  const lines: TurnLog['lines'] = [];
  const used = new Set<string>();
  for (const s of choice.sucesos) {
    const c = menu.find((m) => m.id === s.id);
    if (!c || used.has(c.id) || total <= 0) continue;
    if (c.bad) {
      // Lo malo, solo si se avisó en un turno anterior y cabe en el presupuesto.
      const warned = brewing.find((b) => b.id === c.id && b.since < opened);
      if (!warned || bad <= 0) continue;
      bad--;
    } else if (good-- <= 0) continue;
    const line = perform(state, c);
    if (!line) continue;
    used.add(c.id);
    total--;
    if (c.bad) ai.drama.bad++;
    else ai.drama.good++;
    ai.brewing = (ai.brewing ?? []).filter((b) => b.id !== c.id);
    lines.push({ ...line, motivo: clean(s.motivo) });
  }
  // Avisos nuevos (lo que podría pasar: el jugador aún puede reaccionar).
  for (const a of choice.avisos) {
    const c = menu.find((m) => m.id === a.id);
    if (!c || used.has(c.id) || (ai.brewing ?? []).some((b) => b.id === c.id) || (ai.brewing ?? []).length >= DIRECTOR.maxBrewing) continue;
    ai.brewing = [...(ai.brewing ?? []), { id: c.id, text: brewingText(c), since: state.tick, bad: c.bad }];
  }
  // 2.1: El Eco de esta semana (lo escribe el director) y el encargo con su carta.
  // Ronda 17: el titular de un suceso que al final no pasó no sale.
  const heads = (choice.titulares ?? []).filter((t) => !t.suceso || used.has(t.suceso));
  if (heads.length) publishEdition(state, heads.map((t) => ({ section: t.seccion, text: t.texto, ...(t.sobre !== undefined ? { ref: t.sobre } : {}) })), 'ia');
  if (choice.rival) applyRivalPicks(state, choice.rival.picks, choice.rival.discurso || undefined);
  for (const p of choice.pies ?? []) {
    const m = (state.album ?? []).find((x) => x.tick === p.tick && x.kind === p.kind && !x.caption);
    if (m) m.caption = p.texto;
  }
  if (choice.encargo?.id) {
    const e = offerErrand(state, choice.encargo.id, choice.encargo.carta || undefined);
    if (e) lines.push({ id: e.by, text: `Encargo: ${e.text}`, ...(choice.encargo.carta ? { motivo: choice.encargo.carta } : {}) });
  }
  return lines;
}

/** Cómo se cuenta un aviso: lo que se huele en el pueblo, sin dar el desenlace. */
function brewingText(c: DirectorCandidate): string {
  switch (c.kind) {
    case 'robo_tienda':
    case 'robo_casa':
      return `Se ven caras raras por la calle (${c.why}): ${c.text.toLowerCase()} podría pasar`;
    case 'asociacion':
      return `Hay vecinos organizándose: ${c.why}`;
    case 'manifestacion':
      return `${c.text.replace('convoca', 'prepara')}: ${c.why}`;
    case 'ratas':
      return `Se ven ratas cerca de la basura sin recoger (${c.why})`;
    case 'pelea':
      return `Hay tensión: ${c.text.replace('discuten', 'no se ponen de acuerdo')}`;
    case 'oposicion':
      return `${c.text.replace('da', 'prepara')} (${c.why})`;
    case 'rumor':
      return 'Se oyen comentarios en el bar sobre el ayuntamiento';
    case 'incendio':
      return `Huele a humo: ${c.why}`;
    case 'licitacion':
      return `Hay quien hace preguntas en el bar: ${c.why}`;
    case 'granizo':
      return `El cielo amenaza piedra sobre el campo: ${c.why}`;
    case 'polemica_obra':
      return `Se murmura en el bar sobre lo que cuesta la obra: ${c.why}`;
    case 'turistas_ruido':
      return `Hay vecinos hartos del jaleo de los turistas (${c.why})`;
    case 'ere_gran_empresa':
      return `En la fábrica grande se habla de recortes: ${c.why}`;
    default:
      return c.text;
  }
}

const clean = (t: string | undefined) => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

/** Hace que pase un suceso. Devuelve su línea, o null si ya no se puede. */
function perform(state: GameState, c: DirectorCandidate): { id: number; text: string } | null {
  const [, arg = ''] = c.id.split(':');
  const pair = () => arg.split('_').map((x) => byId(state, Number(x)));
  switch (c.kind) {
    case 'robo_tienda': {
      const b = state.buildings.find((x) => x.id === Number(arg));
      if (!b) return null;
      robbery(state, b);
      return { id: b.owner ?? 0, text: `Robo en ${b.name ?? 'una tienda'}` };
    }
    case 'robo_casa': {
      const b = state.buildings.find((x) => x.id === Number(arg));
      if (!b) return null;
      homeRobbery(state, b, undefined);
      return { id: state.citizens.find((x) => x.homeId === b.id)?.id ?? 0, text: c.text };
    }
    case 'asociacion': {
      const fresh = freshCauses(state).find(([cause]) => cause === arg);
      if (!fresh) return null;
      const a = foundAssociation(state, fresh[0], fresh[1]);
      return { id: a.leaderId, text: `Nace la ${a.name}` };
    }
    case 'manifestacion': {
      const a = (state.associations ?? []).find((x: Association) => x.id === Number(arg));
      if (!a || a.protestDay >= 0) return null;
      callProtest(state, a, false);
      return { id: a.leaderId, text: c.text };
    }
    case 'pelea': {
      const [a, b] = pair();
      if (!a || !b) return null;
      setRelation(state, a, b, 'rivalidad', 30);
      addMemory(state, a, 'discusion', 3, -2, [b.id]);
      addMemory(state, b, 'discusion', 3, -2, [a.id]);
      pushEvent(state, 'info', `${first(a)} y ${first(b)} discuten a voces por cómo va el pueblo`, { ref: a.id });
      return { id: a.id, text: c.text };
    }
    case 'reconciliacion': {
      const [a, b] = pair();
      if (!a || !b) return null;
      setRelation(state, a, b, 'amistad', 25);
      addMemory(state, a, 'se_reconcilio', 3, 3, [b.id]);
      addMemory(state, b, 'se_reconcilio', 3, 3, [a.id]);
      pushEvent(state, 'info', `${first(a)} y ${first(b)} hacen las paces`, { ref: a.id });
      return { id: a.id, text: c.text };
    }
    case 'encuentro': {
      const [a, b] = pair();
      if (!a || !b || relation(a, b.id) || a.relations.length >= 5 || b.relations.length >= 5) return null;
      setRelation(state, a, b, 'amistad', 30);
      addMemory(state, a, 'se_conocieron', 2, 2, [b.id]);
      addMemory(state, b, 'se_conocieron', 2, 2, [a.id]);
      pushEvent(state, 'info', `${first(a)} y ${first(b)} se han hecho amigos en el trabajo`, { ref: a.id });
      return { id: a.id, text: c.text };
    }
    case 'ayuda': {
      const [a, b] = pair();
      if (!a || !b || a.money < DIRECTOR.helpAmount) return null;
      const given = transfer(state, a.id, b.id, DIRECTOR.helpAmount, 'ayuda');
      addMemory(state, b, 'le_ayudaron', 4, 4, [a.id]);
      pushEvent(state, 'info', `${first(a)} le presta ${given} € a ${first(b)} para llegar a fin de mes`, { ref: b.id });
      return { id: b.id, text: c.text };
    }
    case 'gratitud': {
      const x = byId(state, Number(arg));
      if (!x) return null;
      addMemory(state, x, 'agradecio', 3, 2);
      // Se contagia a quien le quiere bien.
      for (const r of x.relations) {
        const y = byId(state, r.id);
        if (y && (r.kind === 'amistad' || r.kind === 'pareja')) y.grudge = Math.max(0, y.grudge - 1);
      }
      pushEvent(state, 'info', `${x.name} da las gracias al alcalde delante de todos en la plaza`, { ref: x.id });
      return { id: x.id, text: c.text };
    }
    case 'rumor': {
      const badRumor = arg === 'malo';
      // Llega a unos pocos vecinos (siempre los mismos para este turno: determinista).
      const reach = [...state.citizens].sort((a, b) => hash32(state.seed, a.id, state.tick) - hash32(state.seed, b.id, state.tick)).slice(0, DIRECTOR.rumorReach);
      for (const y of reach) {
        if (badRumor) y.grudge = Math.min(20, y.grudge + 1);
        else y.grudge = Math.max(0, y.grudge - 1);
        if (y.named) addMemory(state, y, 'rumor', 2, badRumor ? -1 : 1);
      }
      pushEvent(state, 'info', c.text, {});
      return { id: reach[0]?.id ?? 0, text: c.text };
    }
    case 'oposicion': {
      const f = arg as Faction;
      const p = state.politics;
      if (!p.party || !(FACTIONS as readonly string[]).includes(f)) return null;
      const fans = state.citizens.filter((y) => y.named && factionOf(state, y) === f).slice(0, DIRECTOR.rumorReach);
      for (const y of fans) {
        addMemory(state, y, 'mitin', 3, -2);
        y.grudge = Math.min(20, y.grudge + 1);
      }
      pushEvent(state, 'politics', `«${p.party.name}» da un mitin entre ${FACTION_TEXT[f].toLowerCase()}: ${fans.length ? `acuden ${fans.length} vecinos conocidos` : 'va poca gente'}`);
      return { id: fans[0]?.id ?? 0, text: c.text };
    }
    case 'incendio': {
      const b = state.buildings.find((x) => x.id === Number(arg));
      if (!b || !ignite(state, b)) return null;
      return { id: state.citizens.find((x) => x.homeId === b.id || x.jobId === b.id)?.id ?? 0, text: c.text };
    }
    case 'susto': {
      const x = byId(state, Number(arg));
      if (!x || !scare(state, x)) return null;
      return { id: x.id, text: c.text };
    }
    case 'ratas': {
      const b = state.buildings.find((x) => x.id === Number(arg));
      if (!b || (b.trash ?? 0) < TRASH.dirtyAt || trashServed(state).has(b.id)) return null;
      // La plaga: su basura llega a las ratas y se extiende a los edificios de alrededor sin recogida.
      const served = trashServed(state);
      const hit = state.buildings.filter((x) => x.built && !served.has(x.id) && Math.abs(x.x - b.x) + Math.abs(x.y - b.y) <= TRASH.plagueRadius);
      for (const x of hit) x.trash = Math.min(TRASH.max, Math.max(x.trash ?? 0, x === b ? TRASH.ratsAt : TRASH.dirtyAt));
      const ids = new Set(hit.map((x) => x.id));
      const people = state.citizens.filter((c) => (c.homeId !== null && ids.has(c.homeId)) || (c.jobId !== null && ids.has(c.jobId)));
      for (const c of people) {
        c.grudge = Math.min(20, c.grudge + 1);
        if (c.named) addMemory(state, c, 'ratas', 3, -2);
      }
      pushEvent(state, 'warning', `${c.text}: ${plural(hit.length)} sin recogida de basura`, { ref: b.id, notify: true });
      return { id: people[0]?.id ?? 0, text: c.text };
    }
    case 'licitacion': {
      const t = rumoredTenders(state).find((x) => x.buildingId === Number(arg));
      if (!t || !scandal(state, t)) return null;
      return { id: t.councillorId ?? 0, text: c.text };
    }
    case 'homenaje': {
      const st = state.pleno?.street;
      const id = Number(arg);
      if (!st || st.done || !st.candidates.includes(id)) return null;
      // Pasa a ser el primero de la lista del pleno.
      st.candidates = [id, ...st.candidates.filter((x) => x !== id)];
      const name = state.citizens.find((x) => x.id === id)?.name ?? state.departed?.find((x) => x.id === id)?.name ?? 'un vecino';
      pushEvent(state, 'info', `En el bar se pide que una calle lleve el nombre de ${name}`, { ref: id });
      return { id, text: c.text };
    }
    case 'cosecha': {
      const b = state.buildings.find((x) => x.id === Number(arg));
      if (!b || !harvestFeast(state, b)) return null;
      return { id: state.citizens.find((x) => x.jobId === b.id)?.id ?? 0, text: c.text };
    }
    case 'granizo': {
      const b = state.buildings.find((x) => x.id === Number(arg));
      if (!b || !hail(state, b)) return null;
      return { id: state.citizens.find((x) => x.jobId === b.id)?.id ?? 0, text: c.text };
    }
    case 'voluntarios_obra': {
      const lm = landmarksInProgress(state).find((l) => l.id === Number(arg));
      if (!lm || lm.helped === lm.phase || lm.discount || !applyVolunteers(state, lm.id)) return null;
      lm.helped = lm.phase;
      // Ayudan los que están en paro (y les sube el ánimo).
      const who = state.citizens.filter((x) => x.named && x.jobId === null && x.unemployedSince !== undefined).slice(0, 4);
      for (const x of who) addMemory(state, x, 'obra_voluntario', 3, 3);
      return { id: who[0]?.id ?? 0, text: c.text };
    }
    case 'polemica_obra': {
      const lm = landmarksInProgress(state).find((l) => l.id === Number(arg));
      const payer = payingFaction(state);
      if (!lm || lm.polemic === lm.phase || !payer) return null;
      lm.polemic = lm.phase;
      // Actitud −1 en la facción que paga más (y lo recuerdan).
      for (const x of payer.members) {
        x.attitude = Math.max(-2, (x.attitude ?? 0) - 1);
        x.grudge = Math.min(20, x.grudge + 1);
        addMemory(state, x, 'rumor', 3, -2);
      }
      pushEvent(state, 'politics', `${c.text}: los ${FACTION_TEXT[payer.f].toLowerCase()} dicen que la pagan ellos`, { ref: lm.buildingId });
      return { id: payer.members[0]?.id ?? 0, text: c.text };
    }
    case 'reportaje_tv': {
      if (!tvReportCandidate(state)) return null;
      applyTvReport(state);
      return { id: 0, text: c.text };
    }
    case 'turistas_ruido': {
      if (!touristNoiseCandidate(state)) return null;
      applyTouristNoise(state);
      return { id: 0, text: c.text };
    }
    case 'ere_gran_empresa': {
      if (!announceEre(state)) return null;
      const w = state.citizens.find((x) => x.jobId === Number(arg));
      return { id: w?.id ?? 0, text: c.text };
    }
    case 'contrata_vecinos': {
      const before = new Set(state.citizens.filter((x) => x.jobId === Number(arg)).map((x) => x.id));
      if (!hireBatch(state, DIRECTOR.hireBatch)) return null;
      return { id: state.citizens.find((x) => x.jobId === Number(arg) && !before.has(x.id))?.id ?? 0, text: c.text };
    }
    case 'local': {
      const [a, b] = pair();
      if (!a || !b) return null;
      if (!addHook(state, 'mismo_local', [a.id, b.id])) return null;
      setRelation(state, a, b, 'rivalidad', 40);
      return { id: a.id, text: c.text };
    }
  }
}

/** Para el prompt y para «Se está cociendo»: avisos vigentes. */
export function brewingNow(state: GameState, menu = directorMenu(state)): Brewing[] {
  return liveBrewing(state, menu);
}

setDirectorImpl(applyDirector);
