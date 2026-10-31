import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // Las pruebas de varios años de juego pasan de 5 s en máquinas cargadas.
    testTimeout: 30_000,
  },
});
