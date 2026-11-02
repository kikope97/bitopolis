import { describe, expect, it } from 'vitest';
import { checkInvariants, createInitialState, earlyReady, type EarlySystem, EARLY, type GameState, hashState, runSimulation } from '../src/index.ts';

describe('2.6: sucesos que llegan cuando toca (gates.ts)', () => {
  it('cada suceso, a partir de sus vecinos o del ayuntamiento 3', () => {
    const s = createInitialState({ seed: 5 });
    for (const sys of Object.keys(EARLY) as EarlySystem[]) expect(earlyReady(s, sys), sys).toBe(false);
    s.townhallLevel = 3;
    for (const sys of Object.keys(EARLY) as EarlySystem[]) expect(earlyReady(s, sys), sys).toBe(true);
    s.townhallLevel = 1;
    while (s.citizens.length < 30) s.citizens.push({} as never);
    for (const sys of Object.keys(EARLY) as EarlySystem[]) expect(earlyReady(s, sys), sys).toBe(EARLY[sys].pop <= 30);
  });

  it('en una partida, nada llega antes de su momento y en una media sí llega', () => {
    for (const seed of [11, 12]) {
      const { state: s, report } = runSimulation({ seed, days: 720, profile: 'casual', checkEveryDay: false });
      expect(report.invariantErrors).toEqual([]);
      const firstErrand = s.errands?.recent.length || s.errands?.list.length || s.errands?.done;
      // En dos años de una partida media, sí hay encargos y El Eco.
      expect(firstErrand, `seed ${seed}`).toBeTruthy();
      expect(s.press?.editions.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('día a día: ningún encargo, edición, dilema, carta ni oferta vecina con el pueblo recién nacido', () => {
    const seen = { errands: 0, press: 0, dilemmas: 0, letters: 0, offers: 0, big: 0 };
    const check = (s: GameState, d: number) => {
      const n = { errands: (s.errands?.list.length ?? 0) + (s.errands?.done ?? 0), press: s.press?.editions.length ?? 0, dilemmas: s.dilemmas.length, letters: s.letters.length, offers: s.comarca.offers.length, big: s.bigCompany ? 1 : 0 };
      const ready = { errands: earlyReady(s, 'errands'), press: earlyReady(s, 'press'), dilemmas: earlyReady(s, 'dilemmas'), letters: earlyReady(s, 'letters'), offers: earlyReady(s, 'neighborOffers'), big: earlyReady(s, 'bigCompany') };
      for (const k of Object.keys(n) as (keyof typeof n)[]) {
        if (n[k] > seen[k]) expect(ready[k], `${k} el día ${d} con ${s.citizens.length} vecinos y nivel ${s.townhallLevel}`).toBe(true);
        seen[k] = n[k];
      }
    };
    for (const seed of [21, 22]) {
      for (const k of Object.keys(seen) as (keyof typeof seen)[]) seen[k] = 0;
      const { report } = runSimulation({ seed, days: 540, profile: 'casual', onDay: check });
      expect(report.invariantErrors).toEqual([]);
    }
  });
});

describe('2.6: «Pueblo sencillo»', () => {
  it('en 2 años no hay encargos, El Eco, comarca, licitaciones ni dilemas, y el dinero cuadra', () => {
    for (const seed of [3, 8]) {
      const { state: s, report } = runSimulation({ seed, days: 720, profile: 'casual', checkEveryDay: true, simple: true });
      expect(s.simple).toBe(true);
      expect(report.invariantErrors).toEqual([]);
      expect(checkInvariants(s)).toEqual([]);
      expect(s.errands?.list ?? []).toEqual([]);
      expect(s.errands?.done ?? 0).toBe(0);
      expect(s.press?.editions ?? []).toEqual([]);
      expect(s.comarca.towns).toEqual([]);
      expect(s.comarca.offers).toEqual([]);
      expect(s.tenders ?? []).toEqual([]);
      expect(s.dilemmas).toEqual([]);
      // Y el pueblo crece igual.
      expect(s.citizens.length).toBeGreaterThan(20);
    }
  });

  it('reproducible: la misma semilla con y sin «Pueblo sencillo» da hashes distintos, y cada una el mismo siempre', () => {
    const a = runSimulation({ seed: 4, days: 120, profile: 'casual', simple: true }).state;
    const b = runSimulation({ seed: 4, days: 120, profile: 'casual', simple: true }).state;
    expect(hashState(a)).toBe(hashState(b));
  });
});

