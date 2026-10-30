import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist', target: 'es2022', assetsInlineLimit: 0 },
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080', '/healthz': 'http://localhost:8080' },
  },
});
