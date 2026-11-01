import { TICKS_PER_DAY, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import { AMBULANCE, BUILD, CIVIL, FIRE } from './balance.ts';
import { BUILD_NAMES } from './commands.ts';
import { directorOwns } from './director-core.ts';
import { hash32 } from './hash.ts';
import { levelOf, radiusOf } from './levels.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance, nextInt } from './prng.ts';
import { addMemory } from './social.ts';
import { type Building, type BuildingKind, type Citizen, type GameState, buildingAt, inBounds, pushEvent, terrainAt, Tile } from './state.ts';
import { Terrain, isWater } from './terrain.ts';
import { seasonOf } from './weather.ts';

/**
 * 2.1 (hoja de ruta): incendios, bomberos, protección civil y ambulancia.
 *
 * - Cada día, cada edificio puede entrar en riesgo de incendio (más las
 *   fábricas, con calor y con las estufas del invierno). El riesgo se avisa
 *   siempre antes (registro de sucesos y estado «en riesgo» en el edificio).
 * - En Modo normal, al día siguiente el riesgo puede prender (dados). En Modo IA
 *   con director, los dados se apagan y el director elige `incendio:<id>`
 *   entre los edificios en riesgo (con su aviso previo, como todo lo malo).
 * - El fuego dura unas horas y puede saltar al edificio de al lado. Con un
 *   parque de bomberos en su radio (en la colina, con cisterna: nivel 2) se
 *   apaga pronto y sin daños; sin bomberos, el edificio queda destrozado
 *   (`damaged`, se repara con `RepairBuilding`). Nunca se pierde.
 * - Protección civil: en su radio la riada es menos probable y el quitanieves
 *   cuesta menos; diques en la orilla anulan la riada; voluntarios entre los
 *   parados (acción de la IA o, en Modo normal, por reglas).
 * - Ambulancia (centro de salud de nivel 2): en una urgencia de un mayor, si
 *   llega a tiempo (con nieve, menos), la despedida se pospone.
 */

/** Lo que puede arder (el ayuntamiento, las plantas, los parques y las emergencias, no). */
export const BURNABLE: BuildingKind[] = ['house', 'res', 'shop', 'factory', 'bar', 'market', 'school', 'clinic', 'police', 'chapel', 'library', 'sports', 'jail'];

const ARTICLE: Partial<Record<BuildingKind, string>> = {
  house: 'una casa municipal',
  res: 'unas viviendas',
  shop: 'una tienda',
  factory: 'un taller',
  bar: 'el bar',
  market: 'el mercado',
  school: 'el colegio',
  clinic: 'el centro de salud',
  police: 'la comisaría',
  chapel: 'la ermita',
  library: 'la biblioteca',
  sports: 'el polideportivo',
  jail: 'la cárcel',
};

/** Cómo se nombra un edificio en una frase («el Bar de Lucía», «unas viviendas»). */
export function placeName(b: Building): string {
  return b.name ?? ARTICLE[b.kind] ?? (BUILD_NAMES[b.kind] ?? b.kind).toLowerCase();
}

/**
 * Género y número del nombre de un sitio, por su artículo («unas viviendas» →
 * fem. plural), para concordar «destrozadas» y «repararlas». Sin artículo, masculino singular.
 */
export function placeAgreement(name: string): { fem: boolean; plural: boolean } {
  const w = name.split(' ')[0]!.toLowerCase();
  return { fem: ['una', 'la', 'unas', 'las'].includes(w), plural: ['unos', 'los', 'unas', 'las'].includes(w) };
}

/** «destrozado», «destrozada», «destrozados» o «destrozadas» según el sitio. */
export function destroyedWord(name: string): string {
  const a = placeAgreement(name);
  return `destrozad${a.fem ? 'a' : 'o'}${a.plural ? 's' : ''}`;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const first = (c: Citizen) => c.name.split(' ')[0]!;

export const burnable = (b: Building): boolean => b.built && BURNABLE.includes(b.kind);
export const burning = (state: GameState): Building[] => state.buildings.filter((b) => b.fire);
export const burntDown = (b: Building | undefined): boolean => b?.damaged?.cause === 'fuego';

/* ---------------- bomberos ---------------- */

/** Parques de bomberos que llegan a (x, y): en su radio y, en la colina, con cisterna (nivel 2). */
export function fireStationsFor(state: GameState, x: number, y: number): Building[] {
  const hill = terrainAt(state, x, y) === Terrain.Hill;
  return state.buildings
    .filter((b) => b.kind === 'firestation' && b.built && !b.damaged && dist(b, { x, y }) <= radiusOf(b) && (!hill || levelOf(b) >= FIRE.hillLevel))
    .sort((a, b) => dist(a, { x, y }) - dist(b, { x, y }) || a.id - b.id);
}

export const fireCovered = (state: GameState, b: { x: number; y: number }): boolean => fireStationsFor(state, b.x, b.y).length > 0;

/* ---------------- riesgo ---------------- */

/** Probabilidad diaria de riesgo de un edificio y por qué (para el aviso). */
export function riskOf(state: GameState, b: Building): { p: number; why: string[] } {
  const why: string[] = [];
  let p = FIRE.riskBase;
  if (b.kind === 'factory') {
    p *= FIRE.factory;
    why.push('un taller con máquinas');
  }
  if (state.weather?.kind === 'calor') {
    p *= FIRE.heat;
    why.push('la ola de calor');
  }
  const winter = seasonOf(tickToDate(state.tick).month) === 'invierno' || state.weather?.kind === 'nieve';
  if (winter && (b.kind === 'house' || b.kind === 'res' || b.kind === 'bar' || b.kind === 'shop')) {
    p *= FIRE.stoves;
    why.push('las estufas del invierno');
  }
  return { p, why };
}

/** Dado sin tocar el PRNG de la partida (muchos edificios cada día). */
const roll = (state: GameState, b: Building, salt: number) => hash32(state.seed, b.id, Math.floor(state.tick / TICKS_PER_DAY), salt) / 0x1_0000_0000;

/** Pone un edificio en riesgo (con su aviso). */
export function flagRisk(state: GameState, b: Building, why: string): void {
  b.risk = { since: state.tick, why };
  const help = fireCovered(state, b) ? 'Los bomberos están cerca.' : 'No hay bomberos cerca: un parque de bomberos lo apagaría pronto.';
  pushEvent(state, 'fire', `Riesgo de incendio en ${placeName(b)} (${why}). ${help}`, { ref: b.id });
}

/** Cada día: los riesgos que vencen pueden prender (sin director) y aparecen riesgos nuevos. */
export function fireDay(state: GameState): void {
  const ai = directorOwns(state);
  for (const b of state.buildings) {
    if (!b.risk) continue;
    if (!burnable(b) || b.damaged || b.fire) {
      delete b.risk;
      continue;
    }
    const age = state.tick - b.risk.since;
    if (ai) {
      // Con director, lo elige él; si no lo elige en semanas, el riesgo pasa.
      if (age >= FIRE.riskDaysAi * TICKS_PER_DAY) delete b.risk;
      continue;
    }
    if (age < FIRE.riskHours) continue;
    if (chance(state.rng, FIRE.ignite)) ignite(state, b);
    else delete b.risk;
  }
  if (state.citizens.length < FIRE.minPop) return;
  for (const b of state.buildings) {
    if (!burnable(b) || b.risk || b.fire || b.damaged) continue;
    const r = riskOf(state, b);
    if (roll(state, b, 31) < r.p) flagRisk(state, b, r.why.join(' y ') || 'un descuido');
  }
}

/** Empieza un incendio en un edificio. Devuelve false si ya no puede arder. */
export function ignite(state: GameState, b: Building, from?: Building): boolean {
  if (!burnable(b) || b.fire || b.damaged || burning(state).length >= FIRE.maxBurning) return false;
  delete b.risk;
  const covered = fireCovered(state, b);
  const [lo, hi] = covered ? FIRE.coveredHours : FIRE.uncoveredHours;
  b.fire = { since: state.tick, until: state.tick + nextInt(state.rng, lo, hi), covered };
  const em = state.emergencies;
  if (em) em.fires++;
  const how = covered ? 'Los bomberos ya van de camino.' : 'No hay bomberos que lleguen: arderá horas.';
  const text = from ? `El fuego salta de ${placeName(from)} a ${placeName(b)}. ${how}` : `¡Fuego en ${placeName(b)}! ${how}`;
  pushEvent(state, 'fire', text, { ref: b.id, notify: true });
  for (const c of state.citizens) if (c.homeId === b.id || c.jobId === b.id) if (c.named) addMemory(state, c, 'incendio', 4, -3);
  return true;
}

/** Cada hora, si algo arde: el fuego salta, los vecinos ayudan y, al final, se apaga o destroza el edificio. */
export function fireTick(state: GameState): void {
  const list = burning(state);
  if (!list.length) return;
  for (const b of list) {
    if (!b.fire) continue;
    if (state.tick < b.fire.until) {
      // Salta a los vecinos (también en diagonal).
      const p = b.fire.covered ? FIRE.spreadCovered : FIRE.spreadUncovered;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const n = inBounds(state, b.x + dx, b.y + dy) ? buildingAt(state, b.x + dx, b.y + dy) : undefined;
          if (n && burnable(n) && !n.fire && !n.damaged && chance(state.rng, p)) ignite(state, n, b);
        }
      }
      continue;
    }
    putOut(state, b);
  }
}

