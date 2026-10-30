/**
 * Valida que todo color hexadecimal del arte del cliente pertenece a la
 * paleta cerrada de 32 colores. Si aparece otro, el build falla.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PALETTE } from '../packages/client/src/palette.ts';

const allowed = new Set(PALETTE.map((c) => c.toLowerCase()));
if (allowed.size !== 32) {
  console.error(`La paleta debe tener 32 colores distintos (tiene ${allowed.size}).`);
  process.exit(1);
}
const client = new URL('../packages/client/', import.meta.url).pathname;
const bad: string[] = [];
function walk(dir: string) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|css|html)$/.test(f)) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
        let c = m[0].toLowerCase();
        if (c.length === 4) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
        if (!allowed.has(c)) bad.push(`${p}: ${m[0]}`);
      }
    }
  }
}
walk(join(client, 'src'));
if (existsSync(join(client, 'public'))) walk(join(client, 'public'));
const html = readFileSync(join(client, 'index.html'), 'utf8');
for (const m of html.matchAll(/#[0-9a-fA-F]{6}\b/g)) if (!allowed.has(m[0].toLowerCase())) bad.push(`index.html: ${m[0]}`);
if (bad.length) {
  console.error('Colores fuera de la paleta:\n' + bad.join('\n'));
  process.exit(1);
}
console.log(`Paleta ok (${allowed.size} colores).`);
