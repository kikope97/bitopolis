import { TICKS_PER_DAY } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyDirector,
  checkInvariants,
  convenePleno,
  createInitialState,
  cronyOf,
  directorMenu,
  FORMAT_VERSION,
  type GameState,
  hashState,
  materialsCost,
  migrate,
  migrate15Tenders,
  moneyDrift,
  newBuilding,
  step,
  streetCandidates,
  streetNameAt,
  TENDER,
  tenderOffers,
  validateCommand,
} from '../src/index.ts';

const days = (s: GameState, n: number) => {
  for (let i = 0; i < n * TICKS_PER_DAY; i++) step(s);
};

/** Primer sitio donde se puede construir `kind`. */
function spot(s: GameState, kind: 'water' | 'power' = 'water'): { x: number; y: number } {
  for (let y = 0; y < s.map.h; y++) {
    for (let x = 0; x < s.map.w; x++) if (validateCommand(s, { type: 'Build', kind, x, y }).ok) return { x, y };
  }
  throw new Error('sin sitio');
}

/** Lucía (la concejala) con una tienda: hay primo. */
function withCrony(s: GameState) {
  s.townhallLevel = 2;
  const lucia = s.citizens[0]!;
  const hall = s.buildings[0]!;
  const shop = newBuilding(s, 'shop', hall.x - 3, hall.y + 2, lucia.id);
  shop.built = true;
  shop.name = 'Tienda de Lucía';
  return { lucia, shop };
}

