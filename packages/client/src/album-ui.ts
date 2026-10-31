import { tickToDate } from '@bitopolis/shared';
import { familyOf, type GameState, type Kin, type Moment } from '@bitopolis/sim';
import { formatDate } from './i18n.ts';
import { PALETTE } from './palette.ts';
import { render } from './render.ts';
import type { SocialCtx } from './social-ui.ts';
import { T } from './sprites.ts';
import { h, sheet, toast, withBack } from './ui.ts';

/**
 * v1.7: álbum del pueblo y árbol genealógico. Las «fotos» se toman en el
 * momento (si el juego está abierto) y se guardan en este navegador; si no
 * hay foto, se enseña cómo está hoy ese rincón.
 */
const THUMB_W = 8 * T;
const THUMB_H = 5 * T;

/** Dibuja el rincón del mapa de un momento (a escala 1: 8×5 casillas). */
export function renderThumb(state: GameState, m: { x: number; y: number }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  const g = c.getContext('2d')!;
  const cam = {
    x: Math.max(0, Math.min(state.map.w * T - THUMB_W, (m.x + 0.5) * T - THUMB_W / 2)),
    y: Math.max(0, Math.min(state.map.h * T - THUMB_H, (m.y - 0.5) * T - THUMB_H / 2)),
    zoom: 1,
  };
  render(g, state, cam, { time: 0, reducedMotion: true, layer: 'none' });
  return c;
}

const key = (token: string, m: Moment) => `bitopolis.album.${token}.${m.tick}.${m.kind}`;

/** Al aparecer un momento nuevo con el juego abierto, se guarda su foto (en este navegador). */
export function snapMoments(token: string, state: GameState, seen: { n: number }): void {
  const album = state.album ?? [];
  if (album.length <= seen.n) {
    seen.n = album.length;
    return;
  }
  for (const m of album.slice(seen.n)) {
    try {
      localStorage.setItem(key(token, m), renderThumb(state, m).toDataURL('image/png'));
    } catch {
      /* sin sitio: se verá cómo está hoy */
    }
  }
  seen.n = album.length;
}

function photo(token: string, state: GameState, m: Moment): { el: HTMLElement; live: boolean } {
  let url: string | null;
  try {
    url = localStorage.getItem(key(token, m));
  } catch {
    url = null;
  }
  if (url) {
    const img = h('img', { class: 'album-photo', src: url, alt: '' });
    return { el: img, live: false };
  }
  const c = renderThumb(state, m);
  c.className = 'album-photo';
  return { el: c, live: true };
}

/** Postal: la foto ampliada con el texto debajo, para guardar o compartir. */
async function postcard(token: string, state: GameState, m: Moment): Promise<void> {
  const src = document.createElement('canvas');
  src.width = THUMB_W;
  src.height = THUMB_H;
  const ph = photo(token, state, m).el;
  const g0 = src.getContext('2d')!;
  if (ph instanceof HTMLCanvasElement) g0.drawImage(ph, 0, 0);
  else {
    await new Promise<void>((ok) => {
      (ph as HTMLImageElement).onload = () => ok();
      if ((ph as HTMLImageElement).complete) ok();
    });
    g0.drawImage(ph as HTMLImageElement, 0, 0);
  }
  const scale = 3;
  const c = document.createElement('canvas');
  c.width = THUMB_W * scale + 24;
  c.height = THUMB_H * scale + 96;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = PALETTE[21]!;
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 12, 12, THUMB_W * scale, THUMB_H * scale);
  g.fillStyle = PALETTE[0]!;
  g.font = 'bold 22px system-ui, sans-serif';
  g.fillText(`Bitópolis · ${formatDate(tickToDate(m.tick))}`, 16, THUMB_H * scale + 44);
  g.font = '18px system-ui, sans-serif';
  g.fillText(m.text.length > 70 ? `${m.text.slice(0, 68)}…` : m.text, 16, THUMB_H * scale + 76);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  if (!blob) return;
  const file = new File([blob], `bitopolis-${m.tick}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Bitópolis' });
      return;
    } catch {
      /* cancelado: se descarga */
    }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  toast('Postal guardada', { kind: 'good' });
}

export function openAlbum(ctx: SocialCtx): void {
  const state = ctx.state();
  const album = [...(state.album ?? [])].reverse();
  const list = h('div', { class: 'album' });
  for (const m of album) {
    const { el, live } = photo(ctx.token, state, m);
    const save = h('button', { class: 'btn small' }, 'Guardar postal');
    save.addEventListener('click', () => void postcard(ctx.token, state, m));
    list.append(
      h(
        'figure',
        { class: 'album-card' },
        el,
        h('figcaption', {}, h('strong', {}, formatDate(tickToDate(m.tick))), ` · ${m.text}`, live ? h('span', { class: 'muted small' }, ' (así está hoy)') : ''),
        save,
      ),
    );
  }
  sheet(
    'Álbum del pueblo',
    album.length ? h('p', { class: 'muted small' }, 'Los momentos que han hecho este pueblo. Las fotos se guardan en este navegador.') : h('p', { class: 'muted' }, 'Aún no hay momentos. Construye la primera casa.'),
    list,
  );
}

/* ---------------- árbol genealógico ---------------- */

const STATUS: Record<Kin['status'], string> = { vive: '', fallecio: ' ✝', se_fue: ' (se fue)' };

export function openFamily(ctx: SocialCtx, id: number, open: (id: number) => void): void {
  const state = ctx.state();
  const f = familyOf(state, id);
  if (!f) return;
  const person = (k: Kin) => {
    const label = `${k.name}${STATUS[k.status]}`;
    if (k.status !== 'vive') return h('span', { class: 'kin gone' }, label);
    const b = h('button', { class: 'kin' }, label);
    b.addEventListener('click', () => withBack(`Familia de ${f.self.name.split(' ')[0]}`, () => openFamily(ctx, id, open), () => open(k.id)));
    return b;
  };
  const row = (title: string, people: Kin[], extra = '') =>
    people.length || extra ? h('div', { class: 'gen' }, h('h3', {}, title), h('div', { class: 'kin-row' }, ...people.map(person), extra ? h('span', { class: 'muted small' }, extra) : '')) : '';
  sheet(
    `Familia de ${f.self.name.split(' ')[0]}`,
    h('div', { class: 'tree' },
      row('Padres', f.parents),
      row('Hermanos', f.siblings),
      h('div', { class: 'gen me' }, h('div', { class: 'kin-row' }, h('strong', { class: 'kin self' }, `${f.self.name}${STATUS[f.self.status]}`), f.partner ? h('span', { class: 'muted' }, '♥') : '', f.partner ? person(f.partner) : '')),
      row('Hijos', f.children, f.kidsAtHome ? `${f.kidsAtHome === 1 ? 'un niño' : `${f.kidsAtHome} niños`} en casa` : ''),
      row('Nietos', f.grandchildren),
    ),
    !f.parents.length && !f.children.length && !f.kidsAtHome && !f.partner ? h('p', { class: 'muted' }, 'Llegó de fuera y aún no ha formado familia en el pueblo.') : '',
  );
}
