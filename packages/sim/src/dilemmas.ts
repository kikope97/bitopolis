/**
 * 2.4 (bloque D): dilemas morales con datos reales (`ResolveDilemma`). El
 * motor busca los casos (quién, dónde y por qué), ofrece las opciones y aplica
 * sus efectos (`DILEMMA` en balance.ts). Uno al mes como mucho y 7 días para
 * decidir; si no, «no decidir» (rencor a los afectados).
 *
 * Modo normal (y Modo IA sin director): el motor lo abre por reglas, sin dados
 * (hash). Modo IA con director: el director elige cuál sale y lo presenta
 * (`Dilemma.intro`, validada); la IA nunca escribe las opciones.
 */
import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { CARE, DEBT, DILEMMA, GRUDGE_MAX } from './balance.ts';
import type { CommandResult } from './commands.ts';
import { directorOwns } from './director-core.ts';
import { hash32 } from './hash.ts';
import { canMicrocredit, grantMicrocredit, settleDebt } from './household.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { addMemory } from './social.ts';
import { type Building, type Citizen, type Dilemma, type DilemmaKind, type GameState, pushEvent } from './state.ts';

/** Lo que el motor propone (antes de abrirse). `key` identifica el caso: «tipo_id_id». */
export interface DilemmaCandidate {
  key: string;
  kind: DilemmaKind;
  citizenIds: number[];
  buildingId?: number;
  options: string[];
  /** Qué pasa, en una frase del motor (datos reales). */
  text: string;
}

export const DILEMMA_TITLE: Record<DilemmaKind, string> = {
  ultima_plaza_residencia: 'La última plaza de la residencia',
  familia_con_deudas: 'Una familia que no puede pagar',
  fabrica_vierte: 'La fábrica que vierte al río',
  preso_arrepentido: 'Un preso arrepentido',
};

const first = (c: Citizen | undefined) => c?.name.split(' ')[0] ?? 'un vecino';
const byId = (state: GameState, id: number | undefined) => state.citizens.find((c) => c.id === id);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const mood = (c: Citizen, d: number) => (c.happiness = Math.max(0, Math.min(100, c.happiness + d)));
const grudge = (c: Citizen, d: number) => (c.grudge = Math.min(GRUDGE_MAX, c.grudge + d));

/** Su familia en el pueblo: pareja, padres, hijos y quien vive con él. */
function kinOf(state: GameState, c: Citizen): Citizen[] {
  const ids = new Set<number>();
  for (const r of c.relations) if (r.kind === 'pareja') ids.add(r.id);
  for (const p of c.parents ?? []) ids.add(p);
  for (const x of state.citizens) {
    if (x === c) continue;
    if (x.parents?.includes(c.id) || (c.homeId !== null && x.homeId === c.homeId)) ids.add(x.id);
  }
  ids.delete(c.id);
  return [...ids].map((id) => byId(state, id)).filter((x): x is Citizen => !!x);
}

/* ---------------- candidatos ---------------- */

/** Residencias construidas y sin daños, y cuántas plazas quedan (si el agente de cuidados aún no ha llegado, no hay). */
function residenceSpots(state: GameState): { b: Building; free: number } | null {
  const homes = state.buildings.filter((b) => b.kind === 'residence' && b.built && !b.damaged);
  if (!homes.length) return null;
  const used = state.citizens.filter((c) => c.care === 'residencia').length;
  return { b: homes[0]!, free: homes.length * CARE.residence.places - used };
}

function residenceCandidates(state: GameState): DilemmaCandidate[] {
  const r = residenceSpots(state);
  // Solo con la residencia llena salvo una plaza.
  if (!r || r.free !== 1) return [];
  const elders = state.citizens.filter((c) => c.named && c.age >= CARE.elderAge && !c.care).sort((a, b) => b.age - a.age || a.id - b.id);
  if (elders.length < 2) return [];
  const [x, y] = [elders[0]!, elders[1]!];
  return [
    {
      key: `plaza_${x.id}_${y.id}`,
      kind: 'ultima_plaza_residencia',
      citizenIds: [x.id, y.id],
      buildingId: r.b.id,
      options: ['plaza_primero', 'plaza_segundo', 'ampliar'],
      text: `Queda una plaza en la residencia y la necesitan ${x.name} (${x.age} años) y ${y.name} (${y.age} años)`,
    },
  ];
}

