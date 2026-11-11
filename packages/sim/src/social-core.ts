/**
 * 2.3: oficios y metas de los vecinos, sin dependencias (social.ts los reexporta).
 * Están aparte para poder crear vecinos desde `createInitialState` (escenarios)
 * sin el ciclo de carga state → social → commands → state.
 */

export const PROFESSIONS = [
  'panadera', 'maestro', 'fontanera', 'enfermero', 'informática', 'camarero', 'agricultora', 'electricista', 'estudiante', 'jubilado',
] as const;

/** 2.8: los oficios de quien trabaja (sin «estudiante» ni «jubilado», que van por la edad). */
export const WORK_PROFESSIONS = PROFESSIONS.filter((p) => p !== 'estudiante' && p !== 'jubilado');

/**
 * 2.8 (ronda 24): el oficio que cuadra con la edad. `roll` es un número fijo del
 * vecino (dados del motor o hash): elige el oficio y, entre `studentAlways` y
 * `studentUntil`, si aún estudia. Salían «jubilada de 31» y «estudiante de 72».
 */
export function professionForAge(age: number, roll: number, ages: { studentAlways: number; studentUntil: number; pensionAge: number }): string {
  if (age >= ages.pensionAge) return 'jubilado';
  if (age <= ages.studentAlways || (age <= ages.studentUntil && roll % 2 === 0)) return 'estudiante';
  return WORK_PROFESSIONS[Math.floor(roll / 2) % WORK_PROFESSIONS.length]!;
}

/** 2.8: ¿el oficio guardado ya no cuadra con la edad? (partidas viejas: se corrige al cumplir años). */
export function professionStale(profession: string, age: number, ages: { studentUntil: number; pensionAge: number }): boolean {
  if (!profession) return false;
  if (profession === 'jubilado' || profession === 'jubilada') return age < ages.pensionAge;
  if (profession === 'estudiante') return age > ages.studentUntil;
  return age >= ages.pensionAge;
}

export const GOALS = ['comprar_casa', 'trabajo_en_el_pueblo', 'parque_cerca', 'tienda_cerca', 'ahorrar', 'vivir_tranquilo'] as const;
export type Goal = (typeof GOALS)[number];

export function goalFor(desire: string): Goal {
  return (
    ({ casa_propia: 'comprar_casa', trabajo_cerca: 'trabajo_en_el_pueblo', parque: 'parque_cerca', tienda: 'tienda_cerca', tranquilidad: 'vivir_tranquilo', prosperar: 'ahorrar' } as const)[
      desire as 'parque'
    ] ?? 'ahorrar'
  );
}
