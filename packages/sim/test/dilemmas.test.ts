import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  addDebt,
  applyCommand,
  applyDirector,
  buildDirectorRequest,
  canOpenDilemma,
  CARE,
  checkInvariants,
  type Citizen,
  DILEMMA,
  dilemmaCandidates,
  dilemmasDay,
  type GameState,
  MICROCREDIT,
  newBuilding,
  openDilemma,
  OUTSIDE,
  parseDirector,
  runSimulation,
  TREASURY,
  transfer,
} from '../src/index.ts';

let base: GameState | null = null;
/** Un pueblo con vecinos con nombre (una sola simulación para todo el archivo). */
function town(): GameState {
  if (!base) {
    base = runSimulation({ seed: 1, days: 200, profile: 'constructor' }).state;
    transfer(base, OUTSIDE, TREASURY, 20_000, 'subvencion');
  }
  const s = structuredClone(base);
  s.dilemmas = [];
  return s;
}

const named = (s: GameState) => s.citizens.filter((c) => c.named);
const calm = (cs: Citizen[]) => {
  for (const c of cs) {
    c.happiness = 50;
    c.grudge = 0;
  }
};

/** Residencia llena salvo una plaza y dos mayores con nombre que la necesitan. */
function residenceCase(s: GameState): { x: Citizen; y: Citizen; key: string } {
  const b = newBuilding(s, 'residence', 1, 1, TREASURY);
  b.built = true;
  const others = s.citizens.filter((c) => !c.named).slice(0, CARE.residence.places - 1);
  for (const c of others) c.care = 'residencia';
  // Si no hay bastantes sin nombre, completan los que tengan nombre (menos los dos mayores).
  const [x, y, ...rest] = named(s);
  for (const c of rest.slice(0, CARE.residence.places - 1 - others.length)) c.care = 'residencia';
  for (const c of named(s)) if (c !== x && c !== y && !c.care) c.age = Math.min(c.age, 60);
  x!.age = 82;
  y!.age = 78;
  delete x!.care;
  delete y!.care;
  calm([x!, y!]);
  const cand = dilemmaCandidates(s).find((c) => c.kind === 'ultima_plaza_residencia');
  expect(cand).toBeTruthy();
  return { x: x!, y: y!, key: cand!.key };
}

