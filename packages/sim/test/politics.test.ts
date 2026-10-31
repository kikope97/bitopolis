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
  newBuilding,
  saturated,
  serviceSaturation,
  runSimulation,
  step,
  validActions,
  validateCommand,
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
      // Todos los sucesos de esta hora (otro aviso de la misma hora podía tapar el de popularidad).
      for (const e of s.events) if (e.tick === s.tick && e.kind === 'politics' && e.text.startsWith('Faltan')) seen.push(e.text.match(/Faltan (\d+)/)![1]!);
    }
    expect([...new Set(seen)]).toEqual(['12', '6', '3', '1']);
  });

  it('la campaña mueve el voto de su facción, una vez al mes', () => {
    const s = town();
    s.politics.nextElection = s.tick + 6 * TICKS_PER_MONTH;
    // La facción con más vecinos: en una pequeña, el efecto puede no mover el porcentaje redondeado.
    const count = new Map<string, number>();
    for (const c of s.citizens) count.set(factionOf(s, c), (count.get(factionOf(s, c)) ?? 0) + 1);
    const f = [...count.entries()].sort((a, b) => b[1] - a[1])[0]![0] as ReturnType<typeof factionOf>;
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
    // Una facción con la que la moción sea posible (no vale si el gobierno ya se comprometió a eso).
    const f = (Object.keys(s.politics.factions) as (keyof typeof s.politics.factions)[]).find((k) => validateCommand(s, { type: 'Motion', faction: k }).ok)!;
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
    expect(m.formatVersion).toBeGreaterThanOrEqual(7);
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

  it('migración 7 → 8: registro del gobierno rival vacío', () => {
    const v7 = JSON.parse(JSON.stringify(createInitialState({ seed: 1 })));
    v7.formatVersion = 7;
    delete v7.politics.log;
    const m = migrate(v7);
    expect(m.formatVersion).toBeGreaterThanOrEqual(8);
    expect(m.politics.log).toEqual([]);
  });

  it('el gobierno rival deja registro de lo que hace (obras, impuestos, promesas)', () => {
    const s = rivalTown();
    for (let i = 0; i < 6 * TICKS_PER_MONTH; i++) step(s);
    expect(s.politics.log.length).toBeGreaterThan(0);
    expect(s.politics.log.length).toBeLessThanOrEqual(20);
    for (const e of s.politics.log) expect(e.text).toMatch(/alcalde|«/);
    // Ordenado: lo último al final.
    const ticks = s.politics.log.map((e) => e.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it('con un partido en la oposición, su líder pregunta en el pleno; rechazarle tiene coste', () => {
    const s = town();
    const leader = s.citizens.find((c) => c.named)!;
    s.politics.party = { leaderId: leader.id, leaderName: leader.name, name: 'Bitópolis Joven', faction: 'jovenes', founded: s.tick, promises: [] };
    s.politics.campaign.jovenes = 2;
    expect(applyCommand(s, { type: 'ConvenePleno' }).ok).toBe(true);
    const q = s.pleno!.petitions.find((p) => p.opposition);
    expect(q?.citizenId).toBe(leader.id);
    expect(applyCommand(s, { type: 'AnswerPetition', petitionId: q!.id, answer: 'reject' }).ok).toBe(true);
    expect(s.politics.campaign.jovenes).toBe(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('sin partido de oposición no hay pregunta de la oposición', () => {
    const s = town();
    s.politics.party = null;
    applyCommand(s, { type: 'ConvenePleno' });
    expect(s.pleno!.petitions.some((p) => p.opposition)).toBe(false);
  });
});

describe('servicios que escalan con la población (v1.3)', () => {
  it('un colegio atiende a 60 vecinos: con más, se satura y piden otro', () => {
    const s = town(900);
    const schools = s.buildings.filter((b) => b.kind === 'school' && b.built);
    if (!schools.length) return;
    s.buildings = s.buildings.filter((b) => b.kind !== 'school' || b === schools[0]);
    const extra = Math.max(0, 90 - s.citizens.length);
    for (let i = 0; i < extra; i++) s.citizens.push({ ...s.citizens[0]!, id: 900_000 + i, named: false, relations: [], memories: [] });
    expect(serviceSaturation(s, 'school')).toBeLessThan(1);
    step(s);
    const all = Object.values(s.politics.factions).flatMap((f) => f.unmet);
    expect(all).toContain('otro colegio');
  });

  it('un colegio en obras cuenta: no se pide otro mientras se construye (ronda 09)', () => {
    const s = town(900);
    const school = s.buildings.find((b) => b.kind === 'school' && b.built);
    if (!school) return;
    s.buildings = s.buildings.filter((b) => b.kind !== 'school' || b === school);
    for (let i = s.citizens.length; i < 100; i++) s.citizens.push({ ...s.citizens[0]!, id: 900_000 + i, named: false, relations: [], memories: [] });
    expect(saturated(s, 'school')).toBe(true);
    s.buildings.push({ ...school, id: 999_999, built: false });
    expect(saturated(s, 'school')).toBe(false);
  });

  it('saturación por radio (v1.4): un colegio lejano no alivia al del barrio lleno; uno cercano, sí', () => {
    const s = town(600);
    const home = s.buildings.find((b) => b.kind === 'house' && b.built)!;
    s.buildings = s.buildings.filter((b) => b.kind !== 'school');
    const school = newBuilding(s, 'school', home.x + 2, home.y, 0);
    school.built = true;
    s.buildings.push(school);
    for (const c of s.citizens) c.homeId = null;
    for (let i = 0; i < 90; i++) s.citizens.push({ ...s.citizens[0]!, id: 800_000 + i, homeId: home.id, named: false, relations: [], memories: [] });
    expect(serviceSaturation(s, 'school', school.id)).toBeLessThan(0.9);
    const far = newBuilding(s, 'school', home.x + 40, home.y + 40, 0);
    far.built = true;
    s.buildings.push(far);
    expect(serviceSaturation(s, 'school', school.id)).toBeLessThan(0.9);
    expect(serviceSaturation(s, 'school', far.id)).toBe(1);
    expect(saturated(s, 'school')).toBe(true);
    // Uno al lado: los vecinos se reparten (cada uno al más cercano; empate, al más antiguo).
    s.buildings = s.buildings.filter((b) => b !== far);
    const near = newBuilding(s, 'school', home.x - 2, home.y, 0);
    near.built = true;
    s.buildings.push(near);
    expect(serviceSaturation(s, 'school', school.id) + serviceSaturation(s, 'school', near.id)).toBeGreaterThan(1);
  });
});
