import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  checkInvariants,
  OUTSIDE,
  plantCapacityOf,
  radiusOf,
  runSimulation,
  serviceCapacityOf,
  step,
  transfer,
  TREASURY,
  UPGRADABLE,
  validateCommand,
} from '../src/index.ts';

describe('niveles de los servicios (v1.8)', () => {
  it('subir de nivel pide ayuntamiento, vecinos, uso y dinero; tarda unos días y da más', () => {
    // Un pueblo donde algún servicio ya se usa lo bastante (depende de la semilla).
    let s = runSimulation({ seed: 3, days: 1200, profile: 'constructor', checkEveryDay: false }).state;
    for (const seed of [1, 2, 4, 5, 6]) {
      const t = structuredClone(s);
      t.townhallLevel = 5;
      transfer(t, OUTSIDE, TREASURY, 200_000, 'subvencion');
      if (t.buildings.some((b) => b.built && UPGRADABLE.includes(b.kind) && validateCommand(t, { type: 'UpgradeBuilding', buildingId: b.id }).ok)) break;
      s = runSimulation({ seed, days: 1200, profile: 'constructor', checkEveryDay: false }).state;
    }
    const services = s.buildings.filter((b) => b.built && UPGRADABLE.includes(b.kind));
    expect(services.length).toBeGreaterThan(0);
    // Con el ayuntamiento en nivel 1, ninguno.
    s.townhallLevel = 1;
    for (const b of services) {
      const r = validateCommand(s, { type: 'UpgradeBuilding', buildingId: b.id });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Ayuntamiento de nivel 3/);
    }
    // Con ayuntamiento y dinero, alguno que ya se usa mucho sí; los poco usados, no.
    s.townhallLevel = 5;
    transfer(s, OUTSIDE, TREASURY, 200_000, 'subvencion');
    const results = services.map((b) => ({ b, r: validateCommand(s, { type: 'UpgradeBuilding', buildingId: b.id }) }));
    for (const { r } of results) if (!r.ok) expect(r.error).toMatch(/Falta: (Que se use|\d+ vecinos)/);
    const target = results.find((x) => x.r.ok)?.b;
    expect(target).toBeTruthy();
    const b = target!;
    const before = { r: radiusOf(b), cap: serviceCapacityOf(b) + plantCapacityOf(b) };
    const money = s.treasury;
    expect(applyCommand(s, { type: 'UpgradeBuilding', buildingId: b.id }).ok).toBe(true);
    expect(s.treasury).toBeLessThan(money);
    expect(b.upgradeUntil).toBeGreaterThan(s.tick);
    expect(validateCommand(s, { type: 'UpgradeBuilding', buildingId: b.id }).ok).toBe(false); // ya en obra
    for (let i = 0; i < 24 * 8; i++) step(s);
    expect(b.level).toBe(2);
    expect(b.upgradeUntil).toBeUndefined();
    expect(radiusOf(b) + serviceCapacityOf(b) + plantCapacityOf(b)).toBeGreaterThan(before.r + before.cap);
    expect(s.events.some((e) => e.text.includes('sube a nivel 2'))).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  }, 240_000);
});
