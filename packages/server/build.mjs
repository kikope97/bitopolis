// Empaqueta el servidor (con shared y sim dentro) en dist/index.js.
// Las dependencias npm quedan externas y se instalan en la imagen con
// el package.json que se genera junto al bundle.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@bitopolis/'));
const shared = JSON.parse(readFileSync(new URL('../shared/package.json', import.meta.url)));
const deps = Object.fromEntries(
  [...Object.entries(pkg.dependencies), ...Object.entries(shared.dependencies)].filter(([d]) => !d.startsWith('@bitopolis/')),
);

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: [...external, 'zod'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
writeFileSync('dist/package.json', JSON.stringify({ name: 'bitopolis-server', private: true, type: 'module', dependencies: deps }, null, 2));
console.log('server build ok');