describe('licitaciones (2.2)', () => {
  it('«local» da el mismo hash que una obra sin licitación', () => {
    const a = createInitialState({ seed: 7 });
    const b = createInitialState({ seed: 7 });
    const at = spot(a);
    expect(applyCommand(a, { type: 'Build', kind: 'water', ...at }).ok).toBe(true);
    expect(applyCommand(b, { type: 'Build', kind: 'water', ...at, offer: 'local' }).ok).toBe(true);
    expect(hashState(a)).toBe(hashState(b));
    days(a, 10);
    days(b, 10);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.tenders).toBeUndefined();
  });

  it('las obras pequeñas no se licitan', () => {
    const s = createInitialState({ seed: 7 });
    const at = spot(s);
    expect(materialsCost(s, 'house', at.x, at.y)).toBeLessThan(TENDER.minCost);
    expect(validateCommand(s, { type: 'Build', kind: 'house', ...at, offer: 'fuera' }).ok).toBe(false);
    // Y con el ayuntamiento de nivel 1, ninguna.
    expect(validateCommand(s, { type: 'Build', kind: 'water', ...at, offer: 'fuera' }).ok).toBe(false);
    s.townhallLevel = 2;
    expect(validateCommand(s, { type: 'Build', kind: 'water', ...at, offer: 'fuera' }).ok).toBe(true);
  });

  it('cada oferta cuadra el dinero y la de fuera no da jornal a los del pueblo', () => {
    for (const offer of ['local', 'fuera', 'primo'] as const) {
      for (const seed of [1, 2, 3, 4]) {
        const s = createInitialState({ seed });
        withCrony(s);
        const at = spot(s);
        const before = s.treasury;
        expect(applyCommand(s, { type: 'Build', kind: 'water', ...at, offer }).ok).toBe(true);
        const mat = materialsCost(s, 'water', at.x, at.y);
        const paid = before - s.treasury;
        if (offer === 'local') expect(paid).toBe(mat);
        else if (offer === 'fuera') expect(paid).toBe(Math.round(mat * TENDER.cheap.mat));
        else expect(paid).toBe(Math.round(mat * TENDER.crony.mat));
        if (offer === 'fuera') expect(s.projects[0]!.offer).toBe('fuera');
        days(s, 40);
        expect(moneyDrift(s)).toBe(0);
        expect(checkInvariants(s)).toEqual([]);
        expect(s.buildings.find((b) => b.kind === 'water')!.built).toBe(true);
      }
    }
  });

  it('la del primo deja la comisión en la caja de su negocio', () => {
    const s = createInitialState({ seed: 3 });
    const { shop, lucia } = withCrony(s);
    expect(cronyOf(s)?.owner.id).toBe(lucia.id);
    const at = spot(s);
    const mat = materialsCost(s, 'water', at.x, at.y);
    expect(applyCommand(s, { type: 'Build', kind: 'water', ...at, offer: 'primo' }).ok).toBe(true);
    expect(shop.cash).toBe(Math.round(mat * TENDER.crony.kick));
    expect(s.tenders![0]).toMatchObject({ offer: 'primo', councillorId: lucia.id, ownerId: lucia.id, status: 'firmado' });
  });

  it('sin primo con negocio no hay oferta del primo', () => {
    const s = createInitialState({ seed: 3 });
    s.townhallLevel = 2;
    const at = spot(s);
    expect(tenderOffers(s, 'water', at.x, at.y).find((o) => o.offer === 'primo')!.available).toBe(false);
    expect(validateCommand(s, { type: 'Build', kind: 'water', ...at, offer: 'primo' }).ok).toBe(false);
  });

  it('el riesgo se dice en palabras, nunca en %', () => {
    const s = createInitialState({ seed: 3 });
    withCrony(s);
    const at = spot(s);
    for (const o of tenderOffers(s, 'water', at.x, at.y)) expect(`${o.risk} ${o.who}`).not.toMatch(/%|\d+ ?por ?ciento/);
  });

  it('escándalo sin director: rumor a los 14 días y estallido a los 28', () => {
    const s = createInitialState({ seed: 3 });
    withCrony(s);
    const at = spot(s);
    applyCommand(s, { type: 'Build', kind: 'water', ...at, offer: 'primo' });
    const t = s.tenders![0]!;
    t.risk = true;
    s.politics.campaign.jubilados = 2;
    days(s, TENDER.warnDays);
    expect(t.status).toBe('avisado');
    expect(s.events.some((e) => e.text.startsWith('Se comenta en el bar'))).toBe(true);
    days(s, TENDER.revealDays - TENDER.warnDays);
    expect(t.status).toBe('estallado');
    expect(s.politics.campaign.jubilados).toBe(1);
    expect(s.citizens[0]!.memories.some((m) => m.kind === 'escandalo')).toBe(true);
    expect(s.events.some((e) => e.kind === 'crime' && e.text.startsWith('Escándalo'))).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('«Revisar el contrato» durante el rumor lo anula pagando el 10 %', () => {
    const s = createInitialState({ seed: 3 });
    withCrony(s);
    const at = spot(s);
    applyCommand(s, { type: 'Build', kind: 'water', ...at, offer: 'primo' });
    const t = s.tenders![0]!;
    t.risk = true;
    expect(validateCommand(s, { type: 'ReviewContract', buildingId: t.buildingId }).ok).toBe(false);
    days(s, TENDER.warnDays);
    const before = s.treasury;
    expect(applyCommand(s, { type: 'ReviewContract', buildingId: t.buildingId }).ok).toBe(true);
    expect(before - s.treasury).toBe(Math.round(t.mat * TENDER.cancelFee));
    expect(t.status).toBe('revisado');
    days(s, 20);
    expect(t.status).toBe('revisado');
    expect(moneyDrift(s)).toBe(0);
  });

  it('sin riesgo, el contrato se cierra sin rumor', () => {
    const s = createInitialState({ seed: 3 });
    withCrony(s);
    applyCommand(s, { type: 'Build', kind: 'water', ...spot(s), offer: 'primo' });
    s.tenders![0]!.risk = false;
    days(s, TENDER.revealDays + 1);
    expect(s.tenders![0]!.status).toBe('cerrado');
    expect(s.events.some((e) => e.text.startsWith('Se comenta en el bar'))).toBe(false);
  });

  it('escándalo con director: no estalla solo; lo elige el director tras avisarlo', () => {
    const s = createInitialState({ seed: 3, aiMode: true });
    withCrony(s);
    applyCommand(s, { type: 'Build', kind: 'water', ...spot(s), offer: 'primo' });
    const t = s.tenders![0]!;
    t.risk = true;
    // El director dirige: cada día, como si la IA hubiera respondido el turno.
    for (let i = 0; i < (TENDER.revealDays + 2) * TICKS_PER_DAY; i++) {
      s.ai!.directed = true;
      step(s);
    }
    expect(t.status).toBe('avisado');
    const id = `licitacion:${t.buildingId}`;
    expect(directorMenu(s).some((c) => c.id === id && c.bad && c.owed)).toBe(true);
    // Sin aviso previo del director, no pasa.
    applyDirector(s, { sucesos: [{ id, motivo: '' }], avisos: [] });
    expect(t.status).toBe('avisado');
    applyDirector(s, { sucesos: [], avisos: [{ id, motivo: '' }] });
    s.tick += 1;
    applyDirector(s, { sucesos: [{ id, motivo: 'se sabe' }], avisos: [] });
    expect(t.status).toBe('estallado');
  });

  it('con director, si nunca lo elige, se olvida', () => {
    const s = createInitialState({ seed: 3, aiMode: true });
    withCrony(s);
    applyCommand(s, { type: 'Build', kind: 'water', ...spot(s), offer: 'primo' });
    const t = s.tenders![0]!;
    t.risk = true;
    for (let i = 0; i < (TENDER.revealDays + TENDER.forgetDays + 1) * TICKS_PER_DAY; i++) {
      s.ai!.directed = true;
      step(s);
    }
    expect(t.status).toBe('olvidado');
  });

  it('si el concejal se va, el contrato queda sin ids y las invariantes cuadran', () => {
    const s = createInitialState({ seed: 3 });
    withCrony(s);
    applyCommand(s, { type: 'Build', kind: 'water', ...spot(s), offer: 'primo' });
    const t = s.tenders![0]!;
    t.councillorId = 9999;
    expect(checkInvariants(s).some((e) => e.includes('concejal'))).toBe(true);
  });
});

/** Un pueblo con pleno abierto y una vecina fallecida candidata. */
function plenoTown(): GameState {
  const s = createInitialState({ seed: 11 });
  const lucia = s.citizens[0]!;
  s.citizens.push({ ...structuredClone(lucia), id: s.nextId++, name: 'Rosario Martín', age: 74, money: 0, relations: [], memories: [] });
  s.departed.push({ id: s.nextId++, name: 'Andrés Gil', age: 88, tick: 0, reason: 'fallecio' });
  lucia.relations.push({ id: s.departed[0]!.id, kind: 'amistad', strength: 50, since: 0 });
  convenePleno(s);
  return s;
}

describe('calles con nombre (2.2)', () => {
  it('el pleno propone candidatos: fallecidos y mayores', () => {
    const s = plenoTown();
    const cs = streetCandidates(s);
    expect(cs[0]).toMatchObject({ name: 'Andrés Gil', kind: 'fallecido' });
    expect(cs.some((c) => c.name === 'Rosario Martín' && c.kind === 'mayor')).toBe(true);
    expect(s.pleno!.street!.candidates).toEqual(cs.map((c) => c.id));
  });

  it('dedicar una calle: placa, nombre del motor, felicidad, foto; y el derribo la borra', () => {
    const s = plenoTown();
    const hall = s.buildings[0]!;
    const andres = s.departed[0]!.id;
    const lucia = s.citizens[0]!;
    const happy = lucia.happiness;
    const before = s.treasury;
    // Fuera de carretera, no.
    expect(validateCommand(s, { type: 'DedicateStreet', citizenId: andres, x: 0, y: 0 }).ok).toBe(false);
    const x = hall.x;
    const y = hall.y + 1;
    expect(applyCommand(s, { type: 'DedicateStreet', citizenId: andres, x, y }).ok).toBe(true);
    expect(before - s.treasury).toBe(150);
    expect(s.streetNames![0]).toMatchObject({ name: 'Calle de Andrés Gil', axis: 'h', citizenId: andres });
    expect(lucia.happiness).toBe(Math.min(100, happy + 4));
    expect(s.album.some((m) => m.kind === 'calle')).toBe(true);
    // Todo el tramo recto lleva el nombre y solo uno por pleno.
    expect(streetNameAt(s, x + 2, y)?.name).toBe('Calle de Andrés Gil');
    expect(validateCommand(s, { type: 'DedicateStreet', citizenId: s.citizens[1]!.id, x: x + 1, y }).ok).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
    // Derribar un trozo del tramo borra el nombre.
    expect(applyCommand(s, { type: 'Demolish', x: x + 2, y }).ok).toBe(true);
    expect(s.streetNames).toEqual([]);
    expect(checkInvariants(s)).toEqual([]);
    expect(moneyDrift(s)).toBe(0);
  });

  it('el director puede pedir un homenaje: pone a ese vecino primero', () => {
    const s = createInitialState({ seed: 11, aiMode: true });
    const p = plenoTown();
    s.citizens = p.citizens;
    s.departed = p.departed;
    s.nextId = p.nextId;
    convenePleno(s);
    const second = s.pleno!.street!.candidates[1]!;
    const c = directorMenu(s).find((m) => m.id === `homenaje:${second}`);
    expect(c?.bad).toBe(false);
    applyDirector(s, { sucesos: [{ id: c!.id, motivo: '' }], avisos: [] });
    expect(s.pleno!.street!.candidates[0]).toBe(second);
  });
});

describe('migración 14 → 15 (2.2, licitaciones y calles)', () => {
  it('añade licitaciones y calles vacías', () => {
    const s = createInitialState({ seed: 2 });
    const old: Record<string, unknown> = { ...structuredClone(s), formatVersion: 14 };
    delete old.streetNames;
    const m = migrate(old);
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    expect(m.streetNames).toEqual([]);
    expect(m.tenders).toEqual([]);
    expect(migrate15Tenders({ streetNames: [{ x: 1 }] }).streetNames).toEqual([{ x: 1 }]);
  });
});