function familyCandidates(state: GameState): DilemmaCandidate[] {
  const out: DilemmaCandidate[] = [];
  for (const c of state.citizens) {
    if (!c.named || c.owns || c.homeId === null || (c.debt?.town ?? 0) < DILEMMA.family.minDebt) continue;
    const home = state.buildings.find((b) => b.id === c.homeId);
    if (!home || home.kind !== 'house') continue;
    const kin = kinOf(state, c).filter((x) => x.homeId === c.homeId);
    if (!kin.length && !(c.kids?.length ?? 0)) continue;
    const options = ['desahuciar', 'perdonar'];
    if (canMicrocredit(state, c).ok) options.push('microcredito');
    out.push({
      key: `deudas_${c.id}`,
      kind: 'familia_con_deudas',
      citizenIds: [c.id, ...kin.slice(0, 3).map((x) => x.id)],
      buildingId: home.id,
      options,
      text: `${c.name} debe ${c.debt!.town} € al ayuntamiento y no puede pagar; vive en una casa municipal con su familia`,
    });
  }
  // Primero quien más debe (el director recibe unos pocos de cada tipo).
  return out.sort((a, b) => (byId(state, b.citizenIds[0])!.debt?.town ?? 0) - (byId(state, a.citizenIds[0])!.debt?.town ?? 0) || a.citizenIds[0]! - b.citizenIds[0]!);
}

function nearRiver(state: GameState, b: Building, reach: number): boolean {
  const { w, h, terrain } = state.map;
  for (let y = Math.max(0, b.y - reach); y <= Math.min(h - 1, b.y + reach); y++) {
    for (let x = Math.max(0, b.x - reach); x <= Math.min(w - 1, b.x + reach); x++) {
      if (terrain[y * w + x] === 1 && dist(b, { x, y }) <= reach) return true;
    }
  }
  return false;
}

function factoryCandidates(state: GameState): DilemmaCandidate[] {
  const f = DILEMMA.factory;
  const out: DilemmaCandidate[] = [];
  for (const b of state.buildings) {
    if (b.kind !== 'factory' || !b.built || b.damaged) continue;
    const pol = state.fields.pollution[b.y * state.map.w + b.x] ?? 0;
    if (pol < f.pollution || !nearRiver(state, b, f.reach)) continue;
    const workers = state.citizens.filter((c) => c.jobId === b.id);
    if (workers.length < f.fired) continue;
    const fired = workers.slice(-f.fired);
    const neighbors = state.citizens
      .filter((c) => c.named && !workers.includes(c) && c.homeId !== null)
      .map((c) => ({ c, d: dist(state.buildings.find((x) => x.id === c.homeId) ?? { x: 999, y: 999 }, b) }))
      .filter((x) => x.d <= f.reach)
      .sort((a, b2) => a.d - b2.d || a.c.id - b2.c.id)
      .slice(0, f.maxNeighbors)
      .map((x) => x.c.id);
    const owner = byId(state, b.owner);
    out.push({
      key: `vierte_${b.id}`,
      kind: 'fabrica_vierte',
      citizenIds: [...(owner ? [owner.id] : []), ...fired.map((c) => c.id), ...neighbors],
      buildingId: b.id,
      options: ['multar', 'mirar_otro_lado'],
      text: `${b.name ?? 'Una fábrica'} vierte al río (contaminación ${Math.round(pol)} en su calle); multarla supondría ${f.fired} despidos`,
    });
  }
  return out;
}

