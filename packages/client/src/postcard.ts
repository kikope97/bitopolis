import { tickToDate } from '@bitopolis/shared';
import { ACHIEVEMENT_LIST, type GameState, type RecordKey, rankName, townNameOf } from '@bitopolis/sim';
import { renderThumb } from './album-ui.ts';
import { crestCanvas } from './crest.ts';
import { formatDate, money, plural } from './i18n.ts';
import { PALETTE } from './palette.ts';
import { T } from './sprites.ts';
import { h, toast } from './ui.ts';

/**
 * 2.3: postal del pueblo para compartir (PNG de 1080×1350, el formato vertical
 * de las redes). Foto del centro del pueblo a escala entera, cartel con el
 * nombre, el rango y la población, 3 récords y 4 medallas. Todo se dibuja en
 * el navegador: no sale nada al servidor.
 */
export const POSTCARD_W = 1080;
export const POSTCARD_H = 1350;
const SCALE = 4;
const PHOTO_W = 8 * T * SCALE;
const PHOTO_H = 5 * T * SCALE;
const PAD = (POSTCARD_W - PHOTO_W) / 2;

const RECORD_TEXT: Record<RecordKey, (v: number) => string> = {
  population: (v) => `Población: ${plural(v, 'vecino', 'vecinos')}`,
  treasury: (v) => `Caja: ${money(v)}`,
  happiness: (v) => `Felicidad: ${Math.round(v)} %`,
  businesses: (v) => `Empresas: ${v}`,
  visitors: (v) => `Visitantes en un mes: ${v}`,
  income: (v) => `Ingresos de un mes: ${money(v)}`,
};
const RECORD_ORDER: RecordKey[] = ['population', 'happiness', 'treasury', 'visitors', 'businesses', 'income'];

/** Centro del pueblo: la media de los edificios (o el centro del mapa si no hay). */
export function townCenter(state: GameState): { x: number; y: number } {
  const bs = state.buildings;
  if (!bs.length) return { x: Math.floor(state.map.w / 2), y: Math.floor(state.map.h / 2) };
  const x = bs.reduce((a, b) => a + b.x, 0) / bs.length;
  const y = bs.reduce((a, b) => a + b.y, 0) / bs.length;
  return { x: Math.round(x), y: Math.round(y) + 1 };
}

/** Las 3 líneas de récords (si los hay). */
export function postcardRecords(state: GameState): string[] {
  const rec = state.records ?? {};
  return RECORD_ORDER.filter((k) => rec[k]).slice(0, 3).map((k) => `${RECORD_TEXT[k](rec[k]!.v)} (${formatDate(tickToDate(Math.max(0, rec[k]!.tick - 1)))})`);
}

/** Las 4 últimas medallas, con su texto. */
export function postcardMedals(state: GameState): string[] {
  return [...(state.medals ?? [])]
    .sort((a, b) => b.tick - a.tick)
    .slice(0, 4)
    .map((m) => ACHIEVEMENT_LIST.find((a) => a.id === m.id)?.text ?? m.id.replace(/[_-]/g, ' '));
}

function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Dibuja la postal en un canvas nuevo. */
export function drawPostcard(state: GameState): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = POSTCARD_W;
  c.height = POSTCARD_H;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const P = (i: number) => PALETTE[i]!;
  g.fillStyle = P(21);
  g.fillRect(0, 0, POSTCARD_W, POSTCARD_H);
  g.fillStyle = P(0);
  g.fillRect(PAD - 6, PAD - 6, PHOTO_W + 12, PHOTO_H + 12);
  g.drawImage(renderThumb(state, townCenter(state)), PAD, PAD, PHOTO_W, PHOTO_H);

  // Cartel: escudo, nombre, rango y población.
  let y = PAD + PHOTO_H + 40;
  const crest = crestCanvas(state);
  g.drawImage(crest, PAD, y, crest.width * 6, crest.height * 6);
  const tx = PAD + crest.width * 6 + 32;
  const tw = POSTCARD_W - tx - PAD;
  g.fillStyle = P(0);
  g.textBaseline = 'top';
  g.font = 'bold 76px system-ui, sans-serif';
  g.fillText(fit(g, townNameOf(state), tw), tx, y + 4);
  g.font = '40px system-ui, sans-serif';
  g.fillStyle = P(15);
  g.fillText(fit(g, `${rankName(state)} · ${plural(state.citizens.length, 'vecino', 'vecinos')}`, tw), tx, y + 96);
  g.font = '32px system-ui, sans-serif';
  g.fillText(fit(g, formatDate(tickToDate(state.tick)), tw), tx, y + 148);
  y += 200;

  const block = (title: string, lines: string[], dot: number) => {
    if (!lines.length) return;
    g.fillStyle = P(0);
    g.font = 'bold 36px system-ui, sans-serif';
    g.fillText(title, PAD, y);
    y += 52;
    g.font = '30px system-ui, sans-serif';
    for (const l of lines) {
      g.fillStyle = P(dot);
      g.fillRect(PAD + 4, y + 8, 16, 16);
      g.fillStyle = P(0);
      g.fillText(fit(g, l, POSTCARD_W - 2 * PAD - 36), PAD + 36, y);
      y += 44;
    }
    y += 16;
  };
  block('Récords', postcardRecords(state), 9);
  block('Medallas', postcardMedals(state), 60);

  g.font = 'bold 28px system-ui, sans-serif';
  g.fillStyle = P(14);
  g.textAlign = 'right';
  g.fillText('Bitópolis', POSTCARD_W - PAD, POSTCARD_H - 48);
  g.textAlign = 'left';
  return c;
}

/** Comparte la postal con el menú del sistema (si admite archivos) o la descarga. */
export async function sharePostcard(state: GameState): Promise<void> {
  const c = drawPostcard(state);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  if (!blob) return;
  const file = new File([blob], `bitopolis-postal-${state.tick}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: townNameOf(state) });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      /* sin permiso: se descarga */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('Postal guardada', { kind: 'good' });
}
