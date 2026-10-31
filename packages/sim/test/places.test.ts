import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  checkInvariants,
  dies,
  festivalMood,
  type GameState,
  happinessFactors,
  OUTSIDE,
  runSimulation,
  step,
  transfer,
  TREASURY,
  validateCommand,
} from '../src/index.ts';

function town(): GameState {
  const { state } = runSimulation({ seed: 3, days: 400, profile: 'constructor' });
  transfer(state, OUTSIDE, TREASURY, 60_000, 'subvencion');
  return state;
}

/** Construye `kind` en el sitio válido más cercano a (x, y) y espera a que termine. */
function buildNear(s: GameState, kind: 'bar' | 'chapel' | 'cemetery' | 'library' | 'sports', x: number, y: number): boolean {
  const spots: [number, number][] = [];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) spots.push([dx, dy]);
  spots.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]));
  for (const [dx, dy] of spots) {
    if (applyCommand(s, { type: 'Build', kind, x: x + dx, y: y + dy }).ok) {
      for (let i = 0; i < 24 * 12 && s.projects.length; i++) step(s);
      return s.buildings.some((b) => b.kind === kind && b.built);
    }
  }
  return false;
}

describe('lugares de vida social (v1.7)', () => {
  it('se desbloquean con el nivel del ayuntamiento', () => {
    const { state } = runSimulation({ seed: 1, days: 5, profile: 'casual' });
    transfer(state, OUTSIDE, TREASURY, 60_000, 'subvencion');
    const r = validateCommand(state, { type: 'Build', kind: 'library', x: 1, y: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nivel 3/);
  });

  it('la biblioteca alegra más a quien quiere prosperar', () => {
    const s = town();
    s.townhallLevel = 5;
    const c = s.citizens.find((x) => x.named && x.homeId !== null)!;
    c.desire = 'prosperar';
    const home = s.buildings.find((b) => b.id === c.homeId)!;
    expect(buildNear(s, 'library', home.x, home.y)).toBe(true);
    expect(happinessFactors(s, c).some((f) => f.label.startsWith('Biblioteca'))).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('con cementerio el duelo pesa la mitad y la despedida es allí', () => {
    const a = town();
    const b = structuredClone(a);
    const hall = a.buildings.find((x) => x.kind === 'townhall')!;
    expect(buildNear(b, 'cemetery', hall.x, hall.y)).toBe(true);
    for (const s of [a, b]) {
      const [x, y] = s.citizens.filter((c) => c.named);
      x!.relations = [{ id: y!.id, kind: 'pareja', strength: 90, since: 0 }];
      y!.relations = [{ id: x!.id, kind: 'pareja', strength: 90, since: 0 }];
      dies(s, x!);
    }
    const grief = (s: GameState) => s.citizens.flatMap((c) => c.memories).filter((m) => m.kind === 'perdio_a').at(-1)!.valence;
    expect(Math.abs(grief(b))).toBeLessThan(Math.abs(grief(a)));
    expect(b.events.at(-1)!.text).toMatch('cementerio');
    // Sin cementerio, quien ha perdido a alguien lo nota.
    const widow = a.citizens.find((c) => c.memories.some((m) => m.kind === 'perdio_a'))!;
    expect(happinessFactors(a, widow).some((f) => f.label.startsWith('Sin cementerio'))).toBe(true);
  });

  it('con ermita las fiestas alegran más', () => {
    const s = town();
    s.festival = { name: 'Santa Farola', year: 1, size: 'pequena', until: s.tick + 24 * 30 };
    const before = festivalMood(s)!.value;
    const hall = s.buildings.find((x) => x.kind === 'townhall')!;
    expect(buildNear(s, 'chapel', hall.x, hall.y)).toBe(true);
    expect(festivalMood(s)!.value).toBeGreaterThan(before);
  });
});
