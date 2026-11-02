/**
 * 2.6 (lo básico, petición del creador): el panel «Pueblo» y la bandeja
 * «Construir» crecen con el pueblo. Al principio, solo lo básico; cada cosa
 * aparece cuando toca y, la primera vez, con una marca «Nuevo» que se quita al
 * abrirla. Nada se borra: una partida avanzada ve lo que ya usaba.
 *
 * Lo que ya salió una vez se queda (preferencia del navegador, por partida),
 * aunque la condición deje de cumplirse.
 */
import {
  daysToElection,
  type GameState,
  LANDMARKS,
  plenoUnlocked,
  politicsActive,
  rankCandidates,
  simpleTown,
  TOWNHALL_LEVELS,
  townLevel,
} from '@bitopolis/sim';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, TICKS_PER_DAY } from '@bitopolis/shared';
import { type Tool, toolLevel, TOOLS, TRAY, unlockPop } from './tools.ts';

/** Entradas del panel «Pueblo» que aparecen con el tiempo (lo básico va siempre). */
export type HubEntry =
  | 'loans'
  | 'budget'
  | 'pleno'
  | 'politics'
  | 'advisor'
  | 'diary'
  | 'album'
  | 'history'
  | 'medals'
  | 'rank'
  | 'region'
  | 'neighbors'
  | 'errands'
  | 'press';

/** Caja «habitual»: la media de los últimos 6 cierres de mes (sin meses, la de ahora). */
function usualTreasury(state: GameState): number {
  const last = state.stats.slice(-6);
  return last.length ? last.reduce((a, s) => a + s.treasury, 0) / last.length : state.treasury;
}

/** Préstamos: con la caja en negativo, por debajo del 20 % de lo habitual o con un préstamo vivo. */
export function loansWanted(state: GameState): boolean {
  if ((state.loans ?? []).length > 0 || state.treasury < 0) return true;
  const usual = usualTreasury(state);
  return state.stats.length > 0 && usual > 0 && state.treasury < usual * 0.2;
}

/** Lo que el pueblo pide ver ahora (sin contar lo que ya salió antes). */
export function hubWants(state: GameState): Record<HubEntry, boolean> {
  const month = state.stats.length >= 1;
  const medal = (state.medals ?? []).length > 0;
  const simple = simpleTown(state);
  const level = townLevel(state);
  const budget = state.budget.status === 'open' || state.grants.length > 0 || state.associations.length > 0 || !!state.seasons?.current || state.tick >= DAYS_PER_YEAR * TICKS_PER_DAY;
  const errands = state.errands;
  return {
    loans: loansWanted(state),
    budget,
    // Con el ayuntamiento 2 se pueden convocar plenos (la hoja explica si aún faltan vecinos con nombre).
    pleno: plenoUnlocked(state) || !!state.pleno || state.lastPlenoTick >= 0,
    politics: politicsActive(state) || daysToElection(state) <= 12 * DAYS_PER_MONTH,
    // En Modo IA, desde el principio (el consejero habla con la IA: es la gracia de ese modo).
    advisor: month || state.aiMode,
    diary: month,
    album: month || medal,
    history: month || medal,
    medals: month || medal,
    rank: month || medal || !!rankCandidates(state),
    region: level >= 3 || !!state.bigCompany || state.landmarks.length > 0,
    neighbors: !simple && (level >= 3 || state.comarca.offers.length > 0),
    errands: !simple && !!errands && (errands.list.length > 0 || errands.done > 0 || errands.failed > 0),
    press: !simple && (state.press?.editions.length ?? 0) > 0,
  };
}

/** El 🗳 de arriba: desde `OPPOSITION_POP` vecinos o a un año de las elecciones. */
export function pollWanted(state: GameState): boolean {
  return politicsActive(state) || daysToElection(state) <= 12 * DAYS_PER_MONTH;
}

/* ---------------- bandeja «Construir» ---------------- */

/** Nivel que pide de verdad una herramienta (las grandes obras, el suyo; la densidad, con las zonas). */
function realLevel(tl: Tool): number {
  if (tl.landmark) return LANDMARKS.specs[tl.landmark].townhall;
  if (tl.density !== undefined) return Math.max(2, toolLevel(tl));
  return toolLevel(tl);
}
function realPop(tl: Tool): number {
  if (tl.landmark) return LANDMARKS.specs[tl.landmark].pop;
  return unlockPop(tl);
}

/**
 * ¿Se puede desbloquear con el SIGUIENTE nivel del ayuntamiento? (su nivel no
 * pasa del siguiente y sus vecinos, de los que pide ese nivel o los que ya hay).
 */
export function toolInReach(state: GameState, tl: Tool): boolean {
  const next = Math.min(TOWNHALL_LEVELS.length, townLevel(state) + 1);
  const popThen = Math.max(state.citizens.length, TOWNHALL_LEVELS[next - 1]?.pop ?? 0);
  return realLevel(tl) <= next && realPop(tl) <= popThen;
}

/** Categorías de la bandeja que se enseñan ahora (las que se alcanzan con el siguiente nivel). */
export function trayCatsWanted(state: GameState): string[] {
  return TRAY.filter((cat) => cat.tools.some((id) => toolInReach(state, TOOLS.find((x) => x.id === id)!))).map((c) => c.title);
}

/* ---------------- «Nuevo» (preferencia del navegador) ---------------- */

interface Stored {
  known: string[];
  fresh: string[];
}

/**
 * Lo que ya salió y lo que aún lleva «Nuevo». La primera vez (partida nueva en
 * este navegador, o una avanzada abierta aquí por primera vez) todo lo que se
 * ve entra como conocido, sin marca.
 */
export class Reveal {
  private known = new Set<string>();
  private fresh = new Set<string>();
  private ready = false;
  constructor(
    private readonly key: string,
    private readonly store: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  ) {
    try {
      const raw = this.store?.getItem(key);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Stored>;
        this.known = new Set(Array.isArray(s.known) ? s.known : []);
        this.fresh = new Set(Array.isArray(s.fresh) ? s.fresh : []);
        this.ready = true;
      }
    } catch {
      /* sin almacenamiento: todo sin marca */
    }
  }

  private save(): void {
    try {
      this.store?.setItem(this.key, JSON.stringify({ known: [...this.known], fresh: [...this.fresh] }));
    } catch {
      /* navegador sin almacenamiento */
    }
  }

  /** Lo que se ve ahora: lo nuevo entra con «Nuevo» (salvo la primera vez). */
  update(ids: Iterable<string>): void {
    let changed = !this.ready;
    for (const id of ids) {
      if (this.known.has(id)) continue;
      this.known.add(id);
      if (this.ready) this.fresh.add(id);
      changed = true;
    }
    this.ready = true;
    if (changed) this.save();
  }

  /** ¿Ha salido alguna vez? */
  shown(id: string): boolean {
    return this.known.has(id);
  }

  isNew(id: string): boolean {
    return this.fresh.has(id);
  }

  anyNew(prefix: string): boolean {
    for (const id of this.fresh) if (id.startsWith(prefix)) return true;
    return false;
  }

  /** Abierto: se quita «Nuevo». */
  seen(id: string): void {
    if (this.fresh.delete(id)) this.save();
  }
}
