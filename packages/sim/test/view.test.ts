import { describe, expect, it } from 'vitest';
import { DAYS_PER_YEAR } from '@bitopolis/shared';
import { hashState, runSimulation, viewSnapshot } from '../src/index.ts';

/**
 * 2.3: la vista de solo lectura (/v/<token>) es una lista blanca. Si aparece
 * una clave nueva, este test falla: decide si se puede enseñar y añádela aquí.
 */
const TOP = [
  'album', 'buildings', 'crest', 'dikes', 'history', 'landmarks', 'map', 'medals', 'projects', 'records', 'streetNames', 'summary', 'tick',
  'townhallLevel', 'view', 'weather',
];
const BUILDING = ['built', 'crop', 'damaged', 'fire', 'hasPower', 'hasWater', 'id', 'kind', 'level', 'name', 'rural', 'size', 'trash', 'x', 'y'];
const SUMMARY = ['happiness', 'name', 'population', 'rank', 'rankLevel', 'visitors'];
const MOMENT = ['caption', 'kind', 'text', 'tick', 'x', 'y'];
const FORBIDDEN = ['rng', 'seed', 'ai', 'pending', 'decisionLog', 'notes', 'thought', 'debt', 'cash', 'owner', 'citizens', 'treasury', 'key', 'token', 'citizenId', 'books', 'flow', 'ledger'];

function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) allKeys(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    out.add(k);
    allKeys(x, out);
  }
  return out;
}

describe('viewSnapshot (2.3, compartir)', () => {
  const { state } = runSimulation({ seed: 4, days: DAYS_PER_YEAR, profile: 'constructor', checkEveryDay: false });
  state.buildings[0]!.damaged = { cost: 900, repairUntil: state.tick + 10, cause: 'fuego' };
  const v = viewSnapshot(state);

  it('solo lleva las claves permitidas', () => {
    expect(Object.keys(v).sort()).toEqual([...TOP].sort());
    for (const b of v.buildings) for (const k of Object.keys(b)) expect(BUILDING).toContain(k);
    expect(Object.keys(v.summary).sort()).toEqual([...SUMMARY].sort());
    for (const m of v.album) for (const k of Object.keys(m)) expect(MOMENT).toContain(k);
    expect(v.buildings[0]!.damaged).toEqual({ cause: 'fuego' });
  });

  it('nunca lleva estado interno, vecinos, deudas ni dinero', () => {
    // La historia y los récords del pueblo (caja del ayuntamiento incluida) sí se enseñan: el resto, no.
    const rest: Record<string, unknown> = { ...v };
    delete rest.history;
    delete rest.records;
    const keys = allKeys(rest);
    for (const k of FORBIDDEN) expect(keys.has(k), k).toBe(false);
    expect(allKeys(v.history).has('citizens')).toBe(false);
    expect(JSON.stringify(v)).not.toContain('"seed"');
  });

  it('enseña el pueblo tal cual y no toca el estado', () => {
    const before = hashState(state);
    const again = viewSnapshot(state);
    expect(hashState(state)).toBe(before);
    expect(again).toEqual(v);
    expect(v.summary.population).toBe(state.citizens.length);
    expect(v.buildings.length).toBe(state.buildings.length);
    expect(v.map.tiles).toEqual(state.map.tiles);
    expect(v.map.terrain).toEqual(state.map.terrain);
    expect(v.album.length).toBe(state.album.length);
    v.map.tiles[0] = 99;
    expect(state.map.tiles[0]).not.toBe(99);
  });
});
