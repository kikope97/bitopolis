import { createInitialState, type GameState, type StreetName, type ViewSnapshot } from '@bitopolis/sim';
import { api, ApiError } from './api.ts';
import { plural } from './i18n.ts';
import { townCenter } from './postcard.ts';
import { lowMotion } from './prefs.ts';
import { type Camera, render } from './render.ts';
import { T } from './sprites.ts';
import { h } from './ui.ts';

/**
 * 2.3: vista de solo lectura de un pueblo compartido (/v/<token>). Sin worker,
 * sin herramientas ni barra de arriba: solo el mapa (paneo y zoom con el dedo,
 * la rueda o los botones) y un cartel que lleva a hacer tu propio pueblo.
 * Nunca guarda ni reclama nada: solo llama a GET /api/view/<token>.
 */

/** Estado para dibujar: un pueblo vacío con lo que trae la foto encima (el render no necesita más). */
export function displayState(v: ViewSnapshot): GameState {
  const s = createInitialState({ seed: 1 });
  s.tick = v.tick;
  s.map = { w: v.map.w, h: v.map.h, tiles: v.map.tiles, zones: v.map.zones, terrain: v.map.terrain };
  s.buildings = v.buildings.map((b) => ({
    owner: 0,
    cash: 0,
    unpaidMonths: 0,
    ...b,
    damaged: b.damaged ? { cost: 0, repairUntil: 0, ...b.damaged } : undefined,
    fire: b.fire ? { since: v.tick, until: v.tick + 1, covered: true } : undefined,
  }));
  s.projects = v.projects.map((p) => ({ ...p, payer: 0, workersNeeded: 0, workers: [] }) as unknown as GameState['projects'][number]);
  s.dikes = v.dikes;
  s.streetNames = v.streetNames.map((x) => ({ ...x, citizenId: 0 }) as StreetName);
  s.townhallLevel = v.townhallLevel;
  s.weather = v.weather;
  if (s.rank && v.crest) s.rank = { ...s.rank, level: v.summary.rankLevel, crest: v.crest, vote: null };
  s.history = v.history;
  s.records = v.records;
  s.medals = v.medals;
  s.album = v.album;
  // El render solo cuenta cuántos vecinos hay (gente por la calle).
  s.citizens = Array.from({ length: v.summary.population }, () => ({}) as GameState['citizens'][number]);
  s.events = [];
  return s;
}

function failed(text: string): void {
  const app = document.querySelector('#app')!;
  app.replaceChildren(
    h('main', { class: 'start viewer-gone' }, h('h1', { class: 'logo' }, 'Bitópolis'), h('p', {}, text), h('a', { class: 'btn primary big', href: '/' }, 'Haz tu pueblo')),
  );
}

