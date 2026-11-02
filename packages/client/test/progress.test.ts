import { describe, expect, it } from 'vitest';
import { createInitialState, OUTSIDE, runSimulation, transfer, TREASURY } from '@bitopolis/sim';
import { hubWants, loansWanted, Reveal, trayCatsWanted } from '../src/progress.ts';

/** Almacén en memoria (como localStorage). */
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('2.6: panel «Pueblo» progresivo', () => {
  it('un pueblo nuevo solo pide lo básico', () => {
    const s = createInitialState({ seed: 1 });
    transfer(s, OUTSIDE, TREASURY, 30_000, 'subvencion');
    const w = hubWants(s);
    expect(Object.entries(w).filter(([, v]) => v).map(([k]) => k)).toEqual([]);
  });

  it('un pueblo con años lo enseña casi todo', () => {
    const { state: s } = runSimulation({ seed: 3, days: 720, profile: 'casual', checkEveryDay: false });
    s.townhallLevel = Math.max(3, s.townhallLevel);
    const w = hubWants(s);
    for (const k of ['advisor', 'diary', 'album', 'history', 'medals', 'rank', 'region', 'neighbors', 'budget', 'pleno'] as const) expect(w[k], k).toBe(true);
  });

  it('préstamos: con la caja en negativo o muy por debajo de lo habitual, o con un préstamo vivo', () => {
    const s = createInitialState({ seed: 2 });
    transfer(s, OUTSIDE, TREASURY, 30_000, 'subvencion');
    expect(loansWanted(s)).toBe(false);
    s.stats.push({ month: 1, population: 5, treasury: s.treasury, happiness: 60, income: 0, expenses: 0, breakdown: {} });
    transfer(s, TREASURY, OUTSIDE, s.treasury - Math.floor(s.treasury * 0.1), 'obras');
    expect(loansWanted(s)).toBe(true);
    transfer(s, OUTSIDE, TREASURY, s.stats[0]!.treasury, 'subvencion');
    expect(loansWanted(s)).toBe(false);
    s.loans.push({} as never);
    expect(loansWanted(s)).toBe(true);
  });

  it('«Pueblo sencillo»: sin pueblos vecinos, encargos ni El Eco', () => {
    const { state: s } = runSimulation({ seed: 3, days: 720, profile: 'casual', checkEveryDay: false, simple: true });
    s.townhallLevel = Math.max(3, s.townhallLevel);
    const w = hubWants(s);
    expect([w.neighbors, w.errands, w.press]).toEqual([false, false, false]);
    expect(w.region).toBe(true);
  });

  it('bandeja: con el ayuntamiento 1 se ocultan las categorías lejanas', () => {
    const s = createInitialState({ seed: 1 });
    const cats = trayCatsWanted(s);
    expect(cats).toContain('Lo básico');
    expect(cats).toContain('Zonas (los vecinos construyen)');
    for (const t of ['Grandes obras', 'Turismo', 'Transporte', 'Premios de los hitos']) expect(cats).not.toContain(t);
    expect(cats).not.toContain('Cuidados');
    // Con el 2 y vecinos, lo que llega con el 3 ya se ve (con su candado).
    s.townhallLevel = 2;
    while (s.citizens.length < 30) s.citizens.push({} as never);
    expect(trayCatsWanted(s)).toContain('Cuidados');
    expect(trayCatsWanted(s)).not.toContain('Premios de los hitos');
  });
});

describe('2.6: marca «Nuevo»', () => {
  it('la primera vez entra todo sin marca; lo que llega después, con «Nuevo» hasta abrirlo', () => {
    const store = memory();
    const r = new Reveal('k', store);
    r.update(['hub:a', 'tray:b']);
    expect(r.shown('hub:a')).toBe(true);
    expect(r.isNew('hub:a')).toBe(false);
    r.update(['hub:a', 'hub:c']);
    expect(r.isNew('hub:c')).toBe(true);
    expect(r.anyNew('hub:')).toBe(true);
    // Se guarda: otra pestaña lo ve igual; y lo que ya salió se queda aunque deje de pedirse.
    const again = new Reveal('k', store);
    again.update([]);
    expect(again.shown('tray:b')).toBe(true);
    expect(again.isNew('hub:c')).toBe(true);
    again.seen('hub:c');
    expect(new Reveal('k', store).isNew('hub:c')).toBe(false);
  });

  it('sin almacenamiento funciona igual (sin recordar)', () => {
    const r = new Reveal('k', null);
    r.update(['x']);
    r.update(['x', 'y']);
    expect(r.isNew('y')).toBe(true);
  });
});
