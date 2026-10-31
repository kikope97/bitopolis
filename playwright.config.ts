import { defineConfig, devices } from '@playwright/test';

// Puerto configurable (varias pruebas a la vez en la misma máquina).
const PORT = Number(process.env.PW_PORT ?? 8090);
const ADMIN_PORT = Number(process.env.PW_ADMIN_PORT ?? 8091);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, screenshot: 'only-on-failure' },
  projects: [
    { name: 'movil', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    { command: 'node e2e/fake-llm.mjs', url: 'http://localhost:8099/', reuseExistingServer: !process.env.CI },
    {
      // Sin variables de configuración: todo se configura en /admin. Datos nuevos en cada ejecución.
      command: `rm -rf test-results/data && pnpm build && node packages/server/dist/index.js`,
      url: `http://localhost:${PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { PORT: String(PORT), BITOPOLIS_DATA_DIR: 'test-results/data', LOG_LEVEL: 'warn' },
    },
    {
      // Servidor aparte para e2e/admin.spec.ts: cambia ajustes globales (contraseña, partidas nuevas).
      command: `rm -rf test-results/data-admin && node packages/server/dist/index.js`,
      url: `http://localhost:${ADMIN_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { PORT: String(ADMIN_PORT), BITOPOLIS_DATA_DIR: 'test-results/data-admin', LOG_LEVEL: 'warn' },
    },
  ],
});
