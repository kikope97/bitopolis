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
import { DIRECTOR } from './balance.ts';
import { robbery, homeRobbery } from './crime.ts';
import type { Brewing } from './director-core.ts';
import { canFound, freeShopLot } from './economy.ts';
import { hash32 } from './hash.ts';
import { totalDebt } from './household.ts';
import { transfer } from './money.ts';
import { factionOf } from './politics.ts';
import { FACTION_TEXT, FACTIONS, type Faction } from './politics-core.ts';
import { addHook, addMemory, relation, setRelation } from './social.ts';
import { type Citizen, type GameState, pushEvent } from './state.ts';
import { setDirectorImpl, type TurnLog } from './turns.ts';

export const DIRECTOR_KINDS = ['robo_tienda', 'robo_casa', 'asociacion', 'manifestacion', 'pelea', 'reconciliacion', 'gratitud', 'rumor', 'oposicion', 'local', 'encuentro', 'ayuda'] as const;
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
}

/** Lo que elige la IA (ya validado por forma; el motor lo vuelve a validar al aplicarlo). */
export interface DirectorChoice {
  sucesos: { id: string; motivo: string }[];
  avisos: { id: string; motivo: string }[];
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

  // Robos (solo donde la delincuencia lo justifica).
  add(
    state.buildings
      .filter((b) => b.kind === 'shop' && b.built && !b.damaged && b.cash > 0 && crimeAt(state, b.x, b.y) >= DIRECTOR.robCrime)
      .sort((a, b) => crimeAt(state, b.x, b.y) - crimeAt(state, a.x, a.y) || a.id - b.id)
      .map((b) => ({ id: `robo_tienda:${b.id}`, kind: 'robo_tienda', bad: true, text: `Roban en ${b.name ?? 'una tienda'}`, why: `delincuencia ${Math.round(crimeAt(state, b.x, b.y))} en su calle` })),
  );
  add(
    state.buildings
      .filter((b) => (b.kind === 'house' || b.kind === 'res') && b.built && crimeAt(state, b.x, b.y) >= DIRECTOR.robCrime && state.citizens.some((c) => c.homeId === b.id && c.money > 0))
      .sort((a, b) => crimeAt(state, b.x, b.y) - crimeAt(state, a.x, a.y) || a.id - b.id)
      .map((b) => {
        const who = state.citizens.filter((c) => c.homeId === b.id).sort((x, y) => y.money - x.money)[0]!;
        return { id: `robo_casa:${b.id}`, kind: 'robo_casa', bad: true, text: `Entran a robar en casa de ${who.name}`, why: `delincuencia ${Math.round(crimeAt(state, b.x, b.y))} en su calle` };
      }),
  );

  // Asociaciones y manifestaciones.
  add(
    freshCauses(state).map(([cause, cs]) => ({ id: `asociacion:${cause}`, kind: 'asociacion', bad: true, text: `Los vecinos que piden ${CAUSE_ASK[cause]} fundan una asociación`, why: `${cs.length} vecinos con la misma queja: ${CAUSE_TEXT[cause]}` })),
  );
  add(
    (state.associations ?? [])
      .filter((a) => a.protestDay < 0 && a.promiseUntil < 0 && state.tick - Math.max(a.founded, a.lastProtest, a.lastMeeting) >= TICKS_PER_MONTH)
      .map((a) => ({ id: `manifestacion:${a.id}`, kind: 'manifestacion', bad: true, text: `La ${a.name} convoca una manifestación`, why: `${a.members.length} socios; piden ${CAUSE_ASK[a.cause]} y nadie les ha recibido en un mes` })),
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
    if (a) help.push({ id: `ayuda:${a.id}_${b.id}`, kind: 'ayuda', bad: false, text: `${first(a)} le echa una mano a ${first(b)}, que no llega a fin de mes`, why: `${first(b)} tiene ${b.money} € y debe ${totalDebt(b)} €` });
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
        ? { id: 'rumor:malo', kind: 'rumor', bad: true, text: `Corre el rumor de que habrá más medidas como esta: «${recent.text}»`, why: 'lo último que ha hecho el alcalde' }
        : { id: 'rumor:bueno', kind: 'rumor', bad: false, text: `Se comenta en el bar que «${recent.text}» traerá cosas buenas`, why: 'lo último que ha hecho el alcalde' },
    );
  }

  // La oposición (si existe y gobierna el jugador) da un mitin a la facción más descontenta.
  const p = state.politics;
  if (p.party && p.mayor === 'player') {
    const f = [...FACTIONS].sort((a, b) => p.factions[a].satisfaction - p.factions[b].satisfaction)[0]!;
    out.push({ id: `oposicion:${f}`, kind: 'oposicion', bad: true, text: `«${p.party.name}» da un mitin entre ${FACTION_TEXT[f].toLowerCase()}`, why: `es la facción más descontenta (${Math.round(p.factions[f].satisfaction)})` });
  }

  // Una historia: dos vecinos quieren el único local libre.
  const founders = named.filter((c) => canFound(state, c));
  if (founders.length >= 2 && freeShopLot(state) !== null && state.hooks.length < 3) {
    const [a, b] = founders;
    if (relation(a!, b!.id)?.kind !== 'pareja') out.push({ id: `local:${pairId(a!.id, b!.id)}`, kind: 'local', bad: false, text: `${first(a!)} y ${first(b!)} quieren el mismo local para abrir un negocio`, why: 'solo queda un local libre' });
  }
  return out;
}

/* ---------------- presupuesto de drama ---------------- */

const monthOf = (tick: number) => Math.floor(tick / TICKS_PER_MONTH);

/** Sucesos malos que caben este turno, y por qué. */
export function dramaBudget(state: GameState): { bad: number; why: string } {
  const discontent = 100 - townHappiness(state);
  const d = state.ai?.drama && state.ai.drama.month === monthOf(state.tick) ? state.ai.drama : { bad: 0, good: 0 };
  let bad = discontent >= DIRECTOR.twoBadFrom ? 2 : discontent >= DIRECTOR.badFrom ? 1 : 0;
  let why = bad ? `descontento ${Math.round(discontent)}: caben ${bad} malos` : `el pueblo está contento (felicidad ${Math.round(townHappiness(state))}): nada malo`;
  const left = DIRECTOR.maxBadPerMonth - d.bad;
  if (left < bad) {
    bad = Math.max(0, left);
    why = `ya van ${d.bad} sucesos malos este mes`;
  }
  if (bad && townHappiness(state) >= DIRECTOR.fairHappiness && d.bad >= 2 * (d.good + 1)) {
    bad = 0;
    why = 'el alcalde lo hace bien: antes toca algo bueno';
  }
  return { bad, why };
}

/* ---------------- aplicar ---------------- */

/** Avisos vigentes (sin los que caducan o ya no son posibles). No toca el estado. */
function liveBrewing(state: GameState, menu: DirectorCandidate[]): Brewing[] {
  const ai = state.ai;
  if (!ai) return [];
  const ttl = DIRECTOR.brewingTurns * ai.paceDays * TICKS_PER_DAY;
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
  const budget = dramaBudget(state);
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
    case 'pelea':
      return `Hay tensión: ${c.text.replace('discuten', 'no se ponen de acuerdo')}`;
    case 'oposicion':
      return `${c.text.replace('da', 'prepara')} (${c.why})`;
    case 'rumor':
      return 'Se oyen comentarios en el bar sobre el ayuntamiento';
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