export async function showViewer(viewToken: string): Promise<void> {
  let snap: ViewSnapshot;
  try {
    snap = (await api.view(viewToken)).snapshot;
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return failed('Demasiadas visitas seguidas. Prueba en un minuto.');
    if (e instanceof ApiError && e.status === 401) return;
    return failed('Este enlace ya no funciona: quizá su alcalde ha dejado de compartirlo.');
  }
  const state = displayState(snap);
  const sum = snap.summary;
  document.title = `${sum.name} · Bitópolis`;
  document.body.classList.add('in-viewer');

  const canvas = h('canvas', { id: 'view-map', role: 'img', 'aria-label': `Mapa de ${sum.name}`, tabindex: '0' }) as HTMLCanvasElement;
  const zin = h('button', { class: 'fab', id: 'view-in', 'aria-label': 'Acercar' }, '+');
  const zout = h('button', { class: 'fab', id: 'view-out', 'aria-label': 'Alejar' }, '−');
  const root = h(
    'div',
    { class: 'viewer', id: 'viewer' },
    h(
      'header',
      { class: 'viewer-top' },
      h('p', { class: 'viewer-title' }, h('strong', {}, sum.name), ` · ${sum.rank} · ${plural(sum.population, 'vecino', 'vecinos')} · ☺ ${sum.happiness}`),
      h('span', { class: 'viewer-ro muted small' }, 'Solo lectura'),
      h('a', { class: 'viewer-cta', href: '/', id: 'view-cta' }, 'Haz tu pueblo'),
    ),
    h('div', { class: 'viewer-map' }, canvas, h('div', { class: 'viewer-btns' }, zin, zout)),
  );
  document.querySelector('#app')!.replaceChildren(root);

  const g = canvas.getContext('2d')!;
  const dpr = () => Math.max(1, window.devicePixelRatio || 1);
  const minZoom = () => Math.max(1, Math.floor(dpr() / 2));
  const maxZoom = () => Math.round(dpr() * 4);
  const cam: Camera = { x: 0, y: 0, zoom: Math.max(minZoom(), Math.round((40 * dpr()) / T)) };
  const ts = () => T * cam.zoom;
  const clamp = () => {
    const pad = 2 * ts();
    const axis = (pos: number, size: number, view: number) => (size + 2 * pad <= view ? Math.round((size - view) / 2) : Math.max(-pad, Math.min(size - view + pad, pos)));
    cam.x = axis(cam.x, state.map.w * ts(), canvas.width);
    cam.y = axis(cam.y, state.map.h * ts(), canvas.height);
  };
  const center = () => {
    const c = townCenter(state);
    cam.x = Math.round((c.x + 0.5) * ts() - canvas.width / 2);
    cam.y = Math.round((c.y - 0.5) * ts() - canvas.height / 2);
    clamp();
  };
  const zoomTo = (z: number, ax = canvas.width / 2, ay = canvas.height / 2) => {
    const nz = Math.max(minZoom(), Math.min(maxZoom(), Math.round(z)));
    if (nz === cam.zoom) return;
    const wx = (cam.x + ax) / cam.zoom;
    const wy = (cam.y + ay) / cam.zoom;
    cam.zoom = nz;
    cam.x = Math.round(wx * nz - ax);
    cam.y = Math.round(wy * nz - ay);
    clamp();
  };
  let sized = false;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr()));
    canvas.height = Math.max(1, Math.round(r.height * dpr()));
    if (!sized) center();
    else clamp();
    sized = true;
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  zin.addEventListener('click', () => zoomTo(cam.zoom + 1));
  zout.addEventListener('click', () => zoomTo(cam.zoom - 1));
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomTo(cam.zoom + (e.deltaY < 0 ? 1 : -1), (e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr());
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', (e) => {
    const step = ts();
    const k = e.key;
    if (k === 'ArrowLeft') cam.x -= step;
    else if (k === 'ArrowRight') cam.x += step;
    else if (k === 'ArrowUp') cam.y -= step;
    else if (k === 'ArrowDown') cam.y += step;
    else if (k === '+' || k === '=') zoomTo(cam.zoom + 1);
    else if (k === '-') zoomTo(cam.zoom - 1);
    else return;
    e.preventDefault();
    clamp();
  });

  // Un dedo (o el ratón) mueve el mapa; dos dedos acercan o alejan.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; zoom: number } | null = null;
  const dist = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinch = { d: dist(), zoom: cam.zoom };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1) {
      cam.x -= Math.round((e.clientX - p.x) * dpr());
      cam.y -= Math.round((e.clientY - p.y) * dpr());
      clamp();
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch && pointers.size === 2 && pinch.d > 0) {
      const [a, b] = [...pointers.values()];
      const r = canvas.getBoundingClientRect();
      zoomTo(pinch.zoom * (dist() / pinch.d), ((a!.x + b!.x) / 2 - r.left) * dpr(), ((a!.y + b!.y) / 2 - r.top) * dpr());
    }
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const frame = (time: number) => {
    if (!document.hidden) render(g, state, cam, { time, reducedMotion: lowMotion(), layer: 'none' });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Gancho de solo lectura para Playwright (igual que __bitopolis en la partida).
  (window as unknown as { __bitopolisView: unknown }).__bitopolisView = {
    population: sum.population,
    buildings: snap.buildings.length,
    name: sum.name,
    zoom: () => cam.zoom,
    cam: () => ({ x: cam.x, y: cam.y }),
  };
}
