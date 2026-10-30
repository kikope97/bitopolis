import { defineConfig, devices } from '@playwright/test';

const PORT = 8090;

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
  webServer: {
    command: `pnpm build && node packages/server/dist/index.js`,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      BITOPOLIS_DATA_DIR: 'test-results/data',
      BITOPOLIS_MASTER_KEY: 'test-master-key-test-master-key-00',
      BITOPOLIS_PUBLIC_URL: `http://localhost:${PORT}`,
      LOG_LEVEL: 'warn',
    },
  },
});
