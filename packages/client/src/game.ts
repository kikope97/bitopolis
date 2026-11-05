import { DAYS_PER_MONTH, TICKS_PER_DAY, tickToDate, type Command } from '@bitopolis/shared';
import {
  BUILD_NAMES,
  buildingAt,
  cancelRefund,
  isLandmarkKind,
  LANDMARKS,
  CROP_HINT,
  isWater,
  CROP_TEXT,
  cropAt,
  expectedHarvest,
  FARM,
  farmOutlook,
  HARVEST_NAME,
  harvestMonthOf,
  MONTH_NAMES,
  type Building,
  salePrice,
  unitValue,
  type GameEvent,
  type GameState,
  hashState,
  cellsUsed,
  coverageSummary,
  TRASH,
  trashActive,
  trashServed,
  trashStateOf,
  truckRouteOf,
  truckRoutes,
  CRIME,
  jailCapacity,
  canUpgradeBuilding,
  totalDebt,
  cellsOf,
  jailPlacesOf,
  levelOf,
  plantCapacityOf,
  radiusOf,
  maxLevelOf,
  serviceCapacityOf,
  serviceCounts,
  UPGRADABLE,
  upgradeCost,
  upgradeReqs,
  type NeedKey,
  stationsFor,
  CIVIL,
  FIRE,
  fireCovered,
  hasDike,
  isUnlocked,
  volunteerPlaces,
  SEASON_TEXT,
  seasonOf,
  WEATHER_TEXT,
  happinessFactors,
  worriesOf,
  missingServices,
  NEED_LABEL,
  occupants,
  roadCost,
  commandOutlay,
  pendingWorksCost,
  monthlyCostOf,
  networkRoads,
  BUILD,
  WAGE_OUTSIDE,
  maintenanceOf,
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
  zonesWithoutRoad,
  hasAdjacentRoad,
  zoneLotWithoutRoad,
  isFemaleName,
  lowerFirst,
  tenderApplies,
  streetSegment,
  STREETS,
  HERITAGE_NAMES,
  heritageVariant,
  touristified,
  hasReach,
  serviceReach,
  SERVICE,
  townNameOf,
  activeObjectives,
  daysToElection,
  nextLevel,
  OBJECTIVES,
  politicsActive,
} from '@bitopolis/sim';
import { contractBox, openTender } from './tender-ui.ts';
import { makeBubble, openPreview, openUsage } from './ai-ui.ts';
import { openNeighbours, openReport, openTaxes as openTaxesSheet } from './economy-ui.ts';
import { heavyLoad, loadPct, openLoans } from './loans-ui.ts';
import { LAYERS, type LayerId, NEED_ICON } from './layers.ts';
import { vidaBox } from './vida-ui.ts';
import { coopPostBox } from './coop-ui.ts';
import { openMailbox, unreadLetters } from './mail-ui.ts';
import { viviendaBox } from './vivienda-ui.ts';
import { openTourism, openTownHall } from './civic-ui.ts';
import { openAlbum, snapMoments } from './album-ui.ts';
import { type AwaySince, closeHoy, hoyHasNews, isHoyOpen, openHoy } from './hoy-ui.ts';
import { type Ask, dueSoon, dueText, pendingAsks } from './asks.ts';
import { openRank, rankCard } from './rank-ui.ts';
import { dilemmaSpot, openDilemmaSheet, type DilemmaCtx } from './dilemma-ui.ts';
import { objectiveText, objectivesNode, openAdvisor, openCitizen, openDiary, openPleno, portraitCanvas, rememberSeen, renderObjectives, resumeSummary, type SocialCtx } from './social-ui.ts';
import { api, ApiError } from './api.ts';
import { nextHint } from './hints.ts';
import { buildCostParts, monthsText, runwayMonths, runwayWarn } from './cash.ts';
import { openManagement } from './manage-ui.ts';
import { openErrands, openPress } from './town-news-ui.ts';
import { openWhatsHappening, turnHeadline } from './ai-town-ui.ts';
import { pocketMark } from './money-ui.ts';
import { formatDate, money, MONTHS, plural, shortDate, t } from './i18n.ts';
import { buildingPicture, busTrips, type Camera, type Preview, render, restartAnimations, signSpot } from './render.ts';
import { filterOverlay, overlayFor, placeLines, previewOverlay, reachLine, type ReachOverlay, TOOL_FOR_NEED } from './reach-ui.ts';
import type { FromWorker, SaveBatch, ToWorker, Unsaved } from './sim.worker.ts';
import SimWorker from './sim.worker.ts?worker';
import { buildingSprite, landmarkSprite, letterSprite, resSprite, T, ZONE_COLOR } from './sprites.ts';
import { bigCompanyContent, landmarkContent, openRegion, regionAttention } from './landmarks-ui.ts';
import { comarcaPending, openComarca } from './comarca-ui.ts';
import { ficheHead, fold, listGroup, listRow, spriteCopy, statCard, statGrid, statusBar, type UrgentItem, urgentBlock } from './hub-ui.ts';
import { type HubEntry, hubWants, Reveal, trayCatsWanted, ZONE_HELPERS } from './progress.ts';
import { commandFor, costText, isLocked, lockLong, lockShort, shortCost, type Tool, type ToolId, TOOLS, tilesOf, TRAY, trayChipName, trayCost } from './tools.ts';
import { Tutorial } from './tutorial.ts';
import { $, clearToastLog, closeSheet, onSheetChange, confirmDialog, currentSheet, entryAction, h, isSheetOpen, type LogEntry, markLogRead, onToastLog, reducedMotion, sheet, toast, toastLog, vibrate, withBack, setSheetSnap, setFastToasts } from './ui.ts';
import { pixelIcon } from './icons.ts';
import { openHistory } from './charts-ui.ts';
import { medalCount, openMedals } from './medals-ui.ts';
import { duck, sfx, startAmbience, startMusic, stopMusic, unlockAudio } from './audio.ts';
import { coins, dust, pop, shake, shakeOffset } from './fx.ts';
import { onPrefs, prefs } from './prefs.ts';
import { openSettings } from './settings-ui.ts';
import { shareBlock } from './share-ui.ts';
import { openElectionNight, openPolitics, renderPollChip } from './politics-ui.ts';
import { timeOfDay } from './render.ts';
import { demandExtra, lotBox, monthlyText, networkRoom, networkWarnings, plantLoadBox } from './nucleo-ui.ts';

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

/** 2.6: marca «Nuevo» (se quita al abrir lo marcado). */
function newBadge(): HTMLElement {
  return h('span', { class: 'new-badge', 'aria-hidden': 'true' }, 'Nuevo');
}

