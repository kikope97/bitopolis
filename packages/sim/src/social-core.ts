/**
 * 2.3: oficios y metas de los vecinos, sin dependencias (social.ts los reexporta).
 * Están aparte para poder crear vecinos desde `createInitialState` (escenarios)
 * sin el ciclo de carga state → social → commands → state.
 */

export const PROFESSIONS = [
  'panadera', 'maestro', 'fontanera', 'enfermero', 'informática', 'camarero', 'agricultora', 'electricista', 'estudiante', 'jubilado',
] as const;

export const GOALS = ['comprar_casa', 'trabajo_en_el_pueblo', 'parque_cerca', 'tienda_cerca', 'ahorrar', 'vivir_tranquilo'] as const;
export type Goal = (typeof GOALS)[number];

export function goalFor(desire: string): Goal {
  return (
    ({ casa_propia: 'comprar_casa', trabajo_cerca: 'trabajo_en_el_pueblo', parque: 'parque_cerca', tienda: 'tienda_cerca', tranquilidad: 'vivir_tranquilo', prosperar: 'ahorrar' } as const)[
      desire as 'parque'
    ] ?? 'ahorrar'
  );
}
