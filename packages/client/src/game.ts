import { tickToDate, type Command } from '@bitopolis/shared';
import {
  BUILD_NAMES,
  type Building,
  type GameEvent,
  type GameState,
  happinessFactors,
  occupants,
  Tile,
  validateCommand,
  ZONE_UNLOCK_POP,
} from '@bitopolis/sim';
import { api, ApiError } from './api.ts';
import { nextHint } from './hints.ts';
import { formatDate, money, plural, t } from './i18n.ts';
import { type Camera, type Preview, render } from './render.ts';
import type { FromWorker, SaveBatch, ToWorker } from './sim.worker.ts';
import SimWorker from './sim.worker.ts?worker';
import { buildingSprite, letterSprite } from './sprites.ts';
import { commandFor, costText, isLocked, type Tool, type ToolId, TOOLS, tilesOf, unlockPop } from './tools.ts';
import { Tutorial } from './tutorial.ts';
import { $, closeSheet, confirmDialog, h, isSheetOpen, reducedMotion, sheet, toast, vibrate } from './ui.ts';

const DRAG_PX = 10;

export interface GameOptions {
  token: string;
  sessionId: string;
  state: GameState;
  onExit: () => void;
}

export function startGame(opts: GameOptions): void {
  const { token, sessionId } = opts;
  $('#start').hidden = true;
  $('#game').hidden = false;

  const canvas = $('#map') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const worker = new SimWorker();
  const send = (m: ToWorker) => worker.postMessage(m);

  let state: GameState = opts.state;
  let tool: Tool = TOOLS[0]!;
  let speed = 0;
  let preview: Preview | null = null;
  let selected: { x: number; y: number } | null = null;
  const seenEvents = new Set(state.events.map((e) => `${e.tick}|${e.kind}|${e.text}`));
  let lost = false;
  let cmdId = 0;
  const dayAgoTreasury: number[] = [];

  const dpr = () => Math.max(1, Math.round(window.devicePixelRatio || 1));
  const cam: Camera = { x: 0, y: 0, zoom: 2 };
  const tileSize = () => 16 * cam.zoom;

  const tutorial = new Tutorial(`bitopolis.tut.${token}`);

  /* ---------- guardado ---------- */
  const queue: SaveBatch[] = [];
  let saving = false;
  async function flushQueue(keepalive = false) {
    if (saving || queue.length === 0 || lost) return;
    saving = true;
    const merged: SaveBatch = {
      fromTick: queue[0]!.fromTick,
      toTick: queue.at(-1)!.toTick,
      commands: queue.flatMap((b) => b.commands),
      hash: queue.at(-1)!.hash,
    };
    const n = queue.length;
    try {
      await api.save(token, sessionId, merged, keepalive);
      queue.splice(0, n);
      const el = $('#saved');
      el.textContent = t('saved');
      el.classList.remove('err');
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        loseLease();
      } else if (e instanceof ApiError && e.status === 409 && e.body?.state) {
        queue.length = 0;
        send({ type: 'init', state: e.body.state });
        toast(t('desync'), { kind: 'warn' });
      } else {
        const el = $('#saved');
        el.textContent = t('saveFailed');
        el.classList.add('err');
        setTimeout(() => flushQueue(), 5000);
      }
    } finally {
      saving = false;
      if (queue.length > 0 && !lost) void flushQueue();
    }
  }

  function loseLease() {
    lost = true;
    setSpeed(0);
    const back = h('button', { class: 'btn primary' }, t('playHere'));
    const box = h(
      'div',
      { class: 'modal-backdrop', id: 'lost' },
      h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true' }, h('h2', {}, t('busyTitle')), h('p', {}, t('busyText')), back),
    );
    back.addEventListener('click', async () => {
      const r = await api.claim(token, sessionId, true);
      box.remove();
      lost = false;
      queue.length = 0;
      send({ type: 'init', state: r.state });
    });
    document.body.append(box);
    back.focus();
  }

  /* ---------- worker ---------- */
  const pendingResults = new Map<number, (ok: boolean, error?: string) => void>();
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === 'state') {
      state = m.state;
      onState();
    } else if (m.type === 'result') {
      pendingResults.get(m.id)?.(m.ok, m.error);
      pendingResults.delete(m.id);
    } else if (m.type === 'save') {
      queue.push(m.batch);
      void flushQueue();
    }
  };
  send({ type: 'init', state });

  function command(cmd: Command): Promise<boolean> {
    const id = ++cmdId;
    return new Promise((resolve) => {
      pendingResults.set(id, (ok, error) => {
        if (!ok && error) toast(error, { kind: 'warn' });
        if (ok) vibrate(10);
        resolve(ok);
      });
      send({ type: 'command', cmd, id });
    });
  }

  /* ---------- HUD ---------- */
  function onState() {
    const d = tickToDate(state.tick);
    $('#hud-date').textContent = formatDate(d);
    if (d.hour === 0 || dayAgoTreasury.length === 0) {
      dayAgoTreasury.push(state.treasury);
      if (dayAgoTreasury.length > 2) dayAgoTreasury.shift();
    }
    const diff = state.treasury - (dayAgoTreasury[0] ?? state.treasury);
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '';
    const mEl = $('#hud-money');
    mEl.textContent = `${money(state.treasury)} ${arrow}`;
    mEl.classList.toggle('neg', state.treasury < 0);
    $('#hud-pop').textContent = plural(state.citizens.length, 'vecino', 'vecinos');
    const happy = state.citizens.length ? Math.round(state.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.length) : 0;
    $('#hud-happy').textContent = `☺ ${happy}`;
    updateDemand();
    updateToolLocks();
    announceEvents();
    tutorial.update(state, tool.id);
    canvas.setAttribute(
      'aria-label',
      `Mapa del pueblo: ${plural(state.buildings.filter((b) => b.built).length, 'edificio', 'edificios')}, ${plural(state.projects.length, 'obra', 'obras')}.`,
    );
    if (isSheetOpen() && openInspect) openInspect();
  }

  function updateDemand() {
    const box = $('#demand');
    const unlocked = state.citizens.length >= ZONE_UNLOCK_POP;
    for (const k of ['R', 'C', 'I'] as const) {
      const row = box.querySelector<HTMLElement>(`[data-d="${k}"]`)!;
      const v = state.demand[k];
      row.hidden = !unlocked && k !== 'R';
      const bar = row.querySelector<HTMLElement>('.bar-fill')!;
      bar.style.width = `${Math.max(0, v)}%`;
      row.querySelector('.bar-num')!.textContent = v > 0 ? `+${v}` : String(v);
      row.setAttribute('aria-label', `Demanda ${k === 'R' ? 'residencial' : k === 'C' ? 'comercial' : 'industrial'}: ${v}`);
    }
  }

  function updateToolLocks() {
    for (const tl of TOOLS) {
      const btn = document.querySelector<HTMLButtonElement>(`[data-tool="${tl.id}"]`);
      if (!btn) continue;
      const locked = isLocked(tl, state);
      btn.classList.toggle('locked', locked);
      btn.setAttribute('aria-disabled', String(locked));
      const lock = btn.querySelector('.lock')!;
      lock.textContent = locked ? `🔒${unlockPop(tl)}` : '';
    }
  }

  function announceEvents() {
    const fresh: GameEvent[] = [];
    for (const e of state.events) {
      const key = `${e.tick}|${e.kind}|${e.text}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      fresh.push(e);
    }
    if (seenEvents.size > 1000) {
      const keep = [...seenEvents].slice(-400);
      seenEvents.clear();
      for (const k of keep) seenEvents.add(k);
    }
    const arrivals = fresh.filter((e) => e.kind === 'arrival');
    if (arrivals.length === 1) toast(arrivals[0]!.text, { kind: 'good' });
    else if (arrivals.length > 1) toast(`Llegan ${arrivals.length} vecinos nuevos`, { kind: 'good' });
    for (const e of fresh) {
      if (e.kind === 'built') {
        toast(e.text, { kind: 'good', sticky: !!e.notify, onClick: e.notify && e.ref ? () => focusBuilding(e.ref!) : undefined });
        if (e.notify) vibrate(80);
      } else if (e.kind === 'bankrupt' || e.kind === 'warning') {
        toast(e.text, { kind: 'warn', sticky: true });
      } else if (e.kind === 'departure' || e.kind === 'business') {
        toast(e.text, { kind: 'warn' });
      }
    }
  }

  /* ---------- cámara ---------- */
  function resize() {
    const r = canvas.getBoundingClientRect();
    const oldCenter = { x: cam.x + canvas.width / 2, y: cam.y + canvas.height / 2, ts: tileSize() };
    canvas.width = Math.round(r.width * dpr());
    canvas.height = Math.round(r.height * dpr());
    if (oldCenter.ts) {
      cam.x = Math.round(oldCenter.x - canvas.width / 2);
      cam.y = Math.round(oldCenter.y - canvas.height / 2);
    }
    clampCam();
  }
  function centerOn(tx: number, ty: number) {
    cam.x = Math.round((tx + 0.5) * tileSize() - canvas.width / 2);
    cam.y = Math.round((ty + 0.5) * tileSize() - canvas.height / 2);
    clampCam();
  }
  function clampCam() {
    const mw = state.map.w * tileSize();
    const mh = state.map.h * tileSize();
    const mx = canvas.width / 2;
    const my = canvas.height / 2;
    cam.x = Math.max(-mx, Math.min(mw - mx, cam.x));
    cam.y = Math.max(-my, Math.min(mh - my, cam.y));
  }
  const minZoom = () => dpr();
  const maxZoom = () => dpr() * 6;
  function setZoom(z: number, ax = canvas.width / 2, ay = canvas.height / 2) {
    const nz = Math.max(minZoom(), Math.min(maxZoom(), Math.round(z)));
    if (nz === cam.zoom) return;
    const wx = (cam.x + ax) / cam.zoom;
    const wy = (cam.y + ay) / cam.zoom;
    cam.zoom = nz;
    cam.x = Math.round(wx * nz - ax);
    cam.y = Math.round(wy * nz - ay);
    clampCam();
  }
  function tileAt(cx: number, cy: number) {
    const r = canvas.getBoundingClientRect();
    const px = (cx - r.left) * dpr() + cam.x;
    const py = (cy - r.top) * dpr() + cam.y;
    const x = Math.floor(px / tileSize());
    const y = Math.floor(py / tileSize());
    if (x < 0 || y < 0 || x >= state.map.w || y >= state.map.h) return null;
    return { x, y };
  }

  /* ---------- entrada: táctil, ratón y teclado ---------- */
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: {
    mode: 'pending' | 'pan' | 'paint' | 'pinch';
    sx: number;
    sy: number;
    startTile: { x: number; y: number } | null;
    pinchDist?: number;
    pinchZoom?: number;
  } | null = null;

  function previewFor(a: { x: number; y: number }, b: { x: number; y: number }) {
    const cmd = commandFor(tool, a, b);
    if (!cmd) return null;
    return { tiles: tilesOf(cmd), ok: validateCommand(state, cmd).ok };
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture = { mode: 'pinch', sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2, startTile: null, pinchDist: Math.hypot(a.x - b.x, a.y - b.y), pinchZoom: cam.zoom };
      preview = null;
      return;
    }
    const pan = e.button === 1 || e.button === 2;
    gesture = { mode: pan ? 'pan' : 'pending', sx: e.clientX, sy: e.clientY, startTile: tileAt(e.clientX, e.clientY) };
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      // Ratón sin pulsar: vista previa del tile bajo el cursor.
      const t0 = tileAt(e.clientX, e.clientY);
      preview = t0 && tool.id !== 'inspect' ? previewFor(t0, t0) : null;
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      cam.x -= Math.round((mx - gesture.sx) * dpr());
      cam.y -= Math.round((my - gesture.sy) * dpr());
      gesture.sx = mx;
      gesture.sy = my;
      const r = canvas.getBoundingClientRect();
      const scale = Math.hypot(a.x - b.x, a.y - b.y) / gesture.pinchDist!;
      setZoom(gesture.pinchZoom! * scale, (mx - r.left) * dpr(), (my - r.top) * dpr());
      clampCam();
      return;
    }
    const moved = Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy);
    if (gesture.mode === 'pending' && moved > DRAG_PX) {
      gesture.mode = tool.shape === 'tap' ? 'pan' : 'paint';
    }
    if (gesture.mode === 'pan') {
      cam.x -= Math.round((e.clientX - prev.x) * dpr());
      cam.y -= Math.round((e.clientY - prev.y) * dpr());
      clampCam();
    } else if (gesture.mode === 'paint' && gesture.startTile) {
      const t1 = tileAt(e.clientX, e.clientY);
      if (t1) preview = previewFor(gesture.startTile, t1);
    }
  });

  const endPointer = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (pointers.size > 0) {
      if (g?.mode === 'pinch') gesture = { mode: 'pan', sx: e.clientX, sy: e.clientY, startTile: null };
      return;
    }
    gesture = null;
    if (!g || e.type === 'pointercancel') {
      preview = null;
      return;
    }
    const t1 = tileAt(e.clientX, e.clientY);
    if (g.mode === 'pending' && t1) void tapTile(t1);
    if (g.mode === 'paint' && g.startTile && t1) {
      const cmd = commandFor(tool, g.startTile, t1);
      if (cmd) void command(cmd);
    }
    preview = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      setZoom(cam.zoom + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(dpr() / 2)), (e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr());
    },
    { passive: false },
  );

  async function tapTile(tile: { x: number; y: number }) {
    if (tool.id === 'inspect') return inspect(tile);
    if (isLocked(tool, state)) {
      toast(`${tool.label}: se desbloquea con ${unlockPop(tool)} vecinos`, { kind: 'warn' });
      return;
    }
    if (tool.id === 'demolish') {
      const b = state.buildings.find((x) => x.x === tile.x && x.y === tile.y);
      const what = b ? BUILD_NAMES[b.kind] : state.map.tiles[tile.y * state.map.w + tile.x] === Tile.Road ? 'Carretera' : null;
      if (!what) return toast('No hay nada que derribar', { kind: 'warn' });
      const people = b ? occupants(state, b).length + state.citizens.filter((c) => c.jobId === b.id).length : 0;
      const ok = await confirmDialog(
        `¿Derribar ${what.toLowerCase()}?`,
        people > 0 ? `Afecta a ${plural(people, 'vecino', 'vecinos')}. No se puede deshacer.` : 'No se puede deshacer.',
        'Derribar',
      );
      if (!ok) return;
    }
    const cmd = commandFor(tool, tile, tile);
    if (cmd) await command(cmd);
  }

  window.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
    const step = 64 * dpr();
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a') cam.x -= step;
    else if (k === 'ArrowRight' || k === 'd') cam.x += step;
    else if (k === 'ArrowUp' || k === 'w') cam.y -= step;
    else if (k === 'ArrowDown' || k === 's') cam.y += step;
    else if (k === '+' || k === '=') setZoom(cam.zoom + 1);
    else if (k === '-') setZoom(cam.zoom - 1);
    else if (k === ' ' && target.tagName !== 'BUTTON') {
      e.preventDefault();
      setSpeed(speed === 0 ? 1 : 0);
    } else if (k === 'Escape') {
      if (isSheetOpen()) closeSheet();
      else selectTool('inspect');
    } else {
      const tl = TOOLS.find((x) => x.key === k);
      if (tl) selectTool(tl.id);
      else return;
    }
    clampCam();
  });

  /* ---------- herramientas ---------- */
  function toolIcon(tl: Tool): HTMLElement {
    const wrap = h('span', { class: 'tool-icon', 'aria-hidden': 'true' });
    if (tl.build && tl.build !== 'road') {
      const c = buildingSprite(tl.build, 1);
      const img = document.createElement('canvas');
      img.width = 16;
      img.height = 16;
      img.getContext('2d')!.drawImage(c, 0, 0);
      wrap.append(img);
    } else if (tl.zone && tl.zone !== 'none') {
      const color = { R: 6, C: 10, I: 4 }[tl.zone];
      const img = document.createElement('canvas');
      img.width = 3;
      img.height = 5;
      img.getContext('2d')!.drawImage(letterSprite(tl.zone, color), 0, 0);
      img.classList.add('letter');
      wrap.append(img);
    } else {
      wrap.textContent = { inspect: '🔍', road: '🛣', dezone: '⌫', demolish: '⛏' }[tl.id as string] ?? '•';
    }
    return wrap;
  }

  const bar = $('#tools');
  bar.replaceChildren();
  for (const tl of TOOLS) {
    const btn = h(
      'button',
      { class: 'tool', 'data-tool': tl.id, 'aria-pressed': String(tl.id === tool.id), title: `${tl.label} (${tl.key})` },
      toolIcon(tl),
      h('span', { class: 'tool-label' }, tl.label),
      h('span', { class: 'lock', 'aria-hidden': 'true' }),
    );
    btn.addEventListener('click', () => selectTool(tl.id));
    bar.append(btn);
  }

  function selectTool(id: ToolId) {
    const tl = TOOLS.find((x) => x.id === id)!;
    tool = tl;
    for (const b of bar.querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.getAttribute('data-tool') === id));
    const info = $('#tool-info');
    const locked = isLocked(tl, state);
    info.textContent = locked
      ? `${tl.label}: se desbloquea con ${unlockPop(tl)} vecinos.`
      : `${tl.label}: ${tl.help}${costText(tl) ? ` · ${costText(tl)}` : ''}`;
    selected = null;
    tutorial.update(state, tool.id);
  }

  /* ---------- inspección ---------- */
  let openInspect: (() => void) | null = null;

  function focusBuilding(id: number) {
    const b = state.buildings.find((x) => x.id === id);
    if (!b) return;
    centerOn(b.x, b.y);
    inspect({ x: b.x, y: b.y });
  }

  function inspect(tile: { x: number; y: number }) {
    selected = tile;
    const b = state.buildings.find((x) => x.x === tile.x && x.y === tile.y);
    openInspect = () => {
      const fresh = state.buildings.find((x) => x.id === b?.id);
      if (b && !fresh) {
        closeSheet();
        openInspect = null;
        return;
      }
      renderInspect(tile, fresh);
    };
    openInspect();
  }

  function renderInspect(tile: { x: number; y: number }, b: Building | undefined) {
    const prevScroll = document.querySelector('.sheet-body')?.scrollTop ?? 0;
    if (!b) {
      const z = state.map.zones[tile.y * state.map.w + tile.x];
      const tt = state.map.tiles[tile.y * state.map.w + tile.x];
      const name = tt === Tile.Road ? 'Carretera' : tt === Tile.Tree ? 'Árboles' : 'Solar';
      const zone = z ? `Zona ${['', 'residencial (R)', 'comercial (C)', 'industrial (I)'][z]}` : 'Sin zona';
      sheet(name, h('p', {}, zone), h('p', { class: 'muted' }, `Casilla ${tile.x}, ${tile.y}`));
      openInspect = null;
      return;
    }
    const content: (Node | string)[] = [];
    const p = state.projects.find((x) => x.buildingId === b.id);
    if (p) {
      const pct = Math.round((100 * p.workerDaysDone) / p.workerDaysNeeded);
      const daysLeft = Math.ceil((p.workerDaysNeeded - p.workerDaysDone) / p.workersNeeded);
      const prog = h('progress', { max: '100', value: String(pct), 'aria-label': 'Progreso de la obra' });
      const crewNames = p.crew.map((id) => state.citizens.find((c) => c.id === id)?.name).filter(Boolean);
      const notify = h('input', { type: 'checkbox', id: 'notify', ...(p.notify ? { checked: true } : {}) }) as HTMLInputElement;
      notify.addEventListener('change', () => void command({ type: 'NotifyProject', buildingId: b.id, on: notify.checked }));
      content.push(
        h('p', {}, `En obra: ${pct}% · faltan ${plural(daysLeft, 'día', 'días')}`),
        prog,
        h(
          'p',
          {},
          crewNames.length
            ? `Obreros del pueblo: ${crewNames.join(', ')}.`
            : 'No hay obreros libres en el pueblo.',
          p.outsideToday > 0 ? ` Llegan ${plural(p.outsideToday, 'obrero', 'obreros')} de fuera (más caros).` : '',
        ),
        h('label', { class: 'check' }, notify, ' Avísame cuando acabe'),
      );
    } else {
      const status: string[] = [];
      if (b.kind !== 'water' && b.kind !== 'power') {
        status.push(b.hasWater ? '💧 Con agua' : '💧 SIN AGUA');
        status.push(b.hasPower ? '⚡ Con luz' : '⚡ SIN LUZ');
      }
      if (status.length) content.push(h('p', {}, status.join(' · ')));
      const res = occupants(state, b);
      if (res.length) content.push(h('h3', {}, 'Viven aquí'), citizenList(res));
      const workers = state.citizens.filter((c) => c.jobId === b.id);
      if (workers.length) content.push(h('h3', {}, 'Trabajan aquí'), citizenList(workers));
      if (b.kind === 'shop' || b.kind === 'factory') content.push(h('p', { class: 'muted' }, `Caja de la empresa: ${money(b.cash)}`));
    }
    const owner = b.owner === 0 ? 'Municipal' : b.owner === -1 ? 'Privado' : 'De un vecino';
    content.push(h('p', { class: 'muted' }, owner));
    sheet(BUILD_NAMES[b.kind] ?? b.kind, ...content);
    const body = document.querySelector('.sheet-body');
    if (body) body.scrollTop = prevScroll;
  }

  function citizenList(list: GameState['citizens']) {
    const ul = h('ul', { class: 'people' });
    for (const c of list) {
      const factors = happinessFactors(state, c)
        .filter((f) => f.value < 0)
        .map((f) => f.label.toLowerCase());
      const mood = c.happiness >= 65 ? '😊' : c.happiness >= 40 ? '😐' : '☹️';
      ul.append(
        h(
          'li',
          {},
          h('strong', {}, `${mood} ${c.name}`),
          `, ${c.age} años · ${money(c.money)}`,
          factors.length ? h('span', { class: 'muted' }, ` · le preocupa: ${factors.join(', ')}`) : '',
        ),
      );
    }
    return ul;
  }

  /* ---------- menú, impuestos y cuentas ---------- */
  function openTaxes() {
    const levels = [
      ['low', 'Bajos', 'Menos ingresos, vecinos más contentos y más demanda de vivienda.'],
      ['medium', 'Medios', 'Equilibrio.'],
      ['high', 'Altos', 'Más ingresos ahora, pero baja la felicidad y llega menos gente.'],
    ] as const;
    const box = h('div', { class: 'radio-list', role: 'radiogroup', 'aria-label': 'Nivel de impuestos' });
    for (const [lv, name, desc] of levels) {
      const btn = h('button', { class: 'btn choice', role: 'radio', 'aria-checked': String(state.taxLevel === lv) }, h('strong', {}, name), h('span', {}, desc));
      btn.addEventListener('click', async () => {
        await command({ type: 'SetTax', level: lv });
        openTaxes();
      });
      box.append(btn);
    }
    sheet(
      'Impuestos',
      h('p', {}, 'Un único impuesto sobre sueldos, ventas e inmuebles. Se cobra a fin de mes según la media del mes.'),
      box,
      h('p', { class: 'muted' }, 'Con 50 vecinos se separarán en IBI, tasas y plusvalía.'),
    );
  }

  function openAccounts() {
    const last = state.stats.at(-1);
    const cur = state.month;
    const rows = (bd: Record<string, number>) => {
      const ul = h('ul', { class: 'accounts' });
      const entries = Object.entries(bd).sort((a, b) => a[1] - b[1]);
      if (!entries.length) ul.append(h('li', {}, 'Sin movimientos todavía.'));
      for (const [k, v] of entries) ul.append(h('li', { class: v < 0 ? 'neg' : 'pos' }, h('span', {}, k), h('span', {}, `${v > 0 ? '▲ +' : '▼ '}${money(v)}`)));
      return ul;
    };
    const why = last
      ? Object.entries(last.breakdown)
          .filter(([, v]) => v < 0)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 2)
          .map(([k, v]) => `${k} (${money(v)})`)
      : [];
    sheet(
      'Cuentas del ayuntamiento',
      h('h3', {}, 'Este mes (en curso)'),
      rows(cur.breakdown),
      h('h3', {}, 'Mes pasado'),
      last ? rows(last.breakdown) : h('p', {}, 'Aún no ha terminado ningún mes.'),
      last && last.income - last.expenses < 0 && why.length ? h('p', {}, `Por qué baja tu saldo: ${why.join(' y ')}.`) : '',
    );
  }

  function openMenu() {
    const item = (label: string, fn: () => void) => {
      const b = h('button', { class: 'btn wide' }, label);
      b.addEventListener('click', fn);
      return b;
    };
    sheet(
      'Menú',
      item('Impuestos', openTaxes),
      item('Cuentas del ayuntamiento', openAccounts),
      item('Repetir tutorial', () => {
        closeSheet();
        tutorial.start(state, true);
      }),
      item('Volver al inicio', () => {
        closeSheet();
        exit();
      }),
    );
  }

  /* ---------- velocidad y ciclo de vida ---------- */
  function setSpeed(s: number) {
    if (lost && s > 0) return;
    if (s === 10 && speed !== 10) toast('x10 avanza un mes cada minuto: vigila la caja.');
    speed = s;
    send({ type: 'speed', speed: s });
    for (const b of document.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-speed')) === s));
  }

  const onVisibility = () => {
    if (document.hidden) {
      setSpeed(0);
      send({ type: 'flush' });
    }
  };
  const onPageHide = () => {
    send({ type: 'flush' });
    void flushQueue(true);
    void api.release(token, sessionId);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  const heartbeat = setInterval(() => !document.hidden && !lost && send({ type: 'flush' }), 30_000);

  function exit() {
    setSpeed(0);
    send({ type: 'flush' });
    setTimeout(() => {
      void flushQueue().then(() => {
        worker.terminate();
        clearInterval(heartbeat);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        void api.release(token, sessionId);
        $('#game').hidden = true;
        opts.onExit();
      });
    }, 150);
  }

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
    b.onclick = () => setSpeed(Number(b.dataset.speed));
  }
  $('#zoom-in').onclick = () => setZoom(cam.zoom + 1);
  $('#zoom-out').onclick = () => setZoom(cam.zoom - 1);
  $('#menu').onclick = openMenu;
  $('#hud-money').onclick = openAccounts;
  $('#whatnow').onclick = () => {
    const hint = nextHint(state);
    toast(hint.text, { sticky: true });
    if (hint.tool) selectTool(hint.tool);
  };

  /* Gancho para las pruebas de Playwright (solo lectura). */
  (window as unknown as { __bitopolis: unknown }).__bitopolis = {
    get state() {
      return state;
    },
    tileCenter(tx: number, ty: number) {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((tx + 0.5) * tileSize() - cam.x) / dpr(), y: r.top + ((ty + 0.5) * tileSize() - cam.y) / dpr() };
    },
  };

  /* ---------- bucle de pintado ---------- */
  function frame(time: number) {
    if ($('#game').hidden) return;
    render(ctx, state, cam, { preview, selected, time, reducedMotion: reducedMotion() });
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  cam.zoom = 2 * dpr();
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  centerOn(hall?.x ?? state.map.w / 2, (hall?.y ?? state.map.h / 2) + 1);
  selectTool('inspect');
  setSpeed(0);
  onState();
  tutorial.start(state);
  tutorial.update(state, tool.id);
  if (!tutorial.active) toast('En pausa. Pulsa x1 para que pase el tiempo.');
  requestAnimationFrame(frame);
}
