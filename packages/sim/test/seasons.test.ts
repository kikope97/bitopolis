import { TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  availableActs,
  buildingAt,
  checkInvariants,
  type FestivalSeason,
  type GameState,
  newBuilding,
  OUTSIDE,
  parseTurn,
  programCost,
  runSimulation,
  SEASONS,
  step,
  terrainAt,
  transfer,
  TREASURY,
  turnMenu,
  validateCommand,
} from '../src/index.ts';

/** Pueblo de abril del año 1 (día 101) con caja de sobra. */
function town(opts: { aiMode?: boolean } = {}): GameState {
  const { state } = runSimulation({ seed: 2, days: 100, profile: 'constructor', ...(opts.aiMode ? { aiMode: true, aiShare: 100 } : {}) });
  transfer(state, OUTSIDE, TREASURY, 30_000, 'subvencion');
  return state;
}

/** Ermita ya construida en una casilla libre (para la romería y la procesión). */
function addChapel(s: GameState): void {
  for (let y = 2; y < s.map.h - 2; y++)
    for (let x = 2; x < s.map.w - 2; x++) {
      if (buildingAt(s, x, y) || terrainAt(s, x, y) !== 0 || s.map.tiles[y * s.map.w + x] !== 0) continue;
      const b = newBuilding(s, 'chapel', x, y, 0);
      b.built = true;
      return;
    }
}

/** Avanza día a día hasta que se cumpla `until` (o pasen `days`), anotando cuándo se celebra cada fiesta. */
function run(s: GameState, days: number, until?: (s: GameState) => boolean): { season: FestivalSeason; month: number; day: number }[] {
  const out: { season: FestivalSeason; month: number; day: number }[] = [];
  for (let i = 0; i < days * TICKS_PER_DAY; i++) {
    const before = s.seasons.current?.status;
    step(s);
    const f = s.seasons.current;
    if (f && f.status === 'celebrada' && before !== 'celebrada') {
      const d = tickToDate(s.tick);
      out.push({ season: f.season, month: d.month, day: d.day });
    }
    if (until?.(s)) break;
  }
  return out;
}

const waiting = (s: GameState) => s.seasons.current?.status === 'comision' && !!s.seasons.current.asked;

