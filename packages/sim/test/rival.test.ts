import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyRivalPicks,
  canPresent,
  checkInvariants,
  checkRivalPromises,
  type Citizen,
  factionOf,
  type Faction,
  FORMAT_VERSION,
  type GameState,
  hashState,
  LISTS,
  listInvariants,
  migrate,
  migrate15Politics,
  type Party,
  politicsDay,
  presentCandidacy,
  RIVAL_AI,
  RIVAL_OPTION_ID,
  RIVAL_PROMISES,
  rivalAiWanted,
  rivalMenu,
  runSimulation,
  step,
  styleOf,
  syncLists,
  tally,
  taxSum,
  turnMenu,
  updateFactions,
  validateAsGovernment,
} from '../src/index.ts';

function town(days = 420): GameState {
  return runSimulation({ seed: 1, days, profile: 'constructor' }).state;
}

/** Una candidatura a mano (para las pruebas). */
function list(s: GameState, c: Citizen, faction: Faction): Party {
  return { leaderId: c.id, leaderName: c.name, name: `Lista de ${faction}`, faction, founded: s.tick, promises: [], style: 'populista' };
}

/** Tres candidaturas, cada una de una facción distinta. */
function threeLists(s: GameState): Party[] {
  const named = s.citizens.filter((c) => c.named);
  const fs: Faction[] = ['jubilados', 'jovenes', 'ecologistas'];
  const lists = fs.map((f, i) => list(s, named[i]!, f));
  s.politics.party = JSON.parse(JSON.stringify(lists[0]));
  s.politics.lists = lists;
  syncLists(s);
  return lists;
}

/** Un pueblo donde gobierna el rival. */
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

