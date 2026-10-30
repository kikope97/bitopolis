/** Configuración leída de variables de entorno (sección 12.2 de la spec). */
export interface Config {
  port: number;
  host: string;
  dataDir: string;
  publicUrl: string;
  masterKey: string | undefined;
  clientDir: string;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.BITOPOLIS_DATA_DIR ?? '/data',
    publicUrl: (env.BITOPOLIS_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8080}`).replace(/\/$/, ''),
    masterKey: env.BITOPOLIS_MASTER_KEY,
    clientDir: env.BITOPOLIS_CLIENT_DIR ?? new URL('../../client/dist', import.meta.url).pathname,
    version: env.BITOPOLIS_VERSION ?? '0.0.0-dev',
  };
}
