import { z } from 'zod';

/** Toda acción es un comando serializable, venga del jugador o de la IA. */
export const TaxLevel = z.enum(['low', 'medium', 'high']);
export type TaxLevel = z.infer<typeof TaxLevel>;

export const BuildKind = z.enum(['road', 'house', 'water', 'power']);
export type BuildKind = z.infer<typeof BuildKind>;

const Coord = z.number().int().min(0).max(255);

export const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SetTax'), level: TaxLevel }),
  z.object({ type: z.literal('Build'), kind: BuildKind, x: Coord, y: Coord }),
  z.object({ type: z.literal('Demolish'), x: Coord, y: Coord }),
]);
export type Command = z.infer<typeof Command>;

/** Comando con el tick en el que se aplica (para replays). */
export const TimedCommand = z.object({
  tick: z.number().int().min(0),
  cmd: Command,
});
export type TimedCommand = z.infer<typeof TimedCommand>;