/** Presos del pueblo (cárcel o calabozo) con días de condena por delante. */
function prisoners(state: GameState): { id: number; until: number }[] {
  const j = state.justice;
  if (!j) return [];
  return [...j.jail, ...j.cells].filter((x): x is { until: number; citizenId: number } => x.citizenId !== undefined).map((x) => ({ id: x.citizenId, until: x.until }));
}

function prisonerCandidates(state: GameState): DilemmaCandidate[] {
  const out: DilemmaCandidate[] = [];
  for (const p of prisoners(state)) {
    const c = byId(state, p.id);
    if (!c || p.until - state.tick < DILEMMA.prisoner.minDays * TICKS_PER_DAY) continue;
    const kin = kinOf(state, c);
    if (!kin.length) continue;
    const days = Math.ceil((p.until - state.tick) / TICKS_PER_DAY);
    out.push({
      key: `preso_${c.id}`,
      kind: 'preso_arrepentido',
      citizenIds: [c.id, ...kin.slice(0, 2).map((x) => x.id)],
      options: ['pedir_indulto', 'que_cumpla'],
      text: `${c.name} cumple condena y pide perdón; le quedan ${days} días y su familia pide que salga`,
    });
  }
  return out;
}

/** ¿Se puede abrir un dilema ahora? Ninguno abierto, uno al mes como mucho y gobierna el jugador. */
export function canOpenDilemma(state: GameState): boolean {
  if (state.politics.mayor !== 'player' || state.citizens.length < DILEMMA.minPop) return false;
  if (state.dilemmas.some((d) => !d.resolved)) return false;
  const last = state.dilemmas.at(-1);
  return !last || state.tick - last.tick >= TICKS_PER_MONTH / DILEMMA.perMonth;
}

/**
 * Casos posibles ahora mismo (datos reales). Un caso ya planteado no se repite,
 * y los vecinos tienen que seguir en el pueblo.
 */
export function dilemmaCandidates(state: GameState): DilemmaCandidate[] {
  // El caso se reconoce por su edificio (la fábrica) o por su primer afectado.
  const caseOf = (x: { kind: string; buildingId?: number; citizenIds: number[] }) => (x.kind === 'fabrica_vierte' ? `${x.kind}_b${x.buildingId}` : `${x.kind}_${x.citizenIds[0]}`);
  const seen = new Set(state.dilemmas.map(caseOf));
  return [...residenceCandidates(state), ...familyCandidates(state), ...factoryCandidates(state), ...prisonerCandidates(state)].filter(
    (c) => !seen.has(caseOf(c)) && c.citizenIds.length > 0 && c.citizenIds.every((id) => state.citizens.some((x) => x.id === id)),
  );
}

/* ---------------- abrir ---------------- */

/** Abre un dilema de los candidatos (por su `key`). Devuelve el dilema o null si ya no vale. */
export function openDilemma(state: GameState, key: string, intro?: string): Dilemma | null {
  if (!canOpenDilemma(state)) return null;
  const c = dilemmaCandidates(state).find((x) => x.key === key);
  if (!c) return null;
  const d: Dilemma = {
    // Numeración propia (no gasta ids del pueblo: no cambia los de los edificios y vecinos que vengan).
    id: (state.dilemmas.at(-1)?.id ?? 0) + 1,
    kind: c.kind,
    tick: state.tick,
    until: state.tick + DILEMMA.days * TICKS_PER_DAY,
    citizenIds: c.citizenIds,
    ...(c.buildingId !== undefined ? { buildingId: c.buildingId } : {}),
    options: c.options,
    ...(intro ? { intro } : {}),
  };
  state.dilemmas.push(d);
  if (state.dilemmas.length > 24) state.dilemmas.splice(0, state.dilemmas.length - 24);
  pushEvent(state, 'warning', `Un asunto difícil: ${c.text}. Tienes ${DILEMMA.days} días para decidir`, { ref: c.citizenIds[0], notify: true });
  return d;
}

