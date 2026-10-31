import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  associationsMonth,
  checkInvariants,
  type GameState,
  grievanceOf,
  OUTSIDE,
  runSimulation,
  step,
  transfer,
  TREASURY,
} from '../src/index.ts';

/** Pueblo sin colegio: los vecinos con nombre comparten la queja. */
function town(): GameState {
  const { state: s } = runSimulation({ seed: 3, days: 400, profile: 'constructor' });
  transfer(s, OUTSIDE, TREASURY, 60_000, 'subvencion');
  const schools = new Set(s.buildings.filter((b) => b.kind === 'school').map((b) => b.id));
  s.buildings = s.buildings.filter((b) => !schools.has(b.id));
  for (const c of s.citizens) if (c.jobId !== null && schools.has(c.jobId)) c.jobId = null;
  // Todos con nombre y sin otra queja mayor que el colegio (para que el test no dependa de la semilla).
  for (const c of s.citizens.slice(0, 8)) c.named = true;
  s.associations = [];
  return s;
}

function untilMonthEnd(s: GameState) {
  do step(s);
  while (s.tick % TICKS_PER_MONTH !== 0);
}

describe('asociaciones vecinales (v1.7)', () => {
  it('nace una asociación cuando 4 o más vecinos con nombre comparten la queja', () => {
    const s = town();
    const sharing = s.citizens.filter((c) => c.named && grievanceOf(s, c) !== null);
    expect(sharing.length).toBeGreaterThanOrEqual(4);
    associationsMonth(s);
    expect(s.associations.length).toBe(1);
    const a = s.associations[0]!;
    expect(a.members.length).toBeGreaterThanOrEqual(4);
    expect(a.members).toContain(a.leaderId);
    expect(s.events.at(-1)!.text).toMatch(/^Nace la Asociación de vecinos por/);
  });

  it('si nadie les hace caso, convocan una manifestación; los socios deciden y el día señalado se manifiestan', () => {
    const s = town();
    associationsMonth(s);
    const a = s.associations[0]!;
    for (let m = 0; m < 3 && a.protestDay < 0; m++) untilMonthEnd(s);
    expect(a.protestDay).toBeGreaterThan(0);
    expect(s.events.some((e) => e.text.includes('convoca una manifestación'))).toBe(true);
    for (let i = 0; i < 5 * TICKS_PER_DAY && a.protestDay >= 0; i++) step(s);
    expect(s.events.some((e) => e.kind === 'protest')).toBe(true);
    // El líder va siempre a su manifestación (por reglas).
    const leader = s.citizens.find((c) => c.id === a.leaderId);
    if (leader) expect(leader.memories.some((m) => m.kind === 'se_manifesto')).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('reunirse con ellos desconvoca la protesta; una vez al mes', () => {
    const s = town();
    associationsMonth(s);
    const a = s.associations[0]!;
    a.protestDay = s.tick + 3 * TICKS_PER_DAY;
    expect(applyCommand(s, { type: 'MeetAssociation', associationId: a.id }).ok).toBe(true);
    expect(a.protestDay).toBe(-1);
    expect(a.promiseUntil).toBeGreaterThan(s.tick);
    expect(applyCommand(s, { type: 'MeetAssociation', associationId: a.id }).ok).toBe(false);
  });

  it('cuando se resuelve lo que piden, lo celebran y se disuelve', () => {
    const s = town();
    associationsMonth(s);
    const a = s.associations[0]!;
    // Lo que piden, para todos: sin quejas.
    for (const c of s.citizens) c.homeId = null;
    associationsMonth(s);
    expect(s.associations.find((x) => x.id === a.id)).toBeUndefined();
    expect(s.events.some((e) => e.text.includes('celebra'))).toBe(true);
  });
});
