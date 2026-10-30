/** Configuración leída de variables de entorno (sección 12.2 de la spec). */
export interface Config {
  port: number;
  host: string;
  dataDir: string;
  publicUrl: string;
  masterKey: string | undefined;
  clientDir: string;
  version: string;
  user: string | undefined;
  password: string | undefined;
  ai: EnvAi;
}

/** Lo definido por variable queda fijo y en solo lectura en Configurar. */
export interface EnvAi {
  key?: string;
  baseUrl?: string;
  model?: string;
  modelPremium?: string;
  maxCitizens: number;
  serverMonthly?: number;
  gameMonthly?: number;
  gameDaily?: number;
  pricesJson?: string;
}

const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.BITOPOLIS_DATA_DIR ?? '/data',
    publicUrl: (env.BITOPOLIS_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8080}`).replace(/\/$/, ''),
    masterKey: env.BITOPOLIS_MASTER_KEY,
    clientDir: env.BITOPOLIS_CLIENT_DIR ?? new URL('../../client/dist', import.meta.url).pathname,
    version: env.BITOPOLIS_VERSION ?? '0.0.0-dev',
    user: env.BITOPOLIS_USER || undefined,
    password: env.BITOPOLIS_PASSWORD || undefined,
    ai: {
      key: env.BITOPOLIS_API_KEY || undefined,
      baseUrl: env.BITOPOLIS_AI_BASE_URL || undefined,
      model: env.BITOPOLIS_AI_MODEL || undefined,
      modelPremium: env.BITOPOLIS_AI_MODEL_PREMIUM || undefined,
      maxCitizens: Math.max(1, Math.min(20, num(env.BITOPOLIS_AI_MAX_CITIZENS) ?? 20)),
      serverMonthly: num(env.BITOPOLIS_BUDGET_SERVER_MONTHLY_EUR),
      gameMonthly: num(env.BITOPOLIS_BUDGET_GAME_MONTHLY_EUR),
      gameDaily: num(env.BITOPOLIS_BUDGET_GAME_DAILY_EUR),
      pricesJson: env.BITOPOLIS_AI_PRICES_JSON || undefined,
    },
  };
}
