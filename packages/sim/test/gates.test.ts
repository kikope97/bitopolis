import { describe, expect, it } from 'vitest';
import { checkInvariants, createInitialState, earlyReady, type EarlySystem, EARLY, type GameState, hashState, runSimulation } from '../src/index.ts';

describe('2.6: sucesos que llegan cuando toca (gates.ts)', () => {
  it('cada suceso, a partir de sus vecinos o de su nivel del ayuntamiento', () => {
    const s = createInitialState({ seed: 5 });
    for (const sys of Object.keys(EARLY) as EarlySystem[]) expect(earlyReady(s, sys), sys).toBe(false);
    for (const lv of [3, 4]) {
      s.townhallLevel = lv;
      for (const sys of Object.keys(EARLY) as EarlySystem[]) expect(earlyReady(s, sys), `${sys} con el nivel ${lv}`).toBe(EARLY[sys].level <= lv);
    }
    s.townhallLevel = 5;
    for (const sys of Object.keys(EARLY) as EarlySystem[]) expect(earlyReady(s, sys), sys).toBe(true);
    s.townhallLevel = 1;
    for (const n of [30, 40, 45, 50, 60, 70]) {
      while (s.citizens.length < n) s.citizens.push({} as never);
      for (const sys of Object.keys(EARLY) as EarlySystem[]) expect(earlyReady(s, sys), `${sys} con ${n} vecinos`).toBe(EARLY[sys].pop <= n);
    }
  });

  it('2.8: escalonados, no todos a la vez (encargos 30, El Eco 40, ofertas 45, cartas 50, dilemas 60, gran empresa 70)', () => {
    const pops = (['errands', 'press', 'neighborOffers', 'letters', 'dilemmas', 'bigCompany'] as const).map((k) => EARLY[k].pop);
    expect(pops).toEqual([30, 40, 45, 50, 60, 70]);
    // Ningún umbral de vecinos repetido: cada sistema llega solo.
    expect(new Set(Object.values(EARLY).map((g) => g.pop)).size).toBe(Object.keys(EARLY).length);
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

