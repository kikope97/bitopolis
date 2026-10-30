import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  checkInvariants,
  createInitialState,
  ELECTION_MONTHS,
  factionOf,
  type GameState,
  hashState,
  migrate,
  playerApproval,
  runSimulation,
  step,
  validActions,
} from '../src/index.ts';

function town(days = 420): GameState {
  return runSimulation({ seed: 1, days, profile: 'constructor' }).state;
}

/** Avanza hasta justo después de las próximas elecciones. */
function toElection(s: GameState) {
  const target = s.politics.nextElection;
  while (s.tick <= target) step(s);
}

describe('elecciones (v1.0)', () => {
  it('cada 4 años; sin rival sigues de alcalde', () => {
    const s = createInitialState({ seed: 3 });
    expect(s.politics.nextElection).toBe(ELECTION_MONTHS * TICKS_PER_MONTH);
    toElection(s);
    expect(s.politics.history).toHaveLength(1);
    expect(s.politics.history[0]!.unopposed).toBe(true);
    expect(s.politics.mayor).toBe('player');
    expect(s.politics.nextElection).toBe(2 * ELECTION_MONTHS * TICKS_PER_MONTH);
  });

  it('con la intención de voto baja nace un partido y, si pierdes, pasas a la oposición', () => {
    const s = town();
    // Pueblo muy descontento (rencor máximo) a dos meses de votar.
    s.politics.nextElection = s.tick + 2 * TICKS_PER_MONTH;
    for (let i = 0; i < 2 * TICKS_PER_MONTH + 2; i++) {
      if (i % 24 === 0) for (const c of s.citizens) c.grudge = 40;
      step(s);
    }
    const h = s.politics.history.at(-1)!;
    expect(h.unopposed).toBe(false);
    expect(h.winner).toBe('rival');
    expect(s.politics.mayor).not.toBe('player');
    // En la oposición no se puede gobernar, pero sí hablar y hacer campaña.
    const build = applyCommand(s, { type: 'SetTax', level: 'low' });
    expect(build.ok).toBe(false);
    expect(build.ok ? '' : build.error).toMatch(/oposición/);
    const named = s.citizens.find((c) => c.named)!;
    expect(applyCommand(s, { type: 'TalkTo', citizenId: named.id, question: 'me_votarias' }).ok).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('antes de votar, los vecinos con nombre deciden su voto entre opciones cerradas', () => {
    const s = town();
    const c = s.citizens.find((x) => x.named)!;
    expect(validActions(s, c, 'elecciones')).toEqual(['votar_gobierno', 'votar_oposicion', 'abstenerse']);
  });

  it('avisos de popularidad a 12, 6, 3 y 1 meses', () => {
    const s = town();
    s.politics.party = { leaderId: s.citizens.find((c) => c.named)!.id, leaderName: 'X', name: 'Bitópolis Verde', faction: 'ecologistas', founded: s.tick };
    s.politics.nextElection = s.tick + 13 * TICKS_PER_MONTH;
    const seen: string[] = [];
    for (let i = 0; i < 13 * TICKS_PER_MONTH - 24; i++) {
      step(s);
      const e = s.events.at(-1);
      if (e && e.tick === s.tick && e.kind === 'politics' && e.text.startsWith('Faltan')) seen.push(e.text.match(/Faltan (\d+)/)![1]!);
    }
    expect([...new Set(seen)]).toEqual(['12', '6', '3', '1']);
  });

  it('la campaña mueve el voto de su facción, una vez al mes', () => {
    const s = town();
    s.politics.nextElection = s.tick + 6 * TICKS_PER_MONTH;
    const f = factionOf(s, s.citizens[0]!);
    const before = playerApproval(s);
    expect(applyCommand(s, { type: 'Campaign', faction: f }).ok).toBe(true);
    expect(applyCommand(s, { type: 'Campaign', faction: f }).ok).toBe(false);
    expect(playerApproval(s)).toBeGreaterThan(before);
  });

  it('determinista con la misma semilla (también en la oposición)', { timeout: 60_000 }, () => {
    const a = runSimulation({ seed: 42, days: 1500, profile: 'agresivo' });
    const b = runSimulation({ seed: 42, days: 1500, profile: 'agresivo' });
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.report.invariantErrors).toEqual([]);
  });

  it('migración 5 → 6', () => {
    const v5 = JSON.parse(JSON.stringify(createInitialState({ seed: 1 })));
    v5.formatVersion = 5;
    v5.tick = ELECTION_MONTHS * TICKS_PER_MONTH + 10;
    delete v5.politics;
    const m = migrate(v5);
    expect(m.formatVersion).toBe(6);
    expect(m.politics.mayor).toBe('player');
    expect(m.politics.nextElection).toBe(2 * ELECTION_MONTHS * TICKS_PER_MONTH);
  });
});