/** Se acaba el fuego: con bomberos, sin daños; sin ellos, el edificio queda destrozado. */
function putOut(state: GameState, b: Building): void {
  const f = b.fire!;
  delete b.fire;
  const hours = state.tick - f.since;
  const people = state.citizens.filter((c) => c.homeId === b.id || c.jobId === b.id);
  if (f.covered) {
    if (state.emergencies) state.emergencies.putOut++;
    for (const c of people) if (c.named) addMemory(state, c, 'bomberos', 3, 2);
    pushEvent(state, 'fire', `Los bomberos apagan el fuego en ${placeName(b)} en ${hours} ${hours === 1 ? 'hora' : 'horas'}: solo ha sido un susto`, { ref: b.id });
    return;
  }
  const spec = BUILD[b.kind as keyof typeof BUILD];
  const cost = Math.max(FIRE.repairMin, Math.round((spec?.materials ?? 2_000) * FIRE.repair));
  b.damaged = { cost, repairUntil: -1, cause: 'fuego' };
  const home = b.kind === 'house' || b.kind === 'res';
  const where = placeName(b);
  const ag = placeAgreement(where);
  const it = `l${ag.fem ? 'a' : 'o'}${ag.plural ? 's' : ''}`;
  pushEvent(state, 'fire', `El fuego deja ${where} ${destroyedWord(where)} tras ${hours} horas${home && people.length ? `: ${people.length === 1 ? 'una familia se queda' : `${people.length} vecinos se quedan`} sin casa` : ''}. Reparar${it} cuesta ${cost} €`, { ref: b.id, notify: true });
  // Modo normal (y vecinos sin IA): los vecinos generosos de cerca echan una mano a quien se ha quedado sin casa.
  if (home) helpVictims(state, b, people);
}

