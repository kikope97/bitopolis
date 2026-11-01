import { type BuildKind, type Command, TICKS_PER_MONTH } from '@bitopolis/shared';
import { BUILD, RIVAL_AI } from './balance.ts';
import { canHoldFestival } from './civic.ts';
import { BUILD_NAMES, buildCostAt, governmentCommand, validateAsGovernment } from './commands.ts';
import { saturated, taxLevels } from './economy.ts';
import { FACTION_BUILD, freeSpots, LEVEL_TEXT, NEED_BUILD, rivalAct, syncLists } from './politics.ts';
import { FACTION_TEXT, STYLE_TEXT, type RivalStyle } from './politics-core.ts';
import { inventedName, inventedNumber } from './prompt.ts';
import type { GameState } from './state.ts';

/**
 * 2.2 (rival político con IA): cuando gobierna el rival, la IA elige cómo
 * gobierna de un menú cerrado que calcula el motor; el motor aplica lo elegido
 * con `governmentCommand` (misma validación que el jugador) y, si la IA no
 * responde ese mes, gobiernan las reglas de siempre (`rivalGovern`).
 *
 * Cómo se engancha (lo hace el coordinador, no este módulo):
 * - Al preparar la petición del director en el primer turno semanal de cada mes,
 *   si `rivalAiWanted(state)`, añadir `rivalPromptData(state)` a los datos y pedir
 *   el campo `gobierno_rival: { picks: string[] (≤ 2 ids del menú), discurso: string }`.
 * - Al aplicar el `TownTurn` (applyTownTurn → director), llamar a
 *   `applyRivalPicks(state, picks, discurso)`. Ese mes ya no gobiernan las reglas
 *   (`politics.rivalAiMonth`); si no llega nada válido, a fin de mes, `rivalGovern`.
 */

export type RivalOptionKind = 'nada' | 'obra' | 'impuestos' | 'presupuesto' | 'fiesta' | 'recorte' | 'reparar';

export interface RivalOption {
  /** Id estable (`^[a-z_]+:[a-z0-9_]+$`), p. ej. `obra:clinic` o `impuestos:ibi_bajo_tasas_medio`. */
  id: string;
  kind: RivalOptionKind;
  /** Texto para la IA y para el registro del gobierno. */
  text: string;
  /** Órdenes de gobierno ya validadas (se vuelven a validar al aplicarlas). */
  cmds: Command[];
}

export const RIVAL_OPTION_ID = /^[a-z_]+:[a-z0-9_]+$/;

const LEVELS = ['low', 'medium', 'high'] as const;
const LEVEL_ID = { low: 'bajo', medium: 'medio', high: 'alto' } as const;

/** ¿Gobierna el rival? */
export function rivalGoverns(state: GameState): boolean {
  const p = state.politics;
  return p.mayor !== 'player' && !!p.party && p.party.leaderId === p.mayor;
}

const monthOf = (state: GameState) => Math.floor(state.tick / TICKS_PER_MONTH);

/** ¿Hay que preguntar a la IA cómo gobierna el rival este mes? (gobierna y aún no lo ha hecho). */
export function rivalAiWanted(state: GameState): boolean {
  return rivalGoverns(state) && state.politics.rivalAiMonth !== monthOf(state);
}

/** Obras que el rival puede querer, por este orden: lo prometido, su facción y su estilo. */
const STYLE_BUILD: Record<RivalStyle, BuildKind[]> = {
  populista: ['house', 'park', 'sports', 'bar'],
  tecnico: ['police', 'water', 'power', 'cleanpoint'],
  conservador: ['police', 'clinic', 'chapel'],
  verde: ['park', 'cleanpoint', 'library'],
};

function wantedWorks(state: GameState): BuildKind[] {
  const party = state.politics.party!;
  const owed = party.promises.filter((x) => x.status === 'pending' && NEED_BUILD[x.need]).map((x) => NEED_BUILD[x.need]!);
  const all = [...owed, ...FACTION_BUILD[party.faction], ...STYLE_BUILD[party.style ?? 'populista'], 'clinic', 'school', 'police', 'park', 'house', 'firestation'];
  const out: BuildKind[] = [];
  for (const k of all) {
    if (!(k in BUILD) || k === 'road' || out.includes(k as BuildKind)) continue;
    const kind = k as BuildKind;
    const exists = state.buildings.filter((b) => b.kind === kind).length;
    // Lo mismo que las reglas: no repetir un servicio que aún da abasto; parques y casas, con tope.
    if (kind !== 'house' && kind !== 'park' && exists > 0 && !saturated(state, kind as never)) continue;
    if (kind === 'park' && exists >= Math.ceil(state.citizens.length / 25)) continue;
    if (kind === 'house' && exists >= Math.ceil(state.citizens.length / 15)) continue;
    out.push(kind);
  }
  return out;
}

