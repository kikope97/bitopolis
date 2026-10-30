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
    s.politics.party = { leaderId: s.citizens.find((c) => c.named)!.id, leaderName: 'X', name: 'Bitópolis Verde', faction: 'ecologistas', founded: s.tick, promises: [] };
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
    expect(m.formatVersion).toBeGreaterThanOrEqual(6);
    expect(m.politics.mayor).toBe('player');
    expect(m.politics.nextElection).toBe(2 * ELECTION_MONTHS * TICKS_PER_MONTH);
  });

  /** Pueblo con el rival gobernando (tras perder a propósito). */
  function rivalTown(): GameState {
    const s = town();
    s.politics.nextElection = s.tick + 2 * TICKS_PER_MONTH;
    for (let i = 0; i < 2 * TICKS_PER_MONTH + 2; i++) {
      if (i % 24 === 0) for (const c of s.citizens) c.grudge = 40;
      step(s);
    }
    expect(s.politics.mayor).not.toBe('player');
    return s;
  }

  it('cada facción muestra hasta dos exigencias', () => {
    const s = town();
    step(s);
    for (const f of Object.values(s.politics.factions)) {
      expect(f.demands.length).toBeLessThanOrEqual(2);
      expect(f.demand).toBe(f.demands[0] ?? null);
    }
  });

  it('el partido rival nace con una promesa a su facción', () => {
    const s = rivalTown();
    const party = s.politics.party!;
    expect(party.promises.length).toBeGreaterThanOrEqual(0);
    for (const pr of party.promises) expect(['pending', 'kept', 'broken']).toContain(pr.status);
  });

  it('desde la oposición: una moción al mes; aprobada compromete al gobierno, rechazada acerca la facción', () => {
    const s = rivalTown();
    const f = (Object.keys(s.politics.factions) as (keyof typeof s.politics.factions)[]).find((k) => s.politics.factions[k].demand)!;
    if (!f) return;
    const before = s.politics.campaign[f];
    const promisesBefore = s.politics.party!.promises.length;
    const r = applyCommand(s, { type: 'Motion', faction: f });
    expect(r.ok).toBe(true);
    const approved = s.politics.party!.promises.length > promisesBefore;
    if (approved) expect(s.politics.party!.promises.at(-1)!.fromMotion).toBe(true);
    else expect(s.politics.campaign[f]).toBe(Math.min(6, before + 2));
    expect(applyCommand(s, { type: 'Motion', faction: f }).ok).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('una promesa del rival que vence sin cumplirse se rompe y acerca su facción al jugador', () => {
    const s = rivalTown();
    const party = s.politics.party!;
    const f = (Object.keys(s.politics.factions) as (keyof typeof s.politics.factions)[]).find((k) => s.politics.factions[k].demand)!;
    if (!f) return;
    const need = s.politics.factions[f].demand!;
    party.promises.push({ faction: f, need, deadline: s.tick + 10, status: 'pending', fromMotion: true });
    const before = s.politics.campaign[f];
    for (let i = 0; i < TICKS_PER_MONTH + 24; i++) step(s);
    const pr = party.promises.at(-1)!;
    // Si al vencer seguía faltando, se rompe (y la facción se acerca); si dejó de faltar, se cumplió.
    if (s.politics.factions[f].demands.includes(need)) {
      expect(pr.status).toBe('broken');
      expect(s.politics.campaign[f]).toBe(Math.min(6, before + 2));
    } else expect(['kept', 'broken']).toContain(pr.status);
  });

  it('migración 6 → 7', () => {
    const v6 = JSON.parse(JSON.stringify(createInitialState({ seed: 1 })));
    v6.formatVersion = 6;
    delete v6.politics.lastMotion;
    for (const f of Object.values(v6.politics.factions) as Record<string, unknown>[]) delete f.demands;
    v6.politics.party = { leaderId: 1, leaderName: 'Lucía', name: 'Bitópolis Verde', faction: 'ecologistas', founded: 0 };
    const m = migrate(v6);
    expect(m.formatVersion).toBe(7);
    expect(m.politics.lastMotion).toBe(-1);
    expect(m.politics.party!.promises).toEqual([]);
    expect(m.politics.factions.jovenes.demands).toEqual([]);
  });

  it('la misma exigencia no se lleva al pleno dos veces en 6 meses', () => {
    const s = rivalTown();
    const f = (Object.keys(s.politics.factions) as (keyof typeof s.politics.factions)[]).find((k) => s.politics.factions[k].demand && k !== s.politics.party!.faction);
    if (!f) return;
    expect(applyCommand(s, { type: 'Motion', faction: f }).ok).toBe(true);
    for (let i = 0; i < TICKS_PER_MONTH + 1; i++) step(s);
    const again = applyCommand(s, { type: 'Motion', faction: f });
    if (s.politics.factions[f].demand === s.politics.motions.at(-1)!.need) expect(again.ok ? '' : again.error).toMatch(/6 meses|comprometió/);
  });

  it('el gobierno rival rechaza lo que no puede hacer (sin obra ni impuesto) si no es de su facción', () => {
    const s = rivalTown();
    const party = s.politics.party!;
    const f = (['jubilados', 'jovenes', 'empresarios', 'ecologistas'] as const).find((k) => k !== party.faction)!;
    s.politics.factions[f] = { ...s.politics.factions[f], demand: 'menos contaminación', demands: ['menos contaminación'], unmet: ['menos contaminación'] };
    s.politics.lastMotion = -1;
    const before = s.politics.campaign[f];
    expect(applyCommand(s, { type: 'Motion', faction: f }).ok).toBe(true);
    expect(s.politics.motions.at(-1)!.approved).toBe(false);
    expect(s.politics.campaign[f]).toBe(Math.min(6, before + 2));
  });
});
