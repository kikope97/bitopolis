import { z } from 'zod';

/** Toda acción es un comando serializable, venga del jugador o de la IA. */
export const TaxLevel = z.enum(['low', 'medium', 'high']);
export type TaxLevel = z.infer<typeof TaxLevel>;

/** Lo que el alcalde puede construir directamente. */
export const BuildKind = z.enum(['road', 'water', 'power', 'park', 'school', 'clinic', 'police', 'house', 'plaza', 'market', 'bar', 'chapel', 'cemetery', 'library', 'sports', 'jail', 'firestation', 'civilprotection']);
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
  /** 2.1: dique en una casilla de la orilla del río (anula la riada ahí). */
  z.object({ type: z.literal('BuildDike'), x: Coord, y: Coord }),
  z.object({ type: z.literal('UpgradeTownhall') }),
  z.object({ type: z.literal('UpgradeBuilding'), buildingId: z.number().int() }),
  // v1.9: economía de cada vecino.
  z.object({ type: z.literal('SetMinimumWage'), level: z.enum(['none', 'low', 'medium', 'high']) }),
  z.object({ type: z.literal('SettleDebt'), citizenId: z.number().int(), mode: z.enum(['aplazar', 'perdonar']) }),
  z.object({ type: z.literal('GrantMicrocredit'), citizenId: z.number().int() }),
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
  /**
   * 2.0: lo que decidió la IA en un turno del pueblo (todos los vecinos del turno
   * a la vez). El motor valida cada parte con su menú; lo que no vale se descarta.
   */
  z.object({
    type: z.literal('TownTurn'),
    n: z.number().int().min(1),
    acts: z
      .array(
        z.object({
          vecino: z.number().int(),
          accion: z.string().regex(/^[a-z_]+(:[a-z0-9_]+)?$/).max(40),
          gesto: z.object({ con: z.number().int(), tipo: z.string().max(20) }),
          actitud: z.number().int().min(-2).max(2),
          gasto: z.object({ donde: z.string().max(10), tienda: z.number().int(), ocio: z.boolean() }),
          plan: z.object({ tipo: z.string().max(30), necesidad: z.string().max(20), meses: z.number().int().min(0).max(12) }),
          pensamiento: z.string().max(300),
          motivo: z.string().max(400),
          recuerdo: z.string().max(300).optional(),
        }),
      )
      .max(300),
    focus: z.string().max(300).optional(),
    chronicle: z.string().max(1200).optional(),
    /** Director del pueblo: sucesos que pasan esta semana y avisos de lo que se cuece. */
    director: z
      .object({
        sucesos: z.array(z.object({ id: z.string().regex(/^[a-z_]+:[a-z0-9_]+$/).max(40), motivo: z.string().max(400) })).max(6),
        avisos: z.array(z.object({ id: z.string().regex(/^[a-z_]+:[a-z0-9_]+$/).max(40), motivo: z.string().max(400) })).max(6),
        /** 2.1: titulares de El Eco y el encargo con historia. */
        titulares: z.array(z.object({ seccion: z.enum(['sucesos', 'cartas', 'anuncios']), texto: z.string().max(300), sobre: z.number().int().optional() })).max(3).optional(),
        encargo: z.object({ id: z.string().regex(/^[a-z_]+:[a-z0-9_]+$/).max(40), carta: z.string().max(500) }).optional(),
      })
      .optional(),
  }),
  /** 2.1: responder a un encargo del pueblo. */
  z.object({ type: z.literal('AnswerErrand'), errandId: z.number().int(), answer: z.enum(['aceptar', 'mas_tarde', 'rechazar']) }),
  /** 2.1: contestar en El Eco de Bitópolis (menú cerrado). */
  z.object({ type: z.literal('AnswerPress'), edition: z.number().int().min(1), answer: z.enum(['agradecer', 'desmentir', 'prometer']) }),
  /**
   * 2.1: votos de los vecinos con IA para el escudo y el lema al subir de rango
   * (menú cerrado de `rankCandidates`; el motor descarta lo que no esté en él y
   * el resto del pueblo vota por reglas). Solo lo trae la IA del servidor.
   */
  z.object({
    type: z.literal('ChooseCrest'),
    votes: z.array(z.object({ vecino: z.number().int(), pieza: z.string().regex(/^[a-z_]+$/).max(20), lema: z.string().regex(/^[a-z_]+$/).max(40) })).min(1).max(300),
  }),
  /** 2.0: % de vecinos con IA (solo sube: nadie deja de pensar con IA). */
  z.object({ type: z.literal('SetAiShare'), share: z.number().int().min(0).max(100) }),
  /** 2.0: días de juego entre turnos de la IA (el cliente los alarga a x3/x10). */
  z.object({ type: z.literal('SetTurnPace'), days: z.number().int().min(3).max(60) }),
]);
export type Command = z.infer<typeof Command>;

/** Comando con el tick en el que se aplica (para replays). */
export const TimedCommand = z.object({
  tick: z.number().int().min(0),
  cmd: Command,
});
export type TimedCommand = z.infer<typeof TimedCommand>;