/** Por reglas: hasta dos vecinos con nombre, sociables y con dinero, ayudan a los que se han quedado sin casa. */
function helpVictims(state: GameState, b: Building, victims: Citizen[]): void {
  const v = victims[0];
  if (!v) return;
  const helpers = state.citizens
    .filter((c) => c.named && !victims.includes(c) && !(state.aiMode && state.ai && state.ai.share > 0) && c.traits.social >= 60 && c.money >= FIRE.helpAmount * 3)
    .map((c) => ({ c, d: (() => { const h = state.buildings.find((x) => x.id === c.homeId); return h ? dist(h, b) : 99; })() }))
    .filter((x) => x.d <= 8)
    .sort((a, b) => a.d - b.d || a.c.id - b.c.id)
    .slice(0, 2);
  for (const { c } of helpers) helpAfterFire(state, c, b);
}

/** Un vecino ayuda tras un incendio: dinero a los afectados (o, si arde aún, ayuda a apagarlo). */
export function helpAfterFire(state: GameState, c: Citizen, b: Building): string {
  if (b.fire) {
    // Cubos y mangueras: el fuego dura algo menos (el motor decide cuánto).
    b.fire.until = Math.max(state.tick + 1, b.fire.until - FIRE.helpHours);
    addMemory(state, c, 'ayudo_incendio', 3, 3);
    c.happiness = Math.min(100, c.happiness + 2);
    return `ayuda a apagar el fuego en ${placeName(b)}`;
  }
  const v = state.citizens.find((x) => x.homeId === b.id && x !== c);
  if (!v) return 'quiere ayudar, pero ya no hay a quién';
  const given = transfer(state, c.id, v.id, Math.min(FIRE.helpAmount, c.money), 'ayuda');
  addMemory(state, c, 'ayudo_incendio', 3, 3, [v.id]);
  addMemory(state, v, 'le_ayudaron', 4, 4, [c.id]);
  pushEvent(state, 'info', `${first(c)} le da ${given} € a ${first(v)}, que se ha quedado sin casa por el fuego`, { ref: v.id });
  return `ayuda a ${first(v)} tras el incendio`;
}

