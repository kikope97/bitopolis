/**
 * 2.8 (ronda 24, parte D): celebrar los logros. Solo cliente; no toca el estado.
 *
 * - Al subir el ayuntamiento de nivel, una tarjeta «¡Ayuntamiento nivel 3!» con lo
 *   que desbloquea (`TOWNHALL_LEVELS[n].unlocks`) y «Construir ahora» (abre la
 *   bandeja). El destello y la cámara sobre el ayuntamiento los pone game.ts
 *   (`showHall`); con movimiento reducido, sin animación.
 * - En un escenario, una barra de meta en la franja (`#goal-bar`, una línea que se
 *   toca y lleva a Objetivos) con el progreso de `scenarioStatus`.
 * - Al terminar un escenario, una tarjeta de resultado (ganado o no, meses usados)
 *   con «Reintentar este escenario», que abre una partida nueva con el mismo
 *   escenario, terreno y «Pueblo sencillo» (`retryScenario`).
 *
 * Las tarjetas no son modales: se cierran con ✕, Escape, al tocar fuera, al abrir
 * una hoja o la bandeja y (la del nivel) solas a los 12 s. Esperan a que no haya
 * ninguna hoja abierta (la subida se hace desde «Gestión del pueblo»).
 */
import { type GameState, scenarioResult, scenarioStatus, TOWNHALL_LEVELS } from '@bitopolis/sim';
import type { ScenarioId, TerrainShape } from '@bitopolis/shared';
import { pixelIcon } from './icons.ts';
import { confirmDialog, h, isSheetOpen } from './ui.ts';

export interface CelebrateCtx {
  /** Abre la bandeja «Construir». */
  openTray(): void;
  /** Abre Pueblo › Objetivos. */
  openGoals(): void;
  /** Destello y cámara sobre el ayuntamiento (game.ts decide si hay animación). */
  showHall(): void;
  /** Sonido y vibración de la celebración. */
  cheer(): void;
}

/** Lo elegido al crear cada partida (lo guarda start.ts): para «Reintentar» con el mismo terreno. */
export const startPicksKey = (token: string) => `bitopolis.start.${token}`;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Token nuevo de 22 caracteres base62 (como el del servidor), con el azar del navegador. */
function newToken(): string {
  let out = '';
  const buf = new Uint8Array(1);
  while (out.length < 22) {
    crypto.getRandomValues(buf);
    // 248 = 62 × 4: sin sesgo.
    if (buf[0]! < 248) out += ALPHABET[buf[0]! % 62];
  }
  return out;
}

/** URL de una partida nueva con el mismo escenario (start.ts lee `escenario`, `terreno` y `sencillo`). */
export function retryUrl(state: GameState, token: string): string {
  let terrain: TerrainShape = 'aleatorio';
  try {
    const saved = JSON.parse(localStorage.getItem(startPicksKey(token)) ?? '{}') as { terrain?: TerrainShape };
    if (saved.terrain) terrain = saved.terrain;
  } catch {
    /* sin datos: al azar */
  }
  const q = new URLSearchParams({ escenario: state.scenario.id, terreno: terrain });
  if (state.simple) q.set('sencillo', '1');
  return `/p/${newToken()}?${q.toString()}`;
}

/** «Reintentar este escenario»: confirma y abre la pantalla de inicio de una partida nueva con lo mismo elegido. */
export async function retryScenario(state: GameState, token: string): Promise<void> {
  const name = scenarioResult(state)?.name ?? 'este escenario';
  const ok = await confirmDialog(`¿Otra partida de «${name}»?`, 'Empieza un pueblo nuevo con el mismo escenario y terreno. Este queda guardado en su enlace.', 'Empezar', { safe: true });
  if (ok) location.assign(retryUrl(state, token));
}

/** Texto del resultado («Cumplida en 13 meses», «No se cumplió en 36 meses»). */
export function resultLine(r: NonNullable<ReturnType<typeof scenarioResult>>): string {
  if (r.won) return r.months ? `Cumplida en ${r.months} ${r.months === 1 ? 'mes' : 'meses'}` : 'Cumplida';
  return `No se cumplió en ${r.deadlineMonths} meses`;
}

