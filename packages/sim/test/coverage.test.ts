import { describe, expect, it } from 'vitest';
import { applyCommand, coverageSummary, createInitialState, type GameState, missingServices, OUTSIDE, runSimulation, step, transfer, TREASURY } from '../src/index.ts';

function town(): GameState {
  const { state } = runSimulation({ seed: 3, days: 300, profile: 'constructor' });
  transfer(state, OUTSIDE, TREASURY, 30_000, 'subvencion');
  return state;
}

describe('qué falta en cada vivienda (v1.7, propuesta del creador)', () => {
  it('en un pueblo recién empezado solo se piden agua y luz (lo demás aún está bloqueado)', () => {
    const s = createInitialState({ seed: 1 });
    const hall = s.buildings[0]!;
    const needs = missingServices(s, hall.x + 1, hall.y + 2).map((n) => n.key);
    expect(needs).toEqual(['agua', 'luz']);
  });

  it('sin colegio cerca se pide colegio; al construirlo al lado, deja de pedirse', () => {
    const s = town();
    expect(s.citizens.length).toBeGreaterThanOrEqual(25);
    // Sin colegios en el pueblo (quien trabajaba allí, al paro).
    const schools = new Set(s.buildings.filter((b) => b.kind === 'school').map((b) => b.id));
    s.buildings = s.buildings.filter((b) => !schools.has(b.id));
    for (const c of s.citizens) if (c.jobId !== null && schools.has(c.jobId)) c.jobId = null;
    const home = s.buildings.find((b) => b.kind === 'house' && b.built)!;
    expect(missingServices(s, home.x, home.y).find((n) => n.key === 'colegio')?.status).toBe('falta');
    let built = false;
    // El sitio válido más cercano (dentro del radio del colegio, 8 casillas).
    const spots: [number, number][] = [];
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (Math.abs(dx) + Math.abs(dy) <= 6) spots.push([dx, dy]);
    spots.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]));
    for (const [dx, dy] of spots) {
      if (applyCommand(s, { type: 'Build', kind: 'school', x: home.x + dx, y: home.y + dy }).ok) {
        built = true;
        break;
      }
    }
    expect(built).toBe(true);
    for (let i = 0; i < 24 * 15 && s.projects.length; i++) step(s);
    expect(missingServices(s, home.x, home.y).some((n) => n.key === 'colegio' && n.status === 'falta')).toBe(false);
  });

  it('el resumen cuenta viviendas y solares R y es puro (no cambia el estado)', () => {
    const s = town();
    const before = JSON.stringify(s);
    const sum = coverageSummary(s);
    expect(JSON.stringify(s)).toBe(before);
    for (const r of sum) expect(r.falta + r.lleno).toBeGreaterThan(0);
  });
});