/** Edificios a los que se puede ir a ayudar: ardiendo o destrozados por el fuego con gente que vivía allí. */
export function fireHelpTargets(state: GameState): Building[] {
  return state.buildings
    .filter((b) => b.fire || (burntDown(b) && b.damaged!.repairUntil < 0 && state.citizens.some((c) => c.homeId === b.id)))
    .sort((a, b) => a.id - b.id)
    .slice(0, 2);
}

/** Vecinos cuya casa ha quedado destrozada por el fuego (no reparada aún). */
export function homelessByFire(state: GameState): Citizen[] {
  const burnt = new Set(state.buildings.filter((b) => burntDown(b) && b.damaged!.repairUntil < 0).map((b) => b.id));
  return state.citizens.filter((c) => c.homeId !== null && burnt.has(c.homeId));
}

/** Acoge en su casa a un vecino que se ha quedado sin ella por el fuego. */
export function shelter(state: GameState, c: Citizen, guest: Citizen | undefined): string {
  if (!guest || !homelessByFire(state).includes(guest) || homelessByFire(state).includes(c) || c.homeId === null) return 'quería acoger a alguien, pero ya no hace falta';
  addMemory(state, c, 'acogio', 4, 3, [guest.id]);
  addMemory(state, guest, 'le_acogieron', 5, 5, [c.id]);
  const r = c.relations.find((x) => x.id === guest.id);
  if (r) r.strength = Math.min(100, r.strength + 15);
  const r2 = guest.relations.find((x) => x.id === c.id);
  if (r2) r2.strength = Math.min(100, r2.strength + 15);
  pushEvent(state, 'info', `${first(c)} acoge en su casa a ${first(guest)} mientras le arreglan la suya tras el incendio`, { ref: guest.id });
  return `acoge en su casa a ${first(guest)}`;
}

/* ---------------- protección civil y diques ---------------- */

export const civilPosts = (state: GameState): Building[] => state.buildings.filter((b) => b.kind === 'civilprotection' && b.built && !b.damaged);
export const civilCovers = (state: GameState, x: number, y: number): boolean => civilPosts(state).some((b) => dist(b, { x, y }) <= radiusOf(b));

/** ¿Hay río en una casilla vecina (también en diagonal)? */
export function onRiverbank(state: GameState, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inBounds(state, x + dx, y + dy) && terrainAt(state, x + dx, y + dy) === Terrain.River) return true;
  return false;
}

export const hasDike = (state: GameState, x: number, y: number): boolean => (state.dikes ?? []).includes(y * state.map.w + x);

