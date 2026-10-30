import { z } from 'zod';

/** Toda acción es un comando serializable, venga del jugador o de la IA. */
export const TaxLevel = z.enum(['low', 'medium', 'high']);
export type TaxLevel = z.infer<typeof TaxLevel>;

/** Lo que el alcalde puede construir directamente. */
export const BuildKind = z.enum(['road', 'water', 'power', 'park', 'school', 'clinic', 'house']);
export type BuildKind = z.infer<typeof BuildKind>;

export const ZoneKind = z.enum(['none', 'R', 'C', 'I']);
export type ZoneKind = z.infer<typeof ZoneKind>;

const Coord = z.number().int().min(0).max(255);
const Size = z.number().int().min(1).max(16);

export const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SetTax'), level: TaxLevel }),
  z.object({ type: z.literal('Build'), kind: BuildKind, x: Coord, y: Coord }),
  /** Carretera en línea recta de (x,y) a (x2,y2): horizontal o vertical. */
  z.object({ type: z.literal('BuildRoad'), x: Coord, y: Coord, x2: Coord, y2: Coord }),
  z.object({ type: z.literal('Zone'), zone: ZoneKind, x: Coord, y: Coord, w: Size, h: Size }),
  z.object({ type: z.literal('Demolish'), x: Coord, y: Coord }),
  z.object({ type: z.literal('NotifyProject'), buildingId: z.number().int().min(1), on: z.boolean() }),
  /** Decisión de un vecino con nombre (IA o reglas) entre sus acciones válidas. */
  z.object({
    type: z.literal('CitizenAct'),
    citizenId: z.number().int().min(1),
    action: z.string().regex(/^[a-z_]+(:[a-z0-9_]+)?$/).max(40),
    motivo: z.string().max(400),
    source: z.enum(['ai', 'rule']),
  }),
]);
export type Command = z.infer<typeof Command>;

/** Comando con el tick en el que se aplica (para replays). */
export const TimedCommand = z.object({
  tick: z.number().int().min(0),
  cmd: Command,
});
export type TimedCommand = z.infer<typeof TimedCommand>;
