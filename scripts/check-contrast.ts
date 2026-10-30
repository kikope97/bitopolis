/**
 * Valida el contraste WCAG 2.1 AA de los pares de color de la interfaz
 * (texto normal ≥ 4,5:1; texto grande y bordes de controles ≥ 3:1), en el
 * modo normal y en el de alto contraste. Si alguno no llega, el build falla.
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../packages/client/src/style.css', import.meta.url), 'utf8');

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}
const root = vars(css.match(/:root\s*{([^}]*)}/)![1]!);
const high = { ...root, ...vars(css.match(/html\[data-contrast='alto'\]\s*{([^}]*)}/)![1]!) };

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** [primer plano, fondo, mínimo, qué es] */
const PAIRS: [string, string, number, string][] = [
  ['text', 'bg', 4.5, 'texto sobre el fondo'],
  ['text', 'panel', 4.5, 'texto en paneles y botones'],
  ['muted', 'bg', 4.5, 'texto secundario sobre el fondo'],
  ['muted', 'panel', 4.5, 'texto secundario en paneles'],
  ['accent', 'bg', 4.5, 'títulos y avisos en acento'],
  ['accent', 'panel', 4.5, 'acento en paneles'],
  ['bg', 'accent', 4.5, 'texto del botón principal'],
  ['good', 'bg', 3, 'indicadores «bien» (grandes o con icono)'],
  ['bad', 'bg', 3, 'indicadores «mal» (grandes o con icono)'],
];

const fails: string[] = [];
for (const [mode, v] of [['normal', root], ['alto contraste', high]] as const) {
  for (const [fg, bg, min, what] of PAIRS) {
    const r = ratio(v[fg]!, v[bg]!);
    if (r < min) fails.push(`${mode}: ${what} (--${fg} sobre --${bg}) = ${r.toFixed(2)}:1 < ${min}:1`);
  }
  // En alto contraste, también los bordes de los controles (WCAG 1.4.11).
  if (mode === 'alto contraste' && ratio(v.line!, v.panel!) < 3) fails.push(`alto contraste: bordes ${ratio(v.line!, v.panel!).toFixed(2)}:1 < 3:1`);
}
if (fails.length) {
  console.error('Contraste insuficiente (WCAG AA):\n' + fails.join('\n'));
  process.exit(1);
}
console.log(`Contraste AA ok (${PAIRS.length} pares × 2 modos).`);