function taxText(state: GameState, ibi: (typeof LEVELS)[number], tasas: (typeof LEVELS)[number]): string {
  return state.taxesSplit ? `IBI ${LEVEL_TEXT[ibi]} y tasas ${LEVEL_TEXT[tasas]}` : `impuestos en nivel ${LEVEL_TEXT[ibi]}`;
}

function taxOptions(state: GameState): RivalOption[] {
  const t = taxLevels(state);
  const out: RivalOption[] = [];
  if (!state.taxesSplit) {
    for (const lv of LEVELS) {
      if (lv === t.ibi) continue;
      out.push({ id: `impuestos:${LEVEL_ID[lv]}`, kind: 'impuestos', text: `${LEVELS.indexOf(lv) < LEVELS.indexOf(t.ibi) ? 'Bajar' : 'Subir'} los impuestos: ${taxText(state, lv, lv)}`, cmds: [{ type: 'SetTax', level: lv }] });
    }
    return out;
  }
  const i0 = LEVELS.indexOf(t.ibi);
  const t0 = LEVELS.indexOf(t.tasas);
  // Ronda 18: de un paso en un solo tributo (como las reglas), nada de saltos dobles.
  const moves: [number, number][] = [[-1, 0], [0, -1], [1, 0], [0, 1]];
  const seen = new Set<string>();
  for (const [di, dt] of moves) {
    const ibi = LEVELS[Math.max(0, Math.min(2, i0 + di))]!;
    const tasas = LEVELS[Math.max(0, Math.min(2, t0 + dt))]!;
    const id = `impuestos:ibi_${LEVEL_ID[ibi]}_tasas_${LEVEL_ID[tasas]}`;
    if ((ibi === t.ibi && tasas === t.tasas) || seen.has(id)) continue;
    seen.add(id);
    const up = LEVELS.indexOf(ibi) + LEVELS.indexOf(tasas) > i0 + t0;
    out.push({ id, kind: 'impuestos', text: `${up ? 'Subir' : 'Bajar'} impuestos: ${taxText(state, ibi, tasas)}`, cmds: [{ type: 'SetTaxes', ibi, tasas }] });
    if (out.length >= RIVAL_AI.taxes) break;
  }
  return out;
}

/**
 * Menú de gobierno del rival: como mucho `RIVAL_AI.menuMax` opciones, todas
 * válidas ahora mismo en modo gobierno. Vacío si no gobierna el rival.
 * Determinista: solo depende del estado.
 */
export function rivalMenu(state: GameState): RivalOption[] {
  if (!rivalGoverns(state)) return [];
  const out: RivalOption[] = [{ id: 'nada:nada', kind: 'nada', text: 'No hacer nada especial este mes', cmds: [] }];
  const valid = (o: RivalOption) => o.cmds.every((c) => validateAsGovernment(state, c).ok);
  const push = (o: RivalOption) => {
    if (out.length < RIVAL_AI.menuMax && RIVAL_OPTION_ID.test(o.id) && !out.some((x) => x.id === o.id) && valid(o)) out.push(o);
  };
  // Recorte: solo con la caja en números rojos.
  if (state.treasury < RIVAL_AI.cutBelow) {
    const cut = [...state.buildings].reverse().find((b) => (b.kind === 'park' || b.kind === 'house') && b.built);
    if (cut) push({ id: `recorte:${cut.id}`, kind: 'recorte', text: `Recortar gastos: derribar ${cut.kind === 'park' ? 'un parque' : 'una casa municipal'}`, cmds: [{ type: 'Demolish', x: cut.x, y: cut.y }] });
  }
  // Reparar lo destrozado (lo primero que haya).
  const broken = state.buildings.find((b) => b.damaged && b.damaged.repairUntil < 0);
  if (broken?.damaged) push({ id: `reparar:${broken.id}`, kind: 'reparar', text: `Reparar ${(BUILD_NAMES[broken.kind] ?? 'un edificio').toLowerCase()} (${broken.damaged.cost} €)`, cmds: [{ type: 'RepairBuilding', buildingId: broken.id }] });
  // Ronda 18: nada que rompa una promesa pendiente de no subir (o de bajar) impuestos.
  const noRaise = (state.politics.party?.promises ?? []).some((x) => x.status === 'pending' && (x.need === 'no subir impuestos' || x.need === 'bajar el IBI' || x.need === 'bajar los impuestos'));
  for (const o of taxOptions(state)) if (!(noRaise && o.text.startsWith('Subir'))) push(o);
  // Obras concretas, cada una en su sitio (distintos, para poder elegir dos).
  const works = wantedWorks(state);
  const spots = freeSpots(state, Math.max(RIVAL_AI.works, works.length));
  let n = 0;
  for (let i = 0; i < works.length && n < RIVAL_AI.works; i++) {
    const kind = works[i]!;
    const spot = spots[n];
    if (!spot) break;
    const cost = buildCostAt(state, kind, spot.x, spot.y);
    if (state.treasury < cost + RIVAL_AI.reserve) continue;
    const before = out.length;
    push({ id: `obra:${kind}`, kind: 'obra', text: `Construir: ${BUILD_NAMES[kind] ?? kind} cerca del ayuntamiento (${cost} €)`, cmds: [{ type: 'Build', kind, x: spot.x, y: spot.y }] });
    if (out.length > before) n++;
  }
  // Presupuesto del año (en enero) y fiestas (en verano).
  if (state.budget.status === 'open') {
    for (const plan of ['austero', 'equilibrado', 'inversor'] as const) push({ id: `presupuesto:${plan}`, kind: 'presupuesto', text: `Presentar un presupuesto ${plan}`, cmds: [{ type: 'ProposeBudget', plan }] });
  }
  for (const size of ['pequena', 'grande'] as const) {
    if (canHoldFestival(state, size).ok) push({ id: `fiesta:${size}`, kind: 'fiesta', text: `Organizar las fiestas ${size === 'grande' ? 'grandes' : 'pequeñas'}`, cmds: [{ type: 'HoldFestival', size }] });
  }
  return out;
}