/** Texto del motor de un dilema abierto (si el director no lo presentó). */
export function dilemmaText(state: GameState, d: Dilemma): string {
  const [a, b] = d.citizenIds.map((id) => byId(state, id));
  switch (d.kind) {
    case 'ultima_plaza_residencia':
      return `Queda una plaza en la residencia y la necesitan ${a?.name ?? 'un vecino'} y ${b?.name ?? 'otro vecino'}. Solo puede entrar uno, salvo que se amplíe.`;
    case 'familia_con_deudas':
      return `${a?.name ?? 'Una familia'} debe ${a?.debt?.town ?? 0} € al ayuntamiento y vive con su familia en una casa municipal. ¿Qué hace el ayuntamiento?`;
    case 'fabrica_vierte': {
      const f = state.buildings.find((x) => x.id === d.buildingId);
      return `${f?.name ?? 'La fábrica'} vierte al río. Multarla protege el agua, pero tendría que despedir a ${DILEMMA.factory.fired} trabajadores.`;
    }
    case 'preso_arrepentido':
      return `${a?.name ?? 'Un vecino'} cumple condena y pide perdón. Su familia pide que el alcalde solicite el indulto.`;
  }
}

/** Etiqueta y efecto de cada opción (para la hoja; lo que de verdad hace el motor). */
export function dilemmaOption(state: GameState, d: Dilemma, option: string): { label: string; effect: string } {
  const [a, b] = d.citizenIds.map((id) => byId(state, id));
  const r = DILEMMA.residence;
  const fam = DILEMMA.family;
  const f = DILEMMA.factory;
  const p = DILEMMA.prisoner;
  switch (option) {
    case 'plaza_primero':
    case 'plaza_segundo': {
      const [win, lose] = option === 'plaza_primero' ? [a, b] : [b, a];
      return { label: `La plaza, para ${first(win)}`, effect: `${first(win)} entra (+${r.chosenMood} de ánimo); ${first(lose)} se queda fuera (${r.leftOutMood} y rencor)` };
    }
    case 'ampliar':
      return { label: 'Ampliar la residencia', effect: `Entran los dos; cuesta ${DILEMMA.expandCost} € de la caja` };
    case 'desahuciar':
      return { label: 'Desahuciar', effect: `La familia se queda sin casa (${fam.evictMood} de ánimo); la deuda sigue; los vecinos de al lado lo verán mal` };
    case 'perdonar':
      return { label: 'Perdonar la deuda', effect: `Se perdonan ${a?.debt?.town ?? 0} € (el ayuntamiento no los cobra); +${fam.forgiveMood} de ánimo` };
    case 'microcredito':
      return { label: 'Darle un microcrédito', effect: `Préstamo municipal sin intereses para salir del bache; +${fam.microMood} de ánimo` };
    case 'multar':
      return { label: 'Multar a la fábrica', effect: `Hasta ${f.fine} € a la caja; despide a ${f.fired} trabajadores` };
    case 'mirar_otro_lado':
      return { label: 'Mirar a otro lado', effect: `Nadie pierde el trabajo; los vecinos de la orilla se enfadan (rencor +${f.lookAwayGrudge})` };
    case 'pedir_indulto':
      return { label: 'Pedir el indulto', effect: `${first(a)} sale ya (+${p.pardonFamilyMood} de ánimo a su familia); a los de mano dura no les gustará` };
    case 'que_cumpla':
      return { label: 'Que cumpla la condena', effect: `Sigue preso; su familia lo pasa mal (${p.serveFamilyMood} de ánimo)` };
  }
  return { label: option, effect: '' };
}

/* ---------------- decidir ---------------- */

export function canResolveDilemma(state: GameState, id: number, option: string): CommandResult {
  const d = state.dilemmas.find((x) => x.id === id);
  if (!d || d.resolved) return { ok: false, error: 'Ese dilema ya no está abierto' };
  if (!d.options.includes(option)) return { ok: false, error: 'Esa opción no está' };
  const main = byId(state, d.citizenIds[0]);
  if (!main) return { ok: false, error: 'Ese vecino ya no vive en el pueblo' };
  if (option === 'ampliar' && state.treasury < DILEMMA.expandCost) return { ok: false, error: `Ampliar cuesta ${DILEMMA.expandCost} €` };
  if (option === 'plaza_segundo' && !byId(state, d.citizenIds[1])) return { ok: false, error: 'Ese vecino ya no vive en el pueblo' };
  if (option === 'microcredito') {
    const m = canMicrocredit(state, main);
    if (!m.ok) return m;
  }
  if (option === 'perdonar' && !(main.debt?.town ?? 0)) return { ok: false, error: 'Ya no debe nada al ayuntamiento' };
  return { ok: true };
}