/** ¿Protege un dique este sitio? (a `CIVIL.dikeReach` casillas, también en diagonal). */
export function dikeProtects(state: GameState, x: number, y: number): boolean {
  const r = CIVIL.dikeReach;
  for (const i of state.dikes ?? []) {
    const dx = (i % state.map.w) - x;
    const dy = Math.floor(i / state.map.w) - y;
    if (Math.abs(dx) <= r && Math.abs(dy) <= r) return true;
  }
  return false;
}

/** Probabilidad de que la riada anegue este edificio (dique: nada; protección civil: −60 %). */
export function floodChanceAt(state: GameState, b: Building, base: number): number {
  if (dikeProtects(state, b.x, b.y)) return 0;
  return civilCovers(state, b.x, b.y) ? base * (1 - CIVIL.floodCut) : base;
}

/** Reparación de un edificio anegado: a la mitad si los bomberos de nivel 3 ayudan a achicar. */
export function floodRepairFactor(state: GameState, b: Building): number {
  const help = state.buildings.some((s) => s.kind === 'firestation' && s.built && !s.damaged && levelOf(s) >= FIRE.floodLevel && dist(s, b) <= radiusOf(s));
  return help ? FIRE.floodRepairCut : 1;
}

/** Calles en el radio de la protección civil: el quitanieves cuesta la mitad. Devuelve las casillas equivalentes. */
export function snowRoads(state: GameState): number {
  const posts = civilPosts(state);
  let n = 0;
  const { w, tiles } = state.map;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== Tile.Road) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    n += posts.some((b) => dist(b, { x, y }) <= radiusOf(b)) ? 1 - CIVIL.snowCut : 1;
  }
  return n;
}

export function canBuildDike(state: GameState, x: number, y: number): { ok: true } | { ok: false; error: string } {
  if (!inBounds(state, x, y)) return { ok: false, error: 'Fuera del mapa' };
  if (!state.buildings.some((b) => b.kind === 'civilprotection' && b.built)) return { ok: false, error: 'Primero hace falta una caseta de protección civil' };
  if (isWater(terrainAt(state, x, y))) return { ok: false, error: 'El dique va en la orilla, no en el agua' };
  if (!onRiverbank(state, x, y)) return { ok: false, error: 'El dique va en una casilla junto al río' };
  if (hasDike(state, x, y)) return { ok: false, error: 'Ya hay un dique' };
  if (buildingAt(state, x, y) || state.map.tiles[y * state.map.w + x] === Tile.Road) return { ok: false, error: 'Ese sitio está ocupado' };
  if (state.treasury < CIVIL.dikeCost) return { ok: false, error: 'No hay dinero suficiente' };
  return { ok: true };
}

export function buildDike(state: GameState, x: number, y: number): void {
  const i = y * state.map.w + x;
  transfer(state, TREASURY, OUTSIDE, CIVIL.dikeCost, 'obras');
  state.map.tiles[i] = Tile.Grass;
  state.map.zones[i] = 0;
  state.dikes = [...(state.dikes ?? []), i];
  pushEvent(state, 'info', 'Se levanta un dique en la orilla del río: ahí ya no llegará la riada');
}

/* ---------------- voluntarios ---------------- */

export const volunteerPlaces = (state: GameState): number => civilPosts(state).length * CIVIL.volunteersPer - state.citizens.filter((c) => c.volunteer).length;

/** ¿Puede hacerse voluntario? (en paro, con caseta y sitio). */
export function canVolunteer(state: GameState, c: Citizen): boolean {
  return !c.volunteer && c.jobId === null && c.unemployedSince !== undefined && volunteerPlaces(state) > 0;
}

export function becomeVolunteer(state: GameState, c: Citizen): string {
  if (!canVolunteer(state, c)) return 'quería apuntarse a protección civil, pero no hay sitio';
  c.volunteer = true;
  c.happiness = Math.min(100, c.happiness + 2);
  if (c.named) addMemory(state, c, 'voluntario', 4, 3);
  pushEvent(state, 'info', `${c.name} se apunta como voluntario de protección civil`, { ref: c.id });
  return 'se hace voluntario de protección civil';
}

