import { describe, expect, it } from 'vitest';
import {
  addMemory,
  ANCHOR_MAX,
  associationsMonth,
  CARE,
  createInitialState,
  type GameState,
  grievanceOf,
  lifeYear,
  MEMORY_MAX,
  OUTSIDE,
  PROFESSION_AGE,
  professionForAge,
  professionOf,
  professionStale,
  ruleAnswer,
  runSimulation,
  transfer,
  TREASURY,
} from '../src/index.ts';

/** 2.8 (ronda 24, parte E): vecinos creíbles y textos que no mienten. */
const AGES = { ...PROFESSION_AGE, pensionAge: CARE.pensionAge };

describe('oficio según la edad', () => {
  it('estudiante solo de joven y jubilado desde la edad de pensión', () => {
    for (let roll = 0; roll < 40; roll++) {
      expect(professionForAge(18, roll, AGES)).toBe('estudiante');
      expect(professionForAge(CARE.pensionAge, roll, AGES)).toBe('jubilado');
      expect(professionForAge(72, roll, AGES)).toBe('jubilado');
      expect(['estudiante', 'jubilado']).not.toContain(professionForAge(31, roll, AGES));
      expect(['estudiante', 'jubilado']).not.toContain(professionForAge(50, roll, AGES));
    }
  });

  it('en una partida larga ningún vecino con nombre tiene un oficio que no cuadra con su edad', () => {
    const { state } = runSimulation({ seed: 7, days: 800, profile: 'casual' });
    const named = state.citizens.filter((c) => c.named && c.profession);
    expect(named.length).toBeGreaterThan(5);
    for (const c of named) expect(professionStale(c.profession, c.age, AGES), `${c.name}, ${c.profession}, ${c.age}`).toBe(false);
  });

  it('al cumplir la edad de pensión se jubila y lo recuerda; las partidas viejas se corrigen al cumplir años', () => {
    const s = createInitialState({ seed: 3 });
    const c = s.citizens[0]!;
    c.named = true;
    c.name = 'Rosa Gil';
    c.age = CARE.pensionAge - 1;
    c.profession = 'enfermero';
    const old = { ...c, id: c.id + 1000, name: 'Celia Ortega', age: 30, profession: 'jubilado', memories: [] as typeof c.memories, relations: [] as typeof c.relations };
    s.citizens.push(old);
    lifeYear(s);
    expect(c.profession).toBe('jubilado');
    expect(professionOf(c)).toBe('jubilada');
    expect(c.memories.some((m) => m.kind === 'se_jubilo')).toBe(true);
    expect(['estudiante', 'jubilado']).not.toContain(old.profession);
    expect(old.memories.some((m) => m.kind === 'se_jubilo')).toBe(false);
  });
});

describe('recuerdos ancla y sin repeticiones', () => {
  it('lo importante no se olvida y lo repetido se junta en uno', () => {
    const s = createInitialState({ seed: 2 });
    const c = s.citizens[0]!;
    c.named = true;
    c.memories = [];
    addMemory(s, c, 'llego', 2, 1);
    addMemory(s, c, 'fundo_partido', 5, 3);
    for (let i = 0; i < 4; i++) {
      s.tick += 24;
      addMemory(s, c, 'fue_a_las_fiestas', 2, 2);
    }
    expect(c.memories.filter((m) => m.kind === 'fue_a_las_fiestas')).toHaveLength(1);
    expect(c.memories.find((m) => m.kind === 'fue_a_las_fiestas')!.times).toBe(4);
    const kinds = ['hablo_con_alcalde', 'peticion_rechazada', 'voto', 'subida_impuestos', 'rumor', 'mitin', 'excursion', 'susto'] as const;
    for (const k of kinds) {
      s.tick += 24 * 30;
      addMemory(s, c, k, 1, 0);
    }
    expect(c.memories.some((m) => m.kind === 'llego')).toBe(true);
    expect(c.memories.some((m) => m.kind === 'fundo_partido')).toBe(true);
    expect(c.memories.length).toBeLessThanOrEqual(MEMORY_MAX + ANCHOR_MAX);
    // Lo último vivido siempre se queda.
    expect(c.memories.at(-1)!.kind).toBe('susto');
  });
});

/** Pueblo sin colegio (como en associations.test.ts). */
function town(): GameState {
  const { state: s } = runSimulation({ seed: 5, days: 400, profile: 'constructor' });
  transfer(s, OUTSIDE, TREASURY, 60_000, 'subvencion');
  const schools = new Set(s.buildings.filter((b) => b.kind === 'school').map((b) => b.id));
  s.buildings = s.buildings.filter((b) => !schools.has(b.id));
  for (const c of s.citizens) if (c.jobId !== null && schools.has(c.jobId)) c.jobId = null;
  for (const c of s.citizens.slice(0, 8)) c.named = true;
  s.associations = [];
  return s;
}

describe('asociaciones honestas', () => {
  it('no se disuelve porque cambie la queja principal: sigue mientras falte lo que piden', () => {
    const s = town();
    associationsMonth(s);
    const a = s.associations[0]!;
    // Mucho ruido en las casas de los socios: el ruido pasa a ser su queja principal.
    for (const id of a.members) {
      const home = s.buildings.find((b) => b.id === s.citizens.find((c) => c.id === id)?.homeId);
      if (home) s.fields.noise[home.y * s.map.w + home.x] = 100;
    }
    const cause = a.cause;
    expect(s.citizens.filter((c) => a.members.includes(c.id)).some((c) => grievanceOf(s, c) !== cause)).toBe(true);
    associationsMonth(s);
    expect(s.associations.find((x) => x.id === a.id)?.cause).toBe(cause);
    expect(s.events.some((e) => e.text.includes('celebra'))).toBe(false);
    expect(s.citizens.some((c) => c.memories.some((m) => m.kind === 'logro_vecinal'))).toBe(false);
  });

  it('si lo que pedían ya lo tienen pero comparten otra queja, cambian de bandera y lo dicen', () => {
    const s = town();
    associationsMonth(s);
    const a = s.associations[0]!;
    const real = a.cause;
    // Simula que su causa (otra) ya está resuelta: nadie se queja del río.
    a.cause = 'rio';
    associationsMonth(s);
    expect(s.associations.find((x) => x.id === a.id)?.cause).toBe(real);
    expect(s.events.some((e) => e.text.includes('cambia de bandera'))).toBe(true);
  });
});

describe('«Hablar» coherente', () => {
  it('en primera persona y quien se presentó contra el alcalde no dice que le votaría', () => {
    const s = createInitialState({ seed: 4 });
    const c = s.citizens[0]!;
    c.named = true;
    c.happiness = 95;
    c.grudge = 0;
    delete c.vote;
    expect(ruleAnswer(s, c, 'me_votarias', undefined)).toBe('Sí, le votaría. Lo está haciendo bien.');
    addMemory(s, c, 'perdio_elecciones', 5, -4);
    expect(ruleAnswer(s, c, 'me_votarias', undefined)).toMatch(/me presenté contra usted/);
  });
});
