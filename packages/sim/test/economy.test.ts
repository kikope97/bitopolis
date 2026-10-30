import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  buyHome,
  canBuyHome,
  checkInvariants,
  createInitialState,
  type GameState,
  migrate,
  monthRates,
  newBuilding,
  runSimulation,
  sellOnDeparture,
  step,
  taxMood,
  unitValue,
  updateFields,
  updateGrudges,
} from '../src/index.ts';


/** Pueblo con una casa municipal habitada por Lucía. */
function withHouse(): { s: GameState; houseId: number } {
  const s = createInitialState({ seed: 11 });
  const cx = s.map.w / 2;
  const cy = s.map.h / 2;
  applyCommand(s, { type: 'Build', kind: 'water', x: cx - 2, y: cy + 1 });
  applyCommand(s, { type: 'Build', kind: 'power', x: cx - 1, y: cy + 1 });
  applyCommand(s, { type: 'Build', kind: 'house', x: cx + 2, y: cy + 1 });
  for (let i = 0; i < 24 * 5; i++) step(s);
  const house = s.buildings.find((b) => b.kind === 'house')!;
  return { s, houseId: house.id };
}

describe('vivienda', () => {
  it('la casa municipal solo se compra si está a la venta, con entrada, hipoteca y coste de transacción', () => {
    const { s, houseId } = withHouse();
    const lucia = s.citizens.find((c) => c.name === 'Lucía')!;
    expect(lucia.homeId).toBe(houseId);
    lucia.money += 5_000;
    s.ledger.externalIn += 5_000;
    expect(canBuyHome(s, lucia)).toBe(false);
    expect(applyCommand(s, { type: 'SetHousingMode', buildingId: houseId, mode: 'sale' }).ok).toBe(true);
    expect(canBuyHome(s, lucia)).toBe(true);
    const before = s.treasury;
    expect(buyHome(s, lucia)).toBe(true);
    expect(lucia.owns).toBe(true);
    expect(lucia.mortgage).toBeGreaterThan(0);
    // Sin banco: el ayuntamiento cobra entrada + gastos ahora y el resto en cuotas.
    expect(lucia.mortgageTo).toBe(0);
    expect(s.treasury - before).toBe(Math.ceil(lucia.boughtPrice * 0.2) + Math.ceil(lucia.boughtPrice * 0.04));
    expect(lucia.boughtPrice).toBeLessThanOrEqual(7_500);
    // Las cuotas (con interés) van al ayuntamiento.
    for (let i = 0; i < 24 * 30; i++) step(s);
    expect(s.stats.at(-1)!.breakdown['cuotas de vivienda']).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('al vender con ganancia se paga la plusvalía (y no antes de 90 días)', () => {
    const { s, houseId } = withHouse();
    const lucia = s.citizens.find((c) => c.name === 'Lucía')!;
    lucia.money += 5_000;
    s.ledger.externalIn += 5_000;
    applyCommand(s, { type: 'SetHousingMode', buildingId: houseId, mode: 'sale' });
    buyHome(s, lucia);
    // Venta inmediata: sin ganancia ni plusvalía; la vivienda vuelve al ayuntamiento.
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    const c2 = copy.citizens.find((c) => c.name === 'Lucía')!;
    c2.boughtPrice = 1_000;
    sellOnDeparture(copy, c2);
    expect(copy.month.breakdown['plusvalía']).toBeUndefined();
    expect(copy.buildings.find((b) => b.id === houseId)!.privateUnits).toBe(0);
    // Después de 90 días y con el precio de compra bajo: plusvalía.
    s.tick += 24 * 91;
    lucia.boughtPrice = 1_000;
    sellOnDeparture(s, lucia);
    expect(s.month.breakdown['plusvalía']).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('el valor depende del barrio (valor del suelo)', () => {
    const { s, houseId } = withHouse();
    const b = s.buildings.find((x) => x.id === houseId)!;
    const i = b.y * s.map.w + b.x;
    s.fields.land[i] = 20;
    const low = unitValue(s, b);
    s.fields.land[i] = 90;
    expect(unitValue(s, b)).toBeGreaterThan(low);
  });
});

describe('tributos', () => {
  it('el tipo efectivo del mes es la media diaria', () => {
    const s = createInitialState({ seed: 3 });
    for (let i = 0; i < 24 * 9; i++) step(s);
    applyCommand(s, { type: 'SetTax', level: 'high' });
    for (let i = 0; i < 24; i++) step(s);
    const r = monthRates(s);
    expect(r.ibi).toBeLessThan(0.075);
    expect(r.ibi).toBeGreaterThan(0.07);
  });

  it('SetTaxes solo con los tributos separados (50 vecinos)', () => {
    const s = createInitialState({ seed: 3 });
    expect(applyCommand(s, { type: 'SetTaxes', ibi: 'high' }).ok).toBe(false);
    s.taxesSplit = true;
    expect(applyCommand(s, { type: 'SetTaxes', ibi: 'high', tasas: 'low' }).ok).toBe(true);
    expect(s.taxes).toMatchObject({ ibi: 'high', tasas: 'low', plusvalia: 'medium' });
  });

  it('el IBI alto afecta más a los propietarios que a los inquilinos', () => {
    const s = createInitialState({ seed: 3 });
    s.taxesSplit = true;
    s.taxes.ibi = 'high';
    const c = s.citizens[0]!;
    const renter = taxMood(s, c).reduce((a, f) => a + f.value, 0);
    c.owns = true;
    const owner = taxMood(s, c).reduce((a, f) => a + f.value, 0);
    expect(owner).toBeLessThan(renter);
  });

  it('los vecinos recuerdan las subidas aunque se bajen después', () => {
    const s = createInitialState({ seed: 3 });
    s.taxLevel = 'high';
    updateGrudges(s);
    s.prevTaxLevel = 'high';
    s.taxLevel = 'low';
    for (let d = 0; d < 60; d++) updateGrudges(s);
    expect(s.citizens[0]!.grudge).toBeGreaterThan(4);
    expect(taxMood(s, s.citizens[0]!).some((f) => f.label.includes('subidas'))).toBe(true);
  });
});

describe('externalidades', () => {
  it('la contaminación industrial persiste tras cerrar el taller; la policía baja la delincuencia', () => {
    const s = createInitialState({ seed: 5 });
    const f = newBuilding(s, 'factory', 5, 5, -1);
    f.built = true;
    for (let d = 0; d < 30; d++) updateFields(s);
    const i = 5 * s.map.w + 5;
    const high = s.fields.pollution[i]!;
    expect(high).toBeGreaterThan(50);
    s.buildings = s.buildings.filter((b) => b !== f);
    for (let d = 0; d < 30; d++) updateFields(s);
    expect(s.fields.pollution[i]!).toBeGreaterThan(high / 3);
    // Delincuencia por densidad, reducida por la policía.
    const home = newBuilding(s, 'res', 20, 20, -1);
    home.built = true;
    for (const c of s.citizens) c.homeId = home.id;
    for (let k = 0; k < 12; k++) s.citizens.push({ ...s.citizens[0]!, id: 1000 + k, money: 0 });
    updateFields(s);
    const j = 20 * s.map.w + 20;
    const crime = s.fields.crime[j]!;
    const pol = newBuilding(s, 'police', 22, 20, 0);
    pol.built = true;
    updateFields(s);
    expect(s.fields.crime[j]!).toBeLessThan(crime);
  });
});

describe('economía a un año', () => {
  it('hay propietarios, se separan los tributos y el dinero cuadra', () => {
    const { state, report } = runSimulation({ seed: 1, days: 420, profile: 'constructor', checkEveryDay: true });
    expect(report.invariantErrors).toEqual([]);
    expect(state.citizens.some((c) => c.owns)).toBe(true);
    expect(state.taxesSplit).toBe(true);
    expect(state.stats.at(-1)!.breakdown.IBI).toBeGreaterThan(0);
  });

  it('migración 3 → 4', () => {
    const s = createInitialState({ seed: 1 }) as unknown as Record<string, any>;
    const v3 = JSON.parse(JSON.stringify(s));
    v3.formatVersion = 3;
    delete v3.taxes;
    delete v3.fields;
    delete v3.taxesSplit;
    v3.month = { income: 0, expenses: 0, breakdown: {}, taxRateSum: 3, taxDays: 1 };
    for (const c of v3.citizens) delete c.owns;
    const m = migrate(v3);
    expect(m.taxes).toEqual({ ibi: 'medium', tasas: 'medium', plusvalia: 'medium' });
    expect(m.fields.pollution.length).toBe(48 * 48);
    expect(m.citizens[0]!.owns).toBe(false);
    expect((m.month as any).taxRateSum).toBeUndefined();
  });
});