describe('dilemas morales (2.4)', () => {
  it('la última plaza de la residencia: cada opción mueve lo que dice DILEMMA', () => {
    const s0 = town();
    const { key } = residenceCase(s0);
    const d0 = openDilemma(s0, key)!;
    expect(d0.options).toEqual(['plaza_primero', 'plaza_segundo', 'ampliar']);
    expect(d0.until - d0.tick).toBe(DILEMMA.days * TICKS_PER_DAY);
    const r = DILEMMA.residence;
    for (const option of d0.options) {
      const s = structuredClone(s0);
      const d = s.dilemmas.at(-1)!;
      const [x, y] = d.citizenIds.map((id) => s.citizens.find((c) => c.id === id)!);
      const treasury = s.treasury;
      expect(applyCommand(s, { type: 'ResolveDilemma', id: d.id, option }).ok).toBe(true);
      expect(d.resolved).toBe(option);
      if (option === 'ampliar') {
        expect(s.treasury).toBe(treasury - DILEMMA.expandCost);
        expect(x!.care).toBe('residencia');
        expect(y!.care).toBe('residencia');
      } else {
        const [win, lose] = option === 'plaza_primero' ? [x!, y!] : [y!, x!];
        expect(win.care).toBe('residencia');
        expect(lose.care).toBeUndefined();
        expect(win.happiness).toBe(50 + r.chosenMood);
        expect(lose.happiness).toBe(50 + r.leftOutMood);
        expect(lose.grudge).toBe(r.leftOutGrudge);
        expect(s.treasury).toBe(treasury);
      }
      expect(checkInvariants(s)).toEqual([]);
      // Ya cerrado: no se puede volver a decidir.
      expect(applyCommand(s, { type: 'ResolveDilemma', id: d.id, option }).ok).toBe(false);
    }
  }, 120_000);

  it('la familia con deudas: desahuciar, perdonar o microcrédito (deuda conservada)', () => {
    const s0 = town();
    s0.townhallLevel = Math.max(s0.townhallLevel ?? 1, MICROCREDIT.townhallLevel);
    const [c, k] = named(s0).filter((x) => x.homeId !== null);
    const home = s0.buildings.find((b) => b.id === c!.homeId)!;
    home.kind = 'house';
    c!.owns = false;
    k!.homeId = c!.homeId;
    delete c!.debt;
    addDebt(s0, c!, 'town', 800);
    calm([c!, k!]);
    const cand = dilemmaCandidates(s0).find((x) => x.kind === 'familia_con_deudas' && x.citizenIds[0] === c!.id);
    expect(cand?.options).toEqual(['desahuciar', 'perdonar', 'microcredito']);
    openDilemma(s0, cand!.key);
    const f = DILEMMA.family;
    for (const option of cand!.options) {
      const s = structuredClone(s0);
      const d = s.dilemmas.at(-1)!;
      const a = s.citizens.find((x) => x.id === c!.id)!;
      const kin = s.citizens.find((x) => x.id === k!.id)!;
      const forgiven = s.debtLedger.forgiven;
      const money = a.money;
      expect(applyCommand(s, { type: 'ResolveDilemma', id: d.id, option }).ok).toBe(true);
      if (option === 'desahuciar') {
        expect(a.homeId).toBeNull();
        expect(kin.homeId).toBeNull();
        expect(a.debt!.town).toBe(800);
        expect(kin.happiness).toBe(50 + f.evictMood);
      } else if (option === 'perdonar') {
        expect(a.debt?.town ?? 0).toBe(0);
        expect(s.debtLedger.forgiven).toBe(forgiven + 800);
        expect(a.happiness).toBe(50 + f.forgiveMood);
      } else {
        expect(a.debt!.plan?.kind).toBe('microcredito');
        expect(a.money).toBeGreaterThanOrEqual(money);
        expect(a.happiness).toBe(50 + f.microMood);
      }
      expect(checkInvariants(s)).toEqual([]);
    }
  }, 120_000);

  it('la fábrica que vierte: multar (multa y despidos) o mirar a otro lado (rencor en la orilla)', () => {
    const s0 = town();
    const fab = newBuilding(s0, 'factory', 10, 10, OUTSIDE);
    fab.built = true;
    transfer(s0, OUTSIDE, fab.id, 5_000, 'subvencion');
    const ws = s0.citizens.filter((c) => !c.named).slice(0, 3);
    for (const w of ws) w.jobId = fab.id;
    s0.fields.pollution[10 * s0.map.w + 10] = 80;
    s0.map.terrain[10 * s0.map.w + 12] = 1;
    const neighbor = named(s0)[0]!;
    const house = newBuilding(s0, 'res', 11, 11, OUTSIDE);
    house.built = true;
    neighbor.homeId = house.id;
    neighbor.jobId = null;
    calm([neighbor]);
    const cand = dilemmaCandidates(s0).find((x) => x.kind === 'fabrica_vierte');
    expect(cand).toBeTruthy();
    expect(cand!.citizenIds).toContain(neighbor.id);
    openDilemma(s0, cand!.key);
    const f = DILEMMA.factory;
    for (const option of ['multar', 'mirar_otro_lado']) {
      const s = structuredClone(s0);
      const d = s.dilemmas.at(-1)!;
      const t = s.treasury;
      const n = s.citizens.find((x) => x.id === neighbor.id)!;
      expect(applyCommand(s, { type: 'ResolveDilemma', id: d.id, option }).ok).toBe(true);
      const workers = s.citizens.filter((c) => c.jobId === fab.id).length;
      if (option === 'multar') {
        expect(s.treasury).toBe(t + f.fine);
        expect(workers).toBe(3 - f.fired);
        expect(n.grudge).toBe(0);
      } else {
        expect(s.treasury).toBe(t);
        expect(workers).toBe(3);
        expect(n.grudge).toBe(f.lookAwayGrudge);
        expect(n.happiness).toBe(50 + f.lookAwayMood);
      }
      expect(checkInvariants(s)).toEqual([]);
    }
  }, 120_000);

  it('el preso arrepentido: el indulto lo saca; si cumple, sigue preso', () => {
    const s0 = town();
    const [p, k0] = named(s0).filter((x) => x.homeId !== null);
    k0!.homeId = p!.homeId;
    s0.justice!.jail.push({ until: s0.tick + 30 * TICKS_PER_DAY, citizenId: p!.id });
    const cand = dilemmaCandidates(s0).find((x) => x.kind === 'preso_arrepentido');
    expect(cand?.citizenIds[0]).toBe(p!.id);
    const k = s0.citizens.find((x) => x.id === cand!.citizenIds[1]);
    calm([p!, k!]);
    openDilemma(s0, cand!.key);
    const pr = DILEMMA.prisoner;
    for (const option of ['pedir_indulto', 'que_cumpla']) {
      const s = structuredClone(s0);
      const d = s.dilemmas.at(-1)!;
      expect(applyCommand(s, { type: 'ResolveDilemma', id: d.id, option }).ok).toBe(true);
      const kin = s.citizens.find((x) => x.id === k!.id)!;
      const jailed = s.justice!.jail.some((x) => x.citizenId === p!.id);
      expect(jailed).toBe(option === 'que_cumpla');
      expect(kin.happiness).toBe(50 + (option === 'pedir_indulto' ? pr.pardonFamilyMood : pr.serveFamilyMood));
    }
  }, 120_000);

  it('sin decidir en 7 días: «no decidir» y rencor a los afectados; uno al mes como mucho', () => {
    const s = town();
    const { x, y, key } = residenceCase(s);
    const d = openDilemma(s, key)!;
    expect(openDilemma(s, key)).toBeNull();
    s.tick = d.until;
    dilemmasDay(s);
    expect(d.resolved).toBe('no_decidir');
    expect(x.grudge).toBe(DILEMMA.noDecideGrudge);
    expect(y.grudge).toBe(DILEMMA.noDecideGrudge);
    expect(x.care).toBeUndefined();
    // Uno al mes: cerrado el anterior, aún no se abre otro; y el mismo caso no se repite.
    expect(canOpenDilemma(s)).toBe(false);
    s.tick = d.tick + TICKS_PER_MONTH;
    expect(canOpenDilemma(s)).toBe(true);
    expect(dilemmaCandidates(s).some((c) => c.key === key)).toBe(false);
  }, 120_000);

  it('un candidato con un vecino que se fue se descarta (y el dilema abierto se cierra sin efecto)', () => {
    const s = town();
    const { x, key } = residenceCase(s);
    const d = openDilemma(s, key)!;
    s.citizens = s.citizens.filter((c) => c !== x);
    expect(dilemmaCandidates(s).some((c) => c.citizenIds.includes(x.id))).toBe(false);
    expect(applyCommand(s, { type: 'ResolveDilemma', id: d.id, option: 'plaza_segundo' }).ok).toBe(false);
    dilemmasDay(s);
    expect(d.resolved).toBe('sin_efecto');
  }, 120_000);

  it('Modo IA: el director plantea el dilema con su presentación; las cifras inventadas no pasan', () => {
    const s = town();
    s.aiMode = true;
    s.ai = { share: 50, paceDays: 7, turn: { n: 1, opened: s.tick - 24, due: s.tick + 12, kind: 'semana', ids: [] }, lastN: 1, next: s.tick + 168, mayor: [], quick: null, lastQuick: -1e9, log: [] };
    // Descontento para que quepa algo malo.
    for (const c of s.citizens) c.happiness = 20;
    const { key } = residenceCase(s);
    const req = buildDirectorRequest(s);
    const id = `dilema:${key}`;
    expect(req.ids).toContain(id);
    const answer = (presentacion: string) =>
      JSON.stringify({ sucesos: [], avisos: [], foco: 'La residencia', cronica: 'Semana tranquila.', titulares: [], encargo: { id: '', carta: '' }, pies: [], gobierno_rival: { picks: [], discurso: '' }, dilema: { id, presentacion } });
    const badOne = parseDirector(answer('Quedan 9137 plazas y la cola es de 48211 vecinos.'), req.ids, req.shared + req.user);
    expect(badOne?.director.dilema).toEqual({ id, presentacion: '' });
    const good = parseDirector(answer('En la residencia queda una sola plaza y dos vecinos mayores la necesitan.'), req.ids, req.shared + req.user)!;
    expect(good.director.dilema?.presentacion).toContain('una sola plaza');
    applyDirector(s, good.director);
    const d = s.dilemmas.at(-1)!;
    expect(d.intro).toContain('una sola plaza');
    expect(d.options).toEqual(['plaza_primero', 'plaza_segundo', 'ampliar']);
    expect(s.ai.drama!.bad).toBe(1);
  }, 120_000);
});
