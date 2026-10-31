import { z } from 'zod';

/** Toda acción es un comando serializable, venga del jugador o de la IA. */
export const TaxLevel = z.enum(['low', 'medium', 'high']);
export type TaxLevel = z.infer<typeof TaxLevel>;

/** Lo que el alcalde puede construir directamente. */
export const BuildKind = z.enum(['road', 'water', 'power', 'park', 'school', 'clinic', 'police', 'house', 'plaza', 'market', 'bar', 'chapel', 'cemetery', 'library', 'sports', 'jail']);
export type BuildKind = z.infer<typeof BuildKind>;

export const ZoneKind = z.enum(['none', 'R', 'C', 'I']);
export type ZoneKind = z.infer<typeof ZoneKind>;

const Coord = z.number().int().min(0).max(255);
const Size = z.number().int().min(1).max(16);

export const Command = z.discriminatedUnion('type', [
  /** Impuesto único (antes de 50 vecinos); después pone los tres tributos al mismo nivel. */
  z.object({ type: z.literal('SetTax'), level: TaxLevel }),
  /** Tributos separados (desde 50 vecinos): IBI, tasas y plusvalía. */
  z.object({ type: z.literal('SetTaxes'), ibi: TaxLevel.optional(), tasas: TaxLevel.optional(), plusvalia: TaxLevel.optional() }),
  /** Casas municipales: en alquiler o a la venta. */
  z.object({ type: z.literal('SetHousingMode'), buildingId: z.number().int().min(1), mode: z.enum(['rent', 'sale']) }),
  z.object({ type: z.literal('Build'), kind: BuildKind, x: Coord, y: Coord }),
  /** Carretera en línea recta de (x,y) a (x2,y2): horizontal o vertical. */
  z.object({ type: z.literal('BuildRoad'), x: Coord, y: Coord, x2: Coord, y2: Coord }),
  z.object({ type: z.literal('Zone'), zone: ZoneKind, x: Coord, y: Coord, w: Size, h: Size }),
  z.object({ type: z.literal('Demolish'), x: Coord, y: Coord }),
  z.object({ type: z.literal('NotifyProject'), buildingId: z.number().int().min(1), on: z.boolean() }),
  /** Pleno municipal: convocar, responder a cada petición y cerrar. */
  z.object({ type: z.literal('ConvenePleno') }),
  z.object({ type: z.literal('MeetAssociation'), associationId: z.number().int() }),
  z.object({ type: z.literal('RepairBuilding'), buildingId: z.number().int() }),
  // v1.5: presupuesto anual, fiestas y subvenciones.
  z.object({ type: z.literal('ProposeBudget'), plan: z.enum(['austero', 'equilibrado', 'inversor']) }),
  z.object({ type: z.literal('HoldFestival'), size: z.enum(['pequena', 'grande']) }),
  z.object({ type: z.literal('AnswerGrant'), grantId: z.number().int().min(1), accept: z.boolean() }),
  z.object({ type: z.literal('AnswerPetition'), petitionId: z.number().int().min(1), answer: z.enum(['promise', 'reject']) }),
  z.object({ type: z.literal('ClosePleno') }),
  /** Hablar con un vecino: solo preguntas predefinidas (nunca texto libre). */
  z.object({ type: z.literal('TalkTo'), citizenId: z.number().int().min(1), question: z.enum(['como_estas', 'que_necesitas', 'me_votarias']) }),
  /** Campaña electoral con una facción (v1.0): una al mes, en el año antes de votar. */
  z.object({ type: z.literal('Campaign'), faction: z.enum(['jubilados', 'jovenes', 'empresarios', 'ecologistas']) }),
  /** Moción desde la oposición (v1.1): llevar al pleno lo que pide una facción. */
  z.object({ type: z.literal('Motion'), faction: z.enum(['jubilados', 'jovenes', 'empresarios', 'ecologistas']) }),
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
