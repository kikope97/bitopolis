/**
 * Configuración interna del proceso. Viene fijada en la imagen Docker y no
 * hay que tocarla: todo lo demás se configura en /admin (decisión del creador).
 */
export interface Config {
  port: number;
  host: string;
  dataDir: string;
  clientDir: string;
  version: string;
  /** Clave maestra (cifra las API keys y firma cookies): <dataDir>/secret.key. */
  secret: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Omit<Config, 'secret'> {
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.BITOPOLIS_DATA_DIR ?? '/data',
    clientDir: env.BITOPOLIS_CLIENT_DIR ?? new URL('../../client/dist', import.meta.url).pathname,
    version: env.BITOPOLIS_VERSION ?? '0.0.0-dev',
  };
}