/** Texto de la barra de meta: «Quiebra · 3/13 meses · quedan 21». */
export function goalBarText(sc: NonNullable<ReturnType<typeof scenarioStatus>>): string {
  return `${sc.shortName} · ${sc.short} · ${sc.monthsLeft === 1 ? 'queda 1 mes' : `quedan ${sc.monthsLeft}`}`;
}

export function createCelebrate(ctx: CelebrateCtx, token: string): { update(state: GameState): void } {
  let level: number | null = null;
  let scenarioDone: boolean | null = null;
  const pending: ({ kind: 'level'; level: number } | { kind: 'end' })[] = [];
  let card: HTMLElement | null = null;
  let closeTimer = 0;
  let last: GameState | null = null;

  /* --- barra de meta en la franja --- */
  const fill = h('span', { class: 'goal-fill', 'aria-hidden': 'true' });
  const text = h('span', { class: 'goal-text' });
  const bar = h('button', { id: 'goal-bar', class: 'goal-bar', type: 'button', 'data-test': 'goal-bar', hidden: true }, fill, pixelIcon('medal'), text);
  bar.addEventListener('click', () => ctx.openGoals());
  const strip = document.getElementById('strip');
  strip?.prepend(bar);
  let barKey = '';
  function paintBar(state: GameState) {
    const sc = scenarioStatus(state);
    const key = sc ? `${goalBarText(sc)}|${sc.ratio.toFixed(2)}` : '';
    if (key === barKey) return;
    barKey = key;
    bar.hidden = !sc;
    strip?.classList.toggle('has-goal', !!sc);
    if (!sc) return;
    text.textContent = goalBarText(sc);
    fill.style.width = `${Math.round(sc.ratio * 100)}%`;
    bar.setAttribute('aria-label', `Meta de «${sc.name}»: ${sc.progress}. ${sc.monthsLeft === 1 ? 'Queda 1 mes' : `Quedan ${sc.monthsLeft} meses`}. Ver Objetivos`);
  }

  /* --- tarjetas --- */
  function close() {
    clearTimeout(closeTimer);
    card?.remove();
    card = null;
  }
  const outside = (e: Event) => {
    if (card && !card.contains(e.target as Node)) close();
  };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', (e) => {
    if (card && e.key === 'Escape') close();
  });

  /** El aviso del mismo suceso se quita de la pantalla (la tarjeta lo dice; sigue en la campana). */
  function dropToast(re: RegExp) {
    for (const t of document.querySelectorAll<HTMLElement>('#toasts .toast')) if (re.test(t.dataset.text ?? '')) t.remove();
  }

  function show(el: HTMLElement, autoClose: boolean) {
    close();
    card = el;
    document.body.append(el);
    const live = document.getElementById('sr-live');
    if (live) live.textContent = el.getAttribute('aria-label') ?? '';
    if (autoClose) closeTimer = window.setTimeout(close, 12_000);
  }

  function levelCard(lv: number) {
    const info = TOWNHALL_LEVELS.find((l) => l.level === lv);
    if (!info) return;
    const closeBtn = h('button', { class: 'btn celebrate-x', type: 'button', 'aria-label': 'Cerrar' }, '✕');
    const build = h('button', { class: 'btn primary', type: 'button', 'data-test': 'celebrate-build' }, 'Construir ahora');
    const el = h(
      'section',
      { class: 'celebrate', 'data-test': 'celebrate-level', 'data-level': String(lv), role: 'region', 'aria-label': `¡Ayuntamiento nivel ${lv}! ${info.name}. Desbloquea: ${info.unlocks.join(', ')}` },
      h('div', { class: 'celebrate-head' }, pixelIcon('townhall'), h('h2', {}, `¡Ayuntamiento nivel ${lv}!`), closeBtn),
      h('p', { class: 'celebrate-sub' }, info.name),
      h('p', { class: 'celebrate-lead' }, 'Desbloquea:'),
      h('ul', { class: 'celebrate-list' }, ...info.unlocks.map((u) => h('li', {}, u))),
      h('div', { class: 'celebrate-row' }, build),
    );
    closeBtn.addEventListener('click', close);
    build.addEventListener('click', () => {
      close();
      ctx.openTray();
    });
    show(el, true);
    dropToast(/^El ayuntamiento sube a nivel/);
    ctx.cheer();
    ctx.showHall();
  }

  function endCard(state: GameState) {
    const r = scenarioResult(state);
    if (!r) return;
    const closeBtn = h('button', { class: 'btn celebrate-x', type: 'button', 'aria-label': 'Cerrar' }, '✕');
    const retry = h('button', { class: 'btn', type: 'button', 'data-test': 'celebrate-retry' }, 'Reintentar este escenario');
    const keep = h('button', { class: 'btn primary', type: 'button' }, 'Seguir jugando');
    const title = r.won ? '¡Meta cumplida!' : 'Se acabó el plazo';
    const line = resultLine(r);
    const el = h(
      'section',
      { class: `celebrate ${r.won ? 'won' : 'lost'}`, 'data-test': 'celebrate-end', 'data-won': String(r.won), role: 'region', 'aria-label': `${title} «${r.name}»: ${line}` },
      h('div', { class: 'celebrate-head' }, pixelIcon(r.won ? 'medal' : 'calendar'), h('h2', {}, title), closeBtn),
      h('p', { class: 'celebrate-sub' }, `«${r.name}»`),
      h('p', { class: 'celebrate-result' }, line),
      h('p', { class: 'celebrate-lead' }, r.won ? 'La medalla ya está en tu colección. El pueblo sigue, sin plazo.' : 'No pasa nada: el pueblo sigue como partida libre.'),
      h('div', { class: 'celebrate-row' }, retry, keep),
    );
    closeBtn.addEventListener('click', close);
    keep.addEventListener('click', close);
    retry.addEventListener('click', () => {
      close();
      void retryScenario(state, token);
    });
    show(el, false);
    dropToast(/^(¡Meta cumplida en|Se acabó el plazo de)/);
    if (r.won) ctx.cheer();
  }

  /** Enseña lo que espera si no hay hojas, bandeja ni diálogos encima. */
  function flush() {
    if (!pending.length || !last) return;
    if (isSheetOpen() || document.body.classList.contains('tray-open') || document.querySelector('.modal-backdrop, .hoy-backdrop')) return;
    const next = pending.shift()!;
    if (next.kind === 'level') levelCard(next.level);
    else endCard(last);
  }
  window.setInterval(flush, 700);

  return {
    update(state: GameState) {
      last = state;
      paintBar(state);
      const lv = state.townhallLevel ?? 1;
      if (level !== null && lv > level) pending.push({ kind: 'level', level: lv });
      level = lv;
      const done = state.scenario?.id !== 'libre' && state.scenario?.done === true;
      if (scenarioDone === false && done) pending.push({ kind: 'end' });
      scenarioDone = done;
      // Una hoja o la bandeja abiertas cierran la tarjeta (no tapa su cabecera).
      if (card && (isSheetOpen() || document.body.classList.contains('tray-open'))) close();
      flush();
    },
  };
}

/** Para el selector de inicio: ¿son válidos lo que trae la URL? */
export function retryPicks(q: URLSearchParams, scenarios: readonly ScenarioId[], terrains: readonly TerrainShape[]): { scenario?: ScenarioId; terrain?: TerrainShape; simple?: boolean } {
  const sc = q.get('escenario') as ScenarioId | null;
  const te = q.get('terreno') as TerrainShape | null;
  return {
    ...(sc && scenarios.includes(sc) ? { scenario: sc } : {}),
    ...(te && terrains.includes(te) ? { terrain: te } : {}),
    ...(q.get('sencillo') === '1' ? { simple: true } : {}),
  };
}
