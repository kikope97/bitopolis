import { PALETTE } from './palette.ts';

/**
 * Iconos de píxeles para la interfaz (v1.3): sustituyen a emojis que cada
 * sistema dibuja distinto. Se pintan en <canvas data-icon> con la paleta.
 */
const ICONS: Record<string, { rows: string[]; colors: Record<string, number> }> = {
  key: {
    rows: ['.ooo......', 'o#..o.....', 'o#..oooooo', 'o...o..o.o', '.ooo......'],
    colors: { o: 4, '#': 20 },
  },
  // v1.6: iconos de 12×12 para la barra de abajo y la de arriba (antes, emojis distintos en cada móvil).
  inspect: {
    rows: [
      '..oooo......',
      '.o####o.....',
      'o##ww##o....',
      'o#w####o....',
      'o######o....',
      'o######o....',
      '.o####o.....',
      '..oooooo....',
      '......ouo...',
      '.......ouo..',
      '........ouo.',
      '.........oo.',
    ],
    colors: { o: 12, '#': 10, w: 11, u: 19 },
  },
  road: {
    rows: [
      'g.oooooooo.g',
      'g.o######o.g',
      '..o##y###o..',
      'g.o######o.g',
      'g.o##y###o.g',
      '..o######o..',
      'g.o##y###o.g',
      'g.o######o.g',
      '..o##y###o..',
      'g.o######o.g',
      'g.o######o.g',
      '..oooooooo..',
    ],
    colors: { o: 13, '#': 14, y: 4, g: 6 },
  },
  build: {
    rows: [
      '.....rr.....',
      '....rrrr....',
      '...rrrrrr...',
      '..rrrrrrrr..',
      '.rrrrrrrrrr.',
      '..cccccccc..',
      '..cwwcccwc..',
      '..cwwcccwc..',
      '..cccccccc..',
      '..ccccddcc..',
      '..ccccddcc..',
      '.oooooooooo.',
    ],
    colors: { r: 2, c: 21, w: 11, d: 18, o: 14 },
  },
  demolish: {
    rows: [
      '..sssssss...',
      '.ss.....ss..',
      'ss...h...ss.',
      's....h....s.',
      '.....h......',
      '.....h......',
      '.....h......',
      '.....h......',
      '.....h......',
      '.....h......',
      '.....h......',
      '....hhh.....',
    ],
    colors: { s: 13, h: 19 },
  },
  town: {
    rows: [
      '..yy....bb..',
      '.yyyy..bbbb.',
      '.ffff..ffff.',
      '.ffff..ffff.',
      '..ff....ff..',
      '.rrrr..gggg.',
      'rrrrrrgggggg',
      'rrrrrrgggggg',
      'rrrrrrgggggg',
      'rrrrrrgggggg',
      '.rr..gg..gg.',
      '.rr..gg..gg.',
    ],
    colors: { y: 37, b: 36, f: 32, r: 3, g: 10 },
  },
  bell: {
    rows: [
      '.....yy.....',
      '....yyyy....',
      '...yyyyyy...',
      '..yyyyyyyy..',
      '..yyyyyyyy..',
      '..yyyyyyyy..',
      '..yyyyyyyy..',
      '.yyyyyyyyyy.',
      'yyyyyyyyyyyy',
      'oooooooooooo',
      '.....oo.....',
      '............',
    ],
    colors: { y: 4, o: 20 },
  },
  people: {
    rows: [
      '...ff.......',
      '..ffff..ff..',
      '..ffff.ffff.',
      '...ff..ffff.',
      '..bbbb..ff..',
      '.bbbbbbgggg.',
      '.bbbbbggggg.',
      '.bbbbbggggg.',
      '.bbbbbggggg.',
      '..b..b.g..g.',
      '..b..b.g..g.',
      '............',
    ],
    colors: { f: 32, b: 10, g: 6 },
  },
  coin: {
    rows: [
      '...oooooo...',
      '..oyyyyyyo..',
      '.oyyy##yyyo.',
      'oyyy#yy#yyyo',
      'oyy#yyyyyyyo',
      'oyy#yyyyyyyo',
      'oyy#yyyyyyyo',
      'oyyy#yy#yyyo',
      '.oyyy##yyyo.',
      '..oyyyyyyo..',
      '...oooooo...',
      '............',
    ],
    colors: { o: 19, y: 4, '#': 20 },
  },
  smile: {
    rows: [
      '...oooooo...',
      '..oyyyyyyo..',
      '.oyyyyyyyyo.',
      'oyy#yyyy#yyo',
      'oyy#yyyy#yyo',
      'oyyyyyyyyyyo',
      'oy#yyyyyy#yo',
      'oyy#yyyy#yyo',
      '.oyy####yyo.',
      '..oyyyyyyo..',
      '...oooooo...',
      '............',
    ],
    colors: { o: 19, y: 4, '#': 0 },
  },
  layers: {
    rows: [
      '.....oo.....',
      '...oo##oo...',
      '.oo######oo.',
      'o##########o',
      '.oo######oo.',
      '...oo##oo...',
      '.o..oooo..o.',
      'o#oo....oo#o',
      '.oo##oo##oo.',
      '...oo##oo...',
      '.....oo.....',
      '............',
    ],
    colors: { o: 12, '#': 10 },
  },
};

/** Un icono de píxeles listo para poner en un botón (se escala con CSS sin suavizar). */
export function pixelIcon(name: string, cls = 'px-icon'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = cls;
  c.dataset.icon = name;
  c.setAttribute('aria-hidden', 'true');
  drawOne(c);
  return c;
}

function drawOne(c: HTMLCanvasElement): void {
  const icon = ICONS[c.dataset.icon ?? ''];
  const g = c.getContext('2d');
  if (!icon || !g) return;
  c.width = icon.rows[0]!.length;
  c.height = icon.rows.length;
  icon.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = icon.colors[ch];
      if (i === undefined) return;
      g.fillStyle = PALETTE[i]!;
      g.fillRect(x, y, 1, 1);
    }),
  );
}

export function drawPixelIcons(root: ParentNode = document): void {
  for (const c of root.querySelectorAll<HTMLCanvasElement>('canvas[data-icon]')) drawOne(c);
}