function close(state: GameState, d: Dilemma, option: string): void {
  d.resolved = option;
  d.closed = state.tick;
}

/** Aplica la opción elegida (validada antes con `canResolveDilemma`). */
export function resolveDilemma(state: GameState, id: number, option: string): void {
  const d = state.dilemmas.find((x) => x.id === id);
  if (!d || d.resolved) return;
  const people = d.citizenIds.map((x) => byId(state, x));
  const [a, b] = people;
  switch (option) {
    case 'plaza_primero':
    case 'plaza_segundo':
    case 'ampliar': {
      const r = DILEMMA.residence;
      if (option === 'ampliar') transfer(state, TREASURY, OUTSIDE, DILEMMA.expandCost, 'residencia');
      const winners = option === 'ampliar' ? [a, b] : option === 'plaza_primero' ? [a] : [b];
      for (const c of winners) {
        if (!c) continue;
        c.care = 'residencia';
        mood(c, r.chosenMood);
        addMemory(state, c, 'dilema_a_favor', 4, 3);
      }
      const loser = option === 'ampliar' ? undefined : option === 'plaza_primero' ? b : a;
      if (loser) {
        mood(loser, r.leftOutMood);
        grudge(loser, r.leftOutGrudge);
        addMemory(state, loser, 'dilema_en_contra', 4, -3);
        for (const k of kinOf(state, loser)) grudge(k, 1);
      }
      pushEvent(state, 'info', option === 'ampliar' ? `Se amplía la residencia: entran ${first(a)} y ${first(b)}` : `La última plaza de la residencia es para ${first(winners[0])}`, { ref: winners[0]?.id });
      break;
    }
    case 'desahuciar': {
      if (!a) break;
      const fam = DILEMMA.family;
      const home = state.buildings.find((x) => x.id === a.homeId);
      const out = state.citizens.filter((x) => x.homeId !== null && x.homeId === a.homeId);
      for (const c of out) {
        c.homeId = null;
        c.rentArrears = 0;
        c.evictedUntil = state.tick + DEBT.evictedMonths * TICKS_PER_MONTH;
        mood(c, fam.evictMood);
        if (c.named) addMemory(state, c, 'desahuciado', 6, -6);
      }
      if (home) {
        for (const c of state.citizens) {
          const h = state.buildings.find((x) => x.id === c.homeId);
          if (c.named && h && dist(h, home) <= fam.neighborsRadius) grudge(c, fam.neighborsGrudge);
        }
      }
      pushEvent(state, 'info', `El ayuntamiento desahucia a ${a.name} y su familia`, { ref: a.id });
      break;
    }
    case 'perdonar': {
      if (!a) break;
      settleDebt(state, a, 'perdonar');
      a.rentArrears = 0;
      mood(a, DILEMMA.family.forgiveMood);
      addMemory(state, a, 'deuda_perdonada', 5, 4);
      for (const k of kinOf(state, a)) if (k.homeId === a.homeId) mood(k, DILEMMA.family.forgiveMood);
      pushEvent(state, 'info', `El alcalde perdona la deuda de ${a.name}`, { ref: a.id });
      break;
    }
    case 'microcredito': {
      if (!a) break;
      grantMicrocredit(state, a);
      mood(a, DILEMMA.family.microMood);
      addMemory(state, a, 'dilema_a_favor', 4, 2);
      pushEvent(state, 'info', `El ayuntamiento da un microcrédito a ${a.name} para salir del bache`, { ref: a.id });
      break;
    }
    case 'multar': {
      const f = DILEMMA.factory;
      const fab = state.buildings.find((x) => x.id === d.buildingId);
      if (!fab) break;
      const paid = transfer(state, fab.id, TREASURY, Math.min(f.fine, Math.max(0, fab.cash)), 'multas');
      const workers = state.citizens.filter((c) => c.jobId === fab.id);
      for (const c of workers.slice(-f.fired)) {
        c.jobId = null;
        if (c.named) addMemory(state, c, 'perdio_trabajo', 4, -4);
      }
      fab.staff = Math.max(0, workers.length - f.fired);
      for (const c of people) if (c && c.jobId !== fab.id && c.id !== fab.owner && !workers.includes(c)) addMemory(state, c, 'dilema_a_favor', 3, 2);
      pushEvent(state, 'info', `Multa de ${paid} € a ${fab.name ?? 'la fábrica'} por verter al río: despide a ${Math.min(f.fired, workers.length)} trabajadores`, { ref: fab.id });
      break;
    }
    case 'mirar_otro_lado': {
      const f = DILEMMA.factory;
      const fab = state.buildings.find((x) => x.id === d.buildingId);
      for (const c of people) {
        if (!c || c.jobId === d.buildingId || c.id === fab?.owner) continue;
        grudge(c, f.lookAwayGrudge);
        mood(c, f.lookAwayMood);
        addMemory(state, c, 'dilema_en_contra', 3, -2);
      }
      pushEvent(state, 'info', `El ayuntamiento no hace nada con los vertidos de ${fab?.name ?? 'la fábrica'}`, { ref: d.buildingId });
      break;
    }
    case 'pedir_indulto': {
      if (!a) break;
      const p = DILEMMA.prisoner;
      const j = state.justice;
      if (j) {
        j.jail = j.jail.filter((x) => x.citizenId !== a.id);
        j.cells = j.cells.filter((x) => x.citizenId !== a.id);
      }
      mood(a, p.prisonerMood);
      addMemory(state, a, 'dilema_a_favor', 5, 4);
      for (const k of kinOf(state, a)) mood(k, p.pardonFamilyMood);
      const hard = state.citizens.filter((c) => c.named && c !== a && c.traits.terco >= p.orderTerco && !kinOf(state, a).includes(c)).slice(0, p.orderMax);
      for (const c of hard) grudge(c, p.pardonOrderGrudge);
      pushEvent(state, 'info', `${a.name} sale de la cárcel con el indulto que pidió el alcalde`, { ref: a.id });
      break;
    }
    case 'que_cumpla': {
      if (!a) break;
      const p = DILEMMA.prisoner;
      addMemory(state, a, 'dilema_en_contra', 4, -3);
      for (const k of kinOf(state, a)) mood(k, p.serveFamilyMood);
      pushEvent(state, 'info', `${a.name} cumplirá su condena entera`, { ref: a.id });
      break;
    }
  }
  close(state, d, option);
}

