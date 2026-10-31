import { DAYS_PER_YEAR, TICKS_PER_DAY } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import { dies, familyOf, lifeYear, runSimulation } from '../src/index.ts';

describe('álbum del pueblo (v1.7)', () => {
  it('en dos años quedan momentos clave, sin repetir los «primeros», y con sitio en el mapa', () => {
    const { state } = runSimulation({ seed: 2, days: 2 * DAYS_PER_YEAR, profile: 'constructor', checkEveryDay: false });
    expect(state.album.length).toBeGreaterThan(4);
    expect(state.album.some((m) => m.kind === 'primer_house')).toBe(true);
    expect(state.album.some((m) => m.kind === 'primer_pob_10')).toBe(true);
    const firsts = state.album.filter((m) => m.kind.startsWith('primer')).map((m) => m.kind);
    expect(new Set(firsts).size).toBe(firsts.length);
    for (const m of state.album) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThan(state.map.h);
    }
  }, 60_000);
});

describe('árbol genealógico (v1.7)', () => {
  it('el hijo que se independiza tiene padres; quien fallece sigue en el árbol', () => {
    const { state: s } = runSimulation({ seed: 3, days: 400, profile: 'constructor' });
    const [a, b] = s.citizens.filter((c) => c.named && c.homeId !== null);
    a!.relations = [{ id: b!.id, kind: 'pareja', strength: 90, since: 0 }];
    b!.relations = [{ id: a!.id, kind: 'pareja', strength: 90, since: 0 }];
    a!.kids = [s.tick - 18 * DAYS_PER_YEAR * TICKS_PER_DAY];
    // Que haya casa libre para el hijo.
    const home = s.buildings.find((x) => x.kind === 'house' && x.built)!;
    for (const c of s.citizens) if (c.homeId === home.id && c.id !== a!.id && c.id !== b!.id) c.homeId = null;
    lifeYear(s);
    const kid = s.citizens.find((c) => c.parents?.includes(a!.id));
    expect(kid).toBeDefined();
    if (!kid) return;
    expect(kid.parents).toEqual([a!.id, b!.id]);
    dies(s, a!);
    const fam = familyOf(s, kid.id)!;
    expect(fam.parents.map((p) => p.id).sort()).toEqual([a!.id, b!.id].sort());
    expect(fam.parents.find((p) => p.id === a!.id)!.status).toBe('fallecio');
    const famA = familyOf(s, a!.id)!;
    expect(famA.self.status).toBe('fallecio');
    expect(famA.partner?.id).toBe(b!.id);
    expect(famA.children.map((c) => c.id)).toContain(kid.id);
  });
});
