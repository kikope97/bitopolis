import { tickToDate, type Command } from '@bitopolis/shared';
import {
  BUILD,
  BUILD_NAMES,
  type Building,
  salePrice,
  unitValue,
  type GameEvent,
  type GameState,
  happinessFactors,
  occupants,
  Tile,
  validateCommand,
  ZONE_COST_PER_TILE,
  ZONE_UNLOCK_POP,
} from '@bitopolis/sim';
import { makeBubble, openPreview, openUsage } from './ai-ui.ts';
import { openNeighbours, openReport, openTaxes as openTaxesSheet } from './economy-ui.ts';
import { LAYERS, type LayerId } from './layers.ts';
import { openAdvisor, openCitizen, openDiary, openPleno, rememberSeen, renderObjectives, resumeSummary, type SocialCtx } from './social-ui.ts';
import { api, ApiError } from './api.ts';
import { nextHint } from './hints.ts';
import { formatDate, money, plural, t } from './i18n.ts';
import { type Camera, type Preview, render } from './render.ts';
import type { FromWorker, SaveBatch, ToWorker } from './sim.worker.ts';
import SimWorker from './sim.worker.ts?worker';
import { buildingSprite, letterSprite, T } from './sprites.ts';
import { commandFor, costText, isLocked, type Tool, type ToolId, TOOLS, tilesOf, unlockPop } from './tools.ts';
import { Tutorial } from './tutorial.ts';
import { $, closeSheet, confirmDialog, h, isSheetOpen, reducedMotion, sheet, toast, vibrate } from './ui.ts';
import { duck, sfx, startAmbience, startMusic, stopMusic, unlockAudio } from './audio.ts';
import { coins, dust, pop } from './fx.ts';
import { onPrefs, prefs } from './prefs.ts';
import { openSettings } from './settings-ui.ts';
import { openElectionNight, openPolitics, renderPollChip } from './politics-ui.ts';
import { timeOfDay } from './render.ts';