/** Cada mes, por reglas: algún parado se apunta (los vecinos con IA lo deciden ellos en su turno). */
export function volunteersMonth(state: GameState): void {
  if (!civilPosts(state).length) {
    for (const c of state.citizens) delete c.volunteer;
    return;
  }
  const aiDecides = (c: Citizen) => state.aiMode && !!state.ai && state.ai.share > 0 && c.named;
  for (const c of state.citizens) {
    if (!canVolunteer(state, c) || aiDecides(c)) continue;
    if (c.traits.social >= 40 && chance(state.rng, CIVIL.volunteerChance)) becomeVolunteer(state, c);
  }
}

/* ---------------- ambulancia ---------------- */

/** Centros de salud con ambulancia (nivel 2) que llegan a un sitio (× 1,5 su radio). */
export function ambulanceFor(state: GameState, at: { x: number; y: number } | undefined): Building | undefined {
  if (!at) return undefined;
  return state.buildings
    .filter((b) => b.kind === 'clinic' && b.built && !b.damaged && levelOf(b) >= AMBULANCE.level && dist(b, at) <= radiusOf(b) * AMBULANCE.reach)
    .sort((a, b) => dist(a, at) - dist(b, at) || a.id - b.id)[0];
}

/**
 * Urgencia de un mayor (le tocaba despedirse): si hay ambulancia que llegue y
 * llega a tiempo (con nieve tarda más), se salva. Devuelve true si se salva.
 */
export function tryAmbulance(state: GameState, c: Citizen): boolean {
  const home = state.buildings.find((b) => b.id === c.homeId);
  const amb = ambulanceFor(state, home);
  if (!amb || !home) return false;
  const snow = state.weather?.kind === 'nieve';
  if (!chance(state.rng, AMBULANCE.save * (snow ? AMBULANCE.snow : 1))) {
    pushEvent(state, 'fire', `Urgencia en casa de ${c.name}: la ambulancia sale${snow ? ', pero la nieve la retrasa' : ''} y no llega a tiempo`, { ref: home.id });
    return false;
  }
  if (state.emergencies) state.emergencies.saved++;
  addMemory(state, c, 'ambulancia', 5, 5);
  const partner = c.relations.find((r) => r.kind === 'pareja');
  const p = partner ? state.citizens.find((x) => x.id === partner.id) : undefined;
  if (p) addMemory(state, p, 'agradecio', 3, 3, [c.id]);
  pushEvent(state, 'fire', `Urgencia: ${c.name} (${c.age} años) se pone muy mal y la ambulancia llega a tiempo${snow ? ' pese a la nieve' : ''}. Se recupera en casa`, { ref: home.id, notify: true });
  return true;
}

/** Susto que acaba bien (suceso bueno del director): la ambulancia llega en minutos. */
export function scare(state: GameState, c: Citizen): boolean {
  const home = state.buildings.find((b) => b.id === c.homeId);
  if (!ambulanceFor(state, home) || !home) return false;
  const em = state.emergencies;
  if (em) em.scares = { ...(em.scares ?? {}), [c.id]: state.tick };
  addMemory(state, c, 'susto', 3, 1);
  c.grudge = Math.max(0, c.grudge - 2);
  pushEvent(state, 'fire', `${c.name} se marea en la calle; la ambulancia llega en minutos y todo queda en un susto`, { ref: home.id });
  return true;
}

/** Mayores a los que les puede pasar un susto que acabe bien (con ambulancia y sin susto reciente). */
export function scareCandidates(state: GameState): Citizen[] {
  const recent = (c: Citizen) => state.tick - (state.emergencies?.scares?.[c.id] ?? -1e9) < 6 * TICKS_PER_MONTH;
  return state.citizens
    .filter((c) => c.named && c.age >= AMBULANCE.scareAge && !recent(c) && ambulanceFor(state, state.buildings.find((b) => b.id === c.homeId)))
    .sort((a, b) => b.age - a.age || a.id - b.id);
}
