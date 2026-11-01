import { Command, TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  bigFactory,
  buildDirectorRequest,
  buildTurnRequest,
  checkInvariants,
  createInitialState,
  DIRECTOR,
  directorMenu,
  directorOwns,
  donorCandidates,
  type GameState,
  GESTURES,
  gestureCandidates,
  hashState,
  landmarkSpot,
  moneyDrift,
  newBuilding,
  OUTSIDE,
  parseDirector,
  parseTurn,
  REGION,
  regionMonth,
  ruleTurn,
  runSimulation,
  SPEND,
  step,
  TOURISM,
  transfer,
  TREASURY,
  turnMenu,
  turnShared,
  validateCommand,
  Zone,
  type Citizen,
} from '../src/index.ts';

/* ---------------- pueblo de prueba en Modo IA ---------------- */

function town(pop = 90, cash = 150_000, seed = 5): GameState {
  const s = createInitialState({ seed, aiMode: true, aiShare: 100 });
  s.townhallLevel = 3;
  const base = s.citizens[0]!;
  while (s.citizens.length < pop) s.citizens.push({ ...structuredClone(base), id: s.nextId++, name: `Vecino ${s.nextId}`, age: 25 + (s.nextId % 35), money: 0, homeId: null, jobId: null, named: false, owns: false, flow: [0, 0] });
  for (const c of s.citizens) c.happiness = 70;
  transfer(s, OUTSIDE, TREASURY, cash, 'subvenciones');
  return s;
}

/** Deja a un vecino con este dinero (moviéndolo desde fuera o hacia fuera: el dinero cuadra). */
function setMoney(s: GameState, c: Citizen, money: number) {
  if (c.money > money) transfer(s, c.id, OUTSIDE, c.money - money);
  else if (c.money < money) transfer(s, OUTSIDE, c.id, money - c.money);
}

const hall = (s: GameState) => s.buildings.find((b) => b.kind === 'townhall')!;

/** Un vecino con IA (con nombre) y algo de dinero. */
function aiCitizen(s: GameState, i: number, money = 3_000): Citizen {
  const c = s.citizens[i]!;
  c.named = true;
  c.name = `Vecina ${i} Prueba`;
  c.age = 30 + i;
  setMoney(s, c, money);
  return c;
}

/** Abre un turno a mano (el motor lo abriría al empezar el día). */
function openTurn(s: GameState, ids: number[], kind: 'semana' | 'rapida' = 'semana') {
  const ai = s.ai!;
  ai.lastN++;
  ai.turn = { n: ai.lastN, opened: s.tick, due: s.tick + 12, kind, ids };
  return ai.turn;
}

const act = (c: Citizen, accion: string, actitud = 1) => ({
  vecino: c.id,
  accion,
  gesto: { con: 0, tipo: 'ninguno' },
  actitud,
  gasto: { donde: 'pueblo', tienda: 0, ocio: false },
  plan: { tipo: 'ninguno', necesidad: '', meses: 0 },
  pensamiento: '',
  motivo: 'Porque sí.',
});

function startStation(s: GameState) {
  const at = landmarkSpot(s, 'station', hall(s))!;
  expect(applyCommand(s, { type: 'StartLandmark', kind: 'station', ...at })).toEqual({ ok: true });
  return s.landmarks.at(-1)!;
}

function withHeritage(s: GameState) {
  for (let y = 0; y < s.map.h; y++)
    for (let x = 0; x < s.map.w; x++) {
      if (!validateCommand(s, { type: 'Build', kind: 'heritage', x, y }).ok) continue;
      expect(applyCommand(s, { type: 'Build', kind: 'heritage', x, y }).ok).toBe(true);
      const h = s.buildings.find((b) => b.kind === 'heritage')!;
      h.built = true;
      s.projects = s.projects.filter((p) => p.buildingId !== h.id);
      return h;
    }
  throw new Error('sin sitio');
}

/** Vivienda privada en propiedad, con su dueño dentro. */
function ownedHome(s: GameState, c: Citizen, x: number, y: number) {
  const b = newBuilding(s, 'res', x, y, -1);
  b.built = true;
  c.homeId = b.id;
  c.owns = true;
  return b;
}