const DRAG_PX = 10;
const DESIRE_TEXT: Record<string, string> = {
  trabajo_cerca: 'trabajar cerca de casa',
  casa_propia: 'tener casa propia',
  parque: 'un parque',
  tienda: 'tiendas cerca',
  tranquilidad: 'tranquilidad',
  prosperar: 'prosperar',
};
const FEAR_TEXT: Record<string, string> = { paro: 'el paro', impuestos: 'los impuestos', soledad: 'la soledad', ruido: 'el ruido', deudas: 'las deudas' };

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
  let layer: LayerId = 'none';
  let selected: { x: number; y: number } | null = null;
  /** Primer toque de una carretera o zona (modo «toque inicio, toque fin»). */
  let anchor: { x: number; y: number } | null = null;
  /** Final propuesto: se ve el trazado y el coste; un segundo toque ahí confirma. */
  let pendingEnd: { x: number; y: number } | null = null;
  /** Cursor de casilla para jugar con teclado (flechas + Intro). */
  let cursor: { x: number; y: number } | null = null;
  const seenEvents = new Set(state.events.map((e) => `${e.tick}|${e.kind}|${e.text}`));
  let lost = false;
  let cmdId = 0;
  const dayAgoTreasury: number[] = [];

  const dpr = () => Math.max(1, window.devicePixelRatio || 1);
  const cam: Camera = { x: 0, y: 0, zoom: 2 };
  const tileSize = () => T * cam.zoom;

  const tutorial = new Tutorial(`bitopolis.tut.${token}`);

  /* ---------- guardado ---------- */
  const queue: (SaveBatch & { live: boolean })[] = [];
  let saving = false;
  async function flushQueue(keepalive = false) {
    if (saving || queue.length === 0 || lost) return;
    saving = true;
    const merged = {
      fromTick: queue[0]!.fromTick,
      toTick: queue.at(-1)!.toTick,
      commands: queue.flatMap((b) => b.commands),
      hash: queue.at(-1)!.hash,
      // Solo se pide a la IA si se está jugando (no en pausa ni oculto).
      live: queue.some((b) => b.live) && speed > 0 && !document.hidden,
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
      queue.push({ ...m.batch, live: !m.flush && speed > 0 && !document.hidden });
      void flushQueue();
    }
  };
  send({ type: 'init', state });

  function command(cmd: Command): Promise<boolean> {
    const id = ++cmdId;
    return new Promise((resolve) => {
      pendingResults.set(id, (ok, error) => {
        if (!ok && error) {
          toast(error, { kind: 'warn' });
          sfx.error();
        }
        if (ok) feedback(cmd);
        resolve(ok);
      });
      send({ type: 'command', cmd, id });
    });
  }

  /** Sonido y efectos de cada orden aceptada. */
  function feedback(cmd: Command) {
    const say = (t: string) => ($('#sr-live').textContent = t);
    if (cmd.type === 'Build') {
      sfx.build();
      say(`Obra empezada: ${BUILD_NAMES[cmd.kind] ?? cmd.kind}.`);
    } else if (cmd.type === 'BuildRoad') {
      sfx.road();
      say(`Carretera construida: ${plural(tilesOf(cmd).length, 'casilla', 'casillas')}.`);
    } else if (cmd.type === 'Demolish') {
      sfx.demolish();
      dust(cmd.x, cmd.y);
      say('Derribado.');
    } else if (cmd.type === 'Zone') {
      sfx.tap();
      say(cmd.zone === 'none' ? 'Zona quitada.' : `Zona ${cmd.zone} pintada: ${plural(cmd.w * cmd.h, 'casilla', 'casillas')}.`);
    } else if (cmd.type === 'SetTax' || cmd.type === 'SetTaxes') sfx.tap();
  }

  /** Centro de una casilla en coordenadas de pantalla (CSS). */
  function screenOf(tx: number, ty: number): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [r.left + ((tx + 0.5) * 32 * cam.zoom - cam.x) / dpr(), r.top + ((ty + 0.2) * 32 * cam.zoom - cam.y) / dpr()];
  }

  /** Modo tranquilo: un evento importante pausa el juego. */
  function calmPause() {
    if (prefs().calm && speed > 0) {
      setSpeed(0);
      toast('Modo tranquilo: juego en pausa. Pulsa x1 para seguir.', { kind: 'info' });
    }
  }

  /* ---------- HUD ---------- */
  let lastStats = state.stats.length;
  function onState() {
    if (state.stats.length !== lastStats) {
      lastStats = state.stats.length;
      const m = state.stats.at(-1);
      if (m) {
        const net = m.income - m.expenses;
        toast(`Parte del mes: ${net >= 0 ? '▲ +' : '▼ '}${money(net)}. Toca para verlo.`, { kind: net >= 0 ? 'good' : 'warn', onClick: openAccounts });
        if (net > 0) {
          sfx.coin();
          const th = state.buildings.find((b) => b.kind === 'townhall');
          if (th) coins(...screenOf(th.x, th.y), Math.ceil(Math.min(net, 6000) / 600));
        } else sfx.warn();
      }
    }
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
    renderPollChip(state, () => openPolitics(social));
    $('#game').classList.toggle('opposition', state.politics.mayor !== 'player');
    updateDemand();
    updateToolLocks();
    renderObjectives(state);
    announceEvents();
    tutorial.update(state, tool.id);
    canvas.setAttribute(
      'aria-label',
      `Mapa del pueblo: ${plural(state.buildings.filter((b) => b.built).length, 'edificio', 'edificios')}, ${plural(state.projects.length, 'obra', 'obras')}. Con el mapa enfocado, las flechas mueven un cursor e Intro usa la herramienta.`,
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
    for (const e of fresh) if (e.kind === 'decision' && e.ref) addBubble(e.ref, e.tick);
    const arrivals = fresh.filter((e) => e.kind === 'arrival');
    if (arrivals.length) sfx.arrival();
    if (arrivals.length === 1) toast(arrivals[0]!.text, { kind: 'good' });
    else if (arrivals.length > 1) toast(`Llegan ${arrivals.length} vecinos nuevos`, { kind: 'good' });
    const built = fresh.filter((e) => e.kind === 'built');
    for (const e of built) {
      const b = e.ref ? state.buildings.find((x) => x.id === e.ref) : undefined;
      if (b) {
        pop(b.id);
        dust(b.x, b.y);
      }
    }
    if (built.length) sfx.done();
    const notified = built.filter((e) => e.notify);
    for (const e of notified) {
      toast(e.text, { kind: 'good', sticky: true, onClick: e.ref ? () => focusBuilding(e.ref!) : undefined });
      vibrate(80);
      calmPause();
    }
    const plain = built.filter((e) => !e.notify);
    if (plain.length === 1) toast(plain[0]!.text, { kind: 'good' });
    else if (plain.length > 1) toast(`${plain.length} obras terminadas`, { kind: 'good' });
    for (const e of fresh) {
      if (e.kind === 'bankrupt' || e.kind === 'warning') {
        sfx.warn();
        duck(1.5);
        calmPause();
        toast(e.kind === 'warning' ? `${e.text}. Prueba a subir los impuestos (☰ › Impuestos) o espera antes de construir.` : e.text, {
          kind: 'warn',
          sticky: true,
        });
      } else if (e.kind === 'milestone') {
        toast(e.text, { kind: 'good', sticky: true });
        vibrate(120);
        sfx.milestone();
        duck(2);
        calmPause();
        const th = state.buildings.find((b) => b.kind === 'townhall');
        if (th) coins(...screenOf(th.x, th.y), 8);
      } else if (e.kind === 'election') {
        const won = state.politics.history.at(-1)?.winner === 'player';
        if (won) sfx.milestone();
        else sfx.warn();
        duck(4);
        vibrate(150);
        calmPause();
        openElectionNight(social);
      } else if (e.kind === 'politics') {
        toast(e.text, { kind: e.text.startsWith('Faltan') && state.politics.approval < 50 ? 'warn' : 'info', sticky: e.text.startsWith('Faltan'), onClick: () => openPolitics(social) });
        if (e.text.startsWith('Faltan') || e.text.includes('funda')) calmPause();
      } else if (e.kind === 'departure' || e.kind === 'business') {
        toast(e.text, { kind: 'warn' });
        calmPause();
      }
    }
  }

  /* ---------- burbujas con el motivo ---------- */
  const bubbles: { el: HTMLElement; tx: number; ty: number }[] = [];
  function addBubble(citizenId: number, tick: number) {
    const entry = [...state.decisionLog].reverse().find((d) => d.citizenId === citizenId && d.tick === tick);
    const c = state.citizens.find((x) => x.id === citizenId);
    const name = c?.name ?? 'Un vecino';
    const where = state.buildings.find((b) => b.id === (c?.homeId ?? c?.jobId)) ?? state.buildings.find((b) => b.kind === 'townhall');
    if (!entry || !where) return;
    const el = makeBubble(name, entry.motivo, entry.source === 'ai');
    const b = { el, tx: where.x, ty: where.y };
    bubbles.push(b);
    const close = () => {
      el.remove();
      const i = bubbles.indexOf(b);
      if (i >= 0) bubbles.splice(i, 1);
    };
    el.addEventListener('click', () => {
      close();
      if (c?.named) openCitizen(social, c.id);
      else focusBuilding(where.id);
    });
    // Sin límite de tiempo con movimiento reducido; si no, según lo largo del texto.
    if (!reducedMotion()) setTimeout(close, Math.max(9000, entry.motivo.length * 90));
  }
  function placeBubbles() {
    if (!bubbles.length) return;
    const wrap = canvas.getBoundingClientRect();
    for (const b of bubbles) {
      const r = canvas.getBoundingClientRect();
      const x = r.left + ((b.tx + 0.5) * tileSize() - cam.x) / dpr() - wrap.left;
      const y = r.top + (b.ty * tileSize() - 16 * cam.zoom - cam.y) / dpr() - wrap.top;
      b.el.style.left = `${Math.round(x)}px`;
      b.el.style.top = `${Math.round(y)}px`;
    }
  }

  /* ---------- decisiones de la IA (petición anticipada) ---------- */
  let budgetWarned = 0;
  const notices = new Set<string>();
  async function pollDecisions() {
    if (!state.aiMode || speed === 0 || document.hidden || lost || state.pending.length === 0) return;
    try {
      const r = await api.decisions(token);
      for (const d of r.decisions) {
        if (!state.pending.some((p) => p.citizenId === d.citizenId && p.createdTick === d.createdTick)) continue;
        await command({ type: 'CitizenAct', citizenId: d.citizenId, action: d.action, motivo: d.motivo, source: 'ai' });
      }
      $('#ai-banner').hidden = !r.capped;
      setAiChip(r.capped ? 'paused' : 'on');
      if (r.notice && !notices.has(r.notice)) {
        notices.add(r.notice);
        toast(r.notice, { kind: 'warn' });
      }
      const level = r.budgetFraction >= 0.8 ? 80 : r.budgetFraction >= 0.5 ? 50 : 0;
      if (level > budgetWarned) {
        budgetWarned = level;
        toast(`Has gastado el ${level} % del tope de la IA.`, { kind: 'warn', sticky: true });
      }
    } catch {
      /* sin conexión: deciden las reglas */
    }
  }
  const decisionTimer = setInterval(() => void pollDecisions(), 1500);
  function setAiChip(mode: 'on' | 'paused') {
    const chip = $('#ai-chip');
    chip.hidden = !state.aiMode;
    chip.textContent = mode === 'on' ? 'IA ●' : 'IA en pausa';
    chip.classList.toggle('paused', mode === 'paused');
    chip.setAttribute('aria-label', mode === 'on' ? 'IA activa: ver gasto' : 'IA en pausa por el tope de gasto: deciden las reglas. Ver gasto');
  }
  setAiChip('on');
  $('#ai-chip').onclick = () => void openUsage(token);

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
  const minZoom = () => Math.max(1, Math.floor(dpr() / 2));
  const maxZoom = () => Math.round(dpr() * 4);
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
      if (!pendingEnd) preview = t0 && tool.id !== 'inspect' ? previewFor(anchor ?? t0, t0) : null;
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
    // Con un inicio marcado (dos toques) se mantiene la vista previa del trazado.
    if (!anchor) preview = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      setZoom(cam.zoom + (e.deltaY < 0 ? 1 : -1), (e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr());
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
    // Carretera y zonas: además de arrastrar, se puede tocar el inicio y luego el final.
    if (tool.shape !== 'tap') {
      if (!anchor) {
        anchor = tile;
        pendingEnd = null;
        preview = previewFor(tile, tile);
        document.body.classList.add('placing');
        $('#tool-info').textContent = `${tool.label}: ahora toca dónde termina (o arrastra). Esc para cancelar.`;
        $('#sr-live').textContent = `Inicio marcado en la casilla ${tile.x}, ${tile.y}. Elige el final.`;
        return;
      }
      const line = commandFor(tool, anchor, tile);
      if (!line) return;
      // Primer toque en el final: se enseña el trazado y lo que cuesta; el segundo, ahí mismo, confirma.
      if (!pendingEnd || pendingEnd.x !== tile.x || pendingEnd.y !== tile.y) {
        pendingEnd = tile;
        preview = previewFor(anchor, tile);
        const n = tilesOf(line).length;
        const cost = n * (tool.zone ? ZONE_COST_PER_TILE : BUILD.road.materials);
        const v = validateCommand(state, line);
        const msg = v.ok
          ? `${tool.label}: ${plural(n, 'casilla', 'casillas')}, ${money(cost)}. Toca otra vez el final para confirmar.`
          : `${tool.label}: no se puede (${v.error}). Elige otro final o pulsa Esc.`;
        $('#tool-info').textContent = msg;
        $('#sr-live').textContent = msg;
        return;
      }
      anchor = null;
      pendingEnd = null;
      preview = null;
      document.body.classList.remove('placing');
      selectTool(tool.id);
      await command(line);
      return;
    }
    const cmd = commandFor(tool, tile, tile);
    if (cmd) await command(cmd);
  }

  /** Qué hay en una casilla (para el lector de pantalla). */
  function describeTile(t: { x: number; y: number }): string {
    const b = state.buildings.find((x) => x.x === t.x && x.y === t.y);
    const i = t.y * state.map.w + t.x;
    const what = b ? (b.name ?? BUILD_NAMES[b.kind] ?? b.kind) : state.map.tiles[i] === Tile.Road ? 'carretera' : state.map.tiles[i] === Tile.Tree ? 'árboles' : 'solar libre';
    const zone = ['', ', zona residencial', ', zona comercial', ', zona industrial'][state.map.zones[i] ?? 0] ?? '';
    let can = '';
    if (tool.id !== 'inspect') {
      const cmd = commandFor(tool, anchor ?? t, t);
      const v = cmd ? validateCommand(state, cmd) : null;
      can = v ? (v.ok ? `. ${tool.label}: se puede${costText(tool) ? ` (${costText(tool)})` : ''}` : `. ${tool.label}: no se puede (${v.error})`) : '';
    }
    return `Casilla ${t.x}, ${t.y}: ${what}${zone}${can}`;
  }

  window.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
    const step = Math.round(64 * dpr());
    const k = e.key;
    // Con una hoja abierta el teclado es de la hoja: el mapa no se mueve por detrás.
    if (isSheetOpen() && k !== 'Escape') return;
    // Con el mapa enfocado, las flechas mueven un cursor de casilla e Intro actúa en él.
    if (document.activeElement === canvas && (k.startsWith('Arrow') || k === 'Enter')) {
      e.preventDefault();
      if (!cursor) {
        const th = state.buildings.find((b) => b.kind === 'townhall');
        cursor = th ? { x: th.x, y: th.y + 1 } : { x: Math.floor(state.map.w / 2), y: Math.floor(state.map.h / 2) };
      }
      if (k === 'Enter') {
        void tapTile(cursor);
        return;
      }
      const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
      const dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      cursor = { x: Math.max(0, Math.min(state.map.w - 1, cursor.x + dx)), y: Math.max(0, Math.min(state.map.h - 1, cursor.y + dy)) };
      // La cámara sigue al cursor cuando se acerca al borde.
      const ts = tileSize();
      const sx = cursor.x * ts - cam.x;
      const sy = cursor.y * ts - cam.y;
      if (sx < ts || sy < ts || sx > canvas.width - 2 * ts || sy > canvas.height - 2 * ts) centerOn(cursor.x, cursor.y);
      if (tool.id !== 'inspect') preview = previewFor(anchor ?? cursor, cursor);
      $('#sr-live').textContent = describeTile(cursor);
      return;
    }
    if (k === 'ArrowLeft' || k === 'a') cam.x -= step;
    else if (k === 'ArrowRight' || k === 'd') cam.x += step;
    else if (k === 'ArrowUp' || k === 'w') cam.y -= step;
    else if (k === 'ArrowDown' || k === 's') cam.y += step;
    else if (k === '+' || k === '=') setZoom(cam.zoom + 1);
    else if (k === '-') setZoom(cam.zoom - 1);
    else if (k === 'l') $('#layers').click();
    else if (k === ' ' && target.tagName !== 'BUTTON') {
      e.preventDefault();
      setSpeed(speed === 0 ? 1 : 0);
    } else if (k === 'Escape') {
      if (isSheetOpen()) closeSheet();
      else if (anchor) {
        anchor = null;
        pendingEnd = null;
        preview = null;
        document.body.classList.remove('placing');
        selectTool(tool.id);
      } else selectTool('inspect');
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
      img.width = c.width;
      img.height = c.height;
      img.getContext('2d')!.drawImage(c, 0, 0);
      wrap.append(img);
    } else if (tl.zone && tl.zone !== 'none') {
      const color = { R: 6, C: 10, I: 4 }[tl.zone];
      const img = document.createElement('canvas');
      img.width = 5;
      img.height = 7;
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
    anchor = null;
    pendingEnd = null;
    document.body.classList.remove('placing');
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
      if (b.kind === 'house' || b.kind === 'res' || b.kind === 'shop' || b.kind === 'factory') {
        content.push(h('p', {}, `Valor de mercado: ${money(unitValue(state, b))}${b.kind === 'house' || b.kind === 'res' ? ' por vivienda' : ''}.`));
      }
      if (b.kind === 'house') {
        const sale = !!b.forSale;
        const toggle = h('button', { class: 'btn wide' }, sale ? 'Pasar a alquiler' : 'Poner a la venta');
        toggle.addEventListener('click', () => void command({ type: 'SetHousingMode', buildingId: b.id, mode: sale ? 'rent' : 'sale' }));
        content.push(
          h('p', {}, sale ? `A la venta: los inquilinos pueden comprar su vivienda (máx. ${money(salePrice(state, b))} + 4 % de gastos). El dinero va al ayuntamiento.` : 'En alquiler: cobras alquiler cada mes.'),
          h('p', { class: 'muted' }, `Viviendas ya vendidas: ${b.privateUnits ?? 0} de 3.`),
          toggle,
        );
      }
      if (b.owner > 0) {
        const o = state.citizens.find((c) => c.id === b.owner);
        content.push(h('p', {}, `Negocio de ${o?.name ?? 'un antiguo vecino'}.`));
      }
      if (b.kind === 'shop' || b.kind === 'factory') content.push(h('p', { class: 'muted' }, `Caja de la empresa: ${money(b.cash)}`));
    }
    const owner = b.owner === 0 ? 'Municipal' : b.owner === -1 ? 'Privado (inversor de fuera)' : 'De un vecino';
    content.push(h('p', { class: 'muted' }, owner));
    sheet(b.name ?? BUILD_NAMES[b.kind] ?? b.kind, ...content);
    const body = document.querySelector('.sheet-body');
    if (body) body.scrollTop = prevScroll;
  }

  function citizenList(all: GameState['citizens']) {
    const ul = h('ul', { class: 'people' });
    const list = all.filter((c) => c.named);
    const others = all.length - list.length;
    for (const c of list) {
      const factors = happinessFactors(state, c)
        .filter((f) => f.value < 0)
        .map((f) => f.label.toLowerCase());
      const moodText = c.happiness >= 65 ? 'contento' : c.happiness >= 40 ? 'regular' : 'descontento';
      const mood = c.happiness >= 65 ? '😊' : c.happiness >= 40 ? '😐' : '☹️';
      const last = [...state.decisionLog].reverse().find((d) => d.citizenId === c.id);
      const row = h(
        'li',
        { class: 'person-click' },
        h(
          'button',
          { class: 'person-row', 'aria-label': `Ficha de ${c.name}` },
          h('span', { 'aria-hidden': 'true' }, `${mood} `),
          h('strong', {}, `${c.named ? '★ ' : ''}${c.name}`),
          ` (${moodText})`,
          `, ${c.age} años · ${money(c.money)}`,
          c.named ? h('span', { class: 'muted' }, ` · quiere ${DESIRE_TEXT[c.desire]}, teme ${FEAR_TEXT[c.fear]}`) : '',
          last ? h('em', { class: 'quote' }, ` «${last.motivo}»`) : '',
          c.owns ? h('span', { class: 'muted' }, ' · propietario') : '',
          factors.length ? h('span', { class: 'muted' }, ` · le preocupa: ${factors.join(', ')}`) : '',
        ),
      );
      row.querySelector('button')!.addEventListener('click', () => openCitizen(social, c.id));
      ul.append(row);
    }
    if (others > 0) {
      const avg = Math.round(all.filter((c) => !c.named).reduce((a, c) => a + c.happiness, 0) / others);
      ul.append(h('li', { class: 'muted' }, `${list.length ? 'Y ' : ''}${others} ${others === 1 ? 'vecino' : 'vecinos'} más (felicidad media ${avg})`));
    }
    return ul;
  }

  /* ---------- menú, impuestos y cuentas ---------- */
  const social: SocialCtx = { token, state: () => state, command };
  const openTaxes = () => openTaxesSheet(() => state, command);
  const openAccounts = () => openReport(state);

  function openMenu() {
    const item = (label: string, fn: () => void) => {
      const b = h('button', { class: 'btn wide' }, label);
      b.addEventListener('click', fn);
      return b;
    };
    sheet(
      'Menú',
      item('Impuestos', openTaxes),
      item('Parte mensual', openAccounts),
      item('Vecinos', () => openNeighbours(state, (c) => openCitizen(social, c.id))),
      item('Pleno municipal', () => openPleno(social)),
      item('Consejero', () => openAdvisor(social)),
      item('Diario del pueblo', () => openDiary(social)),
      item('Política y elecciones', () => openPolitics(social)),
      ...(state.aiMode
        ? [
            item('Gasto de la IA', () => void openUsage(token)),
            item('Qué se envía a la IA', () => void openPreview(token)),
          ]
        : []),
      item('Ajustes (sonido y accesibilidad)', openSettings),
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
    // Modo tranquilo: como mucho x1.
    if (prefs().calm && s > 1) {
      toast('Modo tranquilo: la velocidad máxima es x1 (Ajustes).', { kind: 'info' });
      s = 1;
    }
    if (s === 10 && speed !== 10) {
      toast(
        state.aiMode
          ? 'x10 con la IA activa: gasta más por hora y muchas decisiones no llegarán a tiempo (las tomarán las reglas).'
          : 'x10 avanza un mes cada minuto: vigila la caja.',
        { kind: state.aiMode ? 'warn' : 'info' },
      );
    }
    speed = s;
    send({ type: 'speed', speed: s });
    $('#sr-live').textContent = s === 0 ? 'Juego en pausa' : `Velocidad x${s}`;
    for (const b of document.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-speed')) === s));
  }

  const onVisibility = () => {
    if (document.hidden) {
      setSpeed(0);
      send({ type: 'flush' });
    }
  };
  const onPageHide = () => {
    rememberSeen(token, state);
    send({ type: 'flush' });
    void flushQueue(true);
    void api.release(token, sessionId);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  const heartbeat = setInterval(() => !document.hidden && !lost && send({ type: 'flush' }), 30_000);

  function exit() {
    rememberSeen(token, state);
    stopMusic();
    offPrefs();
    setSpeed(0);
    send({ type: 'flush' });
    setTimeout(() => {
      void flushQueue().then(() => {
        worker.terminate();
        clearInterval(heartbeat);
        clearInterval(decisionTimer);
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
  $('#layers').onclick = () => {
    const ids = LAYERS.map((l) => l.id);
    layer = ids[(ids.indexOf(layer) + 1) % ids.length]!;
    const def = LAYERS.find((l) => l.id === layer)!;
    const legend = $('#legend');
    legend.hidden = layer === 'none';
    legend.replaceChildren(h('strong', {}, def.label), ...def.legend.map((x) => h('span', { class: `legend-item ${x.cls}` }, x.text)));
    $('#layers').setAttribute('aria-label', `Capas de datos: ${def.label}`);
    $('#layers').setAttribute('aria-pressed', String(layer !== 'none'));
    $('#sr-live').textContent = layer === 'none' ? 'Capas desactivadas' : `Capa activa: ${def.label}`;
  };
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
    sprite: (kind: string, id: number) => buildingSprite(kind, id),
    tileCenter(tx: number, ty: number) {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((tx + 0.5) * tileSize() - cam.x) / dpr(), y: r.top + ((ty + 0.5) * tileSize() - cam.y) / dpr() };
    },
  };

  /* ---------- bucle de pintado ---------- */
  function frame(time: number) {
    if ($('#game').hidden) return;
    render(ctx, state, cam, { preview, selected, cursor: document.activeElement === canvas ? cursor : null, time, reducedMotion: reducedMotion(), layer });
    placeBubbles();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  // Un píxel del sprite ≈ 1,5 px CSS: se aprecia el detalle sin perder vista.
  cam.zoom = Math.max(2, Math.round(dpr() * 1.5));
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  centerOn(hall?.x ?? state.map.w / 2, (hall?.y ?? state.map.h / 2) + 1);
  selectTool('inspect');
  setSpeed(0);
  onState();
  const away = resumeSummary(token, state);
  if (away && away.length) toast(`Desde tu última visita: ${away.join(' · ')}`, { sticky: true });
  tutorial.start(state);
  tutorial.update(state, tool.id);
  if (!tutorial.active) toast('En pausa. Pulsa x1 para que pase el tiempo.');
  // Sonido: se desbloquea con el primer gesto; el ambiente sigue la hora del juego.
  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  startMusic(() => timeOfDay(state.tick) === 'night');
  startAmbience(() => timeOfDay(state.tick) === 'night');
  // Al activar el modo tranquilo con x3/x10 puestos, se baja a x1.
  const markCalm = () => {
    for (const b of document.querySelectorAll('[data-speed="3"], [data-speed="10"]')) b.setAttribute('aria-disabled', String(prefs().calm));
  };
  markCalm();
  const offPrefs = onPrefs((p) => {
    if (p.calm && speed > 1) setSpeed(1);
    markCalm();
  });
  requestAnimationFrame(frame);
}
