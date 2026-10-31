import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import {
  applyCommand,
  baseCrest,
  checkInvariants,
  createInitialState,
  diary,
  diaryRepeats,
  FORMAT_VERSION,
  type GameState,
  migrate,
  migrate14Rank,
  nextRank,
  rankCandidates,
  rankDay,
  rankFor,
  RANKS,
  runSimulation,
  seasonOf,
  step,
  validateCommand,
} from '../src/index.ts';

/** Pueblo con `pop` vecinos y el ayuntamiento al nivel pedido (sin pasar por la obra). */
function townWith(pop: number, hall: number, aiMode = false): GameState {
  const s = createInitialState({ seed: 11, aiMode });
  const first = s.citizens[0]!;
  for (let i = 1; i < pop; i++) s.citizens.push({ ...structuredClone(first), id: 5000 + i, name: `Vecino ${i}`, age: 20 + ((i * 7) % 60), named: i < 8 });
  s.townhallLevel = hall;
  return s;
}

describe('rangos del pueblo (2.1)', () => {
  it('empieza de aldea, con escudo del terreno y sin votación', () => {
    const s = createInitialState({ seed: 4 });
    expect(s.rank?.level).toBe(0);
    expect(s.rank?.crest.pieces).toHaveLength(1);
    expect(s.rank?.vote).toBeNull();
    expect(nextRank(s)?.name).toBe('Lugar');
  });

  it('el rango pide vecinos y nivel del ayuntamiento a la vez', () => {
    expect(rankFor(townWith(RANKS[2].pop, 2))).toBe(1);
    expect(rankFor(townWith(RANKS[2].pop, 3))).toBe(2);
    expect(rankFor(townWith(5, 5))).toBe(0);
    expect(rankFor(townWith(RANKS[4].pop, 5))).toBe(4);
  });

  it('al subir, evento grande, postal y escudo votado por reglas en Modo normal', () => {
    const s = townWith(RANKS[1].pop, 2);
    rankDay(s);
    expect(s.rank!.level).toBe(1);
    expect(s.events.some((e) => e.kind === 'milestone' && e.text.startsWith('¡Bitópolis ya es lugar'))).toBe(true);
    // Modo normal: ya ha votado el pueblo (pieza nueva y lema).
    expect(s.rank!.vote).toBeNull();
    expect(s.rank!.crest.pieces).toHaveLength(2);
    expect(s.rank!.crest.motto).not.toBeNull();
    expect(s.events.some((e) => e.text.startsWith('El escudo estrena'))).toBe(true);
    // No se baja aunque se vaya gente; no se repite la fiesta.
    s.citizens.splice(3);
    const n = s.events.length;
    rankDay(s);
    expect(s.rank!.level).toBe(1);
    expect(s.events.length).toBe(n);
  });

  it('sube de uno en uno: cada rango tiene su votación', () => {
    const s = townWith(RANKS[3].pop, 4);
    for (let i = 0; i < 5; i++) rankDay(s);
    expect(s.rank!.level).toBe(3);
    expect(s.rank!.crest.pieces).toHaveLength(4);
    expect(new Set(s.rank!.crest.pieces).size).toBe(4);
  });

  it('el escudo es determinista (misma semilla, mismo escudo)', () => {
    const a = townWith(RANKS[2].pop, 3);
    const b = townWith(RANKS[2].pop, 3);
    for (let i = 0; i < 3; i++) {
      rankDay(a);
      rankDay(b);
    }
    expect(a.rank).toEqual(b.rank);
    expect(baseCrest(7, [0, 1, 3])).toEqual(baseCrest(7, [0, 1, 3]));
  });

  it('Modo IA: la votación queda abierta con un menú cerrado y la IA vota con ChooseCrest', () => {
    const s = townWith(RANKS[1].pop, 2, true);
    rankDay(s);
    const menu = rankCandidates(s);
    expect(menu).not.toBeNull();
    expect(menu!.piezas.length).toBeGreaterThan(0);
    expect(menu!.lemas.length).toBeGreaterThan(0);
    const ai = s.citizens.filter((c) => c.named);
    // Un voto fuera del menú no vale.
    expect(validateCommand(s, { type: 'ChooseCrest', votes: [{ vecino: ai[0]!.id, pieza: 'dragon', lema: menu!.lemas[0]!.id }] }).ok).toBe(false);
    // Un vecino sin IA tampoco.
    const plain = s.citizens.find((c) => !c.named)!;
    expect(validateCommand(s, { type: 'ChooseCrest', votes: [{ vecino: plain.id, pieza: menu!.piezas[0]!.id, lema: menu!.lemas[0]!.id }] }).ok).toBe(false);
    // Todos los vecinos con IA votan la última pieza del menú; el resto, por reglas.
    const pick = menu!.piezas.at(-1)!.id;
    const lema = menu!.lemas.at(-1)!.id;
    const votes = s.citizens.map((c) => ({ vecino: c.id, pieza: pick, lema }));
    // Que todos piensen con IA para que gane su voto.
    for (const c of s.citizens) c.named = true;
    expect(applyCommand(s, { type: 'ChooseCrest', votes }).ok).toBe(true);
    expect(s.rank!.crest.pieces.at(-1)).toBe(pick);
    expect(s.rank!.crest.motto).toBe(lema);
    expect(rankCandidates(s)).toBeNull();
  });

  it('Modo IA sin votos: al vencer, deciden las reglas', () => {
    const s = townWith(RANKS[1].pop, 2, true);
    rankDay(s);
    const due = s.rank!.vote!.due;
    s.tick = due;
    rankDay(s);
    expect(s.rank!.vote).toBeNull();
    expect(s.rank!.crest.pieces).toHaveLength(2);
  });

  it('en una partida larga se sube de rango y el dinero se conserva', () => {
    const { state } = runSimulation({ seed: 42, days: 720, profile: 'constructor' });
    expect(state.rank!.level).toBeGreaterThanOrEqual(1);
    expect(state.album.some((m) => m.kind.startsWith('rango_'))).toBe(true);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('migración 13→14: un pueblo de antes recibe el rango que ya tiene, sin fanfarria', () => {
    const s = townWith(RANKS[2].pop, 3);
    const old = { ...structuredClone(s), formatVersion: 13 } as Record<string, unknown>;
    delete old.rank;
    const m = migrate(old);
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    expect(m.rank!.level).toBe(2);
    expect(m.rank!.vote).toBeNull();
    // Idempotente: si ya lo tenía, no lo toca.
    expect(migrate14Rank({ rank: m.rank }).rank).toBe(m.rank);
    // Y al día siguiente no celebra lo que ya tenía.
    const n = m.events.length;
    rankDay(m);
    expect(m.events.length).toBe(n);
  });
});

describe('diario sin repeticiones (2.1)', () => {
  it('la misma noticia de un vecino sale una vez por estación, con cuántas veces', () => {
    const s = createInitialState({ seed: 3 });
    const id = s.citizens[0]!.id;
    s.events = [];
    // 15 días seguidos de primavera (mes 3) con la misma noticia y motivos distintos.
    for (let d = 0; d < 15; d++) s.events.push({ tick: (60 + d) * TICKS_PER_DAY, kind: 'decision', text: `Lucía pide más trabajo: «motivo ${d}»`, ref: id });
    // Y otra en verano (mes 6): esa sí sale.
    s.events.push({ tick: 160 * TICKS_PER_DAY, kind: 'decision', text: 'Lucía pide más trabajo: «otra vez»', ref: id });
    const lines = diary(s, 99).flatMap((e) => e.lines);
    const lucia = lines.filter((l) => l.startsWith('Lucía pide más trabajo'));
    expect(lucia).toHaveLength(2);
    expect(lucia).toContain('Lucía pide más trabajo (15 veces en primavera)');
    expect(lucia).toContain('Lucía pide más trabajo: «otra vez»');
    expect(diaryRepeats(s.events).size).toBe(2);
  });

  it('«X se queda» no se repite en la misma estación (ni en el registro de sucesos)', () => {
    const { state } = runSimulation({ seed: 42, days: 360, profile: 'casual' });
    const seen = new Map<string, number>();
    for (const day of diary(state, 999)) {
      for (const l of day.lines) {
        const m = /^(\S+ \S*) ?se queda[:(]/.exec(l);
        if (m) seen.set(l, (seen.get(l) ?? 0) + 1);
      }
    }
    for (const n of seen.values()) expect(n).toBe(1);
    // En el registro: como mucho una «se queda» por vecino y estación.
    const season = (t: number) => {
      const d = tickToDate(t);
      return `${d.month === 12 ? d.year + 1 : d.year}${seasonOf(d.month)}`;
    };
    const keys = state.events.filter((e) => e.kind === 'decision' && / se queda: /.test(e.text)).map((e) => `${e.ref}|${season(e.tick)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('las partidas siguen deterministas con los rangos', () => {
    const a = createInitialState({ seed: 9 });
    const b = createInitialState({ seed: 9 });
    for (let i = 0; i < 24 * 40; i++) {
      step(a);
      step(b);
    }
    expect(a.rank).toEqual(b.rank);
  });
});