/** Sin decidir a tiempo: «no decidir». Nadie gana nada y los afectados se lo guardan. */
export function expireDilemma(state: GameState, d: Dilemma): void {
  for (const id of d.citizenIds) {
    const c = byId(state, id);
    if (!c) continue;
    grudge(c, DILEMMA.noDecideGrudge);
    addMemory(state, c, 'sin_respuesta', 3, -2);
  }
  close(state, d, 'no_decidir');
  pushEvent(state, 'warning', `No decidiste a tiempo: ${DILEMMA_TITLE[d.kind].toLowerCase()}. Los afectados no lo olvidarán`, { ref: d.citizenIds[0] });
}

/**
 * Cada día: vence lo que no se decidió, se cierra lo que ya no tiene sentido (el
 * vecino se fue) y, por reglas (sin director), se abre uno nuevo si toca.
 */
export function dilemmasDay(state: GameState): void {
  for (const d of state.dilemmas) {
    if (d.resolved) continue;
    // Si el vecino se fue o el alcalde ya no gobierna, no hay nada que decidir.
    if (!byId(state, d.citizenIds[0]) || state.politics.mayor !== 'player') {
      close(state, d, 'sin_efecto');
      continue;
    }
    if (state.tick >= d.until) expireDilemma(state, d);
    // Ronda 20: aviso a falta de 2 días (a x10 el plazo pasa volando).
    else if (!d.reminded && d.until - state.tick <= 2 * TICKS_PER_DAY) {
      d.reminded = true;
      pushEvent(state, 'warning', `Un asunto difícil: quedan 2 días para decidir. ${dilemmaText(state, d)}`, { ref: d.citizenIds[0], notify: true });
    }
  }
  if (directorOwns(state) || !canOpenDilemma(state)) return;
  const last = state.dilemmas.at(-1);
  if (last && state.tick - last.tick < DILEMMA.ruleGapMonths * TICKS_PER_MONTH) return;
  const list = dilemmaCandidates(state);
  if (!list.length || hash32(state.seed, state.tick, 31) % 100 >= DILEMMA.ruleChancePct) return;
  openDilemma(state, list[hash32(state.seed, state.tick, 32) % list.length]!.key);
}