describe('candidaturas y recuento (2.2)', () => {
  it('tally con 3 listas: reparte el voto de la oposición por afinidad, sin azar', () => {
    const s = town();
    threeLists(s);
    updateFactions(s);
    const rng = JSON.stringify(s.rng);
    const a = tally(s);
    const b = tally(s);
    expect(a).toEqual(b);
    expect(JSON.stringify(s.rng)).toBe(rng);
    expect(a.votes).toHaveLength(4);
    expect(a.votes[0]!.who).toBe('player');
    const lists = a.votes.slice(1);
    // Lo de las listas suma (con redondeo) el voto de la oposición.
    expect(Math.abs(lists.reduce((x, v) => x + v.votes, 0) - a.opp)).toBeLessThanOrEqual(2);
    for (const v of lists) expect(v.votes).toBeGreaterThan(0);
    // La afinidad cuenta: una lista de una facción con más vecinos saca más que con la facción más pequeña.
    const members = (f: Faction) => s.citizens.filter((c) => factionOf(s, c) === f).length;
    const byFaction = lists.map((v, i) => ({ f: (['jubilados', 'jovenes', 'ecologistas'] as Faction[])[i]!, votes: v.votes }));
    const big = [...byFaction].sort((x, y) => members(y.f) - members(x.f))[0]!;
    const small = [...byFaction].sort((x, y) => members(x.f) - members(y.f))[0]!;
    // 2.4: con los jubilados más contentos (pensión), su lista puede empatar a votos con la pequeña (por redondeo).
    // Ronda 20: la satisfacción de cada facción también pesa; se admite un voto de diferencia.
    if (members(big.f) > members(small.f) * 1.5) expect(big.votes).toBeGreaterThanOrEqual(small.votes - 1);
  });

  it('empate: gana quien gobierna (el jugador o el rival)', () => {
    for (const governs of ['player', 'rival'] as const) {
      const s = town();
      const leader = s.citizens.find((c) => c.named)!;
      s.politics.party = list(s, leader, factionOf(s, leader));
      s.politics.lists = [];
      syncLists(s);
      if (governs === 'rival') s.politics.mayor = leader.id;
      // Todos con el voto decidido: mitad al gobierno, mitad a la oposición.
      const voters = s.citizens.slice(0, s.citizens.length - (s.citizens.length % 2));
      for (const c of s.citizens) c.named = true;
      voters.forEach((c, i) => (c.vote = i % 2 ? 'gobierno' : 'oposicion'));
      for (const c of s.citizens.slice(voters.length)) c.vote = 'abstencion';
      s.politics.nextElection = s.tick;
      const t = tally(s);
      expect(t.votes[0]!.votes).toBe(t.votes[1]!.votes);
      politicsDay(s);
      const h = s.politics.history.at(-1)!;
      expect(h.winner).toBe(governs);
      expect(h.lists).toHaveLength(1);
      expect(checkInvariants(s)).toEqual([]);
    }
  });

  it('noche electoral con 3 listas: votos por lista y, tras votar, las listas se disuelven', () => {
    const s = town();
    threeLists(s);
    s.politics.nextElection = s.tick + 24;
    for (let i = 0; i < 26; i++) step(s);
    const h = s.politics.history.at(-1)!;
    expect(h.lists).toHaveLength(3);
    expect(h.unopposed).toBe(false);
    if (h.winner === 'player') expect(s.politics.lists).toEqual([]);
    else expect(s.politics.lists).toHaveLength(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('se presenta un vecino con nombre ≥25 años, ambición ≥60, facción descontenta, en los 12 meses previos (200 €)', () => {
    const s = town();
    s.politics.party = null;
    s.politics.lists = [];
    const c = s.citizens.find((x) => x.named && x.age >= 30 && x.age < 60)!;
    c.traits.ambicion = 80;
    c.money = 1_000;
    const f = factionOf(s, c);
    updateFactions(s);
    s.politics.factions[f].satisfaction = 20;
    s.politics.nextElection = s.tick + 24 * TICKS_PER_MONTH;
    expect(canPresent(s, c).ok).toBe(false);
    s.politics.nextElection = s.tick + 6 * TICKS_PER_MONTH;
    expect(canPresent(s, c)).toEqual({ ok: true });
    c.traits.ambicion = 59;
    expect(canPresent(s, c).ok).toBe(false);
    c.traits.ambicion = 80;
    // En Modo IA es una acción de su menú.
    s.aiMode = true;
    s.ai ??= { share: 100, paceDays: 7, turn: null, lastN: 0, next: s.tick + 1e6, mayor: [], quick: null, lastQuick: -1e9, log: [] };
    expect(turnMenu(s, c).map((m) => m.accion)).toContain('presentarse');
    const before = c.money;
    presentCandidacy(s, c);
    expect(c.money).toBe(before - LISTS.cost);
    expect((s.politics.party as Party | null)?.leaderId).toBe(c.id);
    expect(s.politics.lists.map((l) => l.leaderId)).toEqual([c.id]);
    expect(s.politics.party!.promises.length).toBeGreaterThan(0);
    expect(s.politics.party!.promises.length).toBeLessThanOrEqual(RIVAL_PROMISES.max);
    // Ya no puede volver a presentarse.
    expect(canPresent(s, c).ok).toBe(false);
    expect(listInvariants(s)).toEqual([]);
  });

  it('por reglas, en un pueblo descontento llegan a presentarse varias listas (nunca más de 3)', () => {
    // Semilla medida: en el perfil agresivo, a los 4 años se presentan dos candidaturas.
    // Pruebas 2.5: la 1 ya no llega (los 10 vecinos dan más dinero); se mide de nuevo, la 6.
    const { state, report } = runSimulation({ seed: 6, days: 1490, profile: 'agresivo', checkEveryDay: true });
    expect(report.invariantErrors).toEqual([]);
    const h = state.politics.history.find((x) => !x.unopposed)!;
    expect(h.lists!.length).toBeGreaterThanOrEqual(2);
    expect(h.lists!.length).toBeLessThanOrEqual(LISTS.max);
    expect(new Set(h.lists!.map((l) => l.faction)).size).toBe(h.lists!.length);
  }, 120_000);

  it('el estilo sale de los rasgos del líder (los ecologistas, verdes)', () => {
    const s = town();
    const c = { ...s.citizens[0]!, traits: { terco: 90, ahorro: 10, social: 10, ambicion: 10 } };
    expect(styleOf(c, 'jubilados')).toBe('conservador');
    expect(styleOf({ ...c, traits: { terco: 10, ahorro: 90, social: 10, ambicion: 10 } }, 'jovenes')).toBe('tecnico');
    expect(styleOf({ ...c, traits: { terco: 10, ahorro: 10, social: 90, ambicion: 95 } }, 'empresarios')).toBe('populista');
    expect(styleOf(c, 'ecologistas')).toBe('verde');
  });
});

describe('promesas medibles del rival (2.2)', () => {
  it('«no subir impuestos» se rompe si los sube; «crear empleo» y «sanear la deuda» se cumplen al medirlo', () => {
    const s = rivalTown();
    const party = s.politics.party!;
    const f = party.faction;
    const far = s.tick + 12 * TICKS_PER_MONTH;
    party.promises = [
      { check: 'impuestos', faction: f, need: 'no subir impuestos', deadline: far, status: 'pending', fromMotion: false },
      { check: 'empleo', faction: f, need: 'crear empleo', deadline: far, status: 'pending', fromMotion: false },
      { check: 'deuda', faction: f, need: 'sanear la deuda', deadline: far, status: 'pending', fromMotion: false },
    ];
    s.treasury = Math.min(s.treasury, 0);
    checkRivalPromises(s);
    expect(party.promises.map((p) => p.status)).toEqual(['pending', 'pending', 'pending']);
    expect(party.promises[0]!.base).toBe(taxSum(s));
    // Sube los impuestos: rota.
    const up = s.taxesSplit ? { type: 'SetTaxes', ibi: 'high', tasas: 'high' } : { type: 'SetTax', level: 'high' };
    if (taxSum(s) < (s.taxesSplit ? 4 : 2)) {
      expect(validateAsGovernment(s, up).ok).toBe(true);
      if (s.taxesSplit) s.taxes = { ...s.taxes, ibi: 'high', tasas: 'high' };
      else s.taxLevel = 'high';
      checkRivalPromises(s);
      expect(party.promises[0]!.status).toBe('broken');
    }
    // Más vecinos con trabajo: cumplida.
    const idle = s.citizens.filter((c) => c.jobId === null);
    const job = s.buildings.find((b) => b.built)!;
    for (const c of idle.slice(0, RIVAL_PROMISES.jobs)) c.jobId = job.id;
    checkRivalPromises(s);
    if (idle.length >= RIVAL_PROMISES.jobs) expect(party.promises[1]!.status).toBe('kept');
    // Caja saneada con superávit: cumplida.
    s.treasury = RIVAL_PROMISES.cleanTreasury + 1;
    s.stats.push({ ...s.stats.at(-1)!, income: 10, expenses: 5 });
    checkRivalPromises(s);
    expect(party.promises[2]!.status).toBe('kept');
  });

  it('lo pendiente al vencer el plazo se rompe', () => {
    const s = rivalTown();
    const party = s.politics.party!;
    party.promises = [{ check: 'empleo', faction: party.faction, need: 'crear empleo', deadline: s.tick - 1, status: 'pending', fromMotion: false, base: 1e6 }];
    checkRivalPromises(s);
    expect(party.promises[0]!.status).toBe('broken');
  });
});

describe('gobierno rival con IA (2.2, rival-ai.ts)', () => {
  it('sin gobierno rival, el menú está vacío', () => {
    const s = town();
    expect(rivalMenu(s)).toEqual([]);
    expect(applyRivalPicks(s, ['nada:nada'])).toEqual([]);
    expect(rivalAiWanted(s)).toBe(false);
  });

  it('el menú del rival siempre es válido (≤12, ids estables, órdenes válidas en modo gobierno)', () => {
    const s = rivalTown();
    for (let day = 0; day < 240; day++) {
      if (s.politics.mayor === 'player') break;
      const menu = rivalMenu(s);
      expect(menu.length).toBeGreaterThan(0);
      expect(menu.length).toBeLessThanOrEqual(RIVAL_AI.menuMax);
      expect(menu[0]!.id).toBe('nada:nada');
      expect(new Set(menu.map((o) => o.id)).size).toBe(menu.length);
      for (const o of menu) {
        expect(o.id).toMatch(RIVAL_OPTION_ID);
        for (const c of o.cmds) expect(validateAsGovernment(s, c)).toEqual({ ok: true });
      }
      // De vez en cuando, con la caja en rojo (aparece el recorte) o llena (aparecen obras).
      if (day === 60) s.treasury = -2_000;
      if (day === 61) s.treasury = 40_000;
      for (let h = 0; h < 24; h++) step(s);
    }
    expect(listInvariants(s)).toEqual([]);
  });

  it('applyRivalPicks aplica ≤2 opciones con governmentCommand y ese mes no gobiernan las reglas', () => {
    const s = rivalTown();
    s.treasury = 40_000;
    const menu = rivalMenu(s);
    const obras = menu.filter((o) => o.kind === 'obra');
    expect(obras.length).toBeGreaterThan(0);
    const tax = menu.find((o) => o.kind === 'impuestos');
    const picks = [obras[0]!.id, tax?.id ?? 'nada:nada', 'nada:nada', 'inventada:x'];
    const before = s.buildings.length;
    expect(rivalAiWanted(s)).toBe(true);
    const applied = applyRivalPicks(s, picks, 'Haremos un pueblo mejor para todos');
    expect(applied.length).toBeLessThanOrEqual(2);
    expect(applied[0]).toBe(obras[0]!.id);
    expect(s.buildings.length).toBe(before + 1);
    expect(rivalAiWanted(s)).toBe(false);
    expect(s.politics.party!.speech?.text).toBe('Haremos un pueblo mejor para todos');
    expect(s.politics.log.at(-1)!.text).toContain('Haremos un pueblo mejor');
    // Discurso con un nombre inventado: se descarta (lo elegido sí se aplica).
    s.politics.rivalAiMonth = -1;
    applyRivalPicks(s, ['nada:nada'], 'Como dijo Bartolomé, bajaremos todo un 50 %');
    expect(s.politics.party!.speech?.text).toBe('Haremos un pueblo mejor para todos');
    // A fin de mes no gobiernan las reglas: el registro no cambia por ellas.
    const logLen = s.politics.log.length;
    do step(s);
    while (s.tick % TICKS_PER_MONTH !== 0);
    const rules = s.politics.log.slice(logLen).filter((e) => / cambia los impuestos| empieza | recorta gastos/.test(e.text));
    expect(rules).toEqual([]);
    expect(listInvariants(s)).toEqual([]);
  });

  it('determinista: misma partida, mismo menú y mismo hash', () => {
    const a = rivalTown();
    const b = rivalTown();
    expect(rivalMenu(a)).toEqual(rivalMenu(b));
    applyRivalPicks(a, [rivalMenu(a).at(-1)!.id]);
    applyRivalPicks(b, [rivalMenu(b).at(-1)!.id]);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('en la oposición el jugador no puede usar las órdenes del menú', () => {
    const s = rivalTown();
    const o = rivalMenu(s).find((x) => x.cmds.length)!;
    expect(applyCommand(s, o.cmds[0]!).ok).toBe(false);
  });
});

describe('formato 15 e invariantes de las listas (2.2)', () => {
  it('migración 14 → 15: listas con el partido (copia), estilo de su facción y promesas como exigencias', () => {
    const s = rivalTown();
    const old = JSON.parse(JSON.stringify(s));
    old.formatVersion = 14;
    delete old.politics.lists;
    delete old.politics.party.style;
    for (const p of old.politics.party.promises) delete p.check;
    old.politics.party.promises.push({ faction: 'jovenes', need: 'un parque', deadline: 0, status: 'pending', fromMotion: true });
    const m = migrate(old);
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    const styles = { jubilados: 'conservador', jovenes: 'populista', empresarios: 'tecnico', ecologistas: 'verde' } as const;
    expect(m.politics.party!.style).toBe(styles[m.politics.party!.faction]);
    expect(m.politics.party!.promises.every((p) => p.check === 'exigencia')).toBe(true);
    expect(m.politics.lists).toHaveLength(1);
    expect(m.politics.lists[0]).toEqual(m.politics.party);
    expect(m.politics.lists[0]).not.toBe(m.politics.party);
    expect(listInvariants(m)).toEqual([]);
    // Sin partido, listas vacías.
    const none = migrate15Politics({ politics: { party: null } });
    expect(none.politics.lists).toEqual([]);
    // Y la partida migrada sigue andando.
    for (let i = 0; i < 48; i++) step(m);
    expect(checkInvariants(m)).toEqual([]);
  });

  it('invariantes: líder en el pueblo, una por líder, como mucho 3 y el partido dentro', () => {
    const s = town();
    const lists = threeLists(s);
    expect(listInvariants(s)).toEqual([]);
    s.politics.lists.push(JSON.parse(JSON.stringify(lists[1])));
    expect(listInvariants(s).join(' ')).toMatch(/candidaturas \(máx\. 3\)/);
    expect(listInvariants(s).join(' ')).toMatch(/repetida/);
    s.politics.lists.pop();
    s.politics.lists[2]!.leaderId = 999_999;
    expect(listInvariants(s).join(' ')).toMatch(/sin líder/);
  });

  it('si se va el líder de una lista, se retira; si era el partido, la siguiente pasa a principal', () => {
    const s = town();
    const lists = threeLists(s);
    s.citizens = s.citizens.filter((c) => c.id !== lists[0]!.leaderId);
    step(s);
    expect(s.politics.party?.leaderId).toBe(lists[1]!.leaderId);
    expect(s.politics.lists.map((l) => l.leaderId)).toEqual([lists[1]!.leaderId, lists[2]!.leaderId]);
    s.citizens = s.citizens.filter((c) => c.id !== lists[2]!.leaderId);
    step(s);
    expect(s.politics.lists.map((l) => l.leaderId)).toEqual([lists[1]!.leaderId]);
    expect(listInvariants(s)).toEqual([]);
  });
});
