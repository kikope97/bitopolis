import { tickToDate, type Command } from '@bitopolis/shared';
import {
  BUILD_NAMES,
  type Building,
  salePrice,
  unitValue,
  type GameEvent,
  type GameState,
  cellsUsed,
  coverageSummary,
  jailCapacity,
  canUpgradeBuilding,
  cellsOf,
  jailPlacesOf,
  levelOf,
  plantCapacityOf,
  radiusOf,
  SERVICE_LEVELS,
  serviceCapacityOf,
  serviceCounts,
  UPGRADABLE,
  upgradeCost,
  upgradeReqs,
  type NeedKey,
  stationsFor,
  SEASON_TEXT,
  seasonOf,
  WEATHER_TEXT,
  happinessFactors,
  missingServices,
  NEED_LABEL,
  occupants,
  roadCost,
  zoneChanges,
  Terrain,
  terrainAt,
  Tile,
  validateCommand,
  ZONE_COST_PER_TILE,
  canUpgradeTownhall,
  TOWNHALL_LEVELS,
  townLevel,
  zonesUnlocked,
} from '@bitopolis/sim';
import { makeBubble, openPreview, openUsage } from './ai-ui.ts';
import { openNeighbours, openReport, openTaxes as openTaxesSheet } from './economy-ui.ts';
import { LAYERS, type LayerId, NEED_ICON } from './layers.ts';
import { openTownHall } from './civic-ui.ts';
import { openAlbum, snapMoments } from './album-ui.ts';
import { objectivesNode, openAdvisor, openCitizen, openDiary, openPleno, portraitCanvas, rememberSeen, renderObjectives, resumeSummary, type SocialCtx } from './social-ui.ts';
import { api, ApiError } from './api.ts';
import { nextHint } from './hints.ts';
import { openManagement } from './manage-ui.ts';
import { formatDate, money, MONTHS, plural, shortDate, t } from './i18n.ts';
import { type Camera, type Preview, render, restartAnimations } from './render.ts';
import type { FromWorker, SaveBatch, ToWorker } from './sim.worker.ts';
import SimWorker from './sim.worker.ts?worker';
import { buildingSprite, letterSprite, T } from './sprites.ts';
import { commandFor, costText, isLocked, lockLong, lockShort, shortCost, type Tool, type ToolId, TOOLS, tilesOf, TRAY, trayCost } from './tools.ts';
import { Tutorial } from './tutorial.ts';
import { $, clearToastLog, closeSheet, onSheetChange, confirmDialog, currentSheet, h, isSheetOpen, markLogRead, onToastLog, reducedMotion, sheet, toast, toastLog, vibrate, withBack } from './ui.ts';
import { pixelIcon } from './icons.ts';
import { duck, sfx, startAmbience, startMusic, stopMusic, unlockAudio } from './audio.ts';
import { coins, dust, pop, shake, shakeOffset } from './fx.ts';
import { onPrefs, prefs } from './prefs.ts';
import { openSettings } from './settings-ui.ts';
import { openElectionNight, openPolitics, renderPollChip } from './politics-ui.ts';
import { timeOfDay } from './render.ts';