/** La gran empresa abierta y su fábrica terminada. */
function withBigCompany(s: GameState) {
  const at = landmarkSpot(s, 'station', { x: hall(s).x + 6, y: hall(s).y })!;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]] as const) s.map.zones[(at.y + dy) * s.map.w + at.x + dx] = Zone.I;
  const p = newBuilding(s, 'power', 0, 0, TREASURY);
  p.built = true;
  s.tick += TICKS_PER_MONTH - (s.tick % TICKS_PER_MONTH);
  regionMonth(s);
  expect(s.bigCompany?.status).toBe('oferta');
  expect(applyCommand(s, { type: 'AnswerBigCompany', accept: true, incentive: 'ibi_bonificado' }).ok).toBe(true);
  const b = bigFactory(s)!;
  b.built = true;
  s.projects = s.projects.filter((x) => x.buildingId !== b.id);
  return b;
}

const ids = (s: GameState, c: Citizen) => turnMenu(s, c).map((m) => m.accion);

/* ---------------- vecinos ---------------- */

describe('metas grandes con IA (2.3): lo que puede hacer cada vecino', () => {
  it('donar_obra: solo con la obra en marcha, poco ahorrador, a favor y sin deudas; el motor fija la cantidad', () => {
    const s = town();
    const c = aiCitizen(s, 1);
    c.traits.ahorro = 10;
    c.attitude = 1;
    expect(ids(s, c).some((a) => a.startsWith('donar_obra:'))).toBe(false);
    const lm = startStation(s);
    expect(donorCandidates(s, lm.id).some((d) => d.citizenId === c.id)).toBe(true);
    expect(ids(s, c)).toContain(`donar_obra:${lm.id}`);
    // Quien gobierna no dona; quien está en contra, tampoco.
    s.politics.mayor = c.id;
    expect(ids(s, c)).not.toContain(`donar_obra:${lm.id}`);
    s.politics.mayor = 'player';
    c.attitude = 0;
    expect(ids(s, c)).not.toContain(`donar_obra:${lm.id}`);
    c.attitude = 1;
    // Aplicar: el 2 % de sus ahorros va a la caja (y no repite en un mes).
    const t = openTurn(s, [c.id], 'rapida');
    const money = c.money;
    const treasury = s.treasury;
    expect(applyCommand(s, { type: 'TownTurn', n: t.n, acts: [act(c, `donar_obra:${lm.id}`)] }).ok).toBe(true);
    const paid = money - c.money;
    expect(paid).toBe(Math.floor(money * 0.02));
    expect(s.treasury - treasury).toBe(paid);
    expect(ids(s, c)).not.toContain(`donar_obra:${lm.id}`);
    s.tick += 31 * TICKS_PER_DAY;
    expect(ids(s, c)).toContain(`donar_obra:${lm.id}`);
    // Una obra que no existe se ignora (sigue igual).
    const t2 = openTurn(s, [c.id], 'rapida');
    const m2 = c.money;
    expect(applyCommand(s, { type: 'TownTurn', n: t2.n, acts: [act(c, 'donar_obra:99999')] }).ok).toBe(true);
    expect(c.money).toBe(m2);
    expect(moneyDrift(s)).toBe(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('abrir_casa_rural y quejarse_turistas: solo quien puede (y quien gobierna no se queja)', () => {
    const s = town(45);
    withHeritage(s);
    s.tourism.visitors = 200;
    s.tourism.avg = 200;
    const h = hall(s);
    const owner = aiCitizen(s, 1, 5_000);
    const home = ownedHome(s, owner, h.x - 3, h.y - 3);
    expect(ids(s, owner)).toContain('abrir_casa_rural');
    const renter = aiCitizen(s, 2, 1_000);
    expect(ids(s, renter)).not.toContain('abrir_casa_rural');
    expect(ids(s, renter)).not.toContain('quejarse_turistas');
    const t = openTurn(s, [owner.id], 'rapida');
    expect(applyCommand(s, { type: 'TownTurn', n: t.n, acts: [act(owner, 'abrir_casa_rural')] }).ok).toBe(true);
    expect(home.rural).toBe(true);
    expect(ids(s, owner)).not.toContain('abrir_casa_rural');
    // Un inquilino de al lado ya puede quejarse; quien gobierna, no.
    const flat = newBuilding(s, 'res', h.x - 3, h.y - 1, -1);
    flat.built = true;
    renter.homeId = flat.id;
    expect(ids(s, renter)).toContain('quejarse_turistas');
    s.politics.mayor = renter.id;
    expect(ids(s, renter)).not.toContain('quejarse_turistas');
    s.politics.mayor = 'player';
    const t2 = openTurn(s, [renter.id], 'rapida');
    expect(applyCommand(s, { type: 'TownTurn', n: t2.n, acts: [act(renter, 'quejarse_turistas')] }).ok).toBe(true);
    expect(s.events.some((e) => e.text.includes('se queja de los turistas'))).toBe(true);
    expect(ids(s, renter)).not.toContain('quejarse_turistas');
    expect(moneyDrift(s)).toBe(0);
  });

  it('aceptar_trabajo incluye la gran empresa cuando contrata (solo a quien está en paro)', () => {
    const s = town();
    const c = aiCitizen(s, 1, 0);
    const worker = aiCitizen(s, 2, 0);
    const b = withBigCompany(s);
    worker.jobId = hall(s).id;
    expect(ids(s, c)).toContain(`aceptar_trabajo:${b.id}`);
    expect(ids(s, worker)).not.toContain(`aceptar_trabajo:${b.id}`);
    const t = openTurn(s, [c.id], 'rapida');
    expect(applyCommand(s, { type: 'TownTurn', n: t.n, acts: [act(c, `aceptar_trabajo:${b.id}`)] }).ok).toBe(true);
    expect(c.jobId).toBe(b.id);
    expect(ids(s, c)).not.toContain(`aceptar_trabajo:${b.id}`);
  });

  it('por costumbre (la IA no responde): donan con dados del estado y como mucho una vez al mes', () => {
    const s = town();
    const c = aiCitizen(s, 1, 2_000);
    c.traits.ahorro = 10;
    c.traits.ambicion = 10;
    c.attitude = 1;
    c.jobId = hall(s).id;
    const lm = startStation(s);
    let donations = 0;
    let lastTick = -1e9;
    for (let i = 0; i < 120; i++) {
      s.tick += 8 * TICKS_PER_DAY;
      c.happiness = 70;
      const before = c.money;
      ruleTurn(s, [c.id]);
      if (c.money < before) {
        donations++;
        expect(s.tick - lastTick).toBeGreaterThanOrEqual(30 * TICKS_PER_DAY);
        lastTick = s.tick;
      }
      if (!s.landmarks.includes(lm)) break;
    }
    expect(donations).toBeGreaterThan(0);
    expect(donations).toBeLessThan(40);
    expect(moneyDrift(s)).toBe(0);
  });
});

/* ---------------- director ---------------- */

describe('metas grandes con IA (2.3): el director', () => {
  const pick = (s: GameState, t: { n: number; ids: number[] }, sucesos: string[], avisos: string[] = []) => {
    const c = s.citizens.find((x) => t.ids.includes(x.id))!;
    return applyCommand(s, { type: 'TownTurn', n: t.n, acts: [act(c, 'seguir')], director: { sucesos: sucesos.map((id) => ({ id, motivo: 'Toca.' })), avisos: avisos.map((id) => ({ id, motivo: 'Se nota.' })) } });
  };

  it('voluntarios_obra (bueno, una vez por fase) y polemica_obra (malo, avisado antes; −1 de actitud a la facción que más paga)', () => {
    const s = town();
    const named = [1, 2, 3, 4, 5, 6].map((i) => aiCitizen(s, i, 1_000));
    const lm = startStation(s);
    expect(applyCommand(s, { type: 'FundLandmarkPhase', id: lm.id }).ok).toBe(true);
    const menu = () => directorMenu(s).map((m) => m.id);
    expect(menu()).toContain(`voluntarios_obra:${lm.id}`);
    const p = s.projects.find((x) => x.buildingId === lm.buildingId)!;
    const need = p.workerDaysNeeded;
    expect(pick(s, openTurn(s, [named[0]!.id]), [`voluntarios_obra:${lm.id}`]).ok).toBe(true);
    expect(p.workerDaysNeeded).toBeLessThan(need);
    expect(directorOwns(s)).toBe(true);
    expect(menu()).not.toContain(`voluntarios_obra:${lm.id}`);
    // Polémica: con lo gastado y los impuestos altos; antes, avisada.
    expect(menu()).not.toContain(`polemica_obra:${lm.id}`);
    s.taxLevel = 'high';
    s.taxesSplit = false;
    for (const c of named) c.last = { in: 900, out: 600, repaid: 0, owed: 0, grew: 0 };
    expect(menu()).toContain(`polemica_obra:${lm.id}`);
    for (const c of s.citizens) c.happiness = 30;
    const before = named.map((c) => c.attitude ?? 0);
    s.tick += 2;
    expect(pick(s, openTurn(s, [named[0]!.id]), [`polemica_obra:${lm.id}`], [`polemica_obra:${lm.id}`]).ok).toBe(true);
    expect(named.slice(1).map((c) => c.attitude ?? 0)).toEqual(before.slice(1));
    expect(s.ai!.brewing!.some((b) => b.id === `polemica_obra:${lm.id}`)).toBe(true);
    s.tick += 2;
    for (const c of s.citizens) c.happiness = 30;
    const att = new Map(named.map((c) => [c.id, c.attitude ?? 0]));
    expect(pick(s, openTurn(s, [named[0]!.id]), [`polemica_obra:${lm.id}`]).ok).toBe(true);
    expect(lm.polemic).toBe(lm.phase);
    const changed = named.filter((c) => c.id !== named[0]!.id && (c.attitude ?? 0) === Math.max(-2, att.get(c.id)! - 1));
    expect(changed.length).toBeGreaterThan(0);
    expect(menu()).not.toContain(`polemica_obra:${lm.id}`);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('reportaje_tv (bueno) y turistas_ruido (malo, con aviso)', () => {
    const s = town(45);
    const c = aiCitizen(s, 1, 5_000);
    const h = withHeritage(s);
    s.tourism.visitors = 300;
    const menu = () => directorMenu(s).map((m) => m.id);
    expect(menu()).toContain(`reportaje_tv:${h.id}`);
    expect(pick(s, openTurn(s, [c.id]), [`reportaje_tv:${h.id}`]).ok).toBe(true);
    expect(s.tourism.tvUntil).toBeGreaterThan(s.tick);
    expect(menu()).not.toContain(`reportaje_tv:${h.id}`);
    // Ruido: hace falta alguna casa rural.
    expect(menu()).not.toContain('turistas_ruido:casas');
    ownedHome(s, c, hall(s).x - 3, hall(s).y - 3).rural = true;
    expect(menu()).toContain('turistas_ruido:casas');
    for (const x of s.citizens) x.happiness = 30;
    s.tick += 2;
    expect(pick(s, openTurn(s, [c.id]), ['turistas_ruido:casas']).ok).toBe(true);
    expect(s.tourism.noiseUntil ?? -1).toBeLessThan(s.tick);
    s.ai!.brewing = [];
    expect(pick(s, openTurn(s, [c.id]), [], ['turistas_ruido:casas']).ok).toBe(true);
    s.tick += 2;
    for (const x of s.citizens) x.happiness = 30;
    expect(pick(s, openTurn(s, [c.id]), ['turistas_ruido:casas']).ok).toBe(true);
    expect(s.tourism.noiseUntil).toBeGreaterThan(s.tick);
    expect(TOURISM.noise.minVisitors).toBeLessThanOrEqual(300);
  });

  it('ere_gran_empresa (malo, solo en crisis, avisado) y contrata_vecinos (bueno); sin director, las reglas', () => {
    const s = town();
    const c = aiCitizen(s, 1, 0);
    const b = withBigCompany(s);
    const menu = () => directorMenu(s).map((m) => m.id);
    expect(menu()).toContain(`contrata_vecinos:${b.id}`);
    expect(menu()).not.toContain(`ere_gran_empresa:${b.id}`);
    expect(pick(s, openTurn(s, [c.id]), [`contrata_vecinos:${b.id}`]).ok).toBe(true);
    expect(s.citizens.filter((x) => x.jobId === b.id).length).toBe(DIRECTOR.hireBatch);
    // Con el director, el fin de mes no contrata por reglas ni avisa del ERE por la crisis.
    expect(directorOwns(s)).toBe(true);
    s.region.phase = 'crisis';
    s.region.until = s.tick + 20 * TICKS_PER_MONTH;
    s.tick += TICKS_PER_MONTH;
    regionMonth(s);
    expect(s.citizens.filter((x) => x.jobId === b.id).length).toBe(DIRECTOR.hireBatch);
    expect(s.bigCompany!.status).toBe('abierta');
    const ere = directorMenu(s).find((m) => m.id === `ere_gran_empresa:${b.id}`)!;
    expect(ere).toMatchObject({ bad: true, owed: true });
    s.tick += 2;
    expect(pick(s, openTurn(s, [c.id]), [], [ere.id]).ok).toBe(true);
    s.tick += 2;
    expect(pick(s, openTurn(s, [c.id]), [ere.id]).ok).toBe(true);
    expect(s.bigCompany!.status).toBe('ere');
    expect(menu()).not.toContain(ere.id);
    // Sin director (la IA no respondió): las reglas contratan y la crisis avisa.
    s.ai!.directed = false;
    const staff = s.citizens.filter((x) => x.jobId === b.id).length;
    s.bigCompany!.status = 'abierta';
    delete s.bigCompany!.warnUntil;
    s.tick += TICKS_PER_MONTH;
    regionMonth(s);
    expect(['ere', 'se_va']).toContain(s.bigCompany!.status);
    // Con el ERE o el cierre anunciados no contrata (F3: contrataba para despedir a los tres meses).
    expect(s.citizens.filter((x) => x.jobId === b.id).length).toBe(staff);
    // Pasada la crisis y sin aviso, las reglas contratan cada mes.
    s.region.phase = 'normal';
    s.bigCompany!.status = 'abierta';
    delete s.bigCompany!.warnUntil;
    s.tick += TICKS_PER_MONTH;
    regionMonth(s);
    expect(s.citizens.filter((x) => x.jobId === b.id).length).toBe(staff + REGION.bigCompany.hirePerMonth);
    expect(moneyDrift(s)).toBe(0);
    expect(checkInvariants(s)).toEqual([]);
  });
});

/* ---------------- prompt ---------------- */

describe('metas grandes con IA (2.3): el prompt', () => {
  it('el bloque común cuenta comarca, obras, escenario, turismo y empresa; parseTurn y parseDirector filtran lo que no se envió', () => {
    const s = createInitialState({ seed: 3, aiMode: true, aiShare: 100, scenario: 'vaciado' });
    s.townhallLevel = 3;
    const base = s.citizens[0]!;
    while (s.citizens.length < 90) s.citizens.push({ ...structuredClone(base), id: s.nextId++, name: `Vecino ${s.nextId}`, money: 0, homeId: null, jobId: null, named: false, owns: false, flow: [0, 0] });
    for (const c of s.citizens) c.happiness = 70;
    transfer(s, OUTSIDE, TREASURY, 150_000, 'subvenciones');
    const c = aiCitizen(s, 1);
    c.traits.ahorro = 10;
    c.attitude = 1;
    const lm = startStation(s);
    withBigCompany(s);
    s.tourism.visitors = 120;
    const t = openTurn(s, [c.id]);
    const shared = turnShared(s);
    expect(shared).toContain('"metas"');
    expect(shared).toContain('Estación de tren: fase 0 de 3');
    expect(shared).toContain('"comarca":"normal"');
    expect(shared).toContain('visitantes al mes: algunos');
    expect(shared).toContain('trabajan en su fábrica');
    expect(shared).toContain('"escenario"');
    const req = buildTurnRequest(s, t.ids, shared);
    const sent = `${req.shared}\n${req.user}`;
    expect(sent).toContain(`donar_obra:${lm.id} (`);
    const answer = (accion: string) => JSON.stringify({ decisiones: [{ ...act(c, accion), recuerdo: '', escudo: { pieza: '', lema: '' }, biografia: '' }] });
    expect(parseTurn(answer(`donar_obra:${lm.id}`), t.ids, sent).acts[0]!.accion).toBe(`donar_obra:${lm.id}`);
    expect(parseTurn(answer('donar_obra:99999'), t.ids, sent).acts[0]!.accion).toBe('seguir');
    expect(parseTurn(answer('abrir_casa_rural'), t.ids, sent).acts[0]!.accion).toBe('seguir');
    const dir = buildDirectorRequest(s, shared);
    expect(dir.ids.some((x) => x.startsWith('contrata_vecinos:'))).toBe(true);
    const parsed = parseDirector(JSON.stringify({ sucesos: [{ id: 'voluntarios_obra:99999', motivo: 'x' }, { id: dir.ids.find((x) => x.startsWith('contrata_vecinos:'))!, motivo: 'Hay paro.' }], avisos: [{ id: 'ere_gran_empresa:1', motivo: 'x' }], foco: 'La fábrica', cronica: 'La fábrica contrata.' }), dir.ids, `${dir.shared}\n${dir.user}`)!;
    expect(parsed.director.sucesos.map((x) => x.id)).toEqual([dir.ids.find((x) => x.startsWith('contrata_vecinos:'))]);
    expect(parsed.director.avisos).toEqual([]);
  });
});

/* ---------------- fuzz ---------------- */

/** IA de pruebas: elige al azar, con preferencia por lo nuevo de la 2.3, entre todo lo que permite el menú. */
function fuzzTurn(seed: number) {
  let x = seed >>> 0 || 1;
  const rnd = (n: number) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
  const fresh = (a: string) => /^(donar_obra|abrir_casa_rural|quejarse_turistas|aceptar_trabajo)/.test(a);
  return (state: GameState): Command | null => {
    const t = state.ai?.turn;
    if (!t) return null;
    const acts = t.ids
      .map((id) => state.citizens.find((c) => c.id === id))
      .filter((c): c is Citizen => !!c)
      .map((c) => {
        const menu = turnMenu(state, c).map((m) => m.accion);
        const pref = menu.filter(fresh);
        const others = gestureCandidates(state, c);
        return {
          vecino: c.id,
          accion: pref.length && rnd(2) ? pref[rnd(pref.length)]! : menu[rnd(menu.length)]!,
          gesto: { con: others.length ? others[rnd(others.length)]!.id : 0, tipo: GESTURES[rnd(GESTURES.length)]! },
          actitud: rnd(5) - 2,
          gasto: { donde: SPEND[rnd(SPEND.length)]!, tienda: 0, ocio: rnd(2) === 0 },
          plan: { tipo: 'ninguno', necesidad: '', meses: 0 },
          pensamiento: 'Hoy pienso en el pueblo.',
          motivo: 'Porque toca.',
        };
      });
    const menu = directorMenu(state).map((m) => m.id);
    const some = () => menu.filter((id) => rnd(/obra|tv|turistas|ere_|contrata/.test(id) ? 2 : 4) === 0).map((id) => ({ id, motivo: 'Porque sí.' }));
    return { type: 'TownTurn', n: t.n, acts, ...(t.kind === 'semana' && rnd(5) > 0 ? { director: { sucesos: some().slice(0, 6), avisos: some().slice(0, 6) }, focus: 'La semana', chronicle: 'Pasan cosas.' } : {}) };
  };
}

/** El alcalde paga la fase siguiente de cada obra en cuanto puede. */
function fundAll(s: GameState) {
  for (const l of s.landmarks) if (l.phase < l.phases && l.phaseUntil === -1 && validateCommand(s, { type: 'FundLandmarkPhase', id: l.id }).ok) applyCommand(s, { type: 'FundLandmarkPhase', id: l.id });
}

describe('metas grandes con IA (2.3): fuzz', () => {
  it('Modo IA con obras, turismo y gran empresa: dinero, deuda e invariantes intactos; reproducir da el mismo hash', () => {
    const goals = new Set<string>();
    for (const seed of [1, 2, 4]) {
      const ai = fuzzTurn(seed * 7);
      const { state: s } = runSimulation({ seed, days: 500, profile: 'casual', aiMode: true, aiShare: 100, onTurn: ai });
      // Se fuerza lo de la 2.3: más vecinos, caja, patrimonio con visitantes, una obra y la gran empresa.
      s.townhallLevel = Math.max(3, s.townhallLevel ?? 1);
      const base = s.citizens[0]!;
      while (s.citizens.length < 90) s.citizens.push({ ...structuredClone(base), id: s.nextId++, name: `Vecino ${s.nextId}`, age: 25 + (s.nextId % 35), money: 0, homeId: null, jobId: null, named: false, owns: false, debt: undefined, flow: [0, 0], relations: [], kids: [] });
      for (const c of s.citizens) c.happiness = Math.max(c.happiness, 70);
      transfer(s, OUTSIDE, TREASURY, 200_000, 'subvenciones');
      if (!s.buildings.some((b) => b.kind === 'heritage')) withHeritage(s);
      s.tourism.visitors = Math.max(s.tourism.visitors, 150);
      s.tourism.avg = 150;
      if (!s.landmarks.some((l) => l.kind === 'station')) startStation(s);
      if (!s.bigCompany) withBigCompany(s);
      // Algunos propietarios con nombre (casas rurales) y ahorradores poco ahorradores (donaciones).
      for (const c of s.citizens.filter((x) => x.named).slice(0, 12)) {
        c.traits.ahorro = 20;
        c.traits.ambicion = 80;
      }
      expect(checkInvariants(s)).toEqual([]);
      const start = structuredClone(s);
      const log: { tick: number; cmd: Command }[] = [];
      for (let day = 0; day < 240; day++) {
        for (let h = 0; h < TICKS_PER_DAY; h++) {
          step(s);
          if (s.ai?.turn && s.ai.turn.opened === s.tick) {
            const cmd = ai(s);
            if (cmd && applyCommand(s, cmd).ok) log.push({ tick: s.tick, cmd });
            for (const l of s.ai.log.at(-1)?.lines ?? []) for (const k of ['voluntarios', 'contrata a', 'reportaje', 'ERE', 'turistas', 'Polémica']) if (l.text.startsWith('✦') && l.text.includes(k)) goals.add(k);
          }
        }
        if (day % 30 === 29) {
          expect(checkInvariants(s)).toEqual([]);
          expect(moneyDrift(s)).toBe(0);
        }
        fundAll(s);
      }
      // Que de verdad se usó lo nuevo.
      const actions = s.decisionLog.map((d) => d.action.split(':')[0]);
      expect(actions.some((a) => a === 'donar_obra' || a === 'abrir_casa_rural' || a === 'quejarse_turistas')).toBe(true);
      expect(s.citizens.some((c) => c.jobId === bigFactory(s)?.id)).toBe(true);
      expect(s.ai!.log.some((l) => l.lines.some((x) => x.text.startsWith('✦')))).toBe(true);
      // Reproducir: mismos comandos desde el mismo estado dan el mismo hash.
      const r = start;
      const byTick = new Map<number, Command[]>();
      for (const c of log) byTick.set(c.tick, [...(byTick.get(c.tick) ?? []), c.cmd]);
      while (r.tick < s.tick) {
        step(r);
        for (const c of byTick.get(r.tick) ?? []) expect(applyCommand(r, c).ok).toBe(true);
        if (r.tick % TICKS_PER_DAY === 0) fundAll(r);
      }
      expect(hashState(r)).toBe(hashState(s));
    }
    // El director ha elegido sucesos de las metas grandes.
    expect(goals.size).toBeGreaterThanOrEqual(3);
  }, 600_000);
});