export function startGame(opts: GameOptions): void {
  const { token, sessionId } = opts;
  $('#start').hidden = true;
  $('#game').hidden = false;
  document.body.classList.add('in-game');
  // 2.7: un h1 (oculto) con el nombre del pueblo.
  $('#town-h1').textContent = townNameOf(opts.state);

  const canvas = $('#map') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const worker = new SimWorker();
  const send = (m: ToWorker) => worker.postMessage(m);

  let state: GameState = opts.state;
  /** 2.6: lo que ya salió en el panel «Pueblo» y la bandeja, y lo que lleva «Nuevo» (por partida, en este navegador). */
  const reveal = new Reveal(`bitopolis.reveal.${token}`);
  let revealKey = '';
  // El «Nuevo» se lee como descripción (no cambia el nombre de los botones).
  if (!document.getElementById('new-desc')) document.body.append(h('span', { id: 'new-desc', class: 'visually-hidden' }, 'Nuevo'));
  let tool: Tool = TOOLS[0]!;
  let speed = 0;
  let preview: Preview | null = null;
  let layer: LayerId = 'none';
  /** 2.6: filtro de «Qué falta» (un servicio) y la zona que se dibuja (memo por firma). */
  let missingKey: NeedKey | null = null;
  let reachMemo: { key: string; overlay: ReachOverlay | null } = { key: '', overlay: null };
  let selected: { x: number; y: number } | null = null;
  /** Primer toque de una carretera o zona (modo «toque inicio, toque fin»). */
  let anchor: { x: number; y: number } | null = null;
  /** Final propuesto: se ve el trazado y el coste; un segundo toque ahí confirma. */
  let pendingEnd: { x: number; y: number } | null = null;
  /** v1.4: en pantallas táctiles, una obra se coloca en dos pasos (ver, confirmar). */
  let pendingPlace: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
  /** 2.2: dedicando una calle (desde el pleno): a quién, y la casilla propuesta. */
  let dedicating: { citizenId: number; name: string } | null = null;
  let pendingDedication: { x: number; y: number } | null = null;
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
  // Los lotes del worker van en cadena (cada uno empieza donde acabó el anterior) y se mandan en orden.
  const queue: (SaveBatch & { live: boolean })[] = [];
  let saving = false;
  let saveError = false;
  /** Fin del último lote recibido: el siguiente tiene que empezar ahí (si no, es de antes de un `init`). */
  let lastBatchTo = state.tick;
  /** Lo que el worker ha aplicado sin lote todavía (llega con cada estado; sirve para guardar al cerrar). */
  let unsaved: Unsaved | null = null;

  /** ¿Queda alguna orden (o, en pausa, algo del reloj) sin confirmar por el servidor? */
  const savePending = () =>
    queue.length > 0 || saving || (unsaved !== null && (unsaved.commands.length > 0 || (speed === 0 && state.tick !== unsaved.from)));
  function paintSaved() {
    const el = $('#saved');
    const text = saveError ? t('saveFailed') : savePending() ? t('saving') : el.textContent ? t('saved') : '';
    if (el.textContent !== text) {
      el.textContent = text;
      el.title = text;
    }
    el.classList.toggle('err', saveError);
    el.dataset.pending = String(savePending());
  }
  function mergeBatches(list: SaveBatch[]) {
    return { fromTick: list[0]!.fromTick, toTick: list.at(-1)!.toTick, commands: list.flatMap((b) => b.commands), hash: list.at(-1)!.hash };
  }
  function resetSave(s: GameState) {
    queue.length = 0;
    unsaved = null;
    lastBatchTo = s.tick;
    saveError = false;
  }

  async function flushQueue() {
    if (saving || queue.length === 0 || lost) return;
    saving = true;
    const n = queue.length;
    const merged = {
      ...mergeBatches(queue),
      // Solo se pide a la IA si se está jugando (no en pausa ni oculto).
      live: queue.some((b) => b.live) && speed > 0 && !document.hidden,
    };
    try {
      await api.save(token, sessionId, merged);
      queue.splice(0, n);
      saveError = false;
      // La primera vez que se guarda ya sale «Guardado» (antes de eso, la franja va vacía).
      $('#saved').textContent ||= t('saved');
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        loseLease();
      } else if (e instanceof ApiError && e.status === 409 && e.body?.state) {
        resetSave(e.body.state);
        send({ type: 'init', state: e.body.state });
        toast(t('desync'), { kind: 'warn' });
      } else {
        saveError = true;
        setTimeout(() => flushQueue(), 5000);
      }
    } finally {
      saving = false;
      paintSaved();
      if (queue.length > 0 && !lost && !saveError) void flushQueue();
    }
  }

  /**
   * Al cerrar o recargar la página no da tiempo a pedirle al worker un lote (llegaría con la página ya
   * cerrada): se monta aquí con toda la cola y lo que el worker tenía sin lote en su último estado (con
   * el hash de ese estado), y sale con `sendBeacon`. Si una petición iba en camino, este guardado la
   * repite; `parts` deja al servidor saltarse lo que ya tenga. Devuelve si mandó algo.
   */
  function saveOnHide(): boolean {
    if (lost) return false;
    const all: SaveBatch[] = [...queue];
    const u = unsaved;
    if (u && u.from === lastBatchTo && (u.commands.length > 0 || state.tick > u.from)) {
      all.push({ fromTick: u.from, toTick: state.tick, commands: u.commands, hash: hashState(state) });
    }
    // Lo que va en camino se repite (puede perderse al cerrar): el servidor se salta lo que ya tenga.
    if (all.length === 0) return false;
    const parts = all.map((b) => ({ toTick: b.toTick, hash: b.hash, n: b.commands.length }));
    // `release`: el servidor suelta la partida después de guardar (si no, otra pestaña esperaría 90 s).
    api.saveOnExit(token, sessionId, { ...mergeBatches(all), live: false, release: true, parts });
    return true;
  }

  /** Espera (como mucho `ms`) a que no quede nada por guardar. */
  async function whenSaved(ms = 4000) {
    const end = performance.now() + ms;
    while ((saving || queue.length > 0) && !lost && !saveError && performance.now() < end) {
      void flushQueue();
      await new Promise((r) => setTimeout(r, 50));
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
      resetSave(r.state);
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
      state = JSON.parse(m.json) as GameState;
      unsaved = m.unsaved;
      onState();
      paintSaved();
    } else if (m.type === 'result') {
      pendingResults.get(m.id)?.(m.ok, m.error);
      pendingResults.delete(m.id);
    } else if (m.type === 'save') {
      // Un lote que no sigue al anterior es de antes de recargar el estado (409, «Jugar aquí»): fuera.
      if (m.batch.fromTick !== lastBatchTo) return;
      lastBatchTo = m.batch.toTick;
      unsaved = null;
      queue.push({ ...m.batch, live: !m.flush && speed > 0 && !document.hidden });
      void flushQueue();
      paintSaved();
    } else if (m.type === 'thinking') {
      // 2.0: el reloj espera al turno del pueblo.
      thinkingN = m.n;
      thinkingSince = performance.now();
      paintThinking();
    }
  };
  send({ type: 'init', state });

  function command(cmd: Command, quiet = false): Promise<boolean> {
    const id = ++cmdId;
    return new Promise((resolve) => {
      pendingResults.set(id, (ok, error) => {
        if (!ok && error && !quiet) {
          toast(error, { kind: 'warn' });
          sfx.error();
        }
        if (ok) feedback(cmd);
        // 2.7: en pausa el tick no cambia: «Te piden» se recalcula al responder.
        if (ok) queueMicrotask(() => refreshAsks(true));
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
      // v1.9.1: en el tutorial, tras la primera casa se vuelve a «Mirar» (si no, cada toque proponía otra casa y se acababa en deuda).
      if (cmd.kind === 'house' && tutorial.active && tool.id === 'house' && state.buildings.filter((b) => b.kind === 'house').length <= 1) selectTool('inspect');
    } else if (cmd.type === 'BuildRoad') {
      sfx.road();
      say(`Carretera construida: ${plural(tilesOf(cmd).length, 'casilla', 'casillas')}.`);
    } else if (cmd.type === 'Demolish') {
      sfx.demolish();
      dust(cmd.x, cmd.y);
      shake(3, 250);
      say('Derribado.');
    } else if (cmd.type === 'SetZoneDensity') {
      sfx.tap();
      say(`Densidad ${['baja', 'media', 'alta'][cmd.level]} marcada en la zona R.`);
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
        toast(text, { kind: 'info', sticky: true, go: `at:${wx},${wy}` });
        return;
      }
      const from = { x: cam.x, y: cam.y };
      glide(from, () => {
        look();
        return { x: cam.x, y: cam.y };
      }, () => {
        toast(text, { kind: 'info', sticky: true, go: `at:${wx},${wy}` });
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
      const a = cal.classList.contains('flip-a');
      cal.classList.toggle('flip-a', !a);
      cal.classList.toggle('flip-b', a);
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
  function attention(at: { x: number; y: number } | undefined, force = false, why?: string, level: 'emergencia' | 'importante' = 'emergencia') {
    const now = performance.now();
    if (at) highlight = { x: at.x, y: at.y, since: now };
    // 2.7: el jugador elige qué frena el tiempo (por defecto, solo las emergencias).
    const slowFor = prefs().slowFor;
    if (slowFor === 'nada' || (level === 'importante' && slowFor !== 'importante')) return;
    if (force && speed >= 3) lastAttention = -Infinity;
    // Ronda 14: si en este mismo lote ya se bajó a x1 (una oferta con plazo), el motivo
    // que llega detrás sí se enseña; si no, como mucho una parada cada 45 s.
    const sameBatch = now - lastAttention < 2_000;
    if (!sameBatch && (speed < 3 || now - lastAttention < 45_000)) return;
    lastAttention = now;
    if (speed >= 3) {
      const before = speed;
      setSpeed(1);
      slowNote(before, why);
    }
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
  /**
   * 2.1: al subir de rango, «attention» suave: fanfarria, destello en el cartel
   * de la entrada, baja a x1 sin temblor y un aviso que abre el escudo.
   */
  function celebrateRank(text: string) {
    sfx.fanfare();
    duck(3);
    vibrate(150);
    const at = signSpot(state) ?? hallSpot();
    if (at) highlight = { x: at.x, y: at.y, since: performance.now() };
    slowDown('el nuevo rango');
    calmPause();
    toast(`${text}. Toca para ver el escudo.`, { kind: 'good', sticky: true, go: 'rank' });
    $('#sr-live').textContent = text;
    const th = hallSpot();
    if (th) coins(...screenOf(th.x, th.y), 12);
  }
  /** Una oferta con plazo baja a x1 (sin temblor) y cuenta como parada (ronda 14). */
  function slowDown(why?: string) {
    if (speed < 3 || prefs().slowFor !== 'importante') return;
    const before = speed;
    setSpeed(1);
    slowNote(before, why);
    lastAttention = performance.now();
  }
  /**
   * Pruebas 2.5: la vuelta a x1 no se notaba (solo cambiaba el «x1» de arriba).
   * Ahora se dice por qué y hay un botón para volver a la velocidad de antes.
   * Se quita sola a los 20 s o cuando el jugador cambia la velocidad.
   */
  let slowTimer = 0;
  let slowFrom = 0;
  function slowNote(before: number, why?: string) {
    const note = $('#slow-note');
    slowFrom = before;
    note.querySelector('.slow-text')!.textContent = `Bajo a x1${why ? ` por ${why}` : ' para que lo veas'}. Vuelvo a x${before} en 20 s.`;
    $('#slow-back').textContent = `Volver a x${before}`;
    note.hidden = false;
    clearTimeout(slowTimer);
    // 2.7: pasado el susto, vuelve sola a la velocidad de antes (si nadie la ha tocado).
    slowTimer = window.setTimeout(() => {
      const to = slowFrom;
      hideSlowNote();
      if (to > 1 && speed === 1 && !isSheetOpen() && !document.querySelector('.modal-backdrop, .hoy-backdrop')) setSpeed(to);
    }, 20_000);
  }
  function hideSlowNote() {
    clearTimeout(slowTimer);
    $('#slow-note').hidden = true;
  }
  $('#slow-back').addEventListener('click', () => {
    const to = slowFrom;
    hideSlowNote();
    if (to > 1) setSpeed(to);
  });
  const hallSpot = () => state.buildings.find((b) => b.kind === 'townhall');
  // v1.9.1: en el paso del tutorial «Toca el ayuntamiento…», el ayuntamiento destella y la cámara va a él.
  tutorial.onFocus = () => {
    const hall = hallSpot();
    if (!hall) return;
    highlight = { x: hall.x, y: hall.y, since: performance.now() };
    if (reducedMotion()) return centerOn(hall.x, hall.y);
    glide({ x: cam.x, y: cam.y }, () => {
      centerOn(hall.x, hall.y);
      return { x: cam.x, y: cam.y };
    }, () => undefined);
  };
  /** Mientras dure ese paso, el destello se repite (sin mover la cámara). */
  function tutorialGlow() {
    if (tutorial.focus !== 'townhall' || isSheetOpen()) return;
    const hall = hallSpot();
    const now = performance.now();
    if (hall && (!highlight || now - highlight.since > 5_000)) highlight = { x: hall.x, y: hall.y, since: now };
  }
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
  const runway = h('span', { class: 'tb-runway', 'aria-hidden': 'true' });
  runway.hidden = true;
  $('#hud-money').replaceChildren(pixelIcon('coin'), moneyText, moneyTrend, runway);
  const popText = h('span', { class: 'tb-text' });
  $('#hud-pop').replaceChildren(pixelIcon('people'), popText);
  const happyText = h('span', { class: 'tb-text' });
  $('#hud-happy').replaceChildren(pixelIcon('smile'), happyText);
  /**
   * Ronda 21: la barra de arriba se encaja sola. Primero, sin la flecha de tendencia, el «€» ni el «%»;
   * si aún no cabe (texto grande en 360 px), en dos filas: ▶, velocidad, caja y avisos arriba; el resto, debajo.
   * Los iconos nunca se quitan (sin ellos, «77 61» no se entendía).
   */
  let topbarKey = '';
  /**
   * 2.7: la barra de arriba va siempre en una fila. Si no cabe, primero sin la flecha, el «€» ni el «%»;
   * si aún no cabe, vecinos, votos e IA pasan a «⋯» (Más). Los iconos nunca se quitan.
   */
  function fitTopbar() {
    const bar = $('.topbar');
    const over = () => bar.scrollWidth > bar.clientWidth + 1;
    bar.classList.remove('tb-tight', 'tb-rows', 'tb-more', 'tb-more2', 'tb-nounit');
    if (!over()) return;
    bar.classList.add('tb-tight');
    if (!over()) return;
    bar.classList.add('tb-more');
    // Con lo demás en «Más», a lo mejor ya caben la flecha y el «€».
    bar.classList.remove('tb-tight');
    if (over()) bar.classList.add('tb-tight');
    // Último escalón (320 px con letra grande): también la felicidad va a «Más».
    if (over()) bar.classList.add('tb-more2');
    // 2.7: el «€» se queda mientras quepa; solo se quita si aún no cabe nada más.
    if (over()) bar.classList.add('tb-nounit');
  }
  /** 2.7: «⋯» enseña lo que no cupo en la barra (cada fila abre lo mismo que su botón). */
  $('#hud-more').addEventListener('click', () => {
    const rows: HTMLElement[] = [];
    const add = (sel: string, label: string) => {
      const src = document.querySelector<HTMLElement>(sel);
      // Solo lo que de verdad no se ve en la barra (oculto o mandado a «Más» por el CSS).
      if (!src || src.hidden || src.offsetParent !== null) return;
      const b = h('button', { class: 'btn wide more-row', 'data-for': sel.slice(1) }, label);
      // Abre su hoja encima (sin cerrar esta antes: el «atrás» del historial cerraría la nueva).
      b.addEventListener('click', () => src.click());
      rows.push(b);
    };
    add('#hud-pop', `Vecinos: ${state.citizens.length}`);
    add('#hud-happy', `Felicidad: ${happyText.textContent}`);
    add('#hud-poll', $('#hud-poll').getAttribute('aria-label') ?? 'Intención de voto');
    add('#ai-chip', 'Lo que piensa el pueblo (IA)');
    const el = sheet('Más datos', ...rows);
    el.classList.add('half');
  });
  let lastStats = state.stats.length;
  let lastLevel = townLevel(state);
  let upgradeWarned = townLevel(state) - 1;
  const albumSeen = { n: state.album?.length ?? 0 };
  function onState() {
    // 2.6: «Deshacer» solo mientras la obra no haya empezado; avisos de las redes, una vez al día.
    checkUndo();
    refreshAsks();
    const netDay = Math.floor(state.tick / 24);
    if (netDay !== lastNetDay) {
      lastNetDay = netDay;
      networkWarnings(state, (text, kind, ref) => toast(text, { kind, go: `b:${ref.id}` }));
    }
    // v1.7: foto de cada momento nuevo del álbum (en este navegador).
    snapMoments(token, state, albumSeen);
    if (layer === 'missing' && Math.floor(state.tick / 24) !== legendDay) missingLegend();
    // Ronda 12: al llegar a 10 vecinos, un momento de desbloqueo que lleva a la bandeja.
    // v1.8: cuando se puede ampliar el ayuntamiento, se avisa una vez por nivel.
    const lv = townLevel(state);
    if (canUpgradeTownhall(state).ok && upgradeWarned < lv) {
      upgradeWarned = lv;
      const hall = hallSpot();
      toast(`Ya puedes ampliar el ayuntamiento a nivel ${lv + 1}: toca el ayuntamiento para ver qué desbloquea.`, { kind: 'good', sticky: true, go: hall ? `b:${hall.id}` : undefined });
      if (hall) highlight = { x: hall.x, y: hall.y, since: performance.now() };
    }
    if (lastLevel < 2 && lv >= 2) {
      sfx.milestone();
      vibrate(120);
      toast('¡Zonas desbloqueadas! Toca aquí o «Construir» para pintar zonas R, C e I junto a la carretera.', { kind: 'good', sticky: true, go: 'tray' });
      tabBuild.classList.add('pulse');
      setTimeout(() => tabBuild.classList.remove('pulse'), 8000);
    }
    lastLevel = lv;
    // 2.0: una tarjeta por turno del pueblo (en vez de muchos avisos sueltos).
    const lastTurn = state.ai?.log.at(-1);
    if (lastTurn && lastTurn.n > turnLogSeen) {
      turnLogSeen = lastTurn.n;
      const head = turnHeadline(state);
      if (head && speed < 10) toast(head, { kind: 'info', go: 'happening' });
    }
    if (state.stats.length !== lastStats) {
      lastStats = state.stats.length;
      const m = state.stats.at(-1);
      if (m) {
        const net = m.income - m.expenses;
        toast(`Parte del mes: ${net >= 0 ? '▲ +' : '▼ '}${money(net)}. Toca para verlo.`, { kind: net >= 0 ? 'good' : 'warn', go: 'accounts' });
        if (net > 0) {
          sfx.coin();
          const th = state.buildings.find((b) => b.kind === 'townhall');
          if (th) coins(...screenOf(th.x, th.y), Math.ceil(Math.min(net, 6000) / 600));
        } else sfx.warn();
        // Ronda 15: los cierres del mes, juntos y también a x10, con la causa.
        if ((m.closures ?? 0) > 0) {
          const wage = (m.wage ?? 0) > 900 ? ` (sueldo mínimo ${money(m.wage ?? 0)})` : '';
          toast(`${m.closures === 1 ? 'Cierra 1 empresa' : `Cierran ${m.closures} empresas`} este mes: no llegaban a las nóminas${wage}. Toca para ver el parte.`, { kind: 'warn', go: 'accounts' });
        }
        // v1.9: un solo aviso al mes con quien no ha podido pagar.
        if ((m.unpaid ?? 0) > 0 && (m.debtors ?? 0) > 0) {
          toast(`${m.debtors} ${m.debtors === 1 ? 'vecino debe' : 'vecinos deben'} dinero; este mes quedaron ${money(m.unpaid ?? 0)} sin pagar al ayuntamiento. Toca para verlos.`, {
            kind: 'warn',
            go: 'debtors',
          });
        }
      }
    }
    const d = tickToDate(state.tick);
    paintCalendar(d);
    // Ronda 21: el año va aparte; en pantallas estrechas se ve «21 dic» (antes, en 360 px, no se veía la fecha).
    const dateEl = $('#hud-date');
    const dateKey = shortDate(d);
    // 2.6: lo que aparece en el panel «Pueblo» y en la bandeja (y sus «Nuevo»): una vez al día
    // y al cambiar el nivel, los vecinos o los edificios (también en pausa, tras una orden).
    const rk = `${dateKey}|${state.townhallLevel}|${state.citizens.length}|${state.buildings.length}|${state.loans?.length ?? 0}`;
    if (rk !== revealKey) {
      revealKey = rk;
      refreshReveal();
    }
    if (dateEl.dataset.v !== dateKey) {
      dateEl.dataset.v = dateKey;
      const [dd, mm, yy] = dateKey.split(' ');
      dateEl.replaceChildren(`${dd} ${mm}`, h('span', { class: 'hud-year' }, ` ${yy}`));
    }
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
    // Ronda 15: con 6 cifras la barra se pisaba: en miles a partir de 100.000 €.
    // Ronda 21: el «€» va aparte: si la barra no cabe, se quita antes que los iconos (fitTopbar).
    const moneyNum = Math.abs(state.treasury) >= 100_000 ? `${Math.round(state.treasury / 1000)} mil` : money(state.treasury).replace(/\s€$/, '');
    if (moneyText.dataset.v !== moneyNum) {
      moneyText.dataset.v = moneyNum;
      moneyText.replaceChildren(moneyNum, h('span', { class: 'tb-unit' }, ' €'));
    }
    // 2.7: si el mes va en negativo, cuántos meses aguanta la caja (en rojo si son menos de 3).
    // Con el gasto corriente: las obras se pagan una vez (antes, el mes de una obra grande decía «<1 m»).
    const rm = state.treasury > 0 ? runwayMonths(state) : null;
    const months = rm === null ? -1 : Math.floor(rm);
    const runKey = months >= 0 && months < 3 ? (months === 0 ? '<1 m' : `${months} m`) : '';
    if (runway.dataset.v !== runKey) {
      runway.dataset.v = runKey;
      runway.textContent = runKey;
      runway.hidden = !runKey;
    }
    moneyTrend.textContent = diff > 0 ? '▲' : diff < 0 ? '▼' : '';
    moneyTrend.className = `trend ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`;
    $('#hud-money').classList.toggle('neg', state.treasury < 0);
    // 2.2: en ámbar si los préstamos se llevan más del 25 % de lo que entra.
    const heavy = state.treasury >= 0 && heavyLoad(state);
    $('#hud-money').classList.toggle('load', heavy);
    $('#hud-money').setAttribute('aria-label', `Caja del ayuntamiento: ${money(state.treasury)}${diff > 0 ? ', subiendo' : diff < 0 ? ', bajando' : ''}${heavy ? `; los préstamos se llevan el ${loadPct(state)} % de lo que entra` : ''}${runKey ? `; a este ritmo la caja aguanta ${months === 0 ? 'menos de un mes' : months === 1 ? '1 mes' : `${months} meses`}` : ''}. Ver cuentas`);
    popText.textContent = String(state.citizens.length);
    $('#hud-pop').setAttribute('aria-label', `Habitantes: ${state.citizens.length}. Ver la lista`);
    const happy = state.citizens.length ? Math.round(state.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.length) : 0;
    happyText.textContent = String(happy);
    $('#hud-happy').classList.toggle('neg', happy > 0 && happy < 45);
    $('#hud-happy').setAttribute('aria-label', `Felicidad media ${happy} de 100: ver por qué`);
    renderPollChip(state, () => openPolitics(social));
    // Ronda 21: si cambia lo largo de las cifras, se vuelve a encajar la barra de arriba.
    const barKey = `${moneyNum.length}|${runKey}|${popText.textContent}|${happyText.textContent}|${$('#hud-poll').textContent}|${$('#hud-poll').hidden}|${$('#ai-chip').hidden}`;
    if (barKey !== topbarKey) {
      topbarKey = barKey;
      fitTopbar();
    }
    $('#game').classList.toggle('opposition', state.politics.mayor !== 'player');
    updateDemand();
    // La bandeja solo se ve abierta (al abrirla se pone al día): cerrada, recalcularla en cada estado costaba a x10.
    if (!$('#tray').hidden) updateToolLocks();
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
      // 2.7: el gasto al mes cambia con el presupuesto: se pone al día aunque no cambie el candado.
      const month = btn.querySelector<HTMLElement>('.tool-month');
      const monthNow = locked ? '' : monthlyText(tl.build, state);
      if (month && month.textContent !== monthNow) month.textContent = monthNow;
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
      toast(e.text, { kind: 'good', sticky: !quiet, go: e.ref ? `b:${e.ref}` : undefined });
      vibrate(80);
      calmPause();
    }
    const plain = quiet ? [] : built.filter((e) => !e.notify);
    if (plain.length === 1) toast(plain[0]!.text, { kind: 'good' });
    else if (plain.length > 1) toast(`${plain.length} obras terminadas`, { kind: 'good' });
    for (const e of fresh) {
      if (e.kind === 'warning' && e.text.startsWith('Se comenta en el bar') && e.ref) {
        // 2.2: el rumor de la obra del primo lleva a su ficha, con «Revisar el contrato».
        sfx.warn();
        calmPause();
        toast(e.text, { kind: 'warn', sticky: true, go: `b:${e.ref}` });
      } else if (e.kind === 'warning' && e.text.startsWith('Un asunto difícil')) {
        // 2.4: un dilema con plazo: destello en el sitio, vuelta a x1 y aviso fijo que abre la hoja.
        // Ronda 20: el dilema de este aviso (el más reciente sin resolver de ese vecino), y siempre a x1.
        const d = [...state.dilemmas].reverse().find((x) => !x.resolved && (e.ref === undefined || x.citizenIds[0] === e.ref));
        sfx.warn();
        calmPause();
        attention(d ? dilemmaSpot(state, d.id) : undefined, true, 'un asunto difícil', 'importante');
        toast(e.text, { kind: 'warn', sticky: true, go: d ? `dilemma:${d.id}` : undefined });
      } else if (e.kind === 'warning' && e.text.startsWith('No decidiste a tiempo')) {
        toast(e.text, { kind: 'warn', sticky: true });
      } else if (e.kind === 'bankrupt' || e.kind === 'warning') {
        sfx.warn();
        duck(1.5);
        if (e.kind === 'bankrupt') shake(4, 400);
        calmPause();
        // 2.7: un aviso, un mensaje (antes se le pegaba el consejo del «?»: «la caja aguanta 1 mes. 24 sin colegio…»).
        toast(e.text, { kind: 'warn', sticky: true, go: 'accounts' });
      } else if (e.kind === 'milestone' && e.text.startsWith('¡Bitópolis ya es')) {
        // 2.1: subida de rango: fanfarria, el cartel destella y un aviso que abre el escudo.
        celebrateRank(e.text);
      } else if (e.kind === 'milestone' && e.text.startsWith('El escudo estrena')) {
        toast(e.text, { kind: 'good', go: 'rank' });
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
      } else if (e.kind === 'info' && /ofrece un acuerdo de/.test(e.text)) {
        // 2.5: oferta de un pueblo vecino con plazo: aviso fijo que lleva a «Comarca», y se frena.
        toast(e.text, { kind: 'warn', sticky: true, go: 'comarca' });
        slowDown('la oferta de un pueblo vecino');
        calmPause();
      } else if (e.kind === 'info' && e.text.startsWith('Encargo del pueblo')) {
        // 2.7: un encargo espera respuesta (antes no se avisaba y se perdía): aviso fijo que abre «Encargos».
        toast(e.text, { kind: 'warn', sticky: true, go: 'errands' });
        slowDown('un encargo');
      } else if (e.kind === 'info' && e.text.startsWith('Sale El Eco')) {
        if (!quiet) toast(e.text, { kind: 'info', go: 'press' });
      } else if (e.kind === 'info' && e.text.includes('recibe carta de')) {
        if (!quiet) toast(e.text, { kind: 'info', go: 'mail' });
      } else if (/quiere montar|Fondos europeos|ofrece pagar el/.test(e.text)) {
        // Ronda 19: la gran empresa, el FEDER y la cofinanciación son decisiones con plazo: aviso fijo y se frena.
        // 2.7: abre la tarjeta donde se responde (antes, el edificio si lo había).
        toast(e.text, { kind: 'warn', sticky: true, go: /quiere montar/.test(e.text) ? 'region' : 'th:grants' });
        calmPause();
      } else if (e.kind === 'info' && /Diputación|fiestas|Subvención/.test(e.text)) {
        // v1.5: ofertas de subvención y fiestas: llevan a su sección del Ayuntamiento.
        // Si hay que decidir algo con plazo, el juego baja a x1 para que dé tiempo (ronda 11).
        const decide = /Responde antes|puedes organizarlas/.test(e.text);
        if (decide) slowDown(/fiestas/i.test(e.text) ? 'las fiestas' : 'la subvención');
        toast(e.text, { kind: 'info', sticky: decide, go: /fiestas/i.test(e.text) ? 'th:festival' : 'th:grants' });
      } else if (e.kind === 'info' && /^(Nieva|Ola de calor|Tormenta sobre|El río crece)/.test(e.text)) {
        // v1.7: el tiempo que cambia algo (no el sol ni las nubes).
        toast(e.text, { kind: 'info' });
      } else if (e.kind === 'info' && /^(Desahucian|El banco se queda)/.test(e.text)) {
        // v1.9: desahucios y embargos.
        if (!quiet) toast(e.text, { kind: 'warn', go: e.ref ? `c:${e.ref}` : undefined });
      } else if (e.kind === 'info' && e.text.startsWith('El río se desborda')) {
        sfx.warn();
        vibrate(80);
        calmPause();
        attention(refSpot(e.ref), false, 'la riada');
        toast(e.text, { kind: 'warn', sticky: true, go: e.ref ? `b:${e.ref}` : undefined });
      } else if (e.kind === 'crime') {
        // v1.8: robos, detenciones, calabozos llenos y disturbios.
        // Ronda 15: los robos en casas (muchos) se avisan sin parar el juego ni llamar la atención.
        const home = e.text.startsWith('Entran a robar en casa') || e.text.startsWith('Intentan robar');
        if (home) {
          if (!quiet) toast(e.text, { kind: e.text.includes('escapa') ? 'warn' : 'info', go: e.ref ? `b:${e.ref}` : undefined });
          continue;
        }
        // Ronda 18: el escándalo de una licitación es una mala noticia (fija, con aviso y lleva a la obra).
        const bad = /Disturbios|llenos|escapa|^Escándalo/.test(e.text);
        // Ronda 15: un robo con el ladrón escapado se avisa, pero no para el juego (solo disturbios y calabozos llenos).
        if (quiet && !bad) continue;
        if (bad) {
          sfx.warn();
          calmPause();
          if (/Disturbios|llenos|^Escándalo/.test(e.text)) attention(refSpot(e.ref) ?? state.buildings.find((b) => b.kind === 'police' && b.built), false, /Disturbios/.test(e.text) ? 'los disturbios' : /llenos/.test(e.text) ? 'los calabozos llenos' : 'el escándalo', /Disturbios/.test(e.text) ? 'emergencia' : 'importante');
        }
        toast(e.text, { kind: bad ? 'warn' : 'good', sticky: /Disturbios|llenos|^Escándalo/.test(e.text), go: e.ref ? `b:${e.ref}` : undefined });
      } else if (e.kind === 'fire') {
        // 2.1: riesgos, incendios, bomberos y urgencias.
        const go = e.ref !== undefined ? `b:${e.ref}` : undefined;
        if (e.text.startsWith('¡Fuego') || e.text.startsWith('El fuego salta')) {
          sfx.warn();
          duck(1.5);
          calmPause();
          attention(refSpot(e.ref), false, 'el incendio');
          toast(e.text, { kind: 'warn', sticky: true, go });
        } else if (e.text.startsWith('El fuego deja')) {
          sfx.warn();
          toast(e.text, { kind: 'warn', sticky: true, go });
        } else if (e.text.startsWith('Riesgo de incendio')) {
          if (!quiet) toast(e.text, { kind: 'warn', go });
        } else if (!quiet || e.text.startsWith('Urgencia')) {
          toast(e.text, { kind: /no llega/.test(e.text) ? 'warn' : 'good', go });
        }
      } else if (e.kind === 'protest') {
        sfx.warn();
        duck(1.5);
        calmPause();
        attention(hallSpot(), false, 'la manifestación');
        toast(e.text, { kind: 'warn', sticky: true, go: 'th:associations' });
      } else if (e.kind === 'politics' && /Asociación|asociación/.test(e.text)) {
        // v1.7: asociaciones. Si convocan una manifestación, hay 3 días para reunirse con ellos: baja a x1.
        const urgent = e.text.includes('convoca una manifestación');
        if (urgent) {
          const a = state.associations?.find((x) => x.id === e.ref);
          attention(a?.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : hallSpot(), false, 'la manifestación convocada');
        }
        toast(e.text, { kind: urgent ? 'warn' : 'info', sticky: urgent || e.text.startsWith('Nace'), go: 'th:associations' });
      } else if (e.kind === 'politics' && /comisión de festejos/.test(e.text)) {
        // 2.4: la comisión de festejos pide presupuesto: aviso fijo que lleva a su sección.
        slowDown('la comisión de festejos');
        toast(e.text, { kind: 'info', sticky: true, go: 'th:seasons' });
      } else if (e.kind === 'politics' && /presupuesto/i.test(e.text)) {
        const decide = e.text.startsWith('Toca presentar');
        if (decide) slowDown('el presupuesto');
        toast(e.text, { kind: e.text.includes('rechaza') ? 'warn' : 'info', sticky: decide, go: 'th:budget' });
      } else if (e.kind === 'politics' && /, alcalde de |baja los impuestos: atraerá/.test(e.text)) {
        // 2.5: lo que dicen los alcaldes vecinos (lleva a «Comarca»; a x10, nada).
        if (!quiet) toast(e.text, { kind: 'info', go: 'comarca' });
      } else if (e.kind === 'politics') {
        // Lo que responde a una acción tuya (moción, campaña) se avisa siempre.
        if (quiet && !e.text.startsWith('Faltan') && !/moción|campaña/i.test(e.text)) continue;
        toast(e.text, { kind: e.text.startsWith('Faltan') && state.politics.approval < 50 ? 'warn' : 'info', sticky: e.text.startsWith('Faltan'), go: 'politics' });
        if (e.text.startsWith('Faltan') || e.text.includes('funda')) calmPause();
      } else if (e.kind === 'departure' || e.kind === 'business') {
        // Ronda 15: una apertura es buena noticia; los cierres van además agrupados a fin de mes.
        const opens = e.kind === 'business' && / abre /.test(e.text);
        // Ronda 21: los que se van a un pueblo vecino llevan a la Comarca (por qué se van), también a x10.
        const toTown = /se van? a .*: (allí se vive|ha bajado los impuestos)/.test(e.text);
        if (!quiet || toTown) toast(e.text, { kind: opens ? 'good' : 'warn', go: toTown ? 'comarca' : e.ref ? `b:${e.ref}` : undefined });
        if (!opens) calmPause();
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

  /* ---------- 2.0: turnos del pueblo con IA ---------- */
  let thinkingN: number | null = null;
  let thinkingSince = 0;
  let turnBusy = false;
  let turnLogSeen = state.ai?.log.at(-1)?.n ?? 0;
  /** Lo que el reloj espera a la IA como mucho (luego deciden las reglas: «por costumbre»). */
  const TURN_WAIT_MS = 45_000;
  function paintThinking() {
    const on = thinkingN !== null;
    document.body.classList.toggle('ai-thinking', on);
    setAiChip(on ? 'thinking' : 'on');
    const strip = document.getElementById('thinking');
    if (strip) strip.hidden = !on;
    // Ronda 16: el botón de velocidad dice que el reloj espera a la IA (no que se haya colgado).
    const sp = $('#speed');
    sp.dataset.waiting = String(on);
    if (on) {
      sp.textContent = '✦';
      sp.setAttribute('aria-label', `El reloj espera a que el pueblo decida la semana (como mucho 45 s). Velocidad x${lastSpeed}`);
    } else paintSpeed();
  }
  function releaseTurn(n: number, why: string) {
    send({ type: 'release', n });
    if (why) toast(why, { kind: 'info' });
  }
  async function pollTurn() {
    const t = state.ai?.turn;
    if (!state.aiMode || !t || lost || turnBusy || document.hidden) return;
    turnBusy = true;
    try {
      const r = await api.turn(token, t.n);
      $('#ai-banner').hidden = !r.capped;
      if (r.notice && !notices.has(r.notice)) {
        notices.add(r.notice);
        toast(r.notice, { kind: 'warn' });
      }
      const res = r.turn;
      if (res && res.status === 'ready' && state.ai?.turn?.n === t.n) {
        await command(
          {
            type: 'TownTurn',
            n: t.n,
            acts: res.acts,
            ...(res.director ? { director: res.director } : {}),
            ...(res.focus ? { focus: res.focus } : {}),
            ...(res.chronicle ? { chronicle: res.chronicle } : {}),
          },
          true,
        );
      } else if (res && res.status === 'failed') {
        releaseTurn(t.n, '');
      }
    } catch {
      /* sin conexión: si tarda demasiado, deciden las reglas */
    } finally {
      turnBusy = false;
    }
    if (thinkingN !== null && state.ai?.turn?.n === thinkingN && performance.now() - thinkingSince > TURN_WAIT_MS) {
      releaseTurn(thinkingN, 'La IA tarda: esta semana el pueblo decide por costumbre.');
    }
  }
  const turnTimer = setInterval(() => void pollTurn(), 1500);
  /* ---------- 2.5: turno mensual de los alcaldes vecinos (IA del servidor) ---------- */
  let neighborBusy = false;
  async function pollNeighbors() {
    const t = state.comarca?.turn;
    if (!state.aiMode || !t || lost || neighborBusy || document.hidden) return;
    neighborBusy = true;
    try {
      const r = await api.neighbors(token, t.month);
      const res = r.neighbors;
      // Si no llega a tiempo, deciden las reglas al vencer (el reloj no espera).
      if (res && res.status === 'ready' && state.comarca?.turn?.month === t.month) await command({ type: 'NeighborTurn', month: t.month, picks: res.picks }, true);
    } catch {
      /* sin conexión: reglas */
    } finally {
      neighborBusy = false;
    }
  }
  const neighborTimer = setInterval(() => void pollNeighbors(), 3000);
  /** Ritmo de los turnos según la velocidad: a x3 y x10, turnos más espaciados (menos esperas y menos gasto). */
  function syncTurnPace(s: number) {
    if (!state.aiMode || !state.ai || s <= 0) return;
    const days = s >= 10 ? 28 : s >= 3 ? 14 : 7;
    if (days !== state.ai.paceDays) void command({ type: 'SetTurnPace', days }, true);
  }
  function setAiChip(mode: 'on' | 'paused' | 'thinking') {
    const chip = $('#ai-chip');
    chip.hidden = !state.aiMode;
    chip.textContent = mode === 'on' ? 'IA ✦' : mode === 'thinking' ? 'IA …' : 'IA en pausa';
    chip.classList.toggle('paused', mode === 'paused');
    chip.classList.toggle('is-thinking', mode === 'thinking');
    chip.setAttribute('aria-label', mode === 'on' ? 'IA activa: ver gasto' : mode === 'thinking' ? 'El pueblo está pensando (la IA decide la semana). Ver gasto' : 'IA en pausa por el tope de gasto: deciden las reglas. Ver gasto');
  }
  setAiChip('on');
  $('#ai-chip').onclick = () => void openUsage(token);

  /* ---------- cámara ---------- */
  function resize() {
    const r = canvas.getBoundingClientRect();
    // Alturas reales de las barras: las hojas, la bandeja y el tutorial se colocan con ellas.
    const root = document.documentElement.style;
    const side = matchMedia('(orientation: landscape) and (max-height: 500px)').matches;
    fitTopbar();
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
    // 2.6: con una hoja abierta encima del mapa (abajo o al lado), se puede llevar el borde del mapa hasta ella:
    // si no, lo de abajo del pueblo nunca quedaba a la vista sobre la hoja.
    const cover = sheetCover();
    const axis = (pos: number, size: number, view: number, extra: number) =>
      size + 2 * pad <= view - extra ? Math.round((size - view) / 2) : Math.max(-pad, Math.min(size - view + pad + extra, pos));
    cam.x = axis(cam.x, state.map.w * tileSize(), canvas.width, cover.x);
    cam.y = axis(cam.y, state.map.h * tileSize(), canvas.height, cover.y);
  }
  /** Lo que tapa del mapa la hoja abierta (en px del canvas): por abajo (móvil) o por la derecha (panel). */
  function sheetCover(): { x: number; y: number } {
    const el = currentSheet();
    if (!el) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    const sr = el.getBoundingClientRect();
    if (sr.left <= r.left + 8) return { x: 0, y: Math.max(0, r.bottom - sr.top) * dpr() };
    return { x: Math.max(0, r.right - sr.left) * dpr(), y: 0 };
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
    if ((tool.id !== 'inspect' && tool.id !== 'demolish') || dedicating) return t;
    // 2.3: `occupies` (vía buildingAt) cuenta las 4 casillas de los edificios 2×2.
    const here = !!buildingAt(state, t.x, t.y);
    const below = !!buildingAt(state, t.x, t.y + 1);
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
      if (t1) {
        preview = previewFor(gesture.startTile, t1);
        farmHint(gesture.startTile, t1);
      }
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
      if (touchInput && tool.id !== 'inspect' && cam.zoom < touchZoom() && !pendingPlace) {
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
        const net = cmd?.type === 'BuildRoad' && validateCommand(state, cmd).ok ? roadNetworkWarn(cmd) : '';
        if (cmd && !validateCommand(state, cmd).ok) flashBad(previewFor(g.startTile, t1)?.tiles ?? [t1]);
        if (cmd) void command(cmd).then((ok) => ok && (warnZoneWithoutRoad(cmd), net && warnRoadNetwork(net)));
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
    if (dedicating) return proposeDedication(tile);
    if (tool.id === 'inspect') return inspect(tile);
    if (isLocked(tool, state)) {
      toast(lockLong(tool, state), { kind: 'warn' });
      return;
    }
    if (tool.id === 'demolish') {
      // v1.6: se confirma en la franja de abajo, en rojo (antes, una ventana que tapaba el mapa).
      const b = buildingAt(state, tile.x, tile.y);
      const onRiver = terrainAt(state, tile.x, tile.y) === Terrain.River;
      const what = b ? (b.name ?? BUILD_NAMES[b.kind]) : state.map.tiles[tile.y * state.map.w + tile.x] === Tile.Road ? (onRiver ? 'Puente' : 'Carretera') : hasDike(state, tile.x, tile.y) ? 'Dique' : null;
      if (!what) {
        $('#tool-info').replaceChildren(h('b', {}, 'Derribar'), ': ahí no hay nada que derribar. Toca un edificio o una carretera.');
        return refreshStrip();
      }
      const people = b ? occupants(state, b).length + state.citizens.filter((c) => c.jobId === b.id).length : 0;
      // 2.6: una obra sin empezar se cancela y devuelve los materiales.
      const refund = b ? cancelRefund(state, b) : 0;
      cancelProposal = refund > 0;
      if (refund > 0) return proposePlace(tile, tile, `¿Cancelar la obra (${what.toLowerCase()})? Aún no ha empezado: se devuelven ${money(refund)} de materiales.`);
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
        if (!v.ok) flashBad(preview?.tiles ?? [tile]);
        const net = v.ok && line.type === 'BuildRoad' ? roadNetworkWarn(line) : '';
        const msg = v.ok
          ? `${tool.label}: ${lineText(anchor, tile)}.${net ? ` ${net}` : ''} Haz clic otra vez en el final para confirmar.`
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
      const net = line.type === 'BuildRoad' && validateCommand(state, line).ok ? roadNetworkWarn(line) : '';
      if (await command(line)) {
        warnZoneWithoutRoad(line);
        if (net) warnRoadNetwork(net);
      }
      return;
    }
    if (touchInput && (tool.build || tool.id === 'dike' || tool.landmark)) {
      // Con el dedo solo construye el botón «Construir»: un doble toque no gasta (ronda 10).
      return proposePlace(tile, tile);
    }
    const cmd = commandFor(tool, tile, tile);
    // 2.7: un clic donde no se puede ya no se queda en un aviso suelto: la casilla parpadea y la franja dice por qué.
    const v = cmd ? validateCommand(state, cmd) : null;
    if (cmd && v && !v.ok) return flashBad([tile], v.error);
    if (cmd && (await placeBuild(cmd)) && cmd.type === 'Build') offerUndo(cmd.x, cmd.y);
  }

  /**
   * 2.2: las obras grandes se licitan: antes de construir, la hoja con las tres
   * ofertas (la local, la de siempre, va primero). El resto, directo.
   */
  function placeBuild(cmd: Command): Promise<boolean> {
    // 2.3: al marcar el solar de una gran obra, se abre su ficha (para pagar la primera fase).
    if (cmd.type === 'StartLandmark') {
      return command(cmd).then((ok) => {
        const lm = ok ? state.landmarks.find((l) => l.kind === cmd.kind) : undefined;
        if (lm) {
          selectTool('inspect');
          focusBuilding(lm.buildingId);
        }
        return ok;
      });
    }
    if (cmd.type !== 'Build' || cmd.kind === 'road' || cmd.offer || !tenderApplies(state, cmd.kind, cmd.x, cmd.y) || !validateCommand(state, cmd).ok) return command(cmd);
    return new Promise((resolve) => {
      openTender(state, cmd, (offer) => void command({ ...cmd, offer }).then(resolve));
    });
  }

  /* ---------- 2.2: dedicar una calle (desde el pleno) ---------- */
  function startDedication(citizenId: number, name: string) {
    closeSheet();
    selectTool('inspect');
    dedicating = { citizenId, name };
    $('#tool-info').replaceChildren(h('b', {}, 'Dedicar una calle'), ` a ${name}: toca una carretera o la Plaza Mayor (placa ${money(STREETS.plaque)}). Esc para cancelar.`);
    if (touchInput) {
      $('#confirm-text').textContent = `Calle para ${name}: toca una carretera o la plaza.`;
      ($('#confirm-yes') as HTMLButtonElement).hidden = true;
      showBar(true);
    }
    refreshStrip();
    $('#sr-live').textContent = `Elige la calle para ${name}.`;
  }

  function proposeDedication(tile: { x: number; y: number }) {
    if (!dedicating) return;
    const cmd: Command = { type: 'DedicateStreet', citizenId: dedicating.citizenId, x: tile.x, y: tile.y };
    const v = validateCommand(state, cmd);
    const seg = streetSegment(state, tile.x, tile.y);
    pendingDedication = v.ok ? tile : null;
    preview = seg ? { tiles: seg.tiles.map(([x, y]) => ({ x, y })), ok: v.ok } : { tiles: [tile], ok: false };
    const what = v.ok ? `¿Dedicar ${seg!.axis === 'plaza' ? 'la plaza' : 'esta calle'} a ${dedicating.name}?` : `No se puede (${v.error})`;
    $('#confirm-text').replaceChildren(what ? h('span', { class: 'cc-what' }, what) : '', v.ok ? h('span', { class: 'cc-cost' }, `Placa: ${money(STREETS.plaque)}`) : '');
    const yes = $('#confirm-yes') as HTMLButtonElement;
    yes.textContent = 'Dedicar aquí';
    yes.className = 'btn primary';
    yes.disabled = !v.ok;
    yes.hidden = !v.ok;
    showBar(true);
    document.body.classList.add('placing');
  }

  function endDedication() {
    dedicating = null;
    pendingDedication = null;
    preview = null;
    showBar(false);
    selectTool('inspect');
  }

  async function confirmDedication() {
    const d = dedicating;
    const at = pendingDedication;
    endDedication();
    if (!d || !at) return;
    if (await command({ type: 'DedicateStreet', citizenId: d.citizenId, x: at.x, y: at.y })) {
      const n = state.streetNames?.at(-1);
      toast(n ? `Se descubre la placa: ${n.name}` : 'Calle dedicada', { kind: 'good' });
    }
  }

  /**
   * Lo que cuesta un trazo, en palabras. Zonas: solo las casillas que cambian
   * (lo mismo que cobra el motor; las ocupadas se saltan y se dice cuántas).
   * Carretera: las casillas nuevas, con los puentes aparte.
   */
  function lineText(a: { x: number; y: number }, b: { x: number; y: number }): string {
    const cmd = commandFor(tool, a, b);
    if (!cmd) return '';
    if (cmd.type === 'SetZoneDensity') {
      const r = tilesOf(cmd).filter((t) => t.x < state.map.w && t.y < state.map.h && state.map.zones[t.y * state.map.w + t.x] === 1).length;
      return r ? `${plural(r, 'casilla R', 'casillas R')}, gratis` : 'aquí no hay zona R';
    }
    if (cmd.type === 'Zone') {
      const { changed, skipped } = zoneChanges(state, cmd);
      if (cmd.zone === 'none') return `${plural(changed, 'casilla', 'casillas')}, gratis`;
      const crops = cmd.zone === 'A' ? ` · ${cropsText(cmd)}` : '';
      const lost = noRoadText(cmd);
      return `${plural(changed, 'casilla', 'casillas')}, ${money(changed * ZONE_COST_PER_TILE)}${skipped ? ` (no se cobran ${skipped} ocupadas o ya marcadas; los árboles sí, se talan al construir)` : ''}${crops}${lost ? ` · ${lost}` : ''}`;
    }
    const n = tilesOf(cmd).filter((t) => state.map.tiles[t.y * state.map.w + t.x] !== Tile.Road && !buildingAt(state, t.x, t.y)).length;
    const bridges = bridgeTiles(a, b);
    return `${plural(n, 'casilla nueva', 'casillas nuevas')}, ${money(lineCost(a, b))}${bridges ? ` (con puente de ${plural(bridges, 'casilla', 'casillas')})` : ''}`;
  }

  /**
   * Casillas de una zona que no tocan carretera: el motor nunca construye en
   * ellas (`zoneLotWithoutRoad`). Antes de marcar se cuenta a mano; después, con el motor.
   */
  function noRoadText(cmd: Extract<Command, { type: 'Zone' }>, placed = false): string {
    if (cmd.zone === 'none') return '';
    const { w, h: hh } = state.map;
    const n = tilesOf(cmd).filter((t) => {
      if (t.x < 0 || t.y < 0 || t.x >= w || t.y >= hh) return false;
      if (placed) return zoneLotWithoutRoad(state, t.x, t.y);
      const i = t.y * w + t.x;
      return state.map.tiles[i] !== Tile.Road && !buildingAt(state, t.x, t.y) && !isWater(state.map.terrain?.[i]) && !hasAdjacentRoad(state, t.x, t.y);
    }).length;
    return n ? `⚠ ${plural(n, 'casilla', 'casillas')} sin carretera: ${n === 1 ? 'ahí' : 'aquí'} no se construirá` : '';
  }
  /** 2.7: tras trazar con el ratón una calle sin agua o luz, la franja lo dice. */
  function warnRoadNetwork(text: string) {
    $('#tool-info').replaceChildren(h('b', {}, tool.label), `: ${text}`);
    refreshStrip();
    $('#sr-live').textContent = text;
  }
  /** Tras marcar una zona, si parte no toca carretera, la franja lo dice. */
  function warnZoneWithoutRoad(cmd: Command | null | undefined) {
    if (cmd?.type !== 'Zone') return;
    const lost = noRoadText(cmd, true);
    if (!lost) return;
    $('#tool-info').replaceChildren(h('b', {}, tool.label), `: ${lost}. Pon una carretera al lado.`);
    refreshStrip();
    $('#sr-live').textContent = lost;
  }

  /** 2.2: qué se plantaría en la zona agraria: «Aquí: regadío (río)» (o los cultivos que salgan, del más común). */
  function cropsText(cmd: Extract<Command, { type: 'Zone' }>): string {
    const n = new Map<string, number>();
    for (const t of tilesOf(cmd)) {
      if (t.x < 0 || t.y < 0 || t.x >= state.map.w || t.y >= state.map.h || isWater(state.map.terrain?.[t.y * state.map.w + t.x])) continue;
      const c = CROP_HINT[cropAt(state, t.x, t.y)];
      n.set(c, (n.get(c) ?? 0) + 1);
    }
    const list = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    return list.length ? `Aquí: ${list.join(' y ')}` : '';
  }

  /** 2.2: mientras se arrastra la zona agraria, la franja dice qué saldría ahí. */
  function farmHint(a: { x: number; y: number }, b: { x: number; y: number }) {
    if (tool.zone !== 'A') return;
    const cmd = commandFor(tool, a, b);
    if (cmd?.type !== 'Zone') return;
    $('#tool-info').replaceChildren(h('b', {}, tool.label), `: ${lineText(a, b)}`);
    refreshStrip();
  }

  /** Coste de un tramo de carretera (los puentes, más caros) y cuántas casillas son puente (v1.7). */
  const lineCost = (a: { x: number; y: number }, b: { x: number; y: number }) => roadCost(state, a.x, a.y, b.x, b.y);
  function bridgeTiles(a: { x: number; y: number }, b: { x: number; y: number }) {
    const cmd = commandFor(tool, a, b);
    return cmd ? tilesOf(cmd).filter((t) => terrainAt(state, t.x, t.y) === Terrain.River && state.map.tiles[t.y * state.map.w + t.x] !== Tile.Road).length : 0;
  }

  /**
   * 2.7: las calles nuevas que no tocan la red del agua o de la luz (`networkRoads`, lo mismo
   * que `siteNetworkWarn` para los edificios). Solo si ya hay planta de esa red.
   */
  let netCache: { s: GameState; water: Set<number>; power: Set<number> } | null = null;
  function roadNetworkWarn(cmd: Extract<Command, { type: 'BuildRoad' }>): string {
    if (netCache?.s !== state) netCache = { s: state, water: networkRoads(state, 'water'), power: networkRoads(state, 'power') };
    const { w, h: hh } = state.map;
    const tiles = tilesOf(cmd);
    const plantOf = (kind: string, net: 'water' | 'power') => kind === net || (net === 'power' && (kind === 'solar' || kind === 'wind'));
    const missing: string[] = [];
    for (const net of ['water', 'power'] as const) {
      if (!state.buildings.some((b) => b.built && plantOf(b.kind, net))) continue;
      const set = netCache[net];
      const touches = tiles.some((t) => {
        if (set.has(t.y * w + t.x)) return true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const x = t.x + dx;
          const y = t.y + dy;
          if (x < 0 || y < 0 || x >= w || y >= hh) continue;
          if (set.has(y * w + x)) return true;
          const b = buildingAt(state, x, y);
          if (b?.built && plantOf(b.kind, net)) return true;
        }
        return false;
      });
      if (!touches) missing.push(net === 'water' ? 'agua' : 'luz');
    }
    if (!missing.length) return '';
    const to = missing.length === 2 ? 'al agua ni a la luz' : missing[0] === 'agua' ? 'al agua' : 'a la luz';
    return `⚠ Esta calle no está unida ${to}: únela a la red o junto a ella no habrá ${missing.join(' ni ')}.`;
  }

  /** 2.7: qué hacer si la caja va a quedar justa (en la barra «Construir»). */
  function runwayAdvice(): string {
    return 'Quizá convenga esperar a cobrar o subir los impuestos.';
  }

  /** 2.7: la casilla que no vale parpadea en rojo; si se dice por qué, va en la franja. */
  let badFlash: { tiles: { x: number; y: number }[]; since: number } | null = null;
  function flashBad(tiles: { x: number; y: number }[], why?: string) {
    badFlash = { tiles, since: performance.now() };
    if (!why) return;
    $('#tool-info').replaceChildren(h('b', {}, tool.label), ': ', h('span', { class: 'bad-why' }, `aquí no: ${why}`), '. Elige otra casilla.');
    refreshStrip();
    $('#sr-live').textContent = `${tool.label}: aquí no se puede, ${why}.`;
    sfx.error();
    vibrate(30);
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
    const hill = (tool.build || tool.landmark) && tool.shape === 'tap' && terrainAt(state, a.x, a.y) === Terrain.Hill;
    // 2.6: con lo que costará al mes. 2.7: como gasto («−1050 €/mes»).
    const pl0 = v.ok && !demolishText && tool.build && tool.shape === 'tap' && touchInput;
    // Ronda 22: en la barra, corto («· −2450 €/mes»); el detalle de sueldos está en la bandeja.
    const month = tool.build && tool.shape === 'tap' ? monthlyText(tool.build, state, true).replace(/\s*\(.*\)$/, '') : '';
    // 2.7: la obra explicada: lo que se paga al poner la obra y lo que irá en obreros («Agua 4200 €» cobraba 3000 y luego devolvía 3000).
    const parts = tool.build && tool.build !== 'road' && tool.shape === 'tap' ? buildCostParts(state, tool.build, a.x, a.y) : null;
    const monthSpan = month ? h('span', { class: 'cc-month' }, ` · ${month}`) : '';
    const cost: (Node | string)[] | string =
      tool.id === 'dike'
        ? shortCost(tool)
        : tool.landmark
          ? `${shortCost(tool)}${hill ? ' (colina: +50 %)' : ''} · ahora solo el solar`
          : parts
            ? [`${parts.text}${hill ? ' (colina: materiales +50 %)' : ''}`, monthSpan]
            : lineText(a, b);
    // Ronda 13: el precio va en su propia línea y siempre se ve (también si no se puede: «no hay dinero»).
    const what = demolishText && v.ok ? demolishText : v.ok ? (pl0 ? '' : `${tool.label} aquí`) : `${tool.label}: no se puede (${v.error})`;
    // v1.9.1: si con lo que falta por pagar de las obras en marcha la caja quedaría en negativo, se avisa (no se bloquea).
    const outlay = v.ok && !demolishText ? commandOutlay(state, cmd) : 0;
    const after = v.ok && !demolishText ? state.treasury - outlay - pendingWorksCost(state) : 0;
    // 2.7: y si la caja queda para menos de 2 meses con el gasto corriente (y lo que costará esta obra al mes).
    const runway = v.ok && !demolishText && after >= 0 && outlay > 0 ? runwayWarn(state, outlay, tool.build && tool.build !== 'road' ? monthlyCostOf(tool.build, state).total : 0) : '';
    // 2.7: una calle que no toca la red de agua o de luz no lleva ni agua ni luz a lo que se construya junto a ella.
    const netWarn = v.ok && !demolishText && cmd.type === 'BuildRoad' ? roadNetworkWarn(cmd) : '';
    const warn = after < 0
      ? h('span', { class: 'cc-warn' }, `⚠ Quedarías en −${money(-after)} con las obras en marcha`)
      : runway
        ? h('span', { class: 'cc-warn cc-runway', 'data-test': 'cc-runway' }, `${runway}. ${runwayAdvice()}`)
        : '';
    const netSpan = netWarn ? h('span', { class: 'cc-warn cc-runway', 'data-test': 'cc-network' }, netWarn) : '';
    // 2.6: lo que gana el pueblo con este servicio aquí («+14 casas con colegio · atenderá a ~38 de 60»).
    const pl = v.ok && !demolishText && tool.build && tool.shape === 'tap' ? placeLines(state, tool.build, a.x, a.y) : null;
    const reachText = pl ? h('span', { class: 'cc-reach', 'data-test': 'cc-reach' }, h('b', { class: pl.none ? 'none' : '' }, pl.gain), ...pl.warn.map((w) => h('span', { class: 'cc-reach-warn' }, w))) : '';
    const costNodes = typeof cost === 'string' ? [cost] : cost;
    $('#confirm-text').replaceChildren(
      h('span', { class: 'cc-what' }, what),
      demolishText || !cost.length ? '' : h('span', { class: 'cc-cost' }, ...(v.ok ? costNodes : ['Cuesta ', ...costNodes])),
      reachText,
      netSpan,
      warn,
    );
    $('#confirm-bar').classList.toggle('warn', after < 0);
    $('#confirm-bar').classList.toggle('runway', !!runway || !!netWarn);
    // 2.7: lo que no se puede, también en el mapa (la casilla parpadea en rojo).
    if (!v.ok && !demolishText) flashBad(preview?.tiles ?? [a]);
    const yes = $('#confirm-yes') as HTMLButtonElement;
    yes.textContent = demolishText ? 'Derribar' : tool.zone ? (tool.zone === 'none' ? 'Quitar zona' : 'Marcar zona') : tool.density !== undefined ? 'Marcar densidad' : tool.landmark ? 'Marcar el solar' : 'Construir';
    yes.className = demolishText ? 'btn danger' : 'btn primary';
    yes.disabled = !v.ok;
    // Si no se puede, no se ofrece «Construir»: solo el motivo y ✕ (ronda 11).
    yes.hidden = !v.ok;
    showBar(true);
    $('#confirm-bar').classList.toggle('danger', !!demolishText);
    document.body.classList.add('placing');
    // Ronda 22: en el móvil la zona del servicio no cabía al acercar; se encuadra entera sobre la barra.
    if (pl && pl.info.mode === 'radio' && touchInput) revealArea(pl.info.tiles);
  }

  /** Tras confirmar, unos instantes sin toques en el mapa: los toques repetidos no proponen otra obra. */
  let quietUntil = 0;
  /** Ronda 22: la propuesta en curso es cancelar una obra (el motor la rechaza si ya empezó). */
  let cancelProposal = false;
  async function confirmPlace() {
    const p = pendingPlace;
    const cancelOnly = cancelProposal;
    cancelProposal = false;
    quietUntil = performance.now() + 500;
    vibrate(15);
    cancelPlace();
    if (!p) return;
    const cmd0 = commandFor(tool, p.a, p.b);
    const cmd = cmd0 && cancelOnly && cmd0.type === 'Demolish' ? { ...cmd0, cancelOnly: true as const } : cmd0;
    const net = cmd?.type === 'BuildRoad' && validateCommand(state, cmd).ok ? roadNetworkWarn(cmd) : '';
    const ok = cmd ? await placeBuild(cmd) : false;
    // Tras una carretera o zona, la franja vuelve a la ayuda de la herramienta (no a «toca dónde termina»).
    if (tool.shape !== 'tap') selectTool(tool.id);
    if (ok) warnZoneWithoutRoad(cmd);
    if (ok && net) warnRoadNetwork(net);
    if (ok && cmd?.type === 'Build') offerUndo(cmd.x, cmd.y);
  }

  /**
   * 2.6: «Deshacer» unos segundos tras poner una obra. Manda un `Demolish` que el
   * motor convierte en cancelación con devolución de los materiales mientras la
   * obra no haya empezado (`cancelRefund`). Si ya empezó (a x10 un día dura 2 s), se quita.
   */
  const UNDO_MS = 5000;
  let undo: { x: number; y: number; id: number; until: number; timer: number } | null = null;
  function undoTarget(): Building | null {
    if (!undo) return null;
    const b = buildingAt(state, undo.x, undo.y);
    return b && b.id === undo.id && cancelRefund(state, b) > 0 ? b : null;
  }
  function offerUndo(x: number, y: number) {
    const b = buildingAt(state, x, y);
    const refund = b ? cancelRefund(state, b) : 0;
    if (!b || refund <= 0) return;
    hideUndo();
    undo = { x, y, id: b.id, until: performance.now() + UNDO_MS, timer: window.setTimeout(hideUndo, UNDO_MS) };
    // 2.7: lo que se recupera es justo lo pagado hasta ahora (los materiales; los obreros aún no han cobrado).
    $('#undo-text').textContent = `${BUILD_NAMES[b.kind] ?? b.kind}: obra puesta (pagados ${money(refund)} de materiales). Deshacer: recuperas ${money(refund)}.`;
    $('#undo-bar').hidden = false;
    refreshStrip();
  }
  function hideUndo() {
    if (undo) window.clearTimeout(undo.timer);
    undo = null;
    $('#undo-bar').hidden = true;
    refreshStrip();
  }
  /** Con cada estado nuevo: si la obra ya empezó (o ya no está), fuera «Deshacer». */
  function checkUndo() {
    if (undo && !undoTarget()) hideUndo();
  }
  $('#undo-btn').onclick = () => {
    const b = undoTarget();
    const at = undo;
    hideUndo();
    if (!b || !at) {
      toast('La obra ya ha empezado: para quitarla, usa «Derribar» (ya no se devuelve nada).', { kind: 'warn' });
      return;
    }
    void command({ type: 'Demolish', x: at.x, y: at.y, cancelOnly: true }).then((ok) => {
      if (ok) $('#sr-live').textContent = 'Obra deshecha: se devuelven los materiales.';
    });
  };

  function cancelAnchor() {
    anchor = null;
    pendingEnd = null;
    preview = null;
    selectTool(tool.id);
  }

  function cancelPlace() {
    pendingPlace = null;
    cancelProposal = false;
    preview = null;
    showBar(false);
  }
  // Además, la barra no acepta toques en sus primeros 350 ms (por si algún clic llega tarde).
  let barShownAt = 0;
  const barReady = () => performance.now() - barShownAt > 350;
  $('#confirm-yes').onclick = () => barReady() && void (dedicating ? confirmDedication() : confirmPlace());
  $('#confirm-no').onclick = () => {
    if (!barReady()) return;
    if (dedicating) endDedication();
    else if (anchor) cancelAnchor();
    else cancelPlace();
  };

  /** Qué hay en una casilla (para el lector de pantalla). */
  function describeTile(t: { x: number; y: number }): string {
    const b = buildingAt(state, t.x, t.y);
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
    if (document.querySelector('.modal-backdrop, .hoy-backdrop')) return;
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
    else if (k.toLowerCase() === 'o') openSettingsGame();
    else if (k === ' ' && target.tagName !== 'BUTTON') {
      e.preventDefault();
      userSpeed(speed === 0 ? lastSpeed : 0);
    } else if (k === 'Escape') {
      if (!tray.hidden) closeTray();
      else if (isSheetOpen()) closeSheet();
      else if (dedicating) endDedication();
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
    if (tl.landmark) {
      // 2.3: la gran obra terminada (2×2, más ancha).
      const c = landmarkSprite(tl.landmark, LANDMARKS.specs[tl.landmark].phases, LANDMARKS.specs[tl.landmark].phases);
      const img = document.createElement('canvas');
      img.width = c.width;
      img.height = c.height;
      img.getContext('2d')!.drawImage(c, 0, 0);
      if (LANDMARKS.specs[tl.landmark].size === 2) img.classList.add('wide');
      wrap.append(img);
    } else if ((tl.build && tl.build !== 'road') || tl.id === 'dike') {
      const c = buildingSprite(tl.build ?? tl.id, 1);
      const img = document.createElement('canvas');
      img.width = c.width;
      img.height = c.height;
      img.getContext('2d')!.drawImage(c, 0, 0);
      wrap.append(img);
    } else if (tl.zone && tl.zone !== 'none') {
      const color = ZONE_COLOR[tl.zone];
      const img = document.createElement('canvas');
      img.width = 5;
      img.height = 7;
      img.getContext('2d')!.drawImage(letterSprite(tl.zone, color), 0, 0);
      img.classList.add('letter');
      wrap.append(img);
    } else if (tl.density !== undefined) {
      // 2.5: el bloque tal como crecería con esa densidad.
      const c = resSprite(tl.density, 7);
      const img = document.createElement('canvas');
      img.width = c.width;
      img.height = c.height;
      img.getContext('2d')!.drawImage(c, 0, 0);
      wrap.append(img);
    } else {
      wrap.append(pixelIcon(tl.id === 'dezone' ? 'demolish' : tl.id));
    }
    return wrap;
  }

  const bar = $('#tools');
  const tray = $('#tray');
  const coarse = matchMedia('(pointer: coarse)').matches;
  /** 2.7: el nombre de la pestaña, con uno corto para el texto grande (nunca solo el icono). */
  const SHORT: Record<string, string> = { Carretera: 'Calle', Construir: 'Obras', Derribar: 'Quitar' };
  const tabLabel = (label: string, short = SHORT[label] ?? label) =>
    h('span', { class: 'tab-label', 'aria-hidden': 'true' }, h('span', { class: 'tl-long' }, label), h('span', { class: 'tl-short' }, short));
  const tab = (id: string, icon: string, label: string, cls = '') => {
    const b = h('button', { class: `tab ${cls}`, id: `tab-${id}`, 'aria-label': label }, pixelIcon(icon), tabLabel(label));
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
  $('#menu').replaceChildren(pixelIcon('town'), tabLabel('Pueblo'));
  $('#menu').classList.add('tab');
  // 2.7: el dock es una barra de herramientas: las flechas pasan de una pestaña a otra.
  $('#dock').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...$('#dock').querySelectorAll<HTMLElement>('.tab')].filter((b) => b.offsetParent !== null);
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation(); // el mapa no se mueve por detrás
    const n = tabs.length;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
    tabs[j]!.focus();
  });

  // La bandeja: por categorías, con precio y lo que falta para lo bloqueado.
  // 2.7 «Construir 2.0»: chips de categoría en una fila (se desplaza de lado) y tarjetas en 3 columnas.
  // Se construye una sola vez: al abrirla solo se ponen al día precios, bloqueos y categorías.
  const trayChips = h('div', { class: 'tray-chips', role: 'toolbar', 'aria-label': 'Categorías' });
  const trayMsg = h('p', { class: 'tray-msg muted small', 'aria-live': 'polite' }, 'Elige qué construir. Los precios incluyen la obra.');
  tray.replaceChildren(h('div', { class: 'tray-head' }, trayChips, trayMsg));
  /** Lleva a una categoría: la abre y la deja arriba (bajo los chips). */
  function goTrayCat(title: string) {
    const fold = tray.querySelector<HTMLDetailsElement>(`details[data-cat="${title}"]`);
    if (!fold) return;
    if (!fold.open) {
      fold.dataset.user = '1';
      fold.open = true;
    }
    seenTrayCat(title);
    const head = tray.querySelector<HTMLElement>('.tray-head')!;
    tray.scrollTo({ top: fold.offsetTop - head.offsetHeight - 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
    markTrayChip(title);
  }
  function markTrayChip(title: string) {
    for (const c of trayChips.querySelectorAll<HTMLElement>('.tray-chip')) {
      const on = c.dataset.cat === title;
      if (on !== (c.getAttribute('aria-current') === 'true')) c.setAttribute('aria-current', String(on));
      if (on) {
        const r = c.offsetLeft - (trayChips.clientWidth - c.offsetWidth) / 2;
        if (c.offsetLeft < trayChips.scrollLeft || c.offsetLeft + c.offsetWidth > trayChips.scrollLeft + trayChips.clientWidth) trayChips.scrollTo({ left: r });
      }
    }
  }
  /** Al desplazar la bandeja, el chip de la categoría que está arriba se marca. */
  let trayScrollRaf = 0;
  tray.addEventListener('scroll', () => {
    if (trayScrollRaf) return;
    trayScrollRaf = requestAnimationFrame(() => {
      trayScrollRaf = 0;
      const top = tray.scrollTop + tray.querySelector<HTMLElement>('.tray-head')!.offsetHeight + 8;
      let cur = '';
      for (const fold of tray.querySelectorAll<HTMLDetailsElement>('details.tray-cat')) {
        if (fold.hidden) continue;
        if (!cur || fold.offsetTop <= top) cur = fold.dataset.cat!;
      }
      if (cur) markTrayChip(cur);
    });
  }, { passive: true });
  for (const cat of TRAY) {
    const grid = h('div', { class: 'tray-grid' });
    for (const id of cat.tools) {
      const tl = TOOLS.find((x) => x.id === id)!;
      const btn = h(
        'button',
        { class: 'tool', 'data-tool': tl.id, 'aria-pressed': 'false', title: tl.key ? `${tl.label} (${tl.key})` : tl.label },
        toolIcon(tl),
        h('span', { class: 'tool-label' }, tl.label),
        h('span', { class: 'tool-cost' }, trayCost(tl)),
        // 2.6: lo que cuesta al mes, debajo del precio (2.7: como gasto, «−1050 €/mes»).
        h('span', { class: 'tool-month' }, monthlyText(tl.build, state)),
      );
      btn.addEventListener('click', () => {
        seenTrayCat(cat.title);
        if (isLocked(tl, state)) {
          // Ronda 12: tocar algo bloqueado no hacía nada; ahora explica qué falta.
          trayMsg.textContent = lockLong(tl, state);
          trayMsg.classList.remove('muted');
          // Ronda 17: la bandeja puede estar desplazada; el motivo también sale como aviso.
          toast(lockLong(tl, state), { kind: 'warn' });
          sfx.error();
          vibrate(30);
          return;
        }
        selectTool(tl.id);
      });
      grid.append(btn);
    }
    // Pruebas 2.5: las categorías sin nada disponible salen plegadas («Grandes obras (5 · ayto. nivel 3)»).
    const head = h('h3', {}, cat.title);
    const fold = h('details', { class: 'tray-cat', open: '', 'data-cat': cat.title }, h('summary', {}, head), grid) as HTMLDetailsElement;
    // Si el jugador la abre o la cierra a mano, se respeta (hasta que cambie lo que hay disponible).
    fold.addEventListener('toggle', () => {
      if (fold.dataset.auto !== String(fold.open)) {
        fold.dataset.user = '1';
        seenTrayCat(cat.title);
      }
    });
    tray.append(fold);
    const chip = h('button', { class: 'tray-chip', 'data-cat': cat.title, 'aria-current': 'false' }, h('span', { class: 'tc-name' }, trayChipName(cat.title)));
    chip.addEventListener('click', () => goTrayCat(cat.title));
    trayChips.append(chip);
  }
  refreshReveal();
  /**
   * 2.6: lo que pide ver el pueblo ahora (panel «Pueblo» y bandeja), todo de una vez: la
   * primera vez en este navegador, todo entra sin «Nuevo» (una partida avanzada ve lo que usaba).
   */
  function refreshReveal() {
    const want = hubWants(state);
    const hub = (Object.keys(want) as HubEntry[]).filter((k) => want[k]).map((k) => `hub:${k}`);
    const cats = trayCatsWanted(state).map((t) => `tray:${t}`);
    const free = TRAY.filter((c) => c.tools.some((id) => !isLocked(TOOLS.find((x) => x.id === id)!, state))).map((c) => `trayfree:${c.title}`);
    reveal.update([...hub, ...cats, ...free]);
    refreshNewDots();
  }
  /** Punto «nuevo» en las pestañas «Pueblo» y «Construir». */
  function refreshNewDots() {
    $('#menu').classList.toggle('has-new', reveal.anyNew('hub:'));
    document.querySelector('#tab-build')?.classList.toggle('has-new', TRAY.some((c) => trayCatNew(c.title)));
  }
  function trayCatNew(title: string) {
    return reveal.isNew(`tray:${title}`) || reveal.isNew(`trayfree:${title}`);
  }
  function seenTrayCat(title: string) {
    if (!trayCatNew(title)) return;
    reveal.seen(`tray:${title}`);
    reveal.seen(`trayfree:${title}`);
    document.querySelector(`#tray details[data-cat="${title}"] .new-badge`)?.remove();
    document.querySelector(`#tray .tray-chip[data-cat="${title}"]`)?.classList.remove('has-new');
    refreshNewDots();
  }
  /**
   * Pliega las categorías sin nada disponible y dice cuántas obras tienen y desde cuándo.
   * 2.6: oculta las que no se alcanzan ni con el siguiente nivel del ayuntamiento.
   */
  function foldTray() {
    refreshReveal();
    for (const cat of TRAY) {
      const fold = tray.querySelector<HTMLDetailsElement>(`details[data-cat="${cat.title}"]`);
      if (!fold) continue;
      fold.hidden = !prefs().fullHub && !reveal.shown(`tray:${cat.title}`) && !reveal.shown(`trayfree:${cat.title}`);
      const tools = cat.tools.map((id) => TOOLS.find((x) => x.id === id)!);
      const zonesOpen = !isLocked(TOOLS.find((x) => x.id === 'zoneR')!, state);
      const free = tools.some((tl) => !isLocked(tl, state) && (zonesOpen || !ZONE_HELPERS.has(tl.id)));
      const sig = free ? 'free' : 'locked';
      if (fold.dataset.sig !== sig) {
        fold.dataset.sig = sig;
        delete fold.dataset.user;
      }
      const why = free ? '' : (tools.map((tl) => lockText(tl)).find((t) => /nivel/.test(t)) ?? lockText(tools[0]!));
      fold.querySelector('h3')!.textContent = free ? cat.title : `${cat.title} (${tools.length}${why ? ` · ${why.replace(/^ayto\. nivel/, 'desde nivel')}` : ''})`;
      if (trayCatNew(cat.title)) fold.querySelector('h3')!.append(newBadge());
      // 2.7: su chip, igual (oculto, con candado si no hay nada disponible y con el punto de «Nuevo»).
      const chip = trayChips.querySelector<HTMLButtonElement>(`.tray-chip[data-cat="${cat.title}"]`);
      if (chip) {
        chip.hidden = fold.hidden;
        chip.classList.toggle('locked', !free);
        chip.classList.toggle('has-new', trayCatNew(cat.title));
        chip.setAttribute('aria-label', `${cat.title}${free ? '' : ': aún bloqueada'}${trayCatNew(cat.title) ? ' (nuevo)' : ''}`);
      }
      if (fold.dataset.user) continue;
      fold.dataset.auto = String(free);
      fold.open = free;
    }
  }

  function openTray() {
    if (isSheetOpen()) closeSheet();
    trayMsg.textContent = 'Elige qué construir. Los precios incluyen la obra.';
    trayMsg.classList.add('muted');
    updateToolLocks();
    foldTray();
    tray.hidden = false;
    tabBuild.setAttribute('aria-expanded', 'true');
    document.body.classList.add('tray-open');
    tutorial.update(state, tool.id);
    const target = tray.querySelector<HTMLElement>('[aria-pressed="true"]') ?? tray.querySelector<HTMLElement>('details:not([hidden]) .tool:not(.locked)');
    // 2.7: el chip de la categoría de lo elegido (o de lo primero que se puede construir) queda marcado.
    const cat = target?.closest<HTMLElement>('details.tray-cat')?.dataset.cat ?? TRAY[0]!.title;
    markTrayChip(cat);
    target?.focus({ preventScroll: true });
    if (target && target.getAttribute('aria-pressed') === 'true') goTrayCat(cat);
    else tray.scrollTop = 0;
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
    strip.dataset.mode = !$('#confirm-bar').hidden ? 'confirm' : !$('#undo-bar').hidden ? 'undo' : $('#tool-info').textContent ? 'tool' : 'info';
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
    if ((tl.zone && tl.zone !== 'none') || tl.density !== undefined) return coarse ? `Toca una esquina y luego la otra. ${tl.help}` : tl.help;
    if (tl.id === 'demolish') return 'toca lo que quieras derribar. Te pedirá confirmación.';
    // 2.6: cuánto margen queda en las redes de agua y luz.
    if (tl.build === 'water' || tl.build === 'power' || tl.build === 'solar' || tl.build === 'wind') return `${tl.help} ${networkRoom(state, tl.build === 'water' ? 'water' : 'power')}`;
    return tl.help;
  }

  function selectTool(id: ToolId) {
    const tl = TOOLS.find((x) => x.id === id)!;
    // Ronda 22: con otra herramienta, la franja enseña su ayuda (no el «Deshacer» de la obra anterior).
    if (undo && id !== tool.id) hideUndo();
    tool = tl;
    // 2.7: con una herramienta elegida, lo que flota sobre el mapa (burbujas) no roba toques.
    document.body.classList.toggle('tool-active', id !== 'inspect');
    const inTray = TRAY.some((c) => c.tools.includes(id));
    for (const b of [tabInspect, tabRoad, tabDemolish]) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    tabBuild.setAttribute('aria-pressed', String(inTray));
    for (const b of tray.querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.getAttribute('data-tool') === id));
    // La pestaña «Construir» enseña lo elegido: se ve qué hay en la mano.
    if (inTray) tabBuild.replaceChildren(h('span', { class: 'tab-sprite' }, toolIcon(tl)), tabLabel(tl.label, 'Obras'));
    else tabBuild.replaceChildren(pixelIcon('build'), tabLabel('Construir'));
    tabBuild.setAttribute('aria-label', inTray ? `Construir: ${tl.label} elegido. Cambiar` : 'Construir');
    // Ronda 21: al trazar (carretera, zonas, densidad), «Capas» y «?» se apartan: un toque en esa esquina
    // abría las capas en vez de marcar la casilla. Vuelven con «Mirar» o con otra herramienta.
    document.body.classList.toggle('tracing', tl.shape !== 'tap');
    const info = $('#tool-info');
    const locked = isLocked(tl, state);
    // Con «Mirar», la franja enseña la fecha y la demanda.
    if (locked) info.textContent = lockLong(tl, state);
    else if (tl.id === 'inspect') info.textContent = '';
    else {
      const cost = trayCost(tl) || costText(tl);
      // 2.6: y lo que costará cada mes (mantenimiento y sueldos). 2.7: como gasto y con la obra explicada.
      const month = monthlyText(tl.build, state, true);
      const spec = tl.build && tl.build !== 'road' && tl.shape === 'tap' ? BUILD[tl.build] : null;
      const why = spec && spec.workers ? ` (${money(spec.materials)} al empezar + hasta ${money(spec.workers * spec.days * WAGE_OUTSIDE)} de obreros)` : '';
      info.replaceChildren(h('b', {}, tl.label), cost ? ` · ${cost}${why}` : ': ', month ? h('span', { class: 'cc-month' }, ` · ${month}`) : '', cost ? ' · ' : '', toolHelp(tl));
    }
    selected = null;
    anchor = null;
    pendingEnd = null;
    dedicating = null;
    pendingDedication = null;
    if (pendingPlace) cancelPlace();
    showBar(false);
    closeTray();
    // 2.5: con la densidad en la mano, se ve la capa «Densidad» (si no había otra).
    if (tl.density !== undefined && layer === 'none') setLayer('density');
    // Ronda 12: una hoja abierta tapaba la barra de confirmar (no se podía ni confirmar ni cancelar).
    if (isSheetOpen() && id !== 'inspect') closeSheet();
    tutorial.update(state, tool.id);
  }

  /* ---------- inspección ---------- */
  let openInspect: (() => void) | null = null;
  /** 2.7: la fila de servicios de la casa, abierta (detalle) o en iconos. */
  let svcOpen = false;
  let inspectSheet: HTMLElement | null = null;

  function focusBuilding(id: number) {
    const b = state.buildings.find((x) => x.id === id);
    if (!b) return;
    centerOn(b.x, b.y);
    inspect({ x: b.x, y: b.y });
  }

  function inspect(tile: { x: number; y: number }) {
    selected = tile;
    const b = buildingAt(state, tile.x, tile.y);
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
    // 2.6: un servicio enseña su zona: que quepa entera sobre la hoja (en el móvil, la mitad de arriba).
    if (b && b.built && !b.damaged && hasReach(b.kind)) revealArea(serviceReach(state, b).tiles);
    else revealTile(tile);
  }

  /** Nivel del servicio, lo que da y qué pide subirlo (con «Mejorar»). */
  function levelBox(b: Building): HTMLElement {
    const lv = levelOf(b);
    const served = serviceCounts(state).get(b.id);
    const box = h('section', { class: 'level-box' }, h('h3', {}, pixelIcon('upgrade'), ` Nivel ${lv} de ${maxLevelOf(b)}`));
    const gives: string[] = [];
    if (radiusOf(b)) gives.push(`llega a ${radiusOf(b)} casillas`);
    if (serviceCapacityOf(b)) gives.push(`atiende a ${serviceCapacityOf(b)} ${b.kind === 'school' ? 'alumnos (vecinos y sus hijos)' : 'vecinos'}${served !== undefined ? ` (ahora ${served})` : ''}`);
    if (plantCapacityOf(b)) gives.push(`da ${b.kind === 'water' ? 'agua' : 'luz'} a ${plantCapacityOf(b)} edificios`);
    if (b.kind === 'police') gives.push(`${cellsOf(b)} calabozos`);
    if (b.kind === 'jail') gives.push(`${jailPlacesOf(b)} plazas`);
    if (b.kind === 'cleanpoint') gives.push(`su camión recorre ${truckRouteOf(b)} casillas de calle al día`);
    if (gives.length) box.append(h('p', { class: 'muted small' }, `Ahora ${gives.join(', ')}.`));
    if (b.upgradeUntil !== undefined) {
      box.append(h('p', {}, `Mejorando a nivel ${lv + 1}: termina el ${formatDate(tickToDate(b.upgradeUntil))}. Sigue abierto mientras tanto.`));
      return box;
    }
    if (lv >= maxLevelOf(b)) {
      box.append(h('p', { class: 'muted small' }, 'Está en su nivel más alto.'));
      return box;
    }
    const reqs = upgradeReqs(state, b, served);
    box.append(
      h('p', {}, `Para el nivel ${lv + 1} (más alcance y más capacidad; cuesta más mantenerlo):`),
      h('ul', { class: 'reqs' }, ...reqs.map((r) => h('li', { class: r.ok ? 'ok' : 'no' }, h('span', { 'aria-hidden': 'true' }, r.ok ? '✓ ' : '✗ '), r.label, h('span', { class: 'visually-hidden' }, r.ok ? ' (cumplido)' : ' (falta)')))),
    );
    // 2.7: el botón va arriba, en la cabecera de la ficha (upgradeButton).
    return box;
  }

  /** 2.7: «Ampliar a nivel N» (botón principal de la ficha); desactivado, con candado y lo que falta. */
  function upgradeButton(b: Building): HTMLElement | null {
    if (!UPGRADABLE.includes(b.kind) || b.upgradeUntil !== undefined || levelOf(b) >= maxLevelOf(b) || !b.built || b.damaged) return null;
    const served = serviceCounts(state).get(b.id);
    const ok = canUpgradeBuilding(state, b, served).ok;
    const btn = h('button', { class: 'btn primary big wide', 'data-test': 'fiche-main' }, pixelIcon('upgrade'), ` Ampliar a nivel ${levelOf(b) + 1} · ${money(upgradeCost(b))}`) as HTMLButtonElement;
    btn.disabled = !ok;
    btn.addEventListener('click', async () => {
      // 2.7: una mejora que se lleva más del 20 % de la caja se confirma (antes, 10.000 € de un toque).
      const cost = upgradeCost(b);
      if (cost > 0.2 * Math.max(0, state.treasury)) {
        const left = state.treasury - cost;
        const extra = Math.max(0, Math.round(maintenanceOf({ ...b, level: levelOf(b) + 1 }) - maintenanceOf(b)));
        const m = runwayMonths(state, left - pendingWorksCost(state), extra);
        const run = m !== null && m < 2 ? ` ⚠ Con el gasto de cada mes, la caja aguantaría ${monthsText(m)}.` : '';
        const ok2 = await confirmDialog(
          `¿Ampliar a nivel ${levelOf(b) + 1}?`,
          `Cuesta ${money(cost)} (el ${Math.round((100 * cost) / Math.max(1, state.treasury))} % de la caja): te quedarán ${money(left)}.${extra ? ` El mantenimiento sube ${money(extra)} al mes.` : ''}${run}`,
          'Ampliar',
          { safe: !run },
        );
        if (!ok2) return;
      }
      void command({ type: 'UpgradeBuilding', buildingId: b.id });
    });
    if (ok) return btn;
    const miss = upgradeReqs(state, b, served).filter((r) => !r.ok).map((r) => lowerFirst(r.label));
    return h('div', {}, btn, miss.length ? h('p', { class: 'muted small fc-why' }, `Falta: ${miss.join('; ')}.`) : '');
  }

  /** 2.7: la barra de estado de la ficha: una palabra y su número. */
  function buildingStatus(b: Building, p: GameState['projects'][number] | undefined): HTMLElement {
    if (p) {
      const pct = Math.round((100 * p.workerDaysDone) / p.workerDaysNeeded);
      return statusBar('info', 'En obra', `${pct} %`, `faltan ${plural(Math.ceil((p.workerDaysNeeded - p.workerDaysDone) / p.workersNeeded), 'día', 'días')}`);
    }
    if (b.fire) return statusBar('bad', 'Ardiendo', undefined, b.fire.covered ? 'los bomberos lo apagan' : 'sin bomberos cerca');
    if (b.damaged) return b.damaged.repairUntil >= 0 ? statusBar('warn', 'En reparación', undefined, `hasta el ${formatDate(tickToDate(b.damaged.repairUntil))}`) : statusBar('bad', b.damaged.cause === 'fuego' ? 'Quemado' : 'Destrozado', undefined, 'no funciona');
    if (b.upgradeUntil !== undefined) return statusBar('info', 'Ampliándose', `a nivel ${levelOf(b) + 1}`, 'sigue abierto');
    const needsNet = b.kind !== 'water' && b.kind !== 'power' && b.kind !== 'farm';
    if (needsNet && !b.hasWater) return statusBar('bad', 'Sin agua', b.dryDays ? plural(b.dryDays, 'día', 'días') : undefined);
    if (needsNet && !b.hasPower) return statusBar('bad', 'Sin luz', b.darkDays ? plural(b.darkDays, 'día', 'días') : undefined);
    if (b.risk) return statusBar('warn', 'Riesgo de incendio', undefined, b.risk.why);
    if (trashStateOf(b) === 'ratas') return statusBar('warn', 'Ratas', undefined, bagsText(b));
    if (b.kind === 'house' || b.kind === 'res' || b.kind === 'vpo') {
      const res = occupants(state, b);
      if (!res.length) return statusBar('info', 'Vacía', undefined, 'aún no vive nadie');
      const avg = Math.round(res.reduce((t, c) => t + c.happiness, 0) / res.length);
      const one = res.length === 1;
      const word = avg >= 65 ? (one ? 'Contento' : 'Contentos') : avg >= 40 ? 'Regular' : one ? 'Descontento' : 'Descontentos';
      const lack = missingServices(state, b.x, b.y).filter((n) => n.status === 'falta').length;
      return statusBar(avg >= 65 ? 'ok' : avg >= 40 ? 'warn' : 'bad', word, `${avg} de 100`, `${plural(res.length, 'vecino', 'vecinos')}${lack ? ` · le ${lack === 1 ? 'falta un servicio' : `faltan ${lack} servicios`}` : ''}`);
    }
    if (hasReach(b.kind)) {
      const cap = serviceReach(state, b).capacity;
      if (cap && cap.of > 0) {
        const pct = Math.round((100 * cap.used) / cap.of);
        const tone = pct > 100 ? 'bad' : cap.full || pct >= 90 ? 'warn' : 'ok';
        return statusBar(tone, pct > 100 ? 'Lleno' : tone === 'warn' ? 'Casi lleno' : 'Funciona', `${pct} %`, `${cap.used} de ${cap.of} ${cap.unit}`);
      }
    }
    if ((b.kind === 'shop' || b.kind === 'factory') && b.books) {
      const profit = b.books.sales - b.books.wages - b.books.taxes;
      return profit < 0 ? statusBar('warn', 'Pierde dinero', `−${money(-profit)}`, 'el mes pasado') : statusBar('ok', 'Funciona', `+${money(profit)}`, 'el mes pasado');
    }
    return statusBar('ok', 'Funciona');
  }

  /** 2.7: cabecera de la ficha: sprite pequeño, de quién es, estado y botón principal. */
  function inspectHead(b: Building, p: GameState['projects'][number] | undefined): HTMLElement {
    const owner = b.owner === 0 ? 'Municipal' : b.owner === -1 ? 'Privado (inversor de fuera)' : `Negocio de ${state.citizens.find((c) => c.id === b.owner)?.name ?? 'un antiguo vecino'}`;
    const lv = UPGRADABLE.includes(b.kind) ? `Nivel ${levelOf(b)} de ${maxLevelOf(b)}` : '';
    let main: HTMLElement | null = null;
    if (b.damaged && b.damaged.repairUntil < 0 && !p) {
      const fix = h('button', { class: 'btn primary big wide', 'data-test': 'fiche-main' }, pixelIcon('repair'), ` Reparar · ${money(b.damaged.cost)}`);
      fix.addEventListener('click', () => void command({ type: 'RepairBuilding', buildingId: b.id }));
      main = fix;
    } else if (!p) main = upgradeButton(b);
    if (!main && b.kind === 'heritage' && b.built) {
      const go = h('button', { class: 'btn primary big wide', id: 'heritage-tourism', 'data-test': 'fiche-main' }, pixelIcon('camera'), ' Turismo: tasa y entorno');
      go.addEventListener('click', () => withBack('Ficha', () => focusBuilding(b.id), () => openTourism(social)));
      main = go;
    }
    let pic: HTMLCanvasElement | null = null;
    try {
      pic = spriteCopy(buildingPicture(b, state));
    } catch {
      /* sin sprite: solo el texto */
    }
    return ficheHead(pic, [owner, lv], buildingStatus(b, p), main);
  }

  /** 2.6: «Da servicio a N viviendas · atiende a X de un máximo de Y» y «Ver zona». */
  function reachBox(b: Building): HTMLElement | null {
    if (!b.built || b.damaged || !hasReach(b.kind)) return null;
    const info = serviceReach(state, b);
    const line = reachLine(state, info);
    const see = h('button', { class: 'btn wide', 'data-test': 'see-zone' }, pixelIcon('layers'), ' Ver zona');
    see.addEventListener('click', () => {
      closeSheet();
      revealArea(info.tiles.length ? info.tiles : [b.y * state.map.w + b.x]);
    });
    const full = !!info.capacity?.full;
    return h(
      'section',
      { class: `reach-box${full ? ' full' : ''}`, 'data-test': 'reach-box' },
      // Ronda 22: en la bomba y la central la cifra principal ya está en su ficha de carga.
      info.mode === 'red' ? '' : h('p', { class: 'reach-main', 'data-test': 'reach-line' }, line.main),
      see,
      line.sub ? h('p', { class: 'muted small' }, `${line.sub}.`) : '',
      h('p', { class: 'reach-key small' }, h('span', { class: 'rk ok', 'aria-hidden': 'true' }, '✓'), ' con servicio  ', h('span', { class: 'rk no', 'aria-hidden': 'true' }, '✗'), ' sin él o lleno', info.mode === 'radio' ? '  · borde: su alcance' : '  · calles: su red'),
    );
  }

  /** 2.6: que una zona entera (casillas) quepa en lo que se ve, sobre la hoja `.half` o al lado del panel. */
  function revealArea(tiles: number[]) {
    if (!tiles.length) return;
    const w = state.map.w;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of tiles) {
      const x = i % w;
      const y = Math.floor(i / w);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const r = canvas.getBoundingClientRect();
    const el = currentSheet();
    let { left, right, bottom } = r;
    // Bajo la barra de arriba no se ve nada.
    const top = Math.max(r.top, document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? r.top);
    if (el) ({ left, right, bottom } = besideSheet(r, el, { left, right, bottom }));
    bottom = Math.min(bottom, $('#strip').getBoundingClientRect().top || bottom);
    const vw = (right - left) * dpr();
    const vh = (bottom - top) * dpr();
    if (vw < 40 || vh < 40) return;
    const need = Math.max((x1 - x0 + 2) * T / vw, (y1 - y0 + 2) * T / vh);
    // Se aleja lo justo para que quepa (nunca por debajo del mínimo); si ya cabe, no se acerca.
    // Ronda 22: sin bajar de un zoom en el que se lean los ✓ y ✗ (~14 px CSS por casilla); si no cabe, se centra.
    const legible = Math.max(minZoom(), Math.ceil((14 * dpr()) / T));
    const fit = Math.max(legible, Math.min(cam.zoom, Math.floor(1 / need)));
    const before = { x: cam.x, y: cam.y, zoom: cam.zoom };
    if (fit < cam.zoom) cam.zoom = fit;
    const ts = tileSize();
    cam.x = Math.round(((x0 + x1 + 1) / 2) * ts - ((left + right) / 2 - r.left) * dpr());
    cam.y = Math.round(((y0 + y1 + 1) / 2) * ts - ((top + bottom) / 2 - r.top) * dpr());
    clampCam();
    noteReveal(before);
  }

  /** 2.7: lo que queda del mapa a la vista con la hoja abierta (abajo, a la derecha o a la izquierda). */
  function besideSheet(r: DOMRect, el: HTMLElement, box: { left: number; right: number; bottom: number }) {
    const sr = el.getBoundingClientRect();
    if (sr.width >= r.width - 16) return { ...box, bottom: Math.min(box.bottom, sr.top) };
    if (sr.left <= r.left + 8) return { ...box, left: Math.max(box.left, sr.right) };
    return { ...box, right: Math.min(box.right, sr.left) };
  }

  /**
   * 2.7: al cerrar la ficha, la cámara vuelve a donde estaba antes de que revealTile/revealArea
   * la movieran (si el jugador no la ha movido después).
   */
  let camBack: { before: { x: number; y: number; zoom: number }; after: { x: number; y: number; zoom: number } } | null = null;
  const sameCam = (a: { x: number; y: number; zoom: number }, b: { x: number; y: number; zoom: number }) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;
  function noteReveal(before: { x: number; y: number; zoom: number }) {
    const after = { x: cam.x, y: cam.y, zoom: cam.zoom };
    if (!currentSheet() || sameCam(before, after)) return;
    // Si el jugador movió el mapa entre una ficha y otra, se vuelve a donde lo dejó él.
    if (!camBack || !sameCam(before, camBack.after)) camBack = { before, after };
    else camBack.after = after;
  }
  function restoreCam() {
    const back = camBack;
    camBack = null;
    if (!back || !sameCam(back.after, { x: cam.x, y: cam.y, zoom: cam.zoom })) return;
    cam.zoom = back.before.zoom;
    cam.x = back.before.x;
    cam.y = back.before.y;
    clampCam();
  }
  /** 2.7: las fichas (edificio, casilla) abren asomadas: el mapa y el edificio quedan a la vista. */
  function asFicha(el: HTMLElement): HTMLElement {
    el.classList.add('half', 'ficha');
    el.dataset.start = 'peek';
    // Si en la asomada no se llega a ver el estado y el botón principal, se abre a media altura.
    requestAnimationFrame(() => {
      if (!el.isConnected || el.dataset.snap) return;
      const main = el.querySelector('[data-test="fiche-main"]') ?? el.querySelector('[data-test="fiche-status"]');
      if (main && main.getBoundingClientRect().bottom > el.getBoundingClientRect().bottom - 4) setSheetSnap(el, 'mid');
    });
    return el;
  }

  /** 2.6: la zona que toca dibujar: la del servicio que se coloca, la del servicio tocado o la del filtro de «Qué falta». */
  function currentReach(): ReachOverlay | null {
    const blen = `${state.buildings.length}:${state.tick >> 3}:${state.month.expenses}`;
    let key = '';
    let make: () => ReachOverlay | null = () => null;
    const t = preview?.tiles[0];
    if (preview?.ok && t && tool.build && tool.shape === 'tap' && hasReach(tool.build)) {
      const kind = tool.build;
      key = `p:${kind}:${t.x},${t.y}:${blen}`;
      make = () => {
        const pl = placeLines(state, kind, t.x, t.y);
        return pl ? previewOverlay(state, pl.info, t.x, t.y) : null;
      };
    } else if (layer === 'missing' && missingKey) {
      // Ronda 22: el filtro elegido manda sobre lo último que se tocó.
      const k = missingKey;
      key = `f:${k}:${blen}`;
      make = () => filterOverlay(state, k);
    } else if (selected && tool.id === 'inspect') {
      const b = buildingAt(state, selected.x, selected.y);
      if (b && b.built && !b.damaged && hasReach(b.kind)) {
        key = `s:${b.id}:${b.level ?? 1}:${blen}`;
        make = () => overlayFor(state, serviceReach(state, b));
      }
    }
    if (key !== reachMemo.key) reachMemo = { key, overlay: key ? make() : null };
    return reachMemo.overlay;
  }

  /** 2.6: con el ratón, lo que ganaría la obra bajo el cursor (en la franja de la herramienta). */
  let hintKey = '';
  function reachHint() {
    const t = preview?.ok ? preview.tiles[0] : undefined;
    const kind = tool.build && tool.shape === 'tap' && hasReach(tool.build) ? tool.build : null;
    const key = t && kind && !pendingPlace ? `${kind}:${t.x},${t.y}:${state.buildings.length}` : '';
    if (key === hintKey) return;
    hintKey = key;
    const info = $('#tool-info');
    info.querySelector('.reach-hint')?.remove();
    if (!key || !kind || !t) return;
    const pl = placeLines(state, kind, t.x, t.y);
    if (pl) info.append(h('span', { class: 'reach-hint', 'data-test': 'reach-hint' }, h('b', { class: pl.none ? 'none' : '' }, pl.gain), ...pl.warn.map((w) => h('span', { class: 'reach-warn' }, w))));
  }

  /** Que la casilla quede a la vista, por encima (o al lado) de la hoja abierta (v1.6). */
  function revealTile(t: { x: number; y: number }) {
    const el = currentSheet();
    if (!el) return;
    const r = canvas.getBoundingClientRect();
    const { top } = r;
    const { left, right, bottom } = besideSheet(r, el, { left: r.left, right: r.right, bottom: r.bottom });
    if (bottom - top < 40 || right - left < 40) return;
    const [sx, sy] = screenOf(t.x, t.y);
    // Si queda cerca del borde (o debajo de la hoja), se centra en lo que queda a la vista.
    const mx = Math.max(2 * tileSize() / dpr(), (right - left) * 0.15);
    const my = Math.max(2 * tileSize() / dpr(), (bottom - top) * 0.15);
    if (sx > left + mx && sx < right - mx && sy > top + my && sy < bottom - my) return;
    const before = { x: cam.x, y: cam.y, zoom: cam.zoom };
    cam.x = Math.round((t.x + 0.5) * tileSize() - ((left + right) / 2 - r.left) * dpr());
    cam.y = Math.round((t.y + 0.5) * tileSize() - ((top + bottom) / 2 - r.top) * dpr());
    clampCam();
    noteReveal(before);
  }

  function renderInspect(tile: { x: number; y: number }, b: Building | undefined) {
    const prevScroll = document.querySelector('.sheet-body')?.scrollTop ?? 0;
    if (!b) {
      const z = state.map.zones[tile.y * state.map.w + tile.x];
      const tt = state.map.tiles[tile.y * state.map.w + tile.x];
      const ter = state.map.terrain?.[tile.y * state.map.w + tile.x] ?? 0;
      const dike = hasDike(state, tile.x, tile.y);
      const name =
        tt === Tile.Road
          ? ter === Terrain.River ? 'Puente' : 'Carretera'
          : dike ? 'Dique' : ter === Terrain.River ? 'Río' : ter === Terrain.Sea ? 'Mar' : tt === Tile.Tree ? 'Árboles' : ter === Terrain.Hill ? 'Colina' : 'Solar';
      if (dike) {
        asFicha(sheet(name, h('p', {}, 'Muro de piedra en la orilla: aquí y en las casillas de alrededor no llega la riada.'), h('p', { class: 'muted' }, `Casilla ${tile.x}, ${tile.y}`)));
        openInspect = null;
        inspectSheet = null;
        return;
      }
      const zone = z ? `Zona ${['', 'residencial (R)', 'comercial (C)', 'industrial (I)', 'agraria (A)'][z]}` : 'Sin zona';
      // Un solar de zona que no toca carretera no se construye nunca: se dice.
      const noRoad = zoneLotWithoutRoad(state, tile.x, tile.y)
        ? h('p', { class: 'pocket-warn', 'data-test': 'lot-no-road' }, '⚠ Falta carretera: aquí no se construirá nada hasta que pase una carretera al lado.')
        : '';
      // 2.6: y si toca carretera, por qué crece o no (agua, luz, demanda, casas libres).
      asFicha(sheet(name, h('p', {}, zone), noRoad || lotBox(state, tile.x, tile.y), h('p', { class: 'muted' }, `Casilla ${tile.x}, ${tile.y}`)));
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
        taxes: () => withBack('Gestión', () => focusBuilding(b.id), openTaxes),
        focus: (x, y) => {
          closeSheet();
          centerOn(x, y);
          inspect({ x, y });
        },
      });
      inspectSheet = currentSheet();
      return;
    }
    // 2.3: las grandes obras tienen su ficha (barra de fases, «Pagar fase N», parar y la cofinanciación).
    if (isLandmarkKind(b.kind)) {
      inspectSheet = sheet(b.name ?? BUILD_NAMES[b.kind] ?? b.kind, ...landmarkContent(state, b, command, () => inspect({ x: b.x, y: b.y })));
      asFicha(inspectSheet).classList.add('landmark-sheet');
      const body = document.querySelector('.sheet-body');
      if (body) body.scrollTop = prevScroll;
      return;
    }
    const content: (Node | string)[] = [];
    // 2.3: la fábrica de la gran empresa (y sus avisos).
    if (b.kind === 'bigfactory') content.push(...bigCompanyContent(state, command, () => inspect({ x: b.x, y: b.y })));
    // 2.2: el contrato de la obra (fuera o el primo) y «Revisar el contrato» si hay rumor.
    const contract = contractBox(state, b, command, () => inspect({ x: b.x, y: b.y }));
    if (contract) content.push(contract);
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
      // 2.1: ardiendo o en riesgo de incendio.
      if (b.fire) {
        const left = Math.max(1, b.fire.until - state.tick);
        content.push(h('div', { class: 'petition danger-box', 'data-fire': 'ardiendo' }, pixelIcon('fire'), h('p', {}, h('strong', {}, '¡Ardiendo! '), b.fire.covered ? `Los bomberos lo están apagando: unas ${left > 48 ? plural(Math.ceil(left / 24), 'día', 'días') : plural(left, 'hora', 'horas')} más.` : `No hay bomberos que lleguen: arderá unas ${left > 48 ? plural(Math.ceil(left / 24), 'día', 'días') : plural(left, 'hora', 'horas')} y quedará destrozado. Puede saltar a lo de al lado.`)));
      } else if (b.risk) {
        const covered = fireCovered(state, b);
        content.push(h('div', { class: 'petition warn-box', 'data-fire': 'riesgo' }, pixelIcon('fire'), h('p', {}, h('strong', {}, 'En riesgo de incendio '), `(${b.risk.why}). `, covered ? 'Los bomberos llegan a tiempo: si prende, solo será un susto.' : `No hay bomberos cerca: si prende, quedará destrozado. Un parque de bomberos en ${SERVICE.firestation!.radius} casillas lo evita.`)));
      }
      // v1.8: destrozado en unos disturbios (2.1: o por el fuego): no funciona hasta que se repara.
      if (b.damaged) {
        const dmg = b.damaged;
        const fire = dmg.cause === 'fuego';
        const home = b.kind === 'house' || b.kind === 'res';
        const why = fire
          ? home
            ? 'Quien vivía aquí está sin casa hasta que se repare (lo nota en su felicidad) y no entra nadie nuevo.'
            : 'No funciona ni contrata hasta repararlo. Nunca se pierde: se arregla pagando la obra.'
          : 'No vende hasta repararla, pero sigue pagando sueldos e impuestos con sus ahorros: si dos meses seguidos no llega a las nóminas, cierra.';
        const box = h('div', { class: 'petition danger-box' }, h('p', {}, h('strong', {}, fire ? 'Destrozado por el fuego. ' : 'Destrozada en unos disturbios. '), why));
        // 2.7: «Reparar» es el botón principal de la ficha (arriba).
        if (dmg.repairUntil >= 0) box.append(h('p', { class: 'muted small' }, `En reparación: reabre el ${formatDate(tickToDate(dmg.repairUntil))}.`));
        content.push(box);
      }
      // 2.6 «Lo básico»: la zona que cubre, a cuántas casas da servicio y su máximo.
      const rb = reachBox(b);
      if (rb) content.push(rb);
      const home = b.kind === 'house' || b.kind === 'res';
      // 2.7: en la casa, primero quién vive y cómo está; los servicios van después (abajo).
      if (!home) {
        const pills: HTMLElement[] = [];
        // 2.2: la finca no necesita agua ni luz: su ficha cuenta la cosecha.
        if (b.kind === 'farm') content.push(farmBox(b));
        else if (b.kind !== 'water' && b.kind !== 'power') {
          pills.push(h('span', { class: `pill ${b.hasWater ? 'good' : 'bad'}` }, b.hasWater ? 'Agua ✓' : `SIN AGUA${b.dryDays ? ` (${plural(b.dryDays, 'día', 'días')})` : ''}`));
          pills.push(h('span', { class: `pill ${b.hasPower ? 'good' : 'bad'}` }, b.hasPower ? 'Luz ✓' : `SIN LUZ${b.darkDays ? ` (${plural(b.darkDays, 'día', 'días')})` : ''}`));
        }
        // Pruebas 2.5: la cifra no llevaba rótulo; es lo que vale el local en el mercado.
        if (b.kind === 'shop' || b.kind === 'factory') pills.push(h('span', { class: 'pill', title: 'Lo que vale el local si se vende' }, `Valor: ${money(unitValue(state, b))}`));
        // 2.1: basura sin recoger.
        const dirty = trashStateOf(b);
        if (dirty !== 'limpio') pills.push(h('span', { class: 'pill bad' }, dirty === 'ratas' ? `RATAS · ${bagsText(b)}` : `Basura: ${bagsText(b)}`));
        // v1.9: las cuentas de la empresa el mes pasado (salud de las empresas).
        if ((b.kind === 'shop' || b.kind === 'factory') && b.books) {
          const k = b.books;
          const profit = k.sales - k.wages - k.taxes;
          content.push(h('p', { class: profit < 0 ? 'neg' : '' }, `El mes pasado: vendió ${money(k.sales)}, pagó ${money(k.wages)} en sueldos y ${money(k.taxes)} en impuestos → ${profit >= 0 ? `ganó ${money(profit)}` : `perdió ${money(-profit)}`}. `));
        }
        if (pills.length) content.push(h('div', { class: 'status-row' }, ...pills));
      }
      // v1.8: comisaría (calabozos) y cárcel (presos).
      if (b.kind === 'police') {
        const used = cellsUsed(state, b.id);
        content.push(h('p', {}, `Calabozos: ${used} de ${cellsOf(b)} ocupados. Cada detenido paga ${money(CRIME.finePerDay)} de multa por día.`));
        if (used >= cellsOf(b)) content.push(h('p', { class: 'pol-tag' }, jailCapacity(state) ? 'Llenos: esperan sitio en la cárcel.' : 'Llenos: hace falta una cárcel para poder detener a más.'));
      }
      if (b.kind === 'jail') content.push(h('p', {}, `Presos: ${state.justice?.jail.length ?? 0} de ${jailCapacity(state)} plazas.`));
      // 2.1: bomberos y protección civil.
      if (b.kind === 'firestation') {
        const lv = b.level ?? 1;
        const em = state.emergencies;
        content.push(h('p', {}, `Llega a ${radiusOf(b)} casillas: ahí, un incendio se apaga en ${FIRE.coveredHours[0]}–${FIRE.coveredHours[1]} horas y sin daños. ${lv >= FIRE.hillLevel ? 'Con cisterna: también en las colinas.' : 'En las colinas no llega hasta el nivel 2 (cisterna).'}${lv >= FIRE.floodLevel ? ' Ayuda en las riadas: reparaciones a la mitad en su radio.' : ''}`));
        if (em) content.push(h('p', { class: 'muted small' }, `Incendios en el pueblo: ${em.fires} · apagados a tiempo: ${em.putOut}`));
      }
      if (b.kind === 'civilprotection') {
        const vols = state.citizens.filter((c) => c.volunteer);
        content.push(h('p', {}, `En ${radiusOf(b)} casillas, las riadas un ${Math.round(CIVIL.floodCut * 100)} % menos y el quitanieves a mitad de precio. Con la caseta puedes levantar diques en la orilla (${money(CIVIL.dikeCost)} cada uno).`));
        content.push(h('p', { class: 'muted small' }, `Voluntarios: ${vols.length}${vols.length ? ` (${vols.slice(0, 4).map((c) => c.name.split(' ')[0]).join(', ')}${vols.length > 4 ? '…' : ''})` : ''} · plazas libres: ${Math.max(0, volunteerPlaces(state))} · riadas evitadas: ${state.emergencies?.floodsAvoided ?? 0}`));
      }
      // 2.1: punto limpio: por dónde pasa su camión y qué hace en cada nivel.
      if (b.kind === 'cleanpoint' && b.built) {
        const route = truckRoutes(state).find((r) => r.id === b.id)?.roads.length ?? 0;
        const served = [...trashServed(state).values()].filter((p) => p.id === b.id).length;
        content.push(h('p', {}, `El camión recorre ${route} de ${truckRouteOf(b)} casillas de calle al día y recoge la basura de ${plural(served, 'edificio', 'edificios')}. Con nieve llega a la mitad.`));
        content.push(h('p', { class: 'muted small' }, 'Solo pagan la tasa de basuras los vecinos por cuya calle pasa el camión. Mira la capa «Limpieza».'));
        if (levelOf(b) >= 2) content.push(h('p', {}, `Reciclaje: la tasa de basuras es un ${Math.round(TRASH.recyclingDiscount * 100)} % más barata para los suyos, y los ecologistas lo agradecen.`));
        if (levelOf(b) >= 3) content.push(h('p', {}, `Compostaje: vende el abono fuera (${money(TRASH.compostPerResident)} por vecino atendido al mes).`));
      }
      // 2.3: el patrimonio (su forma sale del terreno) y la casa rural.
      if (b.kind === 'heritage') {
        content.push(h('p', {}, `${HERITAGE_NAMES[heritageVariant(state, b.x, b.y)].replace(/^el /, 'El ')}: atrae visitantes. El mes pasado vinieron ${state.tourism.visitors}.${state.tourism.protectedId === b.id ? ' Su entorno está protegido.' : ''}`));
      }
      if (b.rural && (b.kind === 'house' || b.kind === 'res')) content.push(h('p', { class: 'muted small' }, 'Casa rural: su dueño alquila plazas a los visitantes.'));
      // 2.4 «Vida»: estación (billete), guardería y residencia (cuota), depuradora (el río) y renovables (la luz).
      const vida = vidaBox(state, b, command, citizenList);
      if (vida) content.push(vida);
      // 2.5: cooperativa agraria (socios, presidente y reparto) y correos (plazo de las subvenciones y buzón).
      const coopPost = coopPostBox(state, b, citizenList, () => withBack('Ficha', () => focusBuilding(b.id), openMail));
      if (coopPost) content.push(coopPost);
      // 2.5: vivienda protegida (quién vive y el alquiler) y bloques con densidad.
      const viv = viviendaBox(state, b, citizenList);
      if (viv) content.push(viv);
      // v1.8 (petición del creador): los servicios suben de nivel.
      // v1.8 (petición del creador): los servicios suben de nivel. 2.7: el detalle, plegado (el botón va arriba).
      if (UPGRADABLE.includes(b.kind)) content.push(fold(`level:${b.kind}`, `Nivel ${levelOf(b)} de ${maxLevelOf(b)}: qué da y qué pide`, false, levelBox(b)));
      // 2.6: la carga de la bomba o la central (cuántos piden y quién se queda sin).
      const plant = plantLoadBox(state, b);
      if (plant) content.push(plant);
      const res = occupants(state, b);
      const workers = state.citizens.filter((c) => c.jobId === b.id);
      if (home && res.length) {
        // Resumen de quien vive aquí antes de la lista.
        const avg = Math.round(res.reduce((t, c) => t + c.happiness, 0) / res.length);
        const inTown = res.filter((c) => c.jobId !== null).length;
        const broke = res.filter((c) => totalDebt(c) > 0).length;
        content.push(
          h('h3', {}, 'Viven aquí'),
          h('p', { class: 'muted small' }, `${plural(res.length, 'vecino', 'vecinos')} · felicidad media ${avg} · ${inTown} trabajan en el pueblo, ${res.length - inTown} fuera`),
          broke ? h('p', { class: 'pocket-warn' }, `€ ${broke === 1 ? 'Uno debe' : `${broke} deben`} dinero: ${money(res.reduce((t, c) => t + totalDebt(c), 0))} en total.`) : '',
          citizenList(res),
        );
      } else if (res.length && b.kind !== 'vpo') content.push(h('h3', {}, 'Viven aquí'), citizenList(res));
      // 2.7: los servicios de la casa, en una fila de iconos con ✓/✗ (al tocarla, el detalle).
      if (home) content.push(servicesTable(b));
      if (workers.length) content.push(fold(`workers:${b.id}`, `Trabajan aquí (${workers.length})`, workers.length <= 3, citizenList(workers)));
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
      if (b.kind === 'shop' || b.kind === 'factory') content.push(h('p', { class: 'muted' }, `Caja de la empresa: ${money(b.cash)}`));
    }
    // 2.7: cabecera → estado → acción, arriba del todo; de quién es, en la cabecera.
    content.unshift(inspectHead(b, p));
    inspectSheet = sheet(b.name ?? (b.kind === 'farm' && b.crop ? `Finca · ${CROP_TEXT[b.crop]}` : (BUILD_NAMES[b.kind] ?? b.kind)), ...content);
    asFicha(inspectSheet);
    const body = document.querySelector('.sheet-body');
    if (body) body.scrollTop = prevScroll;
  }

  /** 2.2: ficha de la finca: cultivo, mes de la cosecha y cómo viene. */
  function farmBox(b: Building): HTMLElement {
    const crop = b.crop ?? cropAt(state, b.x, b.y);
    const month = harvestMonthOf(crop);
    const d = tickToDate(state.tick);
    const done = b.harvested === d.year;
    const outlook = farmOutlook(b);
    const why = crop === 'regadio' ? 'junto al río: el agua no le falta y el tiempo le afecta poco' : crop === 'secano' ? 'depende de la lluvia; el calor le quita' : 'en la colina: depende de la lluvia; el calor le quita';
    const when = done ? `ya cosechada este año; la próxima, en ${MONTH_NAMES[month - 1]}` : d.month === month ? `este mes (${HARVEST_NAME[crop]})` : `en ${MONTH_NAMES[month - 1]} (${HARVEST_NAME[crop]})`;
    const k = b.books;
    return h(
      'div',
      { class: 'farm-box' },
      h('p', {}, h('strong', {}, 'Cultivo: '), `${CROP_TEXT[crop]}, ${why}.`),
      h('p', {}, h('strong', {}, 'Cosecha: '), `${when}.`),
      h('p', { class: 'farm-outlook' }, h('strong', {}, 'Cosecha prevista: '), h('span', { class: `pill ${outlook === 'buena' ? 'good' : outlook === 'mala' ? 'bad' : ''}` }, outlook), ` · unos ${money(expectedHarvest(b))} si fuera hoy`),
      h('p', { class: 'muted small' }, `${plural(FARM.jobs, 'empleo fijo', 'empleos fijos')} y ${FARM.seasonal} temporeros en la cosecha (${money(FARM.seasonalWage)} cada uno; primero, vecinos en paro). Solo pide carretera: ni agua ni luz. Paga IBI rústico. Caja: ${money(b.cash)}.`),
      k && k.sales > 0 ? h('p', {}, `El mes pasado vendió la cosecha: ${money(k.sales)}.`) : '',
    );
  }

  /**
   * v1.8: tabla de servicios de una vivienda (petición del creador): agua y
   * luz (con los días que lleva sin ellas), seguridad, colegio, salud, ocio y
   * tienda, cada uno con su estado. Valor de la vivienda al pie.
   */
  function servicesTable(b: Building): HTMLElement {
    const needs = new Map(missingServices(state, b.x, b.y).map((n) => [n.key, n.status] as const));
    const row = (icon: string, label: string, ok: boolean | 'warn', text: string) =>
      // Ronda 14 (aplazado): lista de definición para los lectores de pantalla («Agua: Sí»), mismo aspecto.
      // 2.7: plegada, una fila de iconos con ✓/✗ (el texto sigue ahí para el lector de pantalla).
      h(
        'div',
        { class: `svc ${ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'bad'}`, title: `${label}: ${text}` },
        pixelIcon(icon),
        h('span', { class: 'svc-mark', 'aria-hidden': 'true' }, ok === true ? '✓' : ok === 'warn' ? '!' : '✗'),
        h('dt', { class: 'svc-label' }, label),
        h('dd', { class: 'svc-state' }, text),
      );
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
      // 2.1: bomberos (en cuanto se pueden construir).
      ...(isUnlocked(state, 'firestation') || state.buildings.some((s) => s.kind === 'firestation') ? [svc('bomberos', 'fire', 'Bomberos')] : []),
      ...(trashActive(state) || state.buildings.some((s) => s.kind === 'cleanpoint') ? [trashRow(b, row)] : []),
      row('bar', 'Tienda', state.buildings.some((s) => s.kind === 'shop' && s.built && !s.damaged && Math.abs(s.x - b.x) + Math.abs(s.y - b.y) <= 6), state.buildings.some((s) => s.kind === 'shop' && s.built && !s.damaged && Math.abs(s.x - b.x) + Math.abs(s.y - b.y) <= 6) ? 'Cerca' : 'Lejos'),
    ];
    const dl = h('dl', { class: `svc-table svc-icons${svcOpen ? ' open' : ''}`, id: 'svc-table', 'aria-label': 'Servicios de la vivienda' }, ...rows);
    const bad = rows.filter((r) => !r.classList.contains('ok')).length;
    const more = h('button', { class: 'btn small svc-more', 'aria-expanded': String(svcOpen), 'aria-controls': 'svc-table' }, svcOpen ? 'Ocultar el detalle' : 'Ver el detalle');
    const toggle = () => {
      svcOpen = !svcOpen;
      dl.classList.toggle('open', svcOpen);
      more.setAttribute('aria-expanded', String(svcOpen));
      more.textContent = svcOpen ? 'Ocultar el detalle' : 'Ver el detalle';
    };
    more.addEventListener('click', toggle);
    dl.addEventListener('click', toggle);
    return h(
      'div',
      { class: 'svc-box' },
      h('h3', {}, 'Servicios', h('span', { class: `svc-count ${bad ? 'bad' : 'ok'}` }, bad ? ` · ${bad} sin cubrir del todo` : ' · todos')),
      dl,
      more,
      h('p', { class: 'muted small' }, `Valor: ${money(unitValue(state, b))} por vivienda`),
    );
  }

  /** 2.1: bolsas de basura que tiene un edificio (cada 10 unidades, una bolsa). */
  function bagsText(b: Building): string {
    const n = Math.max(1, Math.round((b.trash ?? 0) / 10));
    return plural(n, 'bolsa', 'bolsas');
  }

  /** 2.1: fila «Basura» de la tabla de servicios. */
  function trashRow(b: Building, row: (icon: string, label: string, ok: boolean | 'warn', text: string) => HTMLElement): HTMLElement {
    const st = trashStateOf(b);
    const by = trashServed(state).get(b.id);
    if (st === 'ratas') return row('rat', 'Basura', false, `Ratas: ${bagsText(b)} sin recoger`);
    if (st === 'bolsas') return row('trash', 'Basura', 'warn', `${bagsText(b)} en la calle${by ? '' : ' · no pasa el camión'}`);
    if (by) return row('trash', 'Basura', true, `Pasa el camión${levelOf(by) >= 2 ? ' · reciclaje' : ''}`);
    return row('trash', 'Basura', 'warn', 'No pasa el camión: no se le cobra la tasa');
  }

  /** Vecinos de un edificio: una fila por persona con retrato y lo esencial (v1.6). */
  function citizenList(all: GameState['citizens']) {
    const ul = h('ul', { class: 'people' });
    const list = all.filter((c) => c.named);
    const others = all.length - list.length;
    for (const c of list) {
      const worry = worriesOf(state, c)[0];
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
          h('span', { class: 'p-sub' }, `${c.age} años · ${c.owns ? (isFemaleName(c.name) ? 'propietaria' : 'propietario') : 'quiere ' + DESIRE_TEXT[c.desire]}${worry ? ` · le preocupa ${lowerFirst(worry.label)}` : ''}`),
          // v1.9: quien no llega o debe dinero, marcado.
          pocketMark(c) ? h('span', { class: 'p-sub pocket-warn' }, pocketMark(c) === '€!' ? `€ Debe ${money(totalDebt(c))}` : '€ No llega a fin de mes') : '',
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
  const social: SocialCtx = { token, state: () => state, command, pickStreet: (id, name) => startDedication(id, name) };
  // 2.4: el dilema abierto (o el último de ese vecino) para volver desde su ficha.
  const backToDilemma = (id: number) => {
    const d = [...state.dilemmas].reverse().find((x) => x.citizenIds.includes(id));
    if (d) openDilemmaSheet(dilemmaCtx, d.id);
  };
  const dilemmaCtx: DilemmaCtx = {
    state: () => state,
    command,
    reveal: (x, y) => revealTile({ x, y }),
    openCitizen: (id) => withBack('Dilema', () => backToDilemma(id), () => openCitizen(social, id)),
  };
  const openTaxes = () => openTaxesSheet(() => state, command);
  const openLoansSheet = () => openLoans(() => state, command);
  // 2.0: el % de vecinos con IA se cambia en Ajustes (con key del servidor, lo fija /admin).
  let aiShareLocked = true;
  if (state.aiMode) void api.aiMeta().then((m) => (aiShareLocked = m.serverKey)).catch(() => undefined);
  const openSettingsGame = () =>
    openSettings(
      state.aiMode && state.ai ? { share: state.ai.share, locked: aiShareLocked, set: (share) => command({ type: 'SetAiShare', share }) } : undefined,
      shareBlock(token, sessionId, () => state),
    );
  const openHappening = () => openWhatsHappening(social, (id) => withBack('Qué está pasando', openHappening, () => openCitizen(social, id)));
  const openAccounts = () => openReport(state);
  const openRegionSheet = () =>
    openRegion(state, command, (b) => {
      closeSheet();
      focusBuilding(b.id);
    }, () => withBack('Pueblo', openHub, openRegionSheet));
  const openComarcaSheet = () => openComarca({ state: () => state, command: (c) => command(c) });
  const openErrandsSheet = () => openErrands(social, (id) => withBack('Encargos del pueblo', openErrandsSheet, () => openCitizen(social, id)));
  const openPressSheet = () =>
    openPress(social, (ref) => {
      if (state.buildings.some((b) => b.id === ref)) focusBuilding(ref);
      else if (state.citizens.some((c) => c.id === ref)) withBack('El Eco de Bitópolis', openPressSheet, () => openCitizen(social, ref));
    });

  /** «Gestión del pueblo», como al tocar el ayuntamiento en el mapa. */
  function openHall() {
    const hall = state.buildings.find((b) => b.kind === 'townhall' && b.built);
    if (hall) focusBuilding(hall.id);
  }
  /** 2.5: el buzón del pueblo (hoja `.half`). */
  function openMail() {
    openMailbox({ token, state: () => state, openCitizen: (id) => openCitizen(social, id) });
  }

  /**
   * 2.7 «Pueblo 2.0»: arriba, cuatro tarjetas de resumen (Dinero, Gente,
   * Ayuntamiento y Política o Comarca); luego «Lo urgente» (hasta 3 cosas con
   * su botón) y el resto en una lista por temas. Lo frecuente (impuestos,
   * préstamos, pleno) queda a dos toques. Sigue creciendo con el pueblo (2.6).
   */
  function openHub() {
    closeTray();
    const go = (fn: () => void) => () => withBack('Pueblo', openHub, fn);
    // 2.6: el panel crece con el pueblo; lo que sale por primera vez lleva «Nuevo» hasta que se abre.
    // 2.7: como mucho dos marcas a la vez (las demás salen cuando se abran esas).
    const show = hubShown();
    let badges = 0;
    const row = (id: HubEntry | null, icon: string, title: string, fn: () => void, o: { datum?: string; name?: string; attn?: boolean } = {}) => {
      const fresh = !!id && reveal.isNew(`hub:${id}`) && badges < 2;
      if (fresh) badges++;
      return listRow({
        icon,
        title,
        ...o,
        fresh: fresh ? newBadge() : '',
        hub: id ?? undefined,
        onClick: () => {
          if (id) seenHub(id);
          fn();
        },
      });
    };
    const opt = (id: HubEntry, icon: string, title: string, fn: () => void, o: { datum?: string; name?: string; attn?: boolean } = {}) => (show[id] ? [row(id, icon, title, fn, o)] : []);

    const pop = state.citizens.length;
    const last = state.stats.at(-1);
    const net = last ? last.income - last.expenses : null;
    const happy = pop ? Math.round(state.citizens.reduce((a, c) => a + c.happiness, 0) / pop) : 0;
    const d = tickToDate(state.tick);
    const budgetOpen = state.budget.status === 'open' && state.budget.year === d.year;
    const offers = state.grants.filter((g) => g.status === 'offered').length;
    const assocs = state.associations ?? [];
    const protest = assocs.some((a) => a.protestDay >= 0);
    // 2.4: la comisión de festejos espera presupuesto.
    const fiesta = state.seasons?.current;
    const fiestaAsks = !!fiesta && fiesta.status === 'comision' && !!fiesta.asked;
    // 2.7: lo que aguanta la caja con el gasto corriente (las obras del mes no cuentan, como en la barra de arriba).
    const rw = state.treasury > 0 ? runwayMonths(state) : null;
    const runway = rw === null ? -1 : Math.floor(rw);
    const lv = townLevel(state);
    const top = lv >= TOWNHALL_LEVELS.length;
    const next = nextLevel(state);
    const canUp = canUpgradeTownhall(state).ok;
    const dilemma = state.dilemmas.find((x) => !x.resolved);

    /* --- 4 tarjetas de resumen --- */
    const moneySub = state.treasury < 0 ? 'en números rojos' : runway >= 0 && runway < 3 ? `aguanta ${runway === 0 ? 'menos de un mes' : plural(runway, 'mes', 'meses')}` : net === null ? 'aún sin cerrar un mes' : `${net >= 0 ? '+' : '−'}${money(Math.abs(net))} el último mes`;
    const moneyCard = statCard({
      icon: 'coin',
      label: 'Dinero',
      value: money(state.treasury),
      sub: moneySub,
      trend: net === null || net === 0 ? undefined : net > 0 ? 'up' : 'down',
      tone: state.treasury < 0 || (runway >= 0 && runway < 3) ? 'bad' : net !== null && net < 0 ? 'warn' : 'ok',
      name: `Dinero: ${money(state.treasury)} en caja, ${moneySub}. Ver cuentas`,
      onClick: go(openAccounts),
    });
    const prevPop = last?.population ?? pop;
    const popDiff = pop - prevPop;
    const peopleSub = `${popDiff ? `${popDiff > 0 ? '+' : '−'}${Math.abs(popDiff)} este mes · ` : ''}felicidad ${happy} (${happy >= 65 ? 'contentos' : happy >= 45 ? 'regular' : 'descontentos'})`;
    const peopleCard = statCard({
      icon: 'people',
      label: 'Gente',
      value: plural(pop, 'vecino', 'vecinos'),
      sub: peopleSub,
      trend: pop > prevPop ? 'up' : pop < prevPop ? 'down' : undefined,
      tone: pop && happy < 45 ? 'bad' : pop && happy < 60 ? 'warn' : 'ok',
      name: `Gente: ${plural(pop, 'vecino', 'vecinos')}, ${peopleSub}. Ver la lista`,
      onClick: go(openPeople),
    });
    const hallSub = top || !next ? 'el nivel más alto' : canUp ? `ya puedes ampliarlo (${money(next.cost)})` : next.pop > pop ? `nivel ${next.level}: faltan ${plural(next.pop - pop, 'vecino', 'vecinos')}` : `nivel ${next.level}: ${money(next.cost)}`;
    const hallCard = statCard({
      icon: 'townhall',
      label: 'Ayuntamiento',
      value: `Nivel ${lv}`,
      sub: hallSub,
      trend: canUp ? 'up' : undefined,
      tone: canUp ? 'ok' : 'info',
      // v1.9.1: desde aquí se llega a «Gestión del pueblo» (el ayuntamiento cuesta de encontrar en el mapa).
      name: `Nivel ${lv} · ${top ? 'Gestión del pueblo' : 'Ampliar el ayuntamiento'}: ${hallSub}`,
      onClick: go(openHall),
    });
    let fourth: HTMLElement;
    if (show.politics && politicsActive(state)) {
      const p = state.politics;
      const months = Math.max(0, Math.round(daysToElection(state) / DAYS_PER_MONTH));
      const polSub = p.mayor === 'player' ? `elecciones en ${plural(months, 'mes', 'meses')}` : 'estás en la oposición';
      fourth = statCard({
        icon: 'ballot',
        label: 'Política',
        value: `${p.approval} %`,
        sub: polSub,
        tone: p.approval < 45 ? 'bad' : p.approval < 55 ? 'warn' : 'ok',
        name: `Política: ${p.approval} % de intención de voto, ${polSub}`,
        onClick: go(() => openPolitics(social)),
      });
    } else if (show.region || show.neighbors) {
      const pending = show.neighbors ? comarcaPending(state) : 0;
      const phase = { bonanza: 'Bonanza', normal: 'Normal', crisis: 'Crisis' }[state.region.phase];
      const comSub = pending ? plural(pending, 'oferta por responder', 'ofertas por responder') : regionAttention(state) ? 'hay algo que mirar' : show.neighbors ? plural(state.comarca.towns.length, 'pueblo vecino', 'pueblos vecinos') : 'grandes obras y empresas';
      fourth = statCard({
        icon: 'map',
        label: 'Comarca',
        value: phase,
        sub: comSub,
        tone: state.region.phase === 'crisis' ? 'bad' : pending || regionAttention(state) ? 'warn' : 'ok',
        name: `Comarca: ${phase.toLowerCase()}, ${comSub}`,
        onClick: go(show.neighbors ? openComarcaSheet : openRegionSheet),
      });
    } else {
      const goals = activeObjectives(state);
      // Sin el paréntesis («Pueblo › Pleno municipal»): la tarjeta no se llama como las filas de la lista.
      const objSub = goals[0] ? lowerFirst(objectiveText(state, goals[0]).replace(/\s*\(.*\)$/, '')) : 'todos cumplidos';
      fourth = statCard({
        icon: 'medal',
        label: 'Objetivos',
        value: `${state.objectivesDone.length} de ${OBJECTIVES.length}`,
        sub: objSub,
        tone: 'info',
        name: `Objetivos: ${state.objectivesDone.length} de ${OBJECTIVES.length} cumplidos. Siguiente: ${objSub}`,
        onClick: () => document.querySelector('#hub-goals')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }),
      });
    }

    /* --- lo urgente: lo que más pide atención ahora, con su botón --- */
    const urgent: UrgentItem[] = [];
    const burning = state.buildings.find((b) => b.fire);
    if (burning) urgent.push({ icon: 'fire', tone: 'bad', text: `Arde ${(burning.name ?? BUILD_NAMES[burning.kind] ?? 'un edificio').toLowerCase()}`, action: 'Ir allí', onClick: () => focusBuilding(burning.id) });
    if (state.treasury < 0 || (runway >= 0 && runway < 3)) {
      urgent.push({ icon: 'coin', tone: 'bad', text: state.treasury < 0 ? `La caja está en números rojos (${money(state.treasury)})` : `Al ritmo del último mes, la caja aguanta ${runway === 0 ? 'menos de un mes' : plural(runway, 'mes', 'meses')}`, action: 'Ver cuentas', onClick: go(openAccounts) });
    }
    const homes = state.buildings.filter((b) => b.built && !b.damaged && (b.kind === 'house' || b.kind === 'res' || b.kind === 'vpo'));
    const dry = homes.filter((b) => !b.hasWater).length;
    const dark = homes.filter((b) => !b.hasPower).length;
    if (dry) urgent.push({ icon: 'drop', tone: 'bad', text: `${plural(dry, 'vivienda', 'viviendas')} sin agua`, action: 'Ver dónde', onClick: () => showMissing('agua') });
    if (dark) urgent.push({ icon: 'bolt', tone: 'bad', text: `${plural(dark, 'vivienda', 'viviendas')} sin luz`, action: 'Ver dónde', onClick: () => showMissing('luz') });
    // El servicio más lleno (por encima de lo que atiende): a su ficha, donde está «Ampliar».
    const counts = serviceCounts(state);
    let full: { b: Building; pct: number } | null = null;
    for (const b of state.buildings) {
      const cap = b.built && !b.damaged ? serviceCapacityOf(b) : 0;
      const used = counts.get(b.id);
      if (!cap || used === undefined) continue;
      const pct = Math.round((100 * used) / cap);
      if (pct > 100 && (!full || pct > full.pct)) full = { b, pct };
    }
    if (full) {
      const fb = full.b;
      const canMore = UPGRADABLE.includes(fb.kind) && levelOf(fb) < maxLevelOf(fb) && fb.upgradeUntil === undefined;
      urgent.push({ icon: 'upgrade', tone: 'warn', text: `${fb.name ?? BUILD_NAMES[fb.kind] ?? fb.kind}: lleno al ${full.pct} %`, action: canMore ? 'Ampliar' : 'Ver', onClick: () => focusBuilding(fb.id) });
    }
    // Lo que espera respuesta.
    if (dilemma) urgent.push({ icon: 'megaphone', tone: 'warn', text: 'Un vecino espera tu decisión', action: 'Responder', onClick: go(() => openDilemmaSheet(dilemmaCtx, dilemma.id)) });
    if (state.pleno) urgent.push({ icon: 'gavel', tone: 'warn', text: 'El pleno espera tus respuestas', action: 'Responder', onClick: go(() => openPleno(social)) });
    if (budgetOpen) urgent.push({ icon: 'clipboard', tone: 'warn', text: `Toca presentar el presupuesto de ${d.year}`, action: 'Responder', onClick: go(() => openTownHall(social, 'budget')) });
    if (offers) urgent.push({ icon: 'clipboard', tone: 'info', text: plural(offers, 'subvención espera respuesta', 'subvenciones esperan respuesta'), action: 'Responder', onClick: go(() => openTownHall(social, 'grants')) });
    if (fiestaAsks) urgent.push({ icon: 'calendar', tone: 'info', text: 'La comisión de festejos pide presupuesto', action: 'Responder', onClick: go(() => openTownHall(social, 'seasons')) });
    if (show.neighbors && comarcaPending(state)) urgent.push({ icon: 'map', tone: 'info', text: 'Un pueblo vecino espera respuesta', action: 'Responder', onClick: go(openComarcaSheet) });
    if (show.errands && state.errands?.list.some((e) => e.status === 'ofrecido')) urgent.push({ icon: 'scroll', tone: 'info', text: 'Te han hecho un encargo', action: 'Responder', onClick: go(openErrandsSheet) });
    const broken = state.buildings.filter((b) => b.damaged && b.damaged.repairUntil < 0);
    if (broken.length) urgent.push({ icon: 'repair', tone: 'warn', text: `${plural(broken.length, 'edificio destrozado', 'edificios destrozados')} sin reparar`, action: 'Ver', onClick: () => focusBuilding(broken[0]!.id) });

    /* --- la lista --- */
    const visitors = state.tourism.visitors;
    const medals = medalCount(state);
    const errandsOffered = state.errands?.list.filter((e) => e.status === 'ofrecido').length ?? 0;
    const lastEd = state.press?.editions.at(-1);
    sheet(
      'Pueblo',
      statGrid([moneyCard, peopleCard, hallCard, fourth]),
      urgentBlock(urgent),
      listGroup('Dinero', [
        row(null, 'chart', 'Parte mensual', go(openAccounts)),
        row(null, 'tax', 'Impuestos', go(openTaxes)),
        // 2.2: préstamos municipales (destaca con mucha carga o nota D). 2.6: cuando la caja va justa o ya hay uno.
        ...opt('loans', 'bank', 'Préstamos', go(openLoansSheet), { datum: `nota ${state.rating ?? 'B'}`, name: `Préstamos · nota ${state.rating ?? 'B'}`, attn: heavyLoad(state) || state.rating === 'D' }),
      ]),
      listGroup('Ayuntamiento', [
        ...opt('pleno', 'gavel', 'Pleno municipal', go(() => openPleno(social)), { datum: state.pleno ? 'en curso' : undefined, attn: !!state.pleno }),
        ...opt('budget', 'clipboard', 'Presupuesto y fiestas', go(() => openTownHall(social, fiestaAsks ? 'seasons' : undefined)), { datum: budgetOpen ? 'por aprobar' : state.budget.plan, attn: budgetOpen || offers > 0 || protest || fiestaAsks }),
        // 2.3: turismo (desde el nivel 3 o en cuanto hay visitantes). 2.7: en su propia hoja.
        ...(lv >= 3 || visitors > 0 ? [row(null, 'camera', 'Turismo', go(() => openTourism(social)), { datum: plural(visitors, 'visitante', 'visitantes'), name: `Turismo · ${plural(visitors, 'visitante', 'visitantes')}`, attn: touristified(state) })] : []),
        ...(dilemma ? [row(null, 'megaphone', 'Un asunto difícil', go(() => openDilemmaSheet(dilemmaCtx, dilemma.id)), { attn: true })] : []),
        ...opt('politics', 'ballot', 'Política y elecciones', go(() => openPolitics(social)), { datum: politicsActive(state) ? `${state.politics.approval} %` : undefined }),
        ...opt('advisor', 'speech', 'Consejero', go(() => openAdvisor(social))),
      ]),
      listGroup('Gente', [
        row(null, 'people', 'Vecinos', go(openPeople), { datum: String(pop) }),
        row(null, 'smile', 'Felicidad', go(openHappiness), { datum: `${happy} de 100` }),
        ...(state.aiMode ? [row(null, 'spark', '✦ Qué está pasando', go(openHappening), { attn: !!state.ai?.log.length })] : []),
        ...opt('diary', 'book', 'Diario del pueblo', go(() => openDiary(social))),
        ...opt('album', 'album', 'Álbum del pueblo', go(() => openAlbum(social))),
        // 2.5: el buzón (cartas de los que se fueron), con correos o si ya llegó alguna.
        ...(state.letters.length || state.buildings.some((x) => x.kind === 'post') ? [row(null, 'letter', 'Buzón', go(openMail), { datum: plural(state.letters.length, 'carta', 'cartas'), name: `Buzón · ${plural(state.letters.length, 'carta', 'cartas')}`, attn: unreadLetters(state, token) > 0 })] : []),
        // 2.3: gráficas por años y récords.
        ...opt('history', 'calendar', 'Historia', go(() => openHistory(state))),
      ]),
      // 2.3: la comarca (bonanza o crisis), la gran empresa y las grandes obras. 2.5: los pueblos vecinos.
      listGroup('Comarca', [
        ...opt('region', 'map', 'Comarca y grandes obras', go(openRegionSheet), { datum: { bonanza: 'bonanza', normal: 'normal', crisis: 'crisis' }[state.region.phase], attn: regionAttention(state) }),
        ...opt('neighbors', 'town', 'Pueblos vecinos', go(openComarcaSheet), { datum: comarcaPending(state) ? `${comarcaPending(state)} por responder` : undefined, attn: comarcaPending(state) > 0 }),
      ]),
      // 2.1: encargos del pueblo y El Eco de Bitópolis (2.6: cuando llega el primero).
      listGroup('Encargos y El Eco', [
        ...opt('errands', 'scroll', 'Encargos del pueblo', go(openErrandsSheet), { datum: errandsOffered ? `${errandsOffered} por responder` : undefined, attn: errandsOffered > 0 }),
        ...opt('press', 'news', 'El Eco de Bitópolis', go(openPressSheet), { attn: !!lastEd && !lastEd.answered }),
      ]),
      h(
        'section',
        { class: 'hub-sec', id: 'hub-goals' },
        h('h3', { class: 'hub-sec-h' }, 'Objetivos'),
        // 2.1: el rango y el escudo del pueblo (2.6: tras el primer mes).
        ...(show.rank ? [hubRank(badges < 2 && reveal.isNew('hub:rank') ? (badges++, true) : false)] : []),
        objectivesNode(state),
        // 2.3: medallas (logros del pueblo, también los encargos).
        show.medals ? h('div', { class: 'hub-grid hub-list' }, row('medals', 'medal', 'Medallas', go(() => openMedals(state)), { datum: `${medals.have} de ${medals.total}`, name: `Medallas · ${medals.have} de ${medals.total}` })) : '',
      ),
      state.aiMode
        ? listGroup('IA', [row(null, 'coin', 'Gasto de la IA', () => void openUsage(token)), row(null, 'spark', 'Qué se envía a la IA', () => void openPreview(token))])
        : '',
      listGroup('Partida', [
        row(null, 'gear', 'Ajustes', go(openSettingsGame)),
        row(null, 'replay', 'Repetir tutorial', () => {
          closeSheet();
          tutorial.start(state, true);
        }),
        row(null, 'door', 'Volver al inicio', () => {
          closeSheet();
          exit();
        }),
      ]),
    );
  }
  /** 2.7: «Ver dónde»: el mapa con «Qué falta» filtrado a ese servicio (casas sin él). */
  function showMissing(k: NeedKey) {
    closeSheet();
    setLayer('missing');
    missingKey = k;
    selected = null;
    missingLegend();
    const lack = filterOverlay(state, k).marks.map((m) => m.y * state.map.w + m.x);
    if (lack.length) revealArea(lack);
  }
  /** 2.6: qué entradas del panel se ven (lo que pide el pueblo ahora y lo que ya salió alguna vez). */
  function hubShown(): Record<HubEntry, boolean> {
    refreshReveal();
    const keys = Object.keys(hubWants(state)) as HubEntry[];
    // En «Pueblo sencillo» no vuelve lo que apaga, aunque se viera antes. Con «Enseñar todo» (Ajustes), todo lo demás.
    const off: HubEntry[] = state.simple ? ['neighbors', 'errands', 'press'] : [];
    const all = prefs().fullHub;
    return Object.fromEntries(keys.map((k) => [k, !off.includes(k) && (all || reveal.shown(`hub:${k}`))])) as Record<HubEntry, boolean>;
  }
  function seenHub(id: HubEntry) {
    reveal.seen(`hub:${id}`);
    refreshNewDots();
  }
  /** El rango y el escudo (2.6: con «Nuevo» la primera vez). */
  function hubRank(badge: boolean) {
    const card = rankCard(state, go(() => openRank(state)));
    const btn = card.querySelector<HTMLElement>('.rank-card')!;
    if (badge) {
      btn.classList.add('is-new');
      btn.setAttribute('aria-describedby', 'new-desc');
      btn.append(newBadge());
    }
    btn.addEventListener('click', () => seenHub('rank'));
    return card;
    function go(fn: () => void) {
      return () => withBack('Pueblo', openHub, fn);
    }
  }
  // La pestaña «Pueblo» se marca mientras su panel (o una hoja abierta desde él) está a la vista.
  onSheetChange((title) => {
    $('#menu').setAttribute('aria-expanded', String(title === 'Pueblo'));
    // 2.7: al cerrar la ficha, el mapa vuelve a donde estaba.
    if (title === null) restoreCam();
  });
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
      const worry = worriesOf(state, c)[0];
      const btn = h('button', { class: 'person-row' }, portraitCanvas(c.id, 2, 'mini-portrait'), h('span', {}, h('span', { class: 'p-name' }, c.name), h('span', { class: 'p-sub' }, worry ? `le preocupa ${lowerFirst(worry.label)}` : 'sin quejas concretas')), h('span', { class: `p-mood ${c.happiness < 40 ? 'bad' : ''}` }, String(Math.round(c.happiness))));
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

  /**
   * 2.7: de una referencia guardable (la de los avisos y de «Te piden») a lo que abre.
   * Si lo que señalaba ya no existe, nada (la campana lo enseña sin botón).
   */
  function goTo(ref: string): (() => void) | undefined {
    const at = ref.indexOf(':');
    const k = at < 0 ? ref : ref.slice(0, at);
    const arg = at < 0 ? '' : ref.slice(at + 1);
    const id = Number(arg);
    const hub = (fn: () => void) => () => withBack('Pueblo', openHub, fn);
    switch (k) {
      case 'b':
        return state.buildings.some((b) => b.id === id) ? () => focusBuilding(id) : undefined;
      case 'c':
        return state.citizens.some((c) => c.id === id) ? () => openCitizen(social, id) : undefined;
      case 'at': {
        const [x, y] = arg.split(',').map(Number);
        return Number.isFinite(x) && Number.isFinite(y) ? () => centerOn(x!, y!) : undefined;
      }
      case 'th':
        return ['budget', 'festival', 'seasons', 'grants', 'associations', 'tourism'].includes(arg) ? () => openTownHall(social, arg as 'grants') : () => openTownHall(social);
      case 'dilemma':
        return state.dilemmas.some((d) => d.id === id && !d.resolved) ? () => openDilemmaSheet(dilemmaCtx, id) : undefined;
      case 'debtors':
        return () => openNeighbours(state, (c) => withBack('Vecinos', () => openNeighbours(state, () => {}, true), () => openCitizen(social, c.id)), true);
      case 'accounts':
        return openAccounts;
      case 'rank':
        return hub(() => openRank(state));
      case 'politics':
        return () => openPolitics(social);
      case 'happening':
        return openHappening;
      case 'tray':
        return () => openTray();
      case 'mail':
        return hub(openMail);
      case 'comarca':
        return hub(openComarcaSheet);
      case 'region':
        return hub(openRegionSheet);
      case 'errands':
        return hub(openErrandsSheet);
      case 'press':
        return hub(openPressSheet);
      default:
        return undefined;
    }
  }

  /** 2.7: lo que se repite en una semana va junto en «Ha pasado» («3 robos esta semana»). */
  const LOG_GROUPS: [RegExp, string, string][] = [
    [/^(Roban en|Intentan robar|Entran a robar)/, 'robo', 'robos'],
    [/se muda al pueblo|^Llegan \d+ vecinos|vuelve al pueblo|^¡Llega un bebé/, 'llegada', 'llegadas'],
    [/se va del pueblo|^Un vecino se va|vecinos se van/, 'despedida', 'despedidas'],
    [/^Terminada la obra|obras terminadas/, 'obra terminada', 'obras terminadas'],
    [/^(Nieva|Ola de calor|Tormenta sobre|El río crece)/, 'aviso del tiempo', 'avisos del tiempo'],
    [/^Riesgo de incendio/, 'riesgo de incendio', 'riesgos de incendio'],
    [/^(Desahucian|El banco se queda)/, 'desahucio o embargo', 'desahucios y embargos'],
  ];
  /** El número de la campana: lo que te piden más lo importante sin mirar. */
  let asksNow: Ask[] = [];
  let bellKey = '';
  let unreadNow = 0;
  function paintBell(unread = unreadNow) {
    unreadNow = unread;
    const asks = asksNow.length;
    const n = asks + unread;
    const key = `${asks}|${unread}`;
    if (key === bellKey) return;
    bellKey = key;
    bellBadge.hidden = n === 0;
    bellBadge.textContent = n > 9 ? '9+' : String(n);
    bellBadge.classList.toggle('asks', asks > 0);
    $('#bell').setAttribute('aria-label', n ? `Avisos: ${n} sin leer${asks ? ` (${asks === 1 ? '1 te pide respuesta' : `${asks} te piden respuesta`})` : ''}` : 'Avisos');
  }
  let asksDay = -1;
  /** Una vez por hora de juego (o al responder): «Te piden» sale del estado. */
  function refreshAsks(force = false) {
    if (!force && state.tick === asksDay) return;
    asksDay = state.tick;
    asksNow = pendingAsks(state);
    paintBell();
  }

  /** Una fila de «Te piden»: qué, plazo y botón. */
  function askRow(a: Ask, back: () => void): HTMLElement {
    const fn = goTo(a.go);
    const due = dueText(state.tick, a.due);
    const btn = h('button', { class: 'btn primary ask-go' }, a.action);
    if (fn) btn.addEventListener('click', () => withBack('Avisos', back, fn));
    else btn.setAttribute('aria-disabled', 'true');
    return h(
      'li',
      { class: 'ask-card', 'data-ask': a.key },
      h('p', { class: 'ask-text' }, a.text),
      due ? h('p', { class: `ask-due${dueSoon(state.tick, a.due) ? ' soon' : ''}` }, `⏳ ${due}`) : '',
      btn,
    );
  }

  /** La campana 2.0: «Te piden» (lo que espera respuesta) y «Ha pasado» (agrupado). */
  function openLog(tab?: 'asks' | 'past') {
    markLogRead();
    refreshAsks(true);
    const asks = asksNow;
    const pick = tab ?? (asks.length ? 'asks' : 'past');
    const icon = { info: 'ℹ', warn: '⚠', good: '✔' };
    const back = () => openLog(pick);
    // «Ha pasado»: lo más nuevo arriba; lo que se repite en la misma semana, junto.
    const items = toastLog();
    const week = (t?: number) => (t === undefined ? -1 : Math.floor(t / (7 * TICKS_PER_DAY)));
    const nowWeek = week(state.tick);
    const groups = new Map<string, { label: [string, string]; list: LogEntry[] }>();
    const order: (LogEntry | string)[] = [];
    for (const e of items) {
      const g = LOG_GROUPS.find(([re]) => re.test(e.text));
      if (!g || e.tick === undefined) {
        order.push(e);
        continue;
      }
      const key = `${g[1]}|${week(e.tick)}`;
      const have = groups.get(key);
      if (have) have.list.push(e);
      else {
        groups.set(key, { label: [g[1], g[2]], list: [e] });
        order.push(key);
      }
    }
    const row = (e: LogEntry) => {
      const fn = entryAction(e);
      const btn = h('button', { class: 'log-item', ...(fn ? { 'data-go': '1' } : {}) }, h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon[e.kind]), h('span', {}, e.text, ' ', h('span', { class: 'when' }, e.when)));
      if (fn) btn.addEventListener('click', () => withBack('Avisos', back, fn));
      else btn.setAttribute('tabindex', '-1');
      return h('li', { class: e.kind }, btn);
    };
    const ul = h('ul', { class: 'log' });
    for (const o of order) {
      if (typeof o !== 'string') {
        ul.append(row(o));
        continue;
      }
      const g = groups.get(o)!;
      if (g.list.length === 1) {
        ul.append(row(g.list[0]!));
        continue;
      }
      const w = week(g.list[0]!.tick);
      const when = w === nowWeek ? 'esta semana' : w === nowWeek - 1 ? 'la semana pasada' : `la semana del ${g.list.at(-1)!.when}`;
      const kind = g.list.some((e) => e.kind === 'warn') ? 'warn' : g.list[0]!.kind;
      ul.append(
        h(
          'li',
          { class: `${kind} log-group` },
          h('details', {}, h('summary', { class: 'log-sum' }, h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon[kind]), `${g.list.length} ${g.label[1]} ${when}`), h('ul', { class: 'log' }, ...g.list.map(row))),
        ),
      );
    }
    const askList = h('ul', { class: 'asks' }, ...asks.map((a) => askRow(a, back)));
    const panelAsks = h('div', { id: 'log-asks', role: 'tabpanel', 'aria-labelledby': 'log-tab-asks' }, asks.length ? askList : h('p', { class: 'muted' }, 'Nadie espera respuesta ahora mismo.'));
    const panelPast = h('div', { id: 'log-past', role: 'tabpanel', 'aria-labelledby': 'log-tab-past' }, items.length ? ul : h('p', { class: 'muted' }, 'Sin avisos todavía.'));
    const tabAsks = h('button', { id: 'log-tab-asks', class: 'log-tab', role: 'tab', 'aria-controls': 'log-asks' }, 'Te piden', asks.length ? h('span', { class: 'log-tab-n' }, String(asks.length)) : '');
    const tabPast = h('button', { id: 'log-tab-past', class: 'log-tab', role: 'tab', 'aria-controls': 'log-past' }, 'Ha pasado');
    const show = (t: 'asks' | 'past') => {
      tabAsks.setAttribute('aria-selected', String(t === 'asks'));
      tabPast.setAttribute('aria-selected', String(t === 'past'));
      tabAsks.tabIndex = t === 'asks' ? 0 : -1;
      tabPast.tabIndex = t === 'past' ? 0 : -1;
      panelAsks.hidden = t !== 'asks';
      panelPast.hidden = t !== 'past';
    };
    tabAsks.addEventListener('click', () => show('asks'));
    tabPast.addEventListener('click', () => show('past'));
    const tabs = h('div', { class: 'log-tabs', role: 'tablist', 'aria-label': 'Avisos' }, tabAsks, tabPast);
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = tabAsks.getAttribute('aria-selected') === 'true' ? 'past' : 'asks';
      show(next);
      (next === 'asks' ? tabAsks : tabPast).focus();
    });
    show(pick);
    sheet('Avisos', tabs, panelAsks, panelPast);
  }
  const bellBadge = document.querySelector<HTMLElement>('#bell .bell-n')!;
  $('#bell').prepend(pixelIcon('bell'));
  onToastLog(
    (n) => paintBell(n),
    () => openLog('past'),
    () => shortDate(tickToDate(state.tick)),
    { token, tick: () => state.tick, resolve: goTo },
  );
  refreshAsks(true);

  /** Capas: el chip dice cuál está puesta; al tocarlo se elige de una lista (antes, se cambiaba a ciegas). */
  function setLayer(id: LayerId) {
    layer = id;
    if (id !== 'missing') missingKey = null;
    const def = LAYERS.find((l) => l.id === layer)!;
    const legend = $('#legend');
    legend.hidden = layer === 'none';
    // v1.9.1: con poca altura (móvil en horizontal) empieza plegada: si no, tapa medio mapa.
    // 2.7: en el móvil, todas las capas: un chip de una línea abajo a la izquierda; se despliega al tocarlo.
    if (matchMedia('(max-height: 500px), (max-width: 719px)').matches) legendFolded = true;
    if (layer === 'missing') missingLegend();
    else if (layer !== 'none') plainLegend(def);
    const chip = $('#layers');
    // Ronda 21: con leyenda, en el móvil el chip se queda en su icono (la leyenda ya dice qué capa es).
    document.body.classList.toggle('layer-on', layer !== 'none');
    chip.querySelector('.chip-text')!.textContent = layer === 'none' ? 'Capas' : def.label;
    chip.setAttribute('aria-label', `Capas de datos: ${def.label}. Cambiar`);
    chip.setAttribute('aria-pressed', String(layer !== 'none'));
    $('#sr-live').textContent = layer === 'none' ? 'Capas desactivadas' : `Capa activa: ${def.label}`;
  }
  /** Leyenda de «Qué falta»: cuántas viviendas (y solares R) carecen de cada servicio. */
  let legendDay = -1;
  /** 2.6: último día en que se miró la carga de las redes. */
  let lastNetDay = -1;
  let legendFolded = false;
  /** 2.7: leyenda de una capa de colores: cabecera que se pliega (un chip de una línea) y sus colores. */
  function plainLegend(def: (typeof LAYERS)[number]) {
    const legend = $('#legend');
    legend.classList.remove('filtered');
    legend.classList.toggle('folded', legendFolded);
    const head = h(
      'button',
      { class: 'legend-head', 'aria-expanded': String(!legendFolded), 'aria-label': `Leyenda: ${def.label}. ${legendFolded ? 'Desplegar' : 'Plegar'}` },
      h('strong', {}, def.label),
      h('span', { class: 'legend-chev', 'aria-hidden': 'true' }, legendFolded ? '▸' : '▾'),
    );
    head.addEventListener('click', () => {
      legendFolded = !legendFolded;
      plainLegend(def);
      legend.querySelector<HTMLElement>('.legend-head')?.focus();
    });
    legend.replaceChildren(head, ...def.legend.map((x) => h('span', { class: `legend-item ${x.cls}` }, x.text)));
  }
  function missingLegend() {
    legendDay = Math.floor(state.tick / 24);
    // Ronda 13: ordenada por lo que más falta, con «Construir» al lado; plegable para ver el mapa.
    const sum = coverageSummary(state).sort((a, b) => b.falta - a.falta || b.lleno - a.lleno);
    const nameOf = (k: NeedKey) => `${NEED_LABEL[k][0]!.toUpperCase()}${NEED_LABEL[k].slice(1)}`;
    const countOf = (r: { falta: number; lleno: number }) => (r.falta ? `falta en ${plural(r.falta, 'casa', 'casas')}` : `lleno en ${plural(r.lleno, 'casa', 'casas')}`);
    const goBtn = (k: NeedKey) => {
      const go = h('button', { class: 'legend-go', 'aria-label': `Construir: ${NEED_LABEL[k]}` }, pixelIcon('build'), h('span', { class: 'legend-go-text' }, 'Construir'));
      // 2.6: «Construir» deja el filtro puesto (se ve dónde falta mientras se elige el sitio).
      go.addEventListener('click', () => selectTool(TOOL_FOR_NEED[k] as ToolId));
      return go;
    };
    const legend = $('#legend');
    // 2.6: con un servicio elegido, la leyenda se pliega a una línea: «[icono] Policía · falta en 24 casas · [Construir] [✕]».
    if (missingKey) {
      const k = missingKey;
      const r = sum.find((x) => x.key === k) ?? { key: k, falta: 0, lleno: 0 };
      const off = h('button', { class: 'legend-off', 'aria-label': `Quitar el filtro: ${NEED_LABEL[k]}`, 'data-test': 'legend-off' }, '✕');
      off.addEventListener('click', () => {
        missingKey = null;
        missingLegend();
      });
      const pick = h(
        'button',
        { class: 'legend-pick', 'aria-pressed': 'true', 'aria-label': `${nameOf(k)}: ${countOf(r)}. Quitar el filtro`, 'data-need': k },
        pixelIcon(NEED_ICON[k]),
        h('span', { class: 'legend-text' }, h('strong', {}, nameOf(k)), ` · ${r.falta || r.lleno ? countOf(r) : 'no falta en ninguna casa'}${r.falta && r.lleno ? ` (lleno en ${r.lleno})` : ''}`),
      );
      pick.addEventListener('click', () => off.click());
      legend.classList.add('folded', 'filtered');
      legend.replaceChildren(
        h(
          'span',
          { class: 'legend-filter', 'data-test': 'legend-filter' },
          pick,
          goBtn(k),
          off,
        ),
      );
      return;
    }
    legend.classList.remove('filtered');
    const rows = sum.map((r) => {
      // 2.6: cada fila es un botón: filtra el mapa a ese servicio (casas sin él y la zona que cubren).
      const pick = h('button', { class: 'legend-pick', 'aria-pressed': 'false', 'aria-label': `Ver en el mapa dónde falta ${NEED_LABEL[r.key]}`, 'data-need': r.key }, pixelIcon(NEED_ICON[r.key]), h('span', { class: 'legend-text' }, `${nameOf(r.key)}: ${countOf(r)}`));
      pick.addEventListener('click', () => {
        missingKey = r.key;
        selected = null;
        missingLegend();
        // Ronda 22: el mapa va a las casas a las que les falta (si no se ven).
        const lack = filterOverlay(state, r.key).marks.map((m) => m.y * state.map.w + m.x);
        if (lack.length) revealArea(lack);
        $('#sr-live').textContent = `Qué falta: ${NEED_LABEL[r.key]}. ${countOf(r)}.`;
      });
      return h('span', { class: 'legend-need' }, pick, goBtn(r.key));
    });
    // 2.7: plegada es un chip de una línea: «Qué falta · 5 ▸» (cuántos servicios faltan en alguna casa).
    const lacking = sum.filter((r) => r.falta > 0).length;
    const more = legendFolded && lacking ? h('span', { class: 'legend-more' }, ` · ${lacking}`) : '';
    const head = h(
      'button',
      { class: 'legend-head', 'aria-expanded': String(!legendFolded), 'aria-label': `Qué falta${lacking ? `: ${plural(lacking, 'servicio', 'servicios')}` : ''}. ${legendFolded ? 'Desplegar' : 'Plegar'}` },
      h('strong', {}, 'Qué falta'),
      more,
      h('span', { class: 'legend-chev', 'aria-hidden': 'true' }, legendFolded ? '▸' : '▾'),
    );
    head.addEventListener('click', () => {
      legendFolded = !legendFolded;
      missingLegend();
      $('#legend').querySelector<HTMLElement>('.legend-head')?.focus();
    });
    legend.classList.toggle('folded', legendFolded);
    legend.replaceChildren(
      head,
      // 2.7: plegada, el CSS solo enseña la cabecera (las filas siguen ahí para el lector de pantalla al desplegar).
      ...(rows.length ? rows : legendFolded ? [] : [h('span', {}, 'A ninguna vivienda le falta nada.')]),
      ...(legendFolded ? [] : [h('span', { class: 'legend-note' }, 'Toca un servicio para ver qué casas son y la zona que cubre. Marco rojo: falta. Amarillo a trazos: llega, pero está lleno.')]),
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
    // 2.7: hoja compacta (dos columnas, sin texto largo): el pueblo sigue a la vista mientras se elige.
    const el = sheet('Capas de datos', h('p', { class: 'muted small' }, 'Colorean el mapa. La leyenda sale abajo a la izquierda.'), list);
    el.classList.add('half', 'layers-sheet');
  }
  $('#layers').prepend(pixelIcon('layers'));

  /** Qué es R, C, I (o qué falta para las zonas): al tocar la franja. */
  function openDemand() {
    const unlocked = zonesUnlocked(state);
    const { R, C, I } = state.demand;
    const noRoad = zonesWithoutRoad(state);
    const line = (k: string, name: string, v: number, hint: string) => h('li', {}, h('span', {}, h('strong', {}, `${k} · ${name}`), h('span', { class: 'p-sub' }, hint)), h('span', {}, v > 0 ? `+${v}` : String(v)));
    /** El texto sale del signo de la demanda (positivo = falta); por encima de 15 se construye. */
    const hint = (k: 'R' | 'C' | 'I', v: number, falta: string, poco: string, sobra: string) => {
      const n = noRoad[k];
      if (v > 15 && n > 0) return `Tienes zona ${k} sin carretera (${n} ${n === 1 ? 'casilla' : 'casillas'}): ponle una carretera al lado o pinta zona ${k} junto a una.`;
      return v > 15 ? falta : v > 0 ? poco : sobra;
    };
    sheet(
      'Qué pide el pueblo',
      h('p', {}, `Hoy es ${formatDate(tickToDate(state.tick))}.`),
      unlocked
        ? h(
            'ul',
            { class: 'accounts demand-list' },
            line('R', 'viviendas', R, hint('R', R, 'Falta sitio para vivir: pinta zona R.', 'Falta poco sitio para vivir: aún no hace falta más zona R.', 'Hay casas de sobra.')),
            line('C', 'tiendas', C, hint('C', C, 'Quieren comprar cerca: pinta zona C.', 'Quieren alguna tienda más, pero aún no hace falta más zona C.', 'Hay tiendas de sobra.')),
            line('I', 'empleo e industria', I, hint('I', I, 'Hay gente sin trabajo: pinta zona I (lejos de las casas).', 'Falta algo de empleo, pero aún no hace falta más zona I.', 'Hay empleo de sobra.')),
          )
        : h('p', {}, `Las zonas R (viviendas), C (tiendas) e I (industria) llegan con el ayuntamiento de nivel 2: pide ${TOWNHALL_LEVELS[1]!.pop} vecinos (ahora hay ${state.citizens.length}) y ${money(TOWNHALL_LEVELS[1]!.cost)}. Toca el ayuntamiento para ampliarlo.`),
      h('p', { class: 'muted small' }, 'Cuanto más alta la barra, más falta hace. Si está en negativo, sobra.'),
      // 2.6: por qué no crecen los solares y de qué sale cada número.
      ...(unlocked ? (['R', 'C', 'I'] as const).flatMap((z) => demandExtra(state, z)) : demandExtra(state, 'R')),
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

  /** 2.7: el aviso de x10 sale una vez por sesión (antes, cada vez que se ponía). */
  let x10Warned = false;
  function setSpeed(s: number) {
    if (lost && s > 0) return;
    // Modo tranquilo: como mucho x1.
    if (prefs().calm && s > 1) {
      toast('Modo tranquilo: la velocidad máxima es x1 (Ajustes).', { kind: 'info' });
      s = 1;
    }
    if (s === 10 && speed !== 10 && !x10Warned) {
      x10Warned = true;
      toast(
        state.aiMode
          ? 'x10 con la IA activa: gasta más por hora y muchas decisiones no llegarán a tiempo (las tomarán las reglas).'
          : 'x10 avanza un mes cada minuto: vigila la caja.',
        { kind: state.aiMode ? 'warn' : 'info' },
      );
    }
    speed = s;
    setFastToasts(s >= 10);
    // Otra velocidad (no la x1 del suceso): la nota «Bajo a x1…» ya no hace falta.
    if (s !== 1) hideSlowNote();
    syncTurnPace(s);
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
    sp.dataset.speed = String(lastSpeed);
    // Mientras el reloj espera a la IA, el botón lo dice (paintThinking).
    if (sp.dataset.waiting === 'true') return;
    sp.textContent = `x${lastSpeed}`;
    sp.setAttribute('aria-label', `Velocidad x${lastSpeed}. Toca para cambiarla`);
  }

  /**
   * 2.7: «Hoy en Bitópolis»: el juego espera en pausa con la tarjeta abierta y
   * «▶ Seguir» lo pone a la velocidad guardada (al volver se sabe si está en marcha).
   */
  function showHoy(since: AwaySince) {
    if (speed > 0) setSpeed(0);
    refreshAsks(true);
    const go = savedSpeed() || lastSpeed || 1;
    openHoy(state, since, asksNow, {
      speed: go,
      go: goTo,
      openCitizen: (id) => openCitizen(social, id),
      resume: () => userSpeed(go),
      closed: () => rememberSeen(token, state),
    });
    $('#sr-live').textContent = 'Hoy en Bitópolis. El juego espera en pausa.';
  }
  const onVisibility = () => {
    if (document.hidden) {
      rememberSeen(token, state);
      setSpeed(0);
      send({ type: 'flush' });
    } else if (!lost && !isHoyOpen()) {
      // 2.7: tras un buen rato fuera, «Hoy en Bitópolis» (en pausa) en vez de seguir sin más.
      const away = speed === 0 && !tutorial.active ? resumeSummary(token, state) : null;
      if (away && hoyHasNews(state, away, pendingAsks(state))) {
        if (isSheetOpen()) closeSheet();
        showHoy(away);
      } else if (speed === 0 && !isSheetOpen() && savedSpeed() > 0) {
        // Al volver a la pestaña, sigue como lo dejó el jugador.
        setSpeed(savedSpeed());
      }
    }
  };
  const onPageHide = () => {
    rememberSeen(token, state);
    if (!saveOnHide()) void api.release(token, sessionId);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  const heartbeat = setInterval(() => {
    if (document.hidden || lost) return;
    send({ type: 'flush' });
    // 2.7: la última visita se apunta mientras se juega (para que «Hoy» no salga a destiempo).
    rememberSeen(token, state);
  }, 30_000);

  // Atrás sin hojas abiertas: pausa y pregunta antes de salir de la partida (ronda 10).
  history.pushState({ ...(history.state ?? {}), game: true }, '');
  async function onBack(e: PopStateEvent) {
    if ((e.state as { game?: boolean } | null)?.game) return; // cerró una hoja: lo hace ui.ts
    // 2.7: con «Hoy en Bitópolis» abierta, atrás la cierra (no pregunta si salir).
    if (isHoyOpen()) {
      closeHoy();
      history.pushState({ game: true }, '');
      return;
    }
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
    closeHoy();
    rememberSeen(token, state);
    stopMusic();
    offPrefs();
    setSpeed(0);
    send({ type: 'flush' });
    setTimeout(() => {
      void whenSaved().then(() => {
        worker.terminate();
        clearInterval(heartbeat);
        clearInterval(decisionTimer);
        clearInterval(turnTimer);
        clearInterval(neighborTimer);
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
  // 2.7: «⌂» vuelve al ayuntamiento (el centro del pueblo) desde donde sea.
  $('#home').onclick = () => {
    const hall = hallSpot();
    if (!hall) return;
    if (cam.zoom < touchZoom()) setZoom(touchZoom());
    if (reducedMotion()) centerOn(hall.x, hall.y);
    else glide({ x: cam.x, y: cam.y }, () => { centerOn(hall.x, hall.y); return { x: cam.x, y: cam.y }; }, () => undefined);
    highlight = { x: hall.x, y: hall.y, since: performance.now() };
  };
  $('#hud-pop').onclick = () => withBack('Pueblo', openHub, openPeople);
  $('#hud-happy').onclick = () => withBack('Pueblo', openHub, openHappiness);
  $('#bell').onclick = () => openLog();
  $('#strip-info').onclick = openDemand;
  // Ronda 21: la ayuda de la franja se corta a dos líneas; al tocarla se lee entera (y otro toque la recoge).
  const toolInfo = $('#tool-info');
  const markClamp = () => {
    const cut = !toolInfo.classList.contains('open') && toolInfo.scrollHeight > toolInfo.clientHeight + 1;
    toolInfo.classList.toggle('more', cut);
    if (cut || toolInfo.classList.contains('open')) {
      toolInfo.setAttribute('aria-expanded', String(toolInfo.classList.contains('open')));
      toolInfo.setAttribute('role', 'button');
      toolInfo.tabIndex = 0;
    } else {
      for (const a of ['aria-expanded', 'role', 'tabindex']) toolInfo.removeAttribute(a);
    }
  };
  toolInfo.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && toolInfo.getAttribute('role') === 'button') {
      e.preventDefault();
      e.stopPropagation();
      toolInfo.click();
    }
  });
  toolInfo.addEventListener('click', () => {
    if (!toolInfo.classList.contains('open') && !toolInfo.classList.contains('more')) return;
    toolInfo.classList.toggle('open');
    markClamp();
  });
  new MutationObserver(() => {
    toolInfo.classList.remove('open');
    requestAnimationFrame(markClamp);
  }).observe(toolInfo, { childList: true, characterData: true, subtree: true });
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
    /** Casilla que destella ahora (o null). */
    get highlight() {
      return highlight ? { x: highlight.x, y: highlight.y } : null;
    },
    /** 2.4: viajes del autobús que han empezado en el mapa. */
    get busTrips() {
      return busTrips;
    },
    /** 2.6: la zona que se dibuja ahora (resumen para las pruebas): cuántas casillas, marcas y si hay velo. */
    get reach() {
      const o = reachMemo.overlay;
      if (!o) return null;
      const count = (t: string) => o.marks.filter((m) => m.t === t).length;
      return { tiles: o.areas.reduce((a, x) => a + x.tiles.length, 0), borders: o.borders.length, ok: count('ok'), no: count('no'), plus: count('plus'), link: count('link'), veil: o.veil, roads: o.roads };
    },
    /** 2.6: si una casilla está a la vista (no tapada por la hoja ni por la franja). */
    visible(tx: number, ty: number) {
      const r = canvas.getBoundingClientRect();
      const x = r.left + ((tx + 0.5) * tileSize() - cam.x) / dpr();
      const y = r.top + ((ty + 0.5) * tileSize() - cam.y) / dpr();
      const sh = currentSheet()?.getBoundingClientRect();
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? r.top;
      const inMap = x >= r.left && x <= r.right && y >= top && y <= Math.min(r.bottom, $('#strip').getBoundingClientRect().top);
      const underSheet = !!sh && x >= sh.left && x <= sh.right && y >= sh.top && y <= sh.bottom;
      return inMap && !underSheet;
    },
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
    tutorialGlow();
    // La sacudida se aplica a una copia de la cámara: no cambia dónde mira el jugador.
    const [sx, sy] = shakeOffset(time);
    const view = sx || sy ? { ...cam, x: cam.x + sx * dpr(), y: cam.y + sy * dpr() } : cam;
    reachHint();
    render(ctx, state, view, { preview, selected, cursor: document.activeElement === canvas ? cursor : null, time, reducedMotion: reducedMotion(), layer, highlight, labels: cam.zoom >= touchZoom(), fast: speed >= 10, reach: currentReach(), missingKey: layer === 'missing' ? missingKey : null, bad: badFlash });
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
  tutorial.start(state);
  tutorial.update(state, tool.id);
  // 2.7: «Hoy en Bitópolis» al volver tras una ausencia, si hay algo que contar (no durante el tutorial).
  if (away && !tutorial.active && hoyHasNews(state, away, pendingAsks(state))) showHoy(away);
  introGeography();
  // 2.7: en pausa, ⏯ late (antes, un aviso fijo tapaba la parte de arriba del mapa).
  if (!tutorial.active && resume === 0) $('#sr-live').textContent = 'En pausa. Pulsa ▶ para que pase el tiempo.';
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
    // El tamaño del texto cambia lo que cabe arriba.
    topbarKey = '';
    fitTopbar();
  });
  requestAnimationFrame(frame);
}