/** Margen entre toque y arrastre: con el dedo, más (un temblor no es un arrastre). */
const DRAG_PX = 10;
const DRAG_PX_TOUCH = 18;
const DESIRE_TEXT: Record<string, string> = {
  trabajo_cerca: 'trabajar cerca de casa',
  casa_propia: 'tener casa propia',
  parque: 'un parque',
  tienda: 'tiendas cerca',
  tranquilidad: 'tranquilidad',
  prosperar: 'prosperar',
};

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
  document.body.classList.add('in-game');

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
  /** v1.4: en pantallas táctiles, una obra se coloca en dos pasos (ver, confirmar). */
  let pendingPlace: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
  let touchInput = false;
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
      shake(3, 250);
      say('Derribado.');
    } else if (cmd.type === 'Zone') {
      sfx.tap();
      say(cmd.zone === 'none' ? 'Zona quitada.' : `Zona ${cmd.zone} pintada: ${plural(cmd.w * cmd.h, 'casilla', 'casillas')}.`);
    } else if (cmd.type === 'Motion') {
      sfx.tap();
      const m = state.politics.motions.at(-1);
      if (m) say(`Moción ${m.approved ? 'aprobada' : 'rechazada'}: ${m.need}.`);
    } else if (cmd.type === 'SetTax' || cmd.type === 'SetTaxes') sfx.tap();
  }

  /**
   * v1.8 (aplazado de la ronda 13): la primera vez en cada partida, se presenta
   * la geografía. La cámara se acerca al río o al mar más cercano al
   * ayuntamiento, un aviso explica qué supone y la cámara vuelve al pueblo.
   * Con movimiento reducido, solo el aviso (al tocarlo, lleva allí).
   */
  function introGeography() {
    const key = `bitopolis.geo.${token}`;
    // En pruebas automáticas, no (la cámara se movería mientras se toca el mapa).
    if (navigator.webdriver) return;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      return;
    }
    const ter = state.map.terrain ?? [];
    const hall = state.buildings.find((b) => b.kind === 'townhall');
    if (!hall) return;
    let best = -1;
    let bestD = Infinity;
    ter.forEach((t, i) => {
      if (t !== Terrain.River && t !== Terrain.Sea) return;
      const d = Math.abs((i % state.map.w) - hall.x) + Math.abs(Math.floor(i / state.map.w) - hall.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return;
    const wx = best % state.map.w;
    const wy = Math.floor(best / state.map.w);
    const sea = ter[best] === Terrain.Sea;
    const dir = Math.abs(wx - hall.x) > Math.abs(wy - hall.y) ? (wx > hall.x ? 'al este' : 'al oeste') : wy > hall.y ? 'al sur' : 'al norte';
    const hills = ter.includes(Terrain.Hill) ? ' Las colinas (hierba alta) también se edifican, pero los materiales cuestan un 50 % más.' : '';
    const text = sea
      ? `Tu pueblo da al mar ${dir}: cerca de la costa el suelo vale más.${hills}`
      : `${dir[0]!.toUpperCase()}${dir.slice(1)} pasa un río: junto a él el suelo vale más, pero con las tormentas se desborda. Para cruzarlo, una carretera sobre el río hace de puente.${hills}`;
    const look = () => centerOn(wx, wy);
    setTimeout(() => {
      if (reducedMotion()) {
        toast(text, { kind: 'info', sticky: true, onClick: look });
        return;
      }
      const from = { x: cam.x, y: cam.y };
      glide(from, () => {
        look();
        return { x: cam.x, y: cam.y };
      }, () => {
        toast(text, { kind: 'info', sticky: true, onClick: look });
        setTimeout(() => glide({ x: cam.x, y: cam.y }, () => from, () => {}), 3500);
      });
    }, 1500);
  }
  /** v1.8: a x3/x10, un calendario arriba a la izquierda que pasa la hoja cada día. */
  let calDay = -1;
  function paintCalendar(d: { year: number; month: number; day: number }) {
    const cal = $('#calendar');
    const on = speed >= 3;
    if (cal.hidden === on) {
      cal.hidden = !on;
      document.body.classList.toggle('cal-on', on);
    }
    if (!on || d.day === calDay) return;
    calDay = d.day;
    cal.querySelector('.cal-m')!.textContent = `${MONTHS[d.month - 1]!.toLowerCase()} A${d.year}`;
    cal.querySelector('.cal-d')!.textContent = String(d.day);
    if (!reducedMotion()) {
      cal.classList.remove('flip');
      void cal.offsetWidth;
      cal.classList.add('flip');
    }
  }
  /** Desliza la cámara de `from` al destino que calcula `to` (en 1 s). */
  function glide(from: { x: number; y: number }, to: () => { x: number; y: number }, done: () => void) {
    const target = to();
    cam.x = from.x;
    cam.y = from.y;
    const t0 = performance.now();
    const stepFn = (now: number) => {
      const k = Math.min(1, (now - t0) / 1000);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      cam.x = Math.round(from.x + (target.x - from.x) * e);
      cam.y = Math.round(from.y + (target.y - from.y) * e);
      if (k < 1) requestAnimationFrame(stepFn);
      else done();
    };
    requestAnimationFrame(stepFn);
  }

  /** Centro de una casilla en coordenadas de pantalla (CSS). */
  function screenOf(tx: number, ty: number): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [r.left + ((tx + 0.5) * 32 * cam.zoom - cam.x) / dpr(), r.top + ((ty + 0.2) * 32 * cam.zoom - cam.y) / dpr()];
  }

  /**
   * v1.8 (petición del creador): algo pide atención (robo sin resolver,
   * calabozos llenos, manifestación, disturbios, riada). Siempre destella el
   * sitio; a x3/x10 además vuelve a x1, tiembla el mapa y la cámara va allí.
   * Como mucho una vez cada 45 s: que no se pare todo el rato.
   */
  let highlight: { x: number; y: number; since: number } | null = null;
  let lastAttention = -Infinity;
  function attention(at: { x: number; y: number } | undefined) {
    const now = performance.now();
    if (at) highlight = { x: at.x, y: at.y, since: now };
    // Ronda 14: si en este mismo lote ya se bajó a x1 (una oferta con plazo), el motivo
    // que llega detrás sí se enseña; si no, como mucho una parada cada 45 s.
    const sameBatch = now - lastAttention < 2_000;
    if (!sameBatch && (speed < 3 || now - lastAttention < 45_000)) return;
    lastAttention = now;
    if (speed >= 3) setSpeed(1);
    shake(5, 450);
    vibrate(100);
    if (!at) return;
    // Ronda 14: acercar lo bastante para que se vea la animación (la marcha, el ladrón).
    const want = Math.max(touchZoom(), Math.round(dpr() * 2));
    if (cam.zoom < want) setZoom(want);
    if (reducedMotion()) {
      centerOn(at.x, at.y);
      restartAnimations();
      return;
    }
    glide({ x: cam.x, y: cam.y }, () => {
      centerOn(at.x, at.y);
      return { x: cam.x, y: cam.y };
    }, () => restartAnimations());
  }
  /** Una oferta con plazo baja a x1 (sin temblor) y cuenta como parada (ronda 14). */
  function slowDown() {
    if (speed < 3) return;
    setSpeed(1);
    lastAttention = performance.now();
  }
  const hallSpot = () => state.buildings.find((b) => b.kind === 'townhall');
  const refSpot = (ref?: number) => (ref !== undefined ? state.buildings.find((b) => b.id === ref) : undefined);

  /** Modo tranquilo: un evento importante pausa el juego. */
  function calmPause() {
    if (prefs().calm && speed > 0) {
      setSpeed(0);
      toast('Modo tranquilo: juego en pausa. Pulsa ▶ para seguir.', { kind: 'info' });
    }
  }

  /* ---------- HUD (v1.6: iconos de píxeles y cifras; cada dato se toca) ---------- */
  const moneyText = h('span', { class: 'tb-text' });
  const moneyTrend = h('span', { class: 'trend', 'aria-hidden': 'true' });
  $('#hud-money').replaceChildren(pixelIcon('coin'), moneyText, moneyTrend);
  const popText = h('span', { class: 'tb-text' });
  $('#hud-pop').replaceChildren(pixelIcon('people'), popText);
  const happyText = h('span', { class: 'tb-text' });
  $('#hud-happy').replaceChildren(pixelIcon('smile'), happyText);
  let lastStats = state.stats.length;
  let lastLevel = townLevel(state);
  let upgradeWarned = townLevel(state) - 1;
  const albumSeen = { n: state.album?.length ?? 0 };
  function onState() {
    // v1.7: foto de cada momento nuevo del álbum (en este navegador).
    snapMoments(token, state, albumSeen);
    if (layer === 'missing' && Math.floor(state.tick / 24) !== legendDay) missingLegend();
    // Ronda 12: al llegar a 10 vecinos, un momento de desbloqueo que lleva a la bandeja.
    // v1.8: cuando se puede ampliar el ayuntamiento, se avisa una vez por nivel.
    const lv = townLevel(state);
    if (canUpgradeTownhall(state).ok && upgradeWarned < lv) {
      upgradeWarned = lv;
      const hall = hallSpot();
      toast(`Ya puedes ampliar el ayuntamiento a nivel ${lv + 1}: toca el ayuntamiento para ver qué desbloquea.`, { kind: 'good', sticky: true, onClick: hall ? () => focusBuilding(hall.id) : undefined });
      if (hall) highlight = { x: hall.x, y: hall.y, since: performance.now() };
    }
    if (lastLevel < 2 && lv >= 2) {
      sfx.milestone();
      vibrate(120);
      toast('¡Zonas desbloqueadas! Toca aquí o «Construir» para pintar zonas R, C e I junto a la carretera.', { kind: 'good', sticky: true, onClick: () => openTray() });
      tabBuild.classList.add('pulse');
      setTimeout(() => tabBuild.classList.remove('pulse'), 8000);
    }
    lastLevel = lv;
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
    paintCalendar(d);
    $('#hud-date').textContent = shortDate(d);
    $('#hud-date').setAttribute('aria-label', formatDate(d));
    // v1.7: el tiempo de hoy junto a la fecha (icono y, en pantallas anchas, el nombre).
    const wk = state.weather?.kind ?? 'sol';
    const wEl = $('#hud-weather');
    if (wEl.dataset.kind !== wk) {
      wEl.dataset.kind = wk;
      const icon = { sol: 'sun', nubes: 'rain', lluvia: 'rain', tormenta: 'storm', nieve: 'snow', calor: 'heat' }[wk];
      wEl.replaceChildren(...(wk === 'nubes' ? [] : [pixelIcon(icon)]), h('span', { class: 'weather-name' }, WEATHER_TEXT[wk]));
      wEl.setAttribute('aria-label', `${SEASON_TEXT[seasonOf(d.month)]}: ${WEATHER_TEXT[wk].toLowerCase()}`);
    }
    // El botón de la franja lleva su propio nombre: incluye la fecha y el tiempo (ronda 13).
    $('#strip-info').setAttribute('aria-label', `${formatDate(d)}, ${WEATHER_TEXT[wk].toLowerCase()}. Ver qué pide el pueblo`);
    if (d.hour === 0 || dayAgoTreasury.length === 0) {
      dayAgoTreasury.push(state.treasury);
      if (dayAgoTreasury.length > 2) dayAgoTreasury.shift();
    }
    const diff = state.treasury - (dayAgoTreasury[0] ?? state.treasury);
    moneyText.textContent = money(state.treasury);
    moneyTrend.textContent = diff > 0 ? '▲' : diff < 0 ? '▼' : '';
    moneyTrend.className = `trend ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`;
    $('#hud-money').classList.toggle('neg', state.treasury < 0);
    $('#hud-money').setAttribute('aria-label', `Caja del ayuntamiento: ${money(state.treasury)}${diff > 0 ? ', subiendo' : diff < 0 ? ', bajando' : ''}. Ver cuentas`);
    popText.textContent = String(state.citizens.length);
    $('#hud-pop').setAttribute('aria-label', `Habitantes: ${state.citizens.length}. Ver la lista`);
    const happy = state.citizens.length ? Math.round(state.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.length) : 0;
    happyText.textContent = String(happy);
    $('#hud-happy').classList.toggle('neg', happy > 0 && happy < 45);
    $('#hud-happy').setAttribute('aria-label', `Felicidad media ${happy} de 100: ver por qué`);
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
    // Solo se refresca la ficha que se está mirando; antes, cualquier hoja abierta
    // (menú, impuestos, noche electoral…) se cambiaba por la última ficha vista (v1.4).
    if (openInspect && inspectSheet && currentSheet() === inspectSheet) openInspect();
  }

  function updateDemand() {
    const box = $('#demand');
    const unlocked = zonesUnlocked(state);
    for (const k of ['R', 'C', 'I'] as const) {
      const row = box.querySelector<HTMLElement>(`[data-d="${k}"]`)!;
      const v = state.demand[k];
      row.hidden = !unlocked;
      const bar = row.querySelector<HTMLElement>('.bar-fill')!;
      bar.style.width = `${Math.max(0, v)}%`;
      row.querySelector('.bar-num')!.textContent = v > 0 ? `+${v}` : String(v);
      row.setAttribute('aria-label', `Demanda de ${k === 'R' ? 'viviendas' : k === 'C' ? 'tiendas' : 'industria'}: ${v}`);
    }
    // Antes de las zonas, la franja enseña lo que falta para desbloquearlas (ronda 12: «R +47» no se entendía).
    const next = $('#next-unlock');
    next.hidden = unlocked;
    if (!unlocked) {
      const n = state.citizens.length;
      const need = TOWNHALL_LEVELS[1]!.pop;
      const sig = `${Math.min(n, need)}`;
      if (next.dataset.sig !== sig) {
        next.dataset.sig = sig;
        const fill = h('span', { class: 'bar-fill' });
        // Con CSSOM (la CSP no deja atributos style).
        fill.style.width = `${Math.min(100, Math.round((100 * n) / need))}%`;
        // v1.8: con los vecinos ya, falta ampliar el ayuntamiento.
        next.replaceChildren(h('span', {}, n >= need ? 'Zonas: amplía el ayuntamiento' : `Zonas: ${n}/${need} vecinos`), h('span', { class: 'bar', 'aria-hidden': 'true' }, fill));
      }
    }
  }

  function updateToolLocks() {
    for (const tl of TOOLS) {
      const btn = document.querySelector<HTMLButtonElement>(`#tray [data-tool="${tl.id}"]`);
      if (!btn) continue;
      const locked = isLocked(tl, state);
      // Ronda 14: también cambia el motivo («ayto. nivel 2» → «25 vecinos»), no solo el candado.
      const sig = locked ? lockText(tl) : '';
      if (btn.dataset.ready && btn.dataset.lock === sig) continue;
      btn.dataset.ready = '1';
      btn.dataset.lock = sig;
      btn.classList.toggle('locked', locked);
      btn.setAttribute('aria-disabled', String(locked));
      btn.querySelector('.tool-cost')!.textContent = locked ? `🔒 ${lockText(tl)}` : trayCost(tl);
    }
  }
  /** Qué falta para desbloquear una herramienta, en pocas palabras. */
  const lockText = (tl: Tool) => lockShort(tl, state) ?? '';

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
    // v1.4: a x10 solo avisa lo importante; lo demás queda en el diario (antes llenaba la pantalla).
    const quiet = speed >= 10;
    const arrivals = fresh.filter((e) => e.kind === 'arrival');
    if (arrivals.length) sfx.arrival();
    if (quiet) {
      /* llegadas: en el contador de vecinos y en el diario */
    } else if (arrivals.length === 1) toast(arrivals[0]!.text, { kind: 'good' });
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
    if (quiet && notified.length > 1) toast(`${notified.length} obras terminadas`, { kind: 'good' });
    for (const e of quiet && notified.length > 1 ? [] : notified) {
      toast(e.text, { kind: 'good', sticky: !quiet, onClick: e.ref ? () => focusBuilding(e.ref!) : undefined });
      vibrate(80);
      calmPause();
    }
    const plain = quiet ? [] : built.filter((e) => !e.notify);
    if (plain.length === 1) toast(plain[0]!.text, { kind: 'good' });
    else if (plain.length > 1) toast(`${plain.length} obras terminadas`, { kind: 'good' });
    for (const e of fresh) {
      if (e.kind === 'bankrupt' || e.kind === 'warning') {
        sfx.warn();
        duck(1.5);
        if (e.kind === 'bankrupt') shake(4, 400);
        calmPause();
        toast(e.kind === 'warning' ? `${e.text}. ${nextHint(state).text}` : e.text, {
          kind: 'warn',
          sticky: true,
          onClick: openAccounts,
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
        shake(6, 500);
        vibrate(150);
        calmPause();
        openElectionNight(social);
      } else if (e.kind === 'info' && /Diputación|fiestas|Subvención/.test(e.text)) {
        // v1.5: ofertas de subvención y fiestas: llevan a su sección del Ayuntamiento.
        // Si hay que decidir algo con plazo, el juego baja a x1 para que dé tiempo (ronda 11).
        const decide = /Responde antes|puedes organizarlas/.test(e.text);
        if (decide) slowDown();
        toast(e.text, { kind: 'info', sticky: decide, onClick: () => openTownHall(social, /fiestas/i.test(e.text) ? 'festival' : 'grants') });
      } else if (e.kind === 'info' && /^(Nieva|Ola de calor|Tormenta sobre|El río crece)/.test(e.text)) {
        // v1.7: el tiempo que cambia algo (no el sol ni las nubes).
        toast(e.text, { kind: 'info' });
      } else if (e.kind === 'info' && e.text.startsWith('El río se desborda')) {
        sfx.warn();
        vibrate(80);
        calmPause();
        attention(refSpot(e.ref));
        toast(e.text, { kind: 'warn', sticky: true, onClick: e.ref ? () => focusBuilding(e.ref!) : undefined });
      } else if (e.kind === 'crime') {
        // v1.8: robos, detenciones, calabozos llenos y disturbios.
        const bad = /Disturbios|llenos|escapa/.test(e.text);
        if (quiet && !bad) continue;
        if (bad) {
          sfx.warn();
          calmPause();
          attention(refSpot(e.ref) ?? state.buildings.find((b) => b.kind === 'police' && b.built));
        }
        toast(e.text, { kind: bad ? 'warn' : 'good', sticky: /Disturbios|llenos/.test(e.text), onClick: e.ref ? () => focusBuilding(e.ref!) : undefined });
      } else if (e.kind === 'protest') {
        sfx.warn();
        duck(1.5);
        calmPause();
        attention(hallSpot());
        toast(e.text, { kind: 'warn', sticky: true, onClick: () => openTownHall(social, 'associations') });
      } else if (e.kind === 'politics' && /Asociación|asociación/.test(e.text)) {
        // v1.7: asociaciones. Si convocan una manifestación, hay 3 días para reunirse con ellos: baja a x1.
        const urgent = e.text.includes('convoca una manifestación');
        if (urgent) {
          const a = state.associations?.find((x) => x.id === e.ref);
          attention(a?.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : hallSpot());
        }
        toast(e.text, { kind: urgent ? 'warn' : 'info', sticky: urgent || e.text.startsWith('Nace'), onClick: () => openTownHall(social, 'associations') });
      } else if (e.kind === 'politics' && /presupuesto/i.test(e.text)) {
        const decide = e.text.startsWith('Toca presentar');
        if (decide) slowDown();
        toast(e.text, { kind: e.text.includes('rechaza') ? 'warn' : 'info', sticky: decide, onClick: () => openTownHall(social, 'budget') });
      } else if (e.kind === 'politics') {
        // Lo que responde a una acción tuya (moción, campaña) se avisa siempre.
        if (quiet && !e.text.startsWith('Faltan') && !/moción|campaña/i.test(e.text)) continue;
        toast(e.text, { kind: e.text.startsWith('Faltan') && state.politics.approval < 50 ? 'warn' : 'info', sticky: e.text.startsWith('Faltan'), onClick: () => openPolitics(social) });
        if (e.text.startsWith('Faltan') || e.text.includes('funda')) calmPause();
      } else if (e.kind === 'departure' || e.kind === 'business') {
        if (!quiet) toast(e.text, { kind: 'warn' });
        calmPause();
      }
    }
  }

  /* ---------- burbujas con el motivo ---------- */
  const bubbles: { el: HTMLElement; tx: number; ty: number; close: () => void }[] = [];
  function addBubble(citizenId: number, tick: number) {
    const entry = [...state.decisionLog].reverse().find((d) => d.citizenId === citizenId && d.tick === tick);
    const c = state.citizens.find((x) => x.id === citizenId);
    const name = c?.name ?? 'Un vecino';
    const where = state.buildings.find((b) => b.id === (c?.homeId ?? c?.jobId)) ?? state.buildings.find((b) => b.kind === 'townhall');
    if (!entry || !where) return;
    // v1.4: a x10 no salen (llenaban la pantalla); la decisión queda en el diario.
    // A x3, una sola y breve; parado o a x1, como mucho dos (una en el móvil).
    if (speed >= 10) return;
    const max = speed >= 3 || window.innerWidth < 720 ? 1 : 2;
    while (bubbles.length >= max) bubbles[0]!.close();
    const el = makeBubble(name, entry.motivo, entry.source === 'ai');
    const b = { el, tx: where.x, ty: where.y, close: () => {} };
    bubbles.push(b);
    const close = () => {
      el.remove();
      const i = bubbles.indexOf(b);
      if (i >= 0) bubbles.splice(i, 1);
    };
    b.close = close;
    el.addEventListener('click', () => {
      close();
      if (c?.named) openCitizen(social, c.id);
      else focusBuilding(where.id);
    });
    // Sin límite de tiempo con movimiento reducido; si no, según lo largo del texto.
    if (!reducedMotion()) setTimeout(close, speed >= 3 ? 4000 : Math.max(8000, entry.motivo.length * 70));
  }
  function placeBubbles() {
    if (!bubbles.length) return;
    const wrap = canvas.getBoundingClientRect();
    for (const b of bubbles) {
      const r = canvas.getBoundingClientRect();
      const x = r.left + ((b.tx + 0.5) * tileSize() - cam.x) / dpr() - wrap.left;
      const y = r.top + (b.ty * tileSize() - 16 * cam.zoom - cam.y) / dpr() - wrap.top;
      // Siempre dentro del mapa (antes se salían por los lados y tapaban la mitad).
      const w = b.el.offsetWidth;
      const hgt = b.el.offsetHeight;
      const cx = Math.max(w / 2 + 4, Math.min(wrap.width - w / 2 - 4, x));
      const cy = Math.max(hgt + 4, Math.min(wrap.height - 8, y));
      b.el.style.left = `${Math.round(cx)}px`;
      b.el.style.top = `${Math.round(cy)}px`;
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
    // Alturas reales de las barras: las hojas, la bandeja y el tutorial se colocan con ellas.
    const root = document.documentElement.style;
    const side = matchMedia('(orientation: landscape) and (max-height: 500px)').matches;
    root.setProperty('--top-h', `${Math.round($('.topbar').getBoundingClientRect().height)}px`);
    root.setProperty('--dock-h', side ? '0px' : `${Math.round($('#dock').getBoundingClientRect().height)}px`);
    root.setProperty('--strip-h', `${Math.round($('#strip').getBoundingClientRect().height)}px`);
    const oldCenter = { x: cam.x + canvas.width / 2, y: cam.y + canvas.height / 2, ts: tileSize() };
    canvas.width = Math.round(r.width * dpr());
    canvas.height = Math.round(r.height * dpr());
    if (oldCenter.ts) {
      cam.x = Math.round(oldCenter.x - canvas.width / 2);
      cam.y = Math.round(oldCenter.y - canvas.height / 2);
    }
    clampCam();
  }
  /**
   * Cámara inicial: todo el pueblo a la vista con el zoom más cercano que quepa
   * (ronda 12: se veían 7 casillas de ancho). Nunca menos de 24 px por casilla.
   */
  function frameTown() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x: number, y: number) => {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    };
    for (const b of state.buildings) add(b.x, b.y);
    state.map.tiles.forEach((t, i) => t === Tile.Road && add(i % state.map.w, Math.floor(i / state.map.w)));
    if (!Number.isFinite(x0)) add(state.map.w / 2, state.map.h / 2);
    const w = x1 - x0 + 5;
    const hgt = y1 - y0 + 5;
    const fit = Math.floor(Math.min(canvas.width / (w * T), canvas.height / (hgt * T)));
    cam.zoom = Math.max(touchZoom(), Math.min(Math.max(2, Math.round(dpr() * 1.25)), fit));
    centerOn((x0 + x1) / 2, (y0 + y1) / 2);
  }
  function centerOn(tx: number, ty: number) {
    cam.x = Math.round((tx + 0.5) * tileSize() - canvas.width / 2);
    cam.y = Math.round((ty + 0.5) * tileSize() - canvas.height / 2);
    clampCam();
  }
  function clampCam() {
    // Como mucho 2 casillas de borde (antes se podía dejar media pantalla vacía).
    const pad = Math.min(2 * tileSize(), Math.round(Math.min(canvas.width, canvas.height) * 0.15));
    const axis = (pos: number, size: number, view: number) =>
      size + 2 * pad <= view ? Math.round((size - view) / 2) : Math.max(-pad, Math.min(size - view + pad, pos));
    cam.x = axis(cam.x, state.map.w * tileSize(), canvas.width);
    cam.y = axis(cam.y, state.map.h * tileSize(), canvas.height);
  }
  // v1.6.1: se puede alejar como antes de la 1.4 (≈11 px por casilla en un iPhone) para ver el pueblo.
  // Para construir con el dedo hacen falta casillas de al menos 24 px: por debajo, el primer toque acerca.
  const minZoom = () => Math.max(1, Math.floor(dpr() / 2));
  const touchZoom = () => Math.max(1, Math.ceil((24 * dpr()) / T));
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

  /** Inercia al soltar un deslizamiento (v1.4); un toque la detiene. */
  let fling = { vx: 0, vy: 0, t: 0 };
  let flingRaf = 0;
  function startFling() {
    let { vx, vy } = fling;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      cam.x -= Math.round(vx * dt * dpr());
      cam.y -= Math.round(vy * dt * dpr());
      clampCam();
      vx *= Math.pow(0.94, dt / 16);
      vy *= Math.pow(0.94, dt / 16);
      if (Math.hypot(vx, vy) > 0.02) flingRaf = requestAnimationFrame(step);
    };
    if (Math.hypot(vx, vy) > 0.25 && !reducedMotion()) flingRaf = requestAnimationFrame(step);
  }
  /**
   * Los edificios sobresalen media casilla por arriba: tocar el tejado debe
   * elegir ese edificio, no la casilla vacía de encima (Mirar y Derribar).
   */
  function pickTile(cx: number, cy: number, t: { x: number; y: number }): { x: number; y: number } {
    if (tool.id !== 'inspect' && tool.id !== 'demolish') return t;
    const here = state.buildings.some((b) => b.x === t.x && b.y === t.y);
    const below = state.buildings.some((b) => b.x === t.x && b.y === t.y + 1);
    if (here || !below) return t;
    const r = canvas.getBoundingClientRect();
    const fy = (((cy - r.top) * dpr() + cam.y) / tileSize()) % 1;
    return fy >= 0.5 ? { x: t.x, y: t.y + 1 } : t;
  }

  // El navegador genera un «clic» tras el toque: caía sobre «Construir» recién aparecido
  // (construía sin confirmar) o sobre hojas recién abiertas. El mapa se queda el toque (ronda 10).
  canvas.addEventListener('touchend', (e) => e.cancelable && e.preventDefault(), { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(flingRaf);
    closeTray();
    fling = { vx: 0, vy: 0, t: performance.now() };
    touchInput = e.pointerType !== 'mouse';
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
      if (!pendingEnd && !pendingPlace) preview = t0 && tool.id !== 'inspect' ? previewFor(anchor ?? t0, t0) : null;
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
    if (gesture.mode === 'pending' && moved > (touchInput ? DRAG_PX_TOUCH : DRAG_PX)) {
      // Con el dedo, arrastrar mueve el mapa; solo traza si empieza en el inicio ya marcado
      // (antes, con Carretera o Zona elegida no había forma de mover el mapa con un dedo).
      const fromAnchor = !!anchor && !!gesture.startTile && anchor.x === gesture.startTile.x && anchor.y === gesture.startTile.y;
      gesture.mode = tool.shape === 'tap' || (touchInput && !fromAnchor) ? 'pan' : 'paint';
      // Al empezar a arrastrar se recupera lo ya movido: el mapa va pegado al dedo.
      if (gesture.mode === 'pan') {
        cam.x -= Math.round((prev.x - gesture.sx) * dpr());
        cam.y -= Math.round((prev.y - gesture.sy) * dpr());
      }
    }
    if (gesture.mode === 'pan') {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      cam.x -= Math.round(dx * dpr());
      cam.y -= Math.round(dy * dpr());
      clampCam();
      // Velocidad para la inercia (px CSS por ms, suavizada).
      const now = performance.now();
      const dt = Math.max(1, now - fling.t);
      fling = { vx: fling.vx * 0.6 + (dx / dt) * 0.4, vy: fling.vy * 0.6 + (dy / dt) * 0.4, t: now };
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
    if (g.mode === 'pan' && touchInput && performance.now() - fling.t < 80) startFling();
    const t1 = tileAt(e.clientX, e.clientY);
    if (g.mode === 'pending' && t1 && performance.now() >= quietUntil) {
      if (touchInput && tool.id !== 'inspect' && cam.zoom < touchZoom()) {
        // Muy alejado para acertar con el dedo: este toque acerca ahí; el siguiente ya construye.
        const r = canvas.getBoundingClientRect();
        setZoom(touchZoom(), (e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr());
        $('#sr-live').textContent = 'Mapa acercado para colocar con precisión. Toca otra vez.';
      } else void tapTile(pickTile(e.clientX, e.clientY, t1));
    }
    if (g.mode === 'paint' && g.startTile && t1) {
      // Con el dedo, el trazado se enseña y se confirma; con ratón, se hace al soltar.
      if (touchInput) proposePlace(g.startTile, t1);
      else {
        const cmd = commandFor(tool, g.startTile, t1);
        if (cmd) void command(cmd);
      }
    }
    // Con un inicio marcado (dos toques) o una obra por confirmar se mantiene la vista previa.
    if (!anchor && !pendingPlace) preview = null;
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
      toast(lockLong(tool, state), { kind: 'warn' });
      return;
    }
    if (tool.id === 'demolish') {
      // v1.6: se confirma en la franja de abajo, en rojo (antes, una ventana que tapaba el mapa).
      const b = state.buildings.find((x) => x.x === tile.x && x.y === tile.y);
      const onRiver = terrainAt(state, tile.x, tile.y) === Terrain.River;
      const what = b ? (b.name ?? BUILD_NAMES[b.kind]) : state.map.tiles[tile.y * state.map.w + tile.x] === Tile.Road ? (onRiver ? 'Puente' : 'Carretera') : null;
      if (!what) {
        $('#tool-info').replaceChildren(h('b', {}, 'Derribar'), ': ahí no hay nada que derribar. Toca un edificio o una carretera.');
        return refreshStrip();
      }
      const people = b ? occupants(state, b).length + state.citizens.filter((c) => c.jobId === b.id).length : 0;
      return proposePlace(tile, tile, `¿Derribar ${what.toLowerCase()}? No se puede deshacer.${people > 0 ? ` Afecta a ${plural(people, 'vecino', 'vecinos')}.` : ''}`);
    }
    // Carretera y zonas: además de arrastrar, se puede tocar el inicio y luego el final.
    if (tool.shape !== 'tap') {
      if (!anchor) {
        anchor = tile;
        pendingEnd = null;
        preview = previewFor(tile, tile);
        document.body.classList.add('placing');
        $('#tool-info').textContent = `${tool.label}: ahora toca dónde termina (o arrastra). Esc para cancelar.`;
        refreshStrip();
        if (touchInput) {
          // Con el dedo, la instrucción va en la barra, con ✕ para cancelar.
          $('#confirm-text').textContent = `${tool.label}: inicio marcado. Toca dónde termina.`;
          ($('#confirm-yes') as HTMLButtonElement).hidden = true;
          showBar(true);
        }
        $('#sr-live').textContent = `Inicio marcado en la casilla ${tile.x}, ${tile.y}. Elige el final.`;
        return;
      }
      const line = commandFor(tool, anchor, tile);
      if (!line) return;
      if (touchInput) return proposePlace(anchor, tile);
      // Primer toque en el final: se enseña el trazado y lo que cuesta; el segundo, ahí mismo, confirma.
      if (!pendingEnd || pendingEnd.x !== tile.x || pendingEnd.y !== tile.y) {
        pendingEnd = tile;
        preview = previewFor(anchor, tile);
        const v = validateCommand(state, line);
        const msg = v.ok
          ? `${tool.label}: ${lineText(anchor, tile)}. Toca otra vez el final para confirmar.`
          : `${tool.label}: no se puede (${v.error}). Elige otro final o pulsa Esc.`;
        $('#tool-info').textContent = msg;
        refreshStrip();
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
    if (touchInput && tool.build) {
      // Con el dedo solo construye el botón «Construir»: un doble toque no gasta (ronda 10).
      return proposePlace(tile, tile);
    }
    const cmd = commandFor(tool, tile, tile);
    if (cmd) await command(cmd);
  }

  /**
   * Lo que cuesta un trazo, en palabras. Zonas: solo las casillas que cambian
   * (lo mismo que cobra el motor; las ocupadas se saltan y se dice cuántas).
   * Carretera: las casillas nuevas, con los puentes aparte.
   */
  function lineText(a: { x: number; y: number }, b: { x: number; y: number }): string {
    const cmd = commandFor(tool, a, b);
    if (!cmd) return '';
    if (cmd.type === 'Zone') {
      const { changed, skipped } = zoneChanges(state, cmd);
      if (cmd.zone === 'none') return `${plural(changed, 'casilla', 'casillas')}, gratis`;
      return `${plural(changed, 'casilla', 'casillas')}, ${money(changed * ZONE_COST_PER_TILE)}${skipped ? ` (no se cobran ${skipped} ocupadas o ya marcadas; los árboles sí, se talan al construir)` : ''}`;
    }
    const n = tilesOf(cmd).filter((t) => state.map.tiles[t.y * state.map.w + t.x] !== Tile.Road && !state.buildings.some((q) => q.x === t.x && q.y === t.y)).length;
    const bridges = bridgeTiles(a, b);
    return `${plural(n, 'casilla nueva', 'casillas nuevas')}, ${money(lineCost(a, b))}${bridges ? ` (con puente de ${plural(bridges, 'casilla', 'casillas')})` : ''}`;
  }

  /** Coste de un tramo de carretera (los puentes, más caros) y cuántas casillas son puente (v1.7). */
  const lineCost = (a: { x: number; y: number }, b: { x: number; y: number }) => roadCost(state, a.x, a.y, b.x, b.y);
  function bridgeTiles(a: { x: number; y: number }, b: { x: number; y: number }) {
    const cmd = commandFor(tool, a, b);
    return cmd ? tilesOf(cmd).filter((t) => terrainAt(state, t.x, t.y) === Terrain.River && state.map.tiles[t.y * state.map.w + t.x] !== Tile.Road).length : 0;
  }

  /** Enseña la obra (fantasma) y la barra «Construir / ✕». Nada se gasta hasta confirmar. */
  function proposePlace(a: { x: number; y: number }, b: { x: number; y: number }, demolishText?: string) {
    const cmd = commandFor(tool, a, b);
    if (!cmd) return;
    if (isSheetOpen()) closeSheet();
    pendingPlace = { a, b };
    anchor = null;
    pendingEnd = null;
    preview = previewFor(a, b);
    const v = validateCommand(state, cmd);
    const hill = tool.build && tool.shape === 'tap' && terrainAt(state, a.x, a.y) === Terrain.Hill;
    const cost = tool.build && tool.shape === 'tap' ? `${shortCost(tool)}${hill ? ' (colina: materiales +50 %)' : ''}` : lineText(a, b);
    // Ronda 13: el precio va en su propia línea y siempre se ve (también si no se puede: «no hay dinero»).
    const what = demolishText && v.ok ? demolishText : v.ok ? `${tool.label} aquí` : `${tool.label}: no se puede (${v.error})`;
    $('#confirm-text').replaceChildren(h('span', { class: 'cc-what' }, what), demolishText || !cost ? '' : h('span', { class: 'cc-cost' }, v.ok ? cost : `Cuesta ${cost}`));
    const yes = $('#confirm-yes') as HTMLButtonElement;
    yes.textContent = demolishText ? 'Derribar' : tool.zone ? (tool.zone === 'none' ? 'Quitar zona' : 'Marcar zona') : 'Construir';
    yes.className = demolishText ? 'btn danger' : 'btn primary';
    yes.disabled = !v.ok;
    // Si no se puede, no se ofrece «Construir»: solo el motivo y ✕ (ronda 11).
    yes.hidden = !v.ok;
    showBar(true);
    $('#confirm-bar').classList.toggle('danger', !!demolishText);
    document.body.classList.add('placing');
  }

  /** Tras confirmar, unos instantes sin toques en el mapa: los toques repetidos no proponen otra obra. */
  let quietUntil = 0;
  async function confirmPlace() {
    const p = pendingPlace;
    quietUntil = performance.now() + 500;
    vibrate(15);
    cancelPlace();
    if (!p) return;
    const cmd = commandFor(tool, p.a, p.b);
    if (cmd) await command(cmd);
    // Tras una carretera o zona, la franja vuelve a la ayuda de la herramienta (no a «toca dónde termina»).
    if (tool.shape !== 'tap') selectTool(tool.id);
  }

  function cancelAnchor() {
    anchor = null;
    pendingEnd = null;
    preview = null;
    selectTool(tool.id);
  }

  function cancelPlace() {
    pendingPlace = null;
    preview = null;
    showBar(false);
  }
  // Además, la barra no acepta toques en sus primeros 350 ms (por si algún clic llega tarde).
  let barShownAt = 0;
  const barReady = () => performance.now() - barShownAt > 350;
  $('#confirm-yes').onclick = () => barReady() && void confirmPlace();
  $('#confirm-no').onclick = () => {
    if (!barReady()) return;
    if (anchor) cancelAnchor();
    else cancelPlace();
  };

  /** Qué hay en una casilla (para el lector de pantalla). */
  function describeTile(t: { x: number; y: number }): string {
    const b = state.buildings.find((x) => x.x === t.x && x.y === t.y);
    const i = t.y * state.map.w + t.x;
    const ter = state.map.terrain?.[i] ?? 0;
    const road = state.map.tiles[i] === Tile.Road;
    const what = b
      ? (b.name ?? BUILD_NAMES[b.kind] ?? b.kind)
      : road
        ? ter === Terrain.River ? 'puente' : 'carretera'
        : ter === Terrain.River ? 'río' : ter === Terrain.Sea ? 'mar' : state.map.tiles[i] === Tile.Tree ? 'árboles' : ter === Terrain.Hill ? 'colina' : 'solar libre';
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
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
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
    // Atajos de una tecla (letras y signos): se pueden quitar en Ajustes (WCAG 2.1.4) y nunca con Ctrl/Alt/Cmd.
    if (k.length === 1 && k !== ' ' && (!prefs().shortcuts || e.ctrlKey || e.metaKey || e.altKey)) return;
    if (k === 'ArrowLeft' || k === 'a') cam.x -= step;
    else if (k === 'ArrowRight' || k === 'd') cam.x += step;
    else if (k === 'ArrowUp' || k === 'w') cam.y -= step;
    else if (k === 'ArrowDown' || k === 's') cam.y += step;
    else if (k === '+' || k === '=') setZoom(cam.zoom + 1);
    else if (k === '-') setZoom(cam.zoom - 1);
    else if (k === 'l') setLayer(LAYERS[(LAYERS.findIndex((l) => l.id === layer) + 1) % LAYERS.length]!.id);
    // Atajo de Ajustes: solo la tecla sola (Ctrl+O abre archivos en el navegador), con o sin mayúsculas.
    else if (k.toLowerCase() === 'o') openSettings();
    else if (k === ' ' && target.tagName !== 'BUTTON') {
      e.preventDefault();
      userSpeed(speed === 0 ? lastSpeed : 0);
    } else if (k === 'Escape') {
      if (!tray.hidden) closeTray();
      else if (isSheetOpen()) closeSheet();
      else if (pendingPlace) cancelPlace();
      else if (anchor && touchInput) cancelAnchor();
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

  /* ---------- herramientas (v1.6: cinco pestañas y la bandeja «Construir») ---------- */
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
      wrap.append(pixelIcon(tl.id === 'dezone' ? 'demolish' : tl.id));
    }
    return wrap;
  }

  const bar = $('#tools');
  const tray = $('#tray');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const tab = (id: string, icon: string, label: string, cls = '') => {
    const b = h('button', { class: `tab ${cls}`, id: `tab-${id}`, 'aria-label': label }, pixelIcon(icon), h('span', { class: 'tab-label', 'aria-hidden': 'true' }, label));
    return b;
  };
  const tabInspect = tab('inspect', 'inspect', 'Mirar');
  tabInspect.dataset.tool = 'inspect';
  const tabRoad = tab('road', 'road', 'Carretera');
  tabRoad.dataset.tool = 'road';
  const tabBuild = tab('build', 'build', 'Construir');
  tabBuild.setAttribute('aria-expanded', 'false');
  tabBuild.setAttribute('aria-controls', 'tray');
  const tabDemolish = tab('demolish', 'demolish', 'Derribar', 'danger');
  tabDemolish.dataset.tool = 'demolish';
  bar.replaceChildren(tabInspect, tabRoad, tabBuild, tabDemolish);
  tabInspect.onclick = () => selectTool('inspect');
  tabRoad.onclick = () => selectTool('road');
  tabDemolish.onclick = () => selectTool('demolish');
  tabBuild.onclick = () => (tray.hidden ? openTray() : closeTray());
  $('#menu').replaceChildren(pixelIcon('town'), h('span', { class: 'tab-label', 'aria-hidden': 'true' }, 'Pueblo'));
  $('#menu').classList.add('tab');

  // La bandeja: por categorías, con precio y lo que falta para lo bloqueado.
  const trayMsg = h('p', { class: 'tray-msg muted small', 'aria-live': 'polite' }, 'Elige qué construir. Los precios incluyen la obra.');
  tray.replaceChildren(trayMsg);
  for (const cat of TRAY) {
    const grid = h('div', { class: 'tray-grid' });
    for (const id of cat.tools) {
      const tl = TOOLS.find((x) => x.id === id)!;
      const btn = h(
        'button',
        { class: 'tool', 'data-tool': tl.id, 'aria-pressed': 'false', title: `${tl.label} (${tl.key})` },
        toolIcon(tl),
        h('span', { class: 'tool-label' }, tl.label),
        h('span', { class: 'tool-cost' }, trayCost(tl)),
      );
      btn.addEventListener('click', () => {
        if (isLocked(tl, state)) {
          // Ronda 12: tocar algo bloqueado no hacía nada; ahora explica qué falta.
          trayMsg.textContent = lockLong(tl, state);
          trayMsg.classList.remove('muted');
          sfx.error();
          vibrate(30);
          return;
        }
        selectTool(tl.id);
      });
      grid.append(btn);
    }
    tray.append(h('h3', {}, cat.title), grid);
  }

  function openTray() {
    if (isSheetOpen()) closeSheet();
    trayMsg.textContent = 'Elige qué construir. Los precios incluyen la obra.';
    trayMsg.classList.add('muted');
    updateToolLocks();
    tray.hidden = false;
    tabBuild.setAttribute('aria-expanded', 'true');
    document.body.classList.add('tray-open');
    tutorial.update(state, tool.id);
    (tray.querySelector<HTMLElement>('[aria-pressed="true"]') ?? tray.querySelector<HTMLElement>('.tool:not(.locked)'))?.focus();
  }
  function closeTray() {
    if (tray.hidden) return;
    tray.hidden = true;
    tabBuild.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('tray-open');
    tutorial.update(state, tool.id);
  }

  /** La franja de abajo: fecha y demanda, la ayuda de la herramienta o la barra de confirmar. */
  function refreshStrip() {
    const strip = $('#strip');
    strip.dataset.mode = !$('#confirm-bar').hidden ? 'confirm' : $('#tool-info').textContent ? 'tool' : 'info';
  }
  function showBar(on: boolean) {
    if (on && $('#confirm-bar').hidden) barShownAt = performance.now();
    $('#confirm-bar').hidden = !on;
    if (!on) {
      $('#confirm-bar').classList.remove('danger');
      document.body.classList.remove('placing');
    }
    refreshStrip();
  }
  function toolHelp(tl: Tool): string {
    if (tl.id === 'road') return coarse ? 'toca el inicio y luego el final (o arrastra desde el inicio).' : 'arrastra en línea recta. Por debajo van el agua y la luz.';
    if (tl.zone && tl.zone !== 'none') return coarse ? `${tl.help} Toca una esquina y luego la otra.` : tl.help;
    if (tl.id === 'demolish') return 'toca lo que quieras derribar. Te pedirá confirmación.';
    return tl.help;
  }

  function selectTool(id: ToolId) {
    const tl = TOOLS.find((x) => x.id === id)!;
    tool = tl;
    const inTray = TRAY.some((c) => c.tools.includes(id));
    for (const b of [tabInspect, tabRoad, tabDemolish]) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    tabBuild.setAttribute('aria-pressed', String(inTray));
    for (const b of tray.querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.getAttribute('data-tool') === id));
    // La pestaña «Construir» enseña lo elegido: se ve qué hay en la mano.
    if (inTray) tabBuild.replaceChildren(h('span', { class: 'tab-sprite' }, toolIcon(tl)), h('span', { class: 'tab-label', 'aria-hidden': 'true' }, tl.label));
    else tabBuild.replaceChildren(pixelIcon('build'), h('span', { class: 'tab-label', 'aria-hidden': 'true' }, 'Construir'));
    tabBuild.setAttribute('aria-label', inTray ? `Construir: ${tl.label} elegido. Cambiar` : 'Construir');
    const info = $('#tool-info');
    const locked = isLocked(tl, state);
    // Con «Mirar», la franja enseña la fecha y la demanda.
    if (locked) info.textContent = lockLong(tl, state);
    else if (tl.id === 'inspect') info.textContent = '';
    else {
      const cost = trayCost(tl) || costText(tl);
      info.replaceChildren(h('b', {}, tl.label), cost ? ` · ${cost} · ` : ': ', toolHelp(tl));
    }
    selected = null;
    anchor = null;
    pendingEnd = null;
    if (pendingPlace) cancelPlace();
    showBar(false);
    closeTray();
    // Ronda 12: una hoja abierta tapaba la barra de confirmar (no se podía ni confirmar ni cancelar).
    if (isSheetOpen() && id !== 'inspect') closeSheet();
    tutorial.update(state, tool.id);
  }

  /* ---------- inspección ---------- */
  let openInspect: (() => void) | null = null;
  let inspectSheet: HTMLElement | null = null;

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
    revealTile(tile);
  }

  /** Nivel del servicio, lo que da y qué pide subirlo (con «Mejorar»). */
  function levelBox(b: Building): HTMLElement {
    const lv = levelOf(b);
    const served = serviceCounts(state).get(b.id);
    const box = h('section', { class: 'level-box' }, h('h3', {}, pixelIcon('upgrade'), ` Nivel ${lv} de ${SERVICE_LEVELS.maxLevel}`));
    const gives: string[] = [];
    if (radiusOf(b)) gives.push(`llega a ${radiusOf(b)} casillas`);
    if (serviceCapacityOf(b)) gives.push(`atiende a ${serviceCapacityOf(b)} vecinos${served !== undefined ? ` (ahora ${served})` : ''}`);
    if (plantCapacityOf(b)) gives.push(`da ${b.kind === 'water' ? 'agua' : 'luz'} a ${plantCapacityOf(b)} edificios`);
    if (b.kind === 'police') gives.push(`${cellsOf(b)} calabozos`);
    if (b.kind === 'jail') gives.push(`${jailPlacesOf(b)} plazas`);
    if (gives.length) box.append(h('p', { class: 'muted small' }, `Ahora ${gives.join(', ')}.`));
    if (b.upgradeUntil !== undefined) {
      box.append(h('p', {}, `Mejorando a nivel ${lv + 1}: termina el ${formatDate(tickToDate(b.upgradeUntil))}. Sigue abierto mientras tanto.`));
      return box;
    }
    if (lv >= SERVICE_LEVELS.maxLevel) {
      box.append(h('p', { class: 'muted small' }, 'Está en su nivel más alto.'));
      return box;
    }
    const reqs = upgradeReqs(state, b, served);
    box.append(
      h('p', {}, `Para el nivel ${lv + 1} (más alcance y más capacidad; cuesta más mantenerlo):`),
      h('ul', { class: 'reqs' }, ...reqs.map((r) => h('li', { class: r.ok ? 'ok' : 'no' }, h('span', { 'aria-hidden': 'true' }, r.ok ? '✓ ' : '✗ '), r.label, h('span', { class: 'visually-hidden' }, r.ok ? ' (cumplido)' : ' (falta)')))),
    );
    const ok = canUpgradeBuilding(state, b, served).ok;
    const btn = h('button', { class: 'btn primary wide' }, `Mejorar · ${money(upgradeCost(b))}`) as HTMLButtonElement;
    btn.disabled = !ok;
    btn.addEventListener('click', () => void command({ type: 'UpgradeBuilding', buildingId: b.id }));
    box.append(btn);
    return box;
  }

  /** Que la casilla quede a la vista, por encima (o al lado) de la hoja abierta (v1.6). */
  function revealTile(t: { x: number; y: number }) {
    const el = currentSheet();
    if (!el) return;
    const r = canvas.getBoundingClientRect();
    const sr = el.getBoundingClientRect();
    const { left, top } = r;
    let { right, bottom } = r;
    if (sr.left <= r.left + 8) bottom = Math.min(bottom, sr.top);
    else right = Math.min(right, sr.left);
    if (bottom - top < 40 || right - left < 40) return;
    const [sx, sy] = screenOf(t.x, t.y);
    // Si queda cerca del borde (o debajo de la hoja), se centra en lo que queda a la vista.
    const mx = Math.max(2 * tileSize() / dpr(), (right - left) * 0.15);
    const my = Math.max(2 * tileSize() / dpr(), (bottom - top) * 0.15);
    if (sx > left + mx && sx < right - mx && sy > top + my && sy < bottom - my) return;
    cam.x = Math.round((t.x + 0.5) * tileSize() - ((left + right) / 2 - r.left) * dpr());
    cam.y = Math.round((t.y + 0.5) * tileSize() - ((top + bottom) / 2 - r.top) * dpr());
    clampCam();
  }

  function renderInspect(tile: { x: number; y: number }, b: Building | undefined) {
    const prevScroll = document.querySelector('.sheet-body')?.scrollTop ?? 0;
    if (!b) {
      const z = state.map.zones[tile.y * state.map.w + tile.x];
      const tt = state.map.tiles[tile.y * state.map.w + tile.x];
      const ter = state.map.terrain?.[tile.y * state.map.w + tile.x] ?? 0;
      const name =
        tt === Tile.Road
          ? ter === Terrain.River ? 'Puente' : 'Carretera'
          : ter === Terrain.River ? 'Río' : ter === Terrain.Sea ? 'Mar' : tt === Tile.Tree ? 'Árboles' : ter === Terrain.Hill ? 'Colina' : 'Solar';
      const zone = z ? `Zona ${['', 'residencial (R)', 'comercial (C)', 'industrial (I)'][z]}` : 'Sin zona';
      sheet(name, h('p', {}, zone), h('p', { class: 'muted' }, `Casilla ${tile.x}, ${tile.y}`)).classList.add('half');
      openInspect = null;
      inspectSheet = null;
      return;
    }
    // v1.8: el ayuntamiento abre el panel de gestión a pantalla completa.
    if (b.kind === 'townhall' && b.built) {
      openManagement(social, {
        townHall: () => withBack('Gestión', () => focusBuilding(b.id), () => openTownHall(social)),
        politics: () => withBack('Gestión', () => focusBuilding(b.id), () => openPolitics(social)),
        accounts: () => withBack('Gestión', () => focusBuilding(b.id), openAccounts),
        focus: (x, y) => {
          closeSheet();
          centerOn(x, y);
          inspect({ x, y });
        },
      });
      inspectSheet = currentSheet();
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
      // v1.8: destrozado en unos disturbios: no funciona hasta que se repara.
      if (b.damaged) {
        const dmg = b.damaged;
        const box = h('div', { class: 'petition danger-box' }, h('p', {}, h('strong', {}, 'Destrozada en unos disturbios. '), 'No vende hasta repararla, pero sigue pagando sueldos e impuestos con sus ahorros: si dos meses seguidos no llega a las nóminas, cierra.'));
        if (dmg.repairUntil >= 0) box.append(h('p', { class: 'muted small' }, `En reparación: reabre el ${formatDate(tickToDate(dmg.repairUntil))}.`));
        else {
          const fix = h('button', { class: 'btn primary wide' }, `Reparar · ${money(dmg.cost)}`);
          fix.addEventListener('click', () => void command({ type: 'RepairBuilding', buildingId: b.id }));
          box.append(fix);
        }
        content.push(box);
      }
      const home = b.kind === 'house' || b.kind === 'res';
      if (home) content.push(servicesTable(b));
      else {
        const pills: HTMLElement[] = [];
        if (b.kind !== 'water' && b.kind !== 'power') {
          pills.push(h('span', { class: `pill ${b.hasWater ? 'good' : 'bad'}` }, b.hasWater ? 'Agua ✓' : `SIN AGUA${b.dryDays ? ` (${plural(b.dryDays, 'día', 'días')})` : ''}`));
          pills.push(h('span', { class: `pill ${b.hasPower ? 'good' : 'bad'}` }, b.hasPower ? 'Luz ✓' : `SIN LUZ${b.darkDays ? ` (${plural(b.darkDays, 'día', 'días')})` : ''}`));
        }
        if (b.kind === 'shop' || b.kind === 'factory') pills.push(h('span', { class: 'pill' }, money(unitValue(state, b))));
        if (pills.length) content.push(h('div', { class: 'status-row' }, ...pills));
      }
      // v1.8: comisaría (calabozos) y cárcel (presos).
      if (b.kind === 'police') {
        const used = cellsUsed(state, b.id);
        content.push(h('p', {}, `Calabozos: ${used} de ${cellsOf(b)} ocupados.`));
        if (used >= cellsOf(b)) content.push(h('p', { class: 'pol-tag' }, jailCapacity(state) ? 'Llenos: esperan sitio en la cárcel.' : 'Llenos: hace falta una cárcel para poder detener a más.'));
      }
      if (b.kind === 'jail') content.push(h('p', {}, `Presos: ${state.justice?.jail.length ?? 0} de ${jailCapacity(state)} plazas.`));
      // v1.8 (petición del creador): los servicios suben de nivel.
      if (UPGRADABLE.includes(b.kind)) content.push(levelBox(b));
      const res = occupants(state, b);
      const workers = state.citizens.filter((c) => c.jobId === b.id);
      if (home && res.length) {
        // Resumen de quien vive aquí antes de la lista.
        const avg = Math.round(res.reduce((t, c) => t + c.happiness, 0) / res.length);
        const inTown = res.filter((c) => c.jobId !== null).length;
        content.push(
          h('h3', {}, 'Viven aquí'),
          h('p', { class: 'muted small' }, `${plural(res.length, 'vecino', 'vecinos')} · felicidad media ${avg} · ${inTown} trabajan en el pueblo, ${res.length - inTown} fuera`),
          citizenList(res),
        );
      } else if (res.length) content.push(h('h3', {}, 'Viven aquí'), citizenList(res));
      if (workers.length) content.push(h('h3', {}, 'Trabajan aquí'), citizenList(workers));
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
    inspectSheet = sheet(b.name ?? BUILD_NAMES[b.kind] ?? b.kind, ...content);
    inspectSheet.classList.add('half');
    const body = document.querySelector('.sheet-body');
    if (body) body.scrollTop = prevScroll;
  }

  /**
   * v1.8: tabla de servicios de una vivienda (petición del creador): agua y
   * luz (con los días que lleva sin ellas), seguridad, colegio, salud, ocio y
   * tienda, cada uno con su estado. Valor de la vivienda al pie.
   */
  function servicesTable(b: Building): HTMLElement {
    const needs = new Map(missingServices(state, b.x, b.y).map((n) => [n.key, n.status] as const));
    const row = (icon: string, label: string, ok: boolean | 'warn', text: string) =>
      h('div', { class: `svc ${ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'bad'}` }, pixelIcon(icon), h('span', { class: 'svc-label' }, label), h('span', { class: 'svc-state' }, text));
    const svc = (key: NeedKey, icon: string, label: string) => {
      const st = needs.get(key);
      return row(icon, label, st === undefined ? true : st === 'lleno' ? 'warn' : false, st === undefined ? 'Cubierto' : st === 'lleno' ? 'Lleno' : 'No llega');
    };
    const i = b.y * state.map.w + b.x;
    const crime = state.fields.crime[i] ?? 0;
    const police = stationsFor(state, b.x, b.y).length > 0;
    const pop = state.citizens.length;
    const rows = [
      row('drop', 'Agua', b.hasWater, b.hasWater ? 'Sí' : b.dryDays ? `Sin agua desde hace ${plural(b.dryDays, 'día', 'días')}` : 'Sin agua'),
      row('bolt', 'Luz', b.hasPower, b.hasPower ? 'Sí' : b.darkDays ? `Sin luz desde hace ${plural(b.darkDays, 'día', 'días')}` : 'Sin luz'),
      row('police', 'Seguridad', crime < 20 ? true : crime < 40 ? 'warn' : false, `${crime < 20 ? 'Tranquilo' : crime < 40 ? 'Algo de delincuencia' : 'Inseguro'}${police ? ' · comisaría cerca' : pop >= 20 ? ' · sin comisaría cerca' : ''}`),
      ...(pop >= 25 ? [svc('colegio', 'school', 'Colegio'), svc('salud', 'health', 'Salud')] : []),
      ...(pop >= 10 ? [svc('ocio', 'leaf', 'Parque o plaza')] : []),
      row('bar', 'Tienda', state.buildings.some((s) => s.kind === 'shop' && s.built && !s.damaged && Math.abs(s.x - b.x) + Math.abs(s.y - b.y) <= 6), state.buildings.some((s) => s.kind === 'shop' && s.built && !s.damaged && Math.abs(s.x - b.x) + Math.abs(s.y - b.y) <= 6) ? 'Cerca' : 'Lejos'),
    ];
    return h('div', { class: 'svc-table' }, ...rows, h('p', { class: 'muted small' }, `Valor: ${money(unitValue(state, b))} por vivienda`));
  }

  /** Vecinos de un edificio: una fila por persona con retrato y lo esencial (v1.6). */
  function citizenList(all: GameState['citizens']) {
    const ul = h('ul', { class: 'people' });
    const list = all.filter((c) => c.named);
    const others = all.length - list.length;
    for (const c of list) {
      const worry = happinessFactors(state, c).filter((f) => f.value < 0).sort((x, y) => x.value - y.value)[0];
      const moodText = c.happiness >= 65 ? 'contento' : c.happiness >= 40 ? 'regular' : 'descontento';
      const last = [...state.decisionLog].reverse().find((d) => d.citizenId === c.id);
      const btn = h(
        'button',
        { class: 'person-row', 'aria-label': `Ficha de ${c.name}, ${c.age} años, ${moodText}` },
        portraitCanvas(c.id, 2, 'mini-portrait'),
        h(
          'span',
          {},
          h('span', { class: 'p-name' }, c.name),
          h('span', { class: 'p-sub' }, `${c.age} años · ${c.owns ? 'propietario' : 'quiere ' + DESIRE_TEXT[c.desire]}${worry ? ` · le preocupa ${worry.label.toLowerCase()}` : ''}`),
          last ? h('em', { class: 'p-sub quote' }, `«${last.motivo}»`) : '',
        ),
        h('span', { class: `p-mood ${c.happiness >= 65 ? 'good' : c.happiness < 40 ? 'bad' : ''}`, 'aria-hidden': 'true' }, String(Math.round(c.happiness))),
      );
      btn.addEventListener('click', () => withBack(currentSheetTitle(), () => openInspect?.(), () => openCitizen(social, c.id)));
      ul.append(h('li', { class: 'person-click' }, btn));
    }
    if (others > 0) {
      const avg = Math.round(all.filter((c) => !c.named).reduce((a, c) => a + c.happiness, 0) / others);
      ul.append(h('li', { class: 'muted' }, `${list.length ? 'Y ' : ''}${others} ${others === 1 ? 'vecino' : 'vecinos'} más (felicidad media ${avg})`));
    }
    return ul;
  }
  const currentSheetTitle = () => currentSheet()?.querySelector('#sheet-title')?.textContent ?? 'la ficha';

  /* ---------- menú, impuestos y cuentas ---------- */
  const social: SocialCtx = { token, state: () => state, command };
  const openTaxes = () => openTaxesSheet(() => state, command);
  const openAccounts = () => openReport(state);

  /**
   * v1.6: el panel «Pueblo» sustituye al menú plano. Cada sección resume cómo va
   * y lleva a sus hojas, que tienen «‹» para volver aquí.
   */
  function openHub() {
    closeTray();
    const go = (fn: () => void) => () => withBack('Pueblo', openHub, fn);
    const item = (label: string, fn: () => void, attn = false) => {
      const b = h('button', { class: `btn${attn ? ' attn' : ''}` }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const card = (icon: string, title: string, sum: (Node | string)[], ...buttons: Node[]) =>
      h('section', { class: 'hub-card' }, h('h3', {}, pixelIcon(icon), title), h('p', { class: 'hub-sum' }, ...sum), buttons.length ? h('div', { class: 'hub-grid' }, ...buttons) : '');
    const last = state.stats.at(-1);
    const net = last ? last.income - last.expenses : null;
    const happy = state.citizens.length ? Math.round(state.citizens.reduce((a, c) => a + c.happiness, 0) / state.citizens.length) : 0;
    const d = tickToDate(state.tick);
    const budgetOpen = state.budget.status === 'open' && state.budget.year === d.year;
    const offers = state.grants.filter((g) => g.status === 'offered').length;
    const townSum: string[] = [budgetOpen ? `Presupuesto ${d.year} por aprobar` : `Presupuesto ${state.budget.plan}`];
    if (offers) townSum.push(plural(offers, 'subvención por responder', 'subvenciones por responder'));
    const assocs = state.associations ?? [];
    const protest = assocs.some((a) => a.protestDay >= 0);
    if (assocs.length) townSum.push(protest ? 'manifestación convocada' : plural(assocs.length, 'asociación vecinal', 'asociaciones vecinales'));
    sheet(
      'Pueblo',
      card(
        'coin',
        'Dinero',
        ['Caja: ', h('strong', {}, money(state.treasury)), net !== null ? ` · último mes: ${net >= 0 ? '+' : ''}${money(net)}` : ''],
        item('Parte mensual', go(openAccounts)),
        item('Impuestos', go(openTaxes)),
      ),
      card(
        'build',
        'Ayuntamiento',
        [townSum.join(' · ')],
        item('Presupuesto y fiestas', go(() => openTownHall(social)), budgetOpen || offers > 0 || protest),
        item('Pleno municipal', go(() => openPleno(social))),
        item('Política y elecciones', go(() => openPolitics(social))),
        item('Consejero', go(() => openAdvisor(social))),
      ),
      card(
        'people',
        'Gente',
        [h('strong', {}, plural(state.citizens.length, 'vecino', 'vecinos')), ` · felicidad ${happy}`],
        item('Vecinos', go(openPeople)),
        item('Felicidad', go(openHappiness)),
        item('Diario del pueblo', go(() => openDiary(social))),
        item('Álbum del pueblo', go(() => openAlbum(social))),
      ),
      h('section', { class: 'hub-card' }, h('h3', {}, pixelIcon('smile'), 'Objetivos'), objectivesNode(state)),
      ...(state.aiMode
        ? [card('inspect', 'IA', ['Los vecinos con nombre deciden con la IA.'], item('Gasto de la IA', () => void openUsage(token)), item('Qué se envía a la IA', () => void openPreview(token)))]
        : []),
      h(
        'div',
        { class: 'menu-foot' },
        item('Ajustes', go(openSettings)),
        item('Repetir tutorial', () => {
          closeSheet();
          tutorial.start(state, true);
        }),
        item('Volver al inicio', () => {
          closeSheet();
          exit();
        }),
      ),
    );
  }
  // La pestaña «Pueblo» se marca mientras su panel (o una hoja abierta desde él) está a la vista.
  onSheetChange((title) => $('#menu').setAttribute('aria-expanded', String(title === 'Pueblo')));
  $('#menu').setAttribute('aria-expanded', 'false');
  const openPeople = () => openNeighbours(state, (c) => withBack('Vecinos', () => withBack('Pueblo', openHub, openPeople), () => openCitizen(social, c.id)));

  /** Por qué el pueblo está contento o no: causas medias y los vecinos más tristes (v1.6). */
  function openHappiness() {
    const people = state.citizens;
    const sums = new Map<string, number>();
    for (const c of people) for (const f of happinessFactors(state, c)) sums.set(f.label, (sums.get(f.label) ?? 0) + f.value);
    const rows = [...sums.entries()].map(([label, v]) => ({ label, v: v / Math.max(1, people.length) })).filter((r) => Math.abs(r.v) >= 0.5).sort((a, b) => a.v - b.v);
    const happy = people.length ? Math.round(people.reduce((a, c) => a + c.happiness, 0) / people.length) : 0;
    const sad = people.filter((c) => c.named).sort((a, b) => a.happiness - b.happiness).slice(0, 5);
    const list = h('ul', { class: 'accounts' }, ...rows.map((r) => h('li', { class: r.v < 0 ? 'neg' : 'pos' }, h('span', {}, r.label), h('span', {}, `${r.v > 0 ? '+' : ''}${Math.round(r.v)}`))));
    const sadList = h('ul', { class: 'people' });
    for (const c of sad) {
      const worry = happinessFactors(state, c).filter((f) => f.value < 0).sort((x, y) => x.value - y.value)[0];
      const btn = h('button', { class: 'person-row' }, portraitCanvas(c.id, 2, 'mini-portrait'), h('span', {}, h('span', { class: 'p-name' }, c.name), h('span', { class: 'p-sub' }, worry ? `le preocupa ${worry.label.toLowerCase()}` : 'sin quejas concretas')), h('span', { class: `p-mood ${c.happiness < 40 ? 'bad' : ''}` }, String(Math.round(c.happiness))));
      btn.addEventListener('click', () => withBack('Felicidad', () => withBack('Pueblo', openHub, openHappiness), () => openCitizen(social, c.id)));
      sadList.append(h('li', {}, btn));
    }
    sheet(
      'Felicidad',
      h('p', {}, `Felicidad media: `, h('strong', {}, `${happy} de 100`), happy < 45 ? '. Si baja mucho, la gente se va.' : '.'),
      h('h3', {}, 'Qué suma y qué resta (media)'),
      rows.length ? list : h('p', { class: 'muted' }, 'Aún no hay vecinos.'),
      sad.length ? h('h3', {}, 'Los menos contentos') : '',
      sad.length ? sadList : '',
    );
  }

  /** La campana: todos los avisos recientes; los que llevan a algo, se tocan (v1.6). */
  function openLog() {
    markLogRead();
    const items = toastLog();
    const icon = { info: 'ℹ', warn: '⚠', good: '✔' };
    const ul = h('ul', { class: 'log' });
    for (const e of items) {
      const btn = h('button', { class: 'log-item', ...(e.onClick ? { 'data-go': '1' } : {}) }, h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon[e.kind]), h('span', {}, e.text, ' ', h('span', { class: 'when' }, e.when)));
      if (e.onClick) btn.addEventListener('click', () => withBack('Avisos', openLog, e.onClick!));
      else btn.setAttribute('tabindex', '-1');
      ul.append(h('li', { class: e.kind }, btn));
    }
    sheet('Avisos', items.length ? ul : h('p', { class: 'muted' }, 'Sin avisos todavía.'));
  }
  const bellBadge = document.querySelector<HTMLElement>('#bell .bell-n')!;
  $('#bell').prepend(pixelIcon('bell'));
  onToastLog(
    (n) => {
      bellBadge.hidden = n === 0;
      bellBadge.textContent = n > 9 ? '9+' : String(n);
      $('#bell').setAttribute('aria-label', n ? `Avisos: ${n} sin mirar` : 'Avisos');
    },
    openLog,
    () => shortDate(tickToDate(state.tick)),
  );

  /** Capas: el chip dice cuál está puesta; al tocarlo se elige de una lista (antes, se cambiaba a ciegas). */
  function setLayer(id: LayerId) {
    layer = id;
    const def = LAYERS.find((l) => l.id === layer)!;
    const legend = $('#legend');
    legend.hidden = layer === 'none';
    if (layer === 'missing') missingLegend();
    else legend.replaceChildren(h('strong', {}, def.label), ...def.legend.map((x) => h('span', { class: `legend-item ${x.cls}` }, x.text)));
    const chip = $('#layers');
    chip.querySelector('.chip-text')!.textContent = layer === 'none' ? 'Capas' : def.label;
    chip.setAttribute('aria-label', `Capas de datos: ${def.label}. Cambiar`);
    chip.setAttribute('aria-pressed', String(layer !== 'none'));
    $('#sr-live').textContent = layer === 'none' ? 'Capas desactivadas' : `Capa activa: ${def.label}`;
  }
  /** Leyenda de «Qué falta»: cuántas viviendas (y solares R) carecen de cada servicio. */
  let legendDay = -1;
  let legendFolded = false;
  function missingLegend() {
    legendDay = Math.floor(state.tick / 24);
    // Ronda 13: ordenada por lo que más falta, con «Construir» al lado; plegable para ver el mapa.
    const sum = coverageSummary(state).sort((a, b) => b.falta - a.falta || b.lleno - a.lleno);
    const TOOL_FOR: Record<string, ToolId> = { agua: 'water', luz: 'power', colegio: 'school', salud: 'clinic', policia: 'police', ocio: 'park' };
    const rows = sum.map((r) => {
      const name = `${NEED_LABEL[r.key][0]!.toUpperCase()}${NEED_LABEL[r.key].slice(1)}`;
      const count = r.falta ? `falta en ${plural(r.falta, 'casa', 'casas')}` : `lleno en ${plural(r.lleno, 'casa', 'casas')}`;
      const go = h('button', { class: 'legend-go', 'aria-label': `Construir: ${NEED_LABEL[r.key]}` }, 'Construir');
      go.addEventListener('click', () => selectTool(TOOL_FOR[r.key]!));
      return h('span', { class: 'legend-need' }, pixelIcon(NEED_ICON[r.key]), h('span', { class: 'legend-text' }, `${name}: ${count}`), go);
    });
    const head = h('button', { class: 'legend-head', 'aria-expanded': String(!legendFolded) }, h('strong', {}, 'Qué falta'), h('span', { 'aria-hidden': 'true' }, legendFolded ? ' ▸' : ' ▾'));
    head.addEventListener('click', () => {
      legendFolded = !legendFolded;
      missingLegend();
    });
    $('#legend').classList.toggle('folded', legendFolded);
    $('#legend').replaceChildren(
      head,
      ...(legendFolded ? [] : rows.length ? rows : [h('span', {}, 'A ninguna vivienda le falta nada.')]),
      ...(legendFolded ? [] : [h('span', { class: 'legend-note' }, 'Marco rojo: falta. Amarillo a trazos: llega, pero está lleno. Un icono por casa: lo que más falta.')]),
    );
  }
  function openLayers() {
    const list = h('div', { class: 'radio-list compact', role: 'radiogroup', 'aria-label': 'Capa' });
    for (const l of LAYERS) {
      const b = h('button', { class: 'btn choice', role: 'radio', 'aria-checked': String(l.id === layer) }, h('strong', {}, l.label));
      b.addEventListener('click', () => {
        setLayer(l.id);
        closeSheet();
      });
      list.append(b);
    }
    sheet('Capas de datos', h('p', { class: 'muted small' }, 'Colorean el mapa según un dato. La leyenda sale abajo a la izquierda.'), list).classList.add('half');
  }
  $('#layers').prepend(pixelIcon('layers'));

  /** Qué es R, C, I (o qué falta para las zonas): al tocar la franja. */
  function openDemand() {
    const unlocked = zonesUnlocked(state);
    const { R, C, I } = state.demand;
    const line = (k: string, name: string, v: number, hint: string) => h('li', {}, h('span', {}, h('strong', {}, `${k} · ${name}`), h('span', { class: 'p-sub' }, hint)), h('span', {}, v > 0 ? `+${v}` : String(v)));
    sheet(
      'Qué pide el pueblo',
      h('p', {}, `Hoy es ${formatDate(tickToDate(state.tick))}.`),
      unlocked
        ? h(
            'ul',
            { class: 'accounts' },
            line('R', 'viviendas', R, R > 20 ? 'Falta sitio para vivir: pinta zona R.' : 'Hay casas de sobra.'),
            line('C', 'tiendas', C, C > 20 ? 'Quieren comprar cerca: pinta zona C.' : 'Hay tiendas de sobra.'),
            line('I', 'empleo e industria', I, I > 20 ? 'Hay gente sin trabajo: pinta zona I (lejos de las casas).' : 'Hay empleo de sobra.'),
          )
        : h('p', {}, `Las zonas R (viviendas), C (tiendas) e I (industria) llegan con el ayuntamiento de nivel 2: pide ${TOWNHALL_LEVELS[1]!.pop} vecinos (ahora hay ${state.citizens.length}) y ${money(TOWNHALL_LEVELS[1]!.cost)}. Toca el ayuntamiento para ampliarlo.`),
      h('p', { class: 'muted small' }, 'Cuanto más alta la barra, más falta hace. Si está en negativo, sobra.'),
    ).classList.add('half');
  }

  /* ---------- velocidad y ciclo de vida ---------- */
  /**
   * v1.7.0: la velocidad que dejó el jugador se recuerda (por partida, en este
   * navegador). Solo cuentan sus decisiones (▶/❚❚, la velocidad, la barra
   * espaciadora), no las pausas automáticas al cambiar de pestaña o salir.
   */
  const speedKey = `bitopolis.speed.${token}`;
  function savedSpeed(): number {
    try {
      const v = Number(localStorage.getItem(speedKey) ?? '0');
      return [0, 1, 3, 10].includes(v) ? v : 0;
    } catch {
      return 0;
    }
  }
  function userSpeed(s: number) {
    setSpeed(s);
    try {
      localStorage.setItem(speedKey, String(speed));
    } catch {
      /* sin almacenamiento: empezará en pausa */
    }
  }

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
    if (s > 0) lastSpeed = s;
    send({ type: 'speed', speed: s });
    $('#sr-live').textContent = s === 0 ? 'Juego en pausa' : `Velocidad x${s}`;
    paintSpeed();
    calDay = -1;
    paintCalendar(tickToDate(state.tick));
  }
  /** ⏯ y el botón de velocidad (x1 → x3 → x10) del dock (v1.4). */
  let lastSpeed = 1;
  function paintSpeed() {
    const play = $('#play-pause');
    play.textContent = speed === 0 ? '▶' : '❚❚';
    // La etiqueta dice la acción; el estado va en data-paused (ronda 12: «pulsado» en pausa confundía).
    play.setAttribute('aria-label', speed === 0 ? `Poner en marcha a x${lastSpeed}` : 'Pausar');
    play.dataset.paused = String(speed === 0);
    const sp = $('#speed');
    sp.textContent = `x${lastSpeed}`;
    sp.dataset.speed = String(lastSpeed);
    sp.setAttribute('aria-label', `Velocidad x${lastSpeed}. Toca para cambiarla`);
  }

  const onVisibility = () => {
    if (document.hidden) {
      setSpeed(0);
      send({ type: 'flush' });
    } else if (speed === 0 && !lost && !isSheetOpen() && savedSpeed() > 0) {
      // Al volver a la pestaña, sigue como lo dejó el jugador.
      setSpeed(savedSpeed());
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

  // Atrás sin hojas abiertas: pausa y pregunta antes de salir de la partida (ronda 10).
  history.pushState({ ...(history.state ?? {}), game: true }, '');
  async function onBack(e: PopStateEvent) {
    if ((e.state as { game?: boolean } | null)?.game) return; // cerró una hoja: lo hace ui.ts
    const was = speed;
    setSpeed(0);
    if (await confirmDialog('¿Salir de la partida?', 'Se guarda sola. Puedes volver con tu enlace.', 'Salir')) exit();
    else {
      history.pushState({ game: true }, '');
      if (was) setSpeed(was);
    }
  }
  window.addEventListener('popstate', onBack);

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
        window.removeEventListener('popstate', onBack);
        void api.release(token, sessionId);
        $('#game').hidden = true;
        document.body.classList.remove('in-game', 'tray-open', 'sheet-open');
        onSheetChange(null);
        clearToastLog();
        opts.onExit();
      });
    }, 150);
  }

  $('#play-pause').onclick = () => userSpeed(speed === 0 ? lastSpeed : 0);
  $('#speed').onclick = () => {
    if (prefs().calm) return userSpeed(1);
    const next = ({ 1: 3, 3: 10, 10: 1 } as Record<number, number>)[lastSpeed] ?? 1;
    userSpeed(next);
  };
  paintSpeed();
  $('#layers').onclick = openLayers;
  $('#zoom-in').onclick = () => setZoom(cam.zoom + 1);
  $('#zoom-out').onclick = () => setZoom(cam.zoom - 1);
  $('#menu').onclick = () => (currentSheet()?.querySelector('#sheet-title')?.textContent === 'Pueblo' ? closeSheet() : openHub());
  $('#hud-money').onclick = () => withBack('Pueblo', openHub, openAccounts);
  $('#hud-pop').onclick = () => withBack('Pueblo', openHub, openPeople);
  $('#hud-happy').onclick = () => withBack('Pueblo', openHub, openHappiness);
  $('#bell').onclick = openLog;
  $('#strip-info').onclick = openDemand;
  $('#whatnow').onclick = () => {
    // v1.6: el consejo va en la franja de abajo (antes, un aviso más) y elige la herramienta.
    const hint = nextHint(state);
    if (hint.tool) selectTool(hint.tool);
    $('#tool-info').replaceChildren(h('b', {}, '¿Qué hago? '), hint.text);
    refreshStrip();
    $('#sr-live').textContent = hint.text;
  };

  /* Gancho para las pruebas de Playwright (solo lectura). */
  (window as unknown as { __bitopolis: unknown }).__bitopolis = {
    get state() {
      return state;
    },
    sprite: (kind: string, id: number) => buildingSprite(kind, id),
    /** Para las pruebas: centra la cámara en una casilla (no toca el estado). */
    centerOn(tx: number, ty: number) {
      centerOn(tx, ty);
    },
    tileCenter(tx: number, ty: number) {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((tx + 0.5) * tileSize() - cam.x) / dpr(), y: r.top + ((ty + 0.5) * tileSize() - cam.y) / dpr() };
    },
  };

  /* ---------- bucle de pintado ---------- */
  function frame(time: number) {
    if ($('#game').hidden) return;
    // La sacudida se aplica a una copia de la cámara: no cambia dónde mira el jugador.
    const [sx, sy] = shakeOffset(time);
    const view = sx || sy ? { ...cam, x: cam.x + sx * dpr(), y: cam.y + sy * dpr() } : cam;
    render(ctx, state, view, { preview, selected, cursor: document.activeElement === canvas ? cursor : null, time, reducedMotion: reducedMotion(), layer, highlight });
    placeBubbles();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  // El mapa cambia de alto sin que cambie la ventana (texto de ayuda, avisos, barras):
  // sin esto el dibujo quedaba estirado y el toque caía casillas más arriba (v1.4).
  const sizeWatch = new ResizeObserver(() => resize());
  sizeWatch.observe(canvas);
  resize();
  frameTown();
  selectTool('inspect');
  // Si lo dejó en marcha, sigue en marcha (con la misma velocidad).
  const resume = savedSpeed();
  if (resume > 0) lastSpeed = resume;
  setSpeed(resume);
  onState();
  refreshStrip();
  const away = resumeSummary(token, state);
  if (away && away.length) toast(`Desde tu última visita: ${away.join(' · ')}`, { sticky: true });
  tutorial.start(state);
  tutorial.update(state, tool.id);
  introGeography();
  if (!tutorial.active && resume === 0) toast(`En pausa. Pulsa ▶ (${matchMedia('(orientation: landscape) and (max-height: 500px)').matches ? 'arriba' : 'arriba a la izquierda'}) para que pase el tiempo.`);
  // Sonido: se desbloquea con el primer gesto; el ambiente sigue la hora del juego.
  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  startMusic(() => timeOfDay(state.tick) === 'night');
  startAmbience(() => timeOfDay(state.tick) === 'night');
  // Al activar el modo tranquilo con x3/x10 puestos, se baja a x1.
  const markCalm = () => {
    $('#speed').setAttribute('aria-disabled', String(prefs().calm));
  };
  markCalm();
  const offPrefs = onPrefs((p) => {
    if (p.calm && speed > 1) setSpeed(1);
    markCalm();
  });
  requestAnimationFrame(frame);
}