/** Datos del rival para el prompt del director (sin cifras inventables: solo las del motor). */
export function rivalPromptData(state: GameState) {
  const party = state.politics.party;
  if (!rivalGoverns(state) || !party) return null;
  return {
    alcalde: party.leaderName,
    partido: party.name,
    faccion: FACTION_TEXT[party.faction].toLowerCase(),
    estilo: STYLE_TEXT[party.style ?? 'populista'].toLowerCase(),
    promesas: party.promises.filter((x) => x.status === 'pending').map((x) => x.need),
    opciones: rivalMenu(state).map((o) => ({ id: o.id, texto: o.text })),
  };
}

function clean(s: unknown, max: number): string {
  return typeof s === 'string'
    ? s
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f<>`*_#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
}

/**
 * Aplica lo que eligió la IA para el gobierno rival: como mucho `RIVAL_AI.picks`
 * opciones del menú de ahora (una por tipo), con `governmentCommand`. El discurso
 * se queda si pasa los filtros (≤ `RIVAL_AI.speechMax`, sin nombres ni cifras inventados).
 * Si se aplica algo (también «nada:nada»), ese mes no gobiernan las reglas.
 * Devuelve los ids aplicados.
 */
export function applyRivalPicks(state: GameState, picks: readonly string[], discurso?: string): string[] {
  if (!rivalGoverns(state)) return [];
  const p = state.politics;
  const party = p.party!;
  const menu = rivalMenu(state);
  const applied: string[] = [];
  const kinds = new Set<RivalOptionKind>();
  for (const id of [...new Set(picks)].slice(0, RIVAL_AI.picks)) {
    const o = menu.find((x) => x.id === id);
    // Una opción de cada tipo (dos obras sí: cada una tiene su sitio).
    if (!o || (o.kind !== 'obra' && kinds.has(o.kind))) continue;
    // Ronda 18: la segunda obra también deja la reserva en caja.
    if (o.kind === 'obra') {
      const b = o.cmds[0];
      if (b?.type === 'Build' && state.treasury < buildCostAt(state, b.kind, b.x, b.y) + RIVAL_AI.reserve) continue;
    }
    if (o.cmds.length && !o.cmds.every((c) => governmentCommand(state, c))) continue;
    kinds.add(o.kind);
    applied.push(o.id);
    if (o.kind !== 'nada') rivalAct(state, `El alcalde ${party.leaderName} decide: ${o.text.charAt(0).toLowerCase()}${o.text.slice(1)}`);
  }
  // Ronda 18: un discurso sin opciones vale como «no hacer nada especial».
  if (!applied.length && clean(discurso, RIVAL_AI.speechMax)) applied.push('nada:nada');
  if (!applied.length) return applied;
  p.rivalAiMonth = monthOf(state);
  const text = clean(discurso, RIVAL_AI.speechMax);
  const sent = [...state.citizens.map((c) => c.name), party.name, ...menu.map((o) => o.text), String(state.treasury)].join(' ');
  if (text && !inventedName(text, sent) && !inventedNumber(text, sent)) {
    party.speech = { tick: state.tick, text };
    rivalAct(state, `${party.leaderName}: «${text}»`);
  }
  syncLists(state);
  return applied;
}
