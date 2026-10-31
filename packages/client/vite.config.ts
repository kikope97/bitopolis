import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Versión de la aplicación (la del package.json raíz), para enseñarla en Ajustes.
const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: 'dist',
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { input: { main: 'index.html', login: 'login.html', admin: 'admin.html' } },
  },
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080', '/healthz': 'http://localhost:8080' },
  },
});
