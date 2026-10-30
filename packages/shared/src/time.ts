/** 1 tick = 1 hora de juego. */
export const TICKS_PER_DAY = 24;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
export const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH;

/** 1 día de juego = 20 s reales a x1. */
export const REAL_MS_PER_DAY_AT_X1 = 20_000;

export const SPEEDS = [0, 1, 3, 10] as const;
export type Speed = (typeof SPEEDS)[number];

export interface GameDate {
  year: number;
  month: number;
  day: number;
  hour: number;
}

export function tickToDate(tick: number): GameDate {
  const hour = tick % TICKS_PER_DAY;
  const totalDays = Math.floor(tick / TICKS_PER_DAY);
  const day = (totalDays % DAYS_PER_MONTH) + 1;
  const totalMonths = Math.floor(totalDays / DAYS_PER_MONTH);
  const month = (totalMonths % MONTHS_PER_YEAR) + 1;
  const year = Math.floor(totalMonths / MONTHS_PER_YEAR) + 1;
  return { year, month, day, hour };
}