describe('fiestas de temporada (2.4, bloque E)', () => {
  it('cada fiesta se celebra en su mes y su día, y ninguna fuera', () => {
    const s = town();
    addChapel(s);
    const held = run(s, 260);
    expect(held.map((h) => h.season)).toEqual(['romeria', 'sanjuan', 'patronales', 'navidad']);
    for (const h of held) {
      expect(h.month).toBe(SEASONS.month[h.season]);
      expect(h.day).toBe(SEASONS.day[h.season]);
    }
    // Las patronales de la comisión cuentan como las fiestas del año (no hay populares en septiembre).
    expect(s.festival.year).toBe(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('sin ermita no hay romería (ni procesión en el programa)', () => {
    const s = town();
    s.buildings = s.buildings.filter((b) => b.kind !== 'chapel');
    const held = run(s, 75);
    expect(held.map((h) => h.season)).toEqual(['sanjuan']);
    expect(s.seasons.held.romeria).toBeUndefined();
    expect(availableActs(s, 'patronales')).not.toContain('procesion');
  });

  it('comisión por reglas: los más sociables, programa de 2–3 actos y San Juan con hoguera', () => {
    const s = town();
    run(s, 60, (x) => x.seasons.current?.season === 'sanjuan' && waiting(x));
    const f = s.seasons.current!;
    expect(f.season).toBe('sanjuan');
    expect(f.committee).toHaveLength(SEASONS.committee);
    const named = s.citizens.filter((c) => c.named).sort((a, b) => b.traits.social - a.traits.social || a.id - b.id);
    expect(f.committee).toEqual(named.slice(0, 3).map((c) => c.id));
    expect(f.program.length).toBeGreaterThanOrEqual(2);
    expect(f.program.length).toBeLessThanOrEqual(3);
    expect(f.program).toContain('hoguera');
    expect(f.programBy).toBe('reglas');
    // Solo se aprueba la fiesta que espera.
    expect(validateCommand(s, { type: 'ApproveFestival', season: 'navidad', budget: 'todo' }).ok).toBe(false);
  });

  it('presupuesto «poco»: el ayuntamiento paga la mitad, la comisión recauda el resto y el dinero cuadra', () => {
    const s = town();
    run(s, 60, (x) => x.seasons.current?.season === 'sanjuan' && waiting(x));
    expect(applyCommand(s, { type: 'ApproveFestival', season: 'sanjuan', budget: 'poco' }).ok).toBe(true);
    const named = s.citizens.filter((c) => c.named);
    const pockets = named.reduce((t, c) => t + c.money, 0);
    run(s, 40, (x) => x.seasons.current?.status === 'celebrada');
    const f = s.seasons.current!;
    expect(f.status).toBe('celebrada');
    expect(f.paid!.town + f.paid!.collected).toBe(programCost('sanjuan', f.held!));
    expect(f.paid!.collected).toBeLessThanOrEqual(named.length * SEASONS.collectPerNamed);
    expect(f.paid!.town).toBe(Math.round(programCost('sanjuan', f.held!) * 0.5));
    expect(pockets).toBeGreaterThan(0);
    expect(f.mood).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('presupuesto «nada»: fiesta reducida a lo recaudado y la comisión se lo guarda', () => {
    const s = town();
    run(s, 60, (x) => x.seasons.current?.season === 'sanjuan' && waiting(x));
    const f = s.seasons.current!;
    const grudge = new Map(f.committee.map((id) => [id, s.citizens.find((c) => c.id === id)!.grudge]));
    expect(applyCommand(s, { type: 'ApproveFestival', season: 'sanjuan', budget: 'nada' }).ok).toBe(true);
    run(s, 40, (x) => x.seasons.current?.status === 'celebrada');
    expect(f.paid!.town).toBe(0);
    expect(f.held!.length).toBeLessThanOrEqual(f.program.length);
    for (const id of grudge.keys()) {
      const c = s.citizens.find((x) => x.id === id);
      if (c) expect(c.grudge).toBeGreaterThanOrEqual(SEASONS.nadaGrudge);
    }
    expect(checkInvariants(s)).toEqual([]);
  });

  it('sin respuesta del alcalde, la comisión hace lo que puede sin rencor', () => {
    const s = town();
    run(s, 60, (x) => x.seasons.current?.season === 'sanjuan' && waiting(x));
    run(s, 40, (x) => x.seasons.current?.status === 'celebrada');
    const f = s.seasons.current!;
    expect(f.status).toBe('celebrada');
    expect(f.silent).toBe(true);
    expect(f.budget).toBe('nada');
    expect(f.paid!.town).toBe(0);
  });

  it('Modo IA: un vecino se apunta en su turno, encabeza la comisión y elige el programa', () => {
    const s = town({ aiMode: true });
    run(s, 80, (x) => x.seasons.current?.season === 'sanjuan' && x.seasons.current.status === 'comision' && !x.seasons.current.asked && !!x.ai?.turn);
    const f = s.seasons.current!;
    expect(f.season).toBe('sanjuan');
    expect(f.committee).toEqual([]);
    const t = s.ai!.turn!;
    const c = s.citizens.find((x) => t.ids.includes(x.id) && turnMenu(s, x).some((m) => m.accion === 'apuntarse_comision'))!;
    expect(c).toBeTruthy();
    // El menú lo lleva al final.
    expect(turnMenu(s, c).at(-1)!.accion).toBe('apuntarse_comision');
    const act = { vecino: c.id, accion: 'apuntarse_comision', gesto: { con: 0, tipo: 'ninguno' }, actitud: 0, gasto: { donde: 'pueblo', tienda: 0, ocio: false }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: '', motivo: '', programa: ['fuegos', 'verbena', 'belen_viviente'] };
    expect(applyCommand(s, { type: 'TownTurn', n: t.n, acts: [act] }).ok).toBe(true);
    expect(f.committee[0]).toBe(c.id);
    // El belén no es de San Juan y la hoguera va siempre.
    expect(f.program).toEqual(['hoguera', 'fuegos', 'verbena']);
    expect(f.programBy).toBe('ia');
    // Al cerrar el plazo, las reglas completan la comisión sin tocar el programa.
    run(s, 30, waiting);
    expect(f.committee).toHaveLength(SEASONS.committee);
    expect(f.committee[0]).toBe(c.id);
    expect(f.program).toEqual(['hoguera', 'fuegos', 'verbena']);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('parseTurn solo deja pasar actos que se enviaron', () => {
    const raw = JSON.stringify({
      decisiones: [{ vecino: 1, accion: 'seguir', gesto: { con: 0, tipo: 'ninguno' }, actitud: 0, gasto: { donde: 'pueblo', tienda: 0, ocio: false }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: '', motivo: '', programa: ['verbena', 'verbena', 'toros', 'fuegos'] }],
    });
    const r = parseTurn(raw, [1], '"actos_posibles":["hoguera","verbena","fuegos"]');
    expect(r.acts[0]!.programa).toEqual(['verbena', 'fuegos']);
  });
});