/** El dilema abierto (el cliente lo muestra). */
export function openDilemmaNow(state: GameState): Dilemma | undefined {
  return state.dilemmas.find((d) => !d.resolved);
}

/** Afectados por un dilema que se acaba de decidir (entran primero en la reacción rápida). */
export function dilemmaQuickIds(state: GameState): number[] {
  return state.dilemmas.filter((d) => d.closed !== undefined && d.resolved !== 'no_decidir' && d.resolved !== 'sin_efecto' && state.tick - d.closed <= TICKS_PER_DAY).flatMap((d) => d.citizenIds);
}

/** Lo que el alcalde acaba de decidir (texto del motor para la IA del pueblo). */
export function dilemmaMayorText(state: GameState, id: number, option: string): string | null {
  const d = state.dilemmas.find((x) => x.id === id);
  if (!d) return null;
  return `decide en «${DILEMMA_TITLE[d.kind].toLowerCase()}»: ${dilemmaOption(state, d, option).label.toLowerCase()}`;
}

/** Lo que un vecino afectado sabe del último dilema (para su ficha en el turno). */
export function dilemmaBrief(state: GameState, c: Citizen): string | null {
  const d = [...state.dilemmas].reverse().find((x) => x.citizenIds.includes(c.id) && state.tick - (x.closed ?? x.tick) <= TICKS_PER_MONTH);
  if (!d) return null;
  if (!d.resolved) return `el alcalde tiene que decidir sobre su caso: ${DILEMMA_TITLE[d.kind].toLowerCase()}`;
  if (d.resolved === 'sin_efecto') return null;
  if (d.resolved === 'no_decidir') return `el alcalde no decidió nada sobre su caso (${DILEMMA_TITLE[d.kind].toLowerCase()})`;
  return `el alcalde decidió sobre su caso (${DILEMMA_TITLE[d.kind].toLowerCase()}): ${dilemmaOption(state, d, d.resolved).label.toLowerCase()}`;
}

/* ---------------- director (Modo IA) ---------------- */

/** Candidatos para el menú del director: «dilema:<key>». */
export function dilemmaDirectorCandidates(state: GameState): { id: string; text: string; why: string }[] {
  if (!canOpenDilemma(state)) return [];
  return dilemmaCandidates(state).map((c) => ({ id: `dilema:${c.key}`, text: `Plantear al alcalde: ${DILEMMA_TITLE[c.kind].toLowerCase()}`, why: c.text }));
}

/** El director abre el dilema que eligió con su presentación (ya validada). */
export function directorDilemma(state: GameState, id: string, intro?: string): { id: number; text: string } | null {
  const key = id.split(':')[1] ?? '';
  const d = openDilemma(state, key, intro);
  return d ? { id: d.citizenIds[0]!, text: `Dilema: ${DILEMMA_TITLE[d.kind].toLowerCase()}` } : null;
}
