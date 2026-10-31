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
};

export function drawPixelIcons(root: ParentNode = document): void {
  for (const c of root.querySelectorAll<HTMLCanvasElement>('canvas[data-icon]')) {
    const icon = ICONS[c.dataset.icon ?? ''];
    const g = c.getContext('2d');
    if (!icon || !g) continue;
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
}
