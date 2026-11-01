import { TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import { canUpgradeTownhall, type GameState, hash32, type Moment, rankCandidates, rankName } from '@bitopolis/sim';
import { photo } from './album-ui.ts';
import { crestCanvas } from './crest.ts';
import { formatDate, money, plural } from './i18n.ts';
import { PALETTE } from './palette.ts';
import { mottoText, nextRankText } from './rank-ui.ts';
import { portraitCanvas } from './social-ui.ts';
import { h, sheet } from './ui.ts';

/**
 * 2.1: «Mientras no estabas». Al volver a la partida, una tarjeta que se
 * desliza con 3–5 momentos: el pueblo (rango y cambios), fotos del álbum, el
 * vecino del día, la semana en una gráfica y lo pendiente. Se pasa con el dedo
 * (scroll con imán) o con los botones; cada momento es un grupo con nombre.
 */
export interface AwaySince {
  /** Tick desde el que se cuenta. */
  tick: number;
  pop: number;
  treasury: number;
  /** ¿Pasó el tiempo de juego desde la última visita? (si no, se repasa la última semana). */
  advanced: boolean;
  rank: number;
}

export interface AwayActions {
  openCitizen: (id: number) => void;
  openRank: () => void;
}

/** Vecino del día: uno con nombre, fijo para cada día de juego. */
export function citizenOfDay(state: GameState): GameState['citizens'][number] | null {
  const named = state.citizens.filter((c) => c.named);
  const pool = named.length ? named : state.citizens;
  if (!pool.length) return null;
  return pool[hash32(state.seed, Math.floor(state.tick / TICKS_PER_DAY), 41) % pool.length]!;
}

/** Llegadas y salidas de los últimos 7 días (de los sucesos). */
export function weekFlow(state: GameState): { day: number; arrivals: number; departures: number }[] {
  const today = Math.floor(state.tick / TICKS_PER_DAY);
  const days = Array.from({ length: 7 }, (_, i) => ({ day: today - 6 + i, arrivals: 0, departures: 0 }));
  for (const e of state.events) {
    const d = days.find((x) => x.day === Math.floor(e.tick / TICKS_PER_DAY));
    if (!d) continue;
    if (e.kind === 'arrival') d.arrivals++;
    else if (e.kind === 'departure') d.departures++;
  }
  return days;
}

/** Gráfica de la semana: barras hacia arriba (llegan, verde) y hacia abajo (se van, rosa). */
function weekChart(state: GameState): HTMLElement {
  const flow = weekFlow(state);
  const max = Math.max(1, ...flow.map((d) => Math.max(d.arrivals, d.departures)));
  const W = 70;
  const H = 36;
  const c = h('canvas', { class: 'away-chart', width: String(W), height: String(H), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = PALETTE[15]!;
    g.fillRect(0, H / 2, W, 1);
    flow.forEach((d, i) => {
      const x = 3 + i * 10;
      const up = Math.round((d.arrivals / max) * (H / 2 - 2));
      const down = Math.round((d.departures / max) * (H / 2 - 2));
      g.fillStyle = PALETTE[6]!;
      g.fillRect(x, H / 2 - up, 6, up);
      g.fillStyle = PALETTE[61]!;
      g.fillRect(x, H / 2 + 1, 6, down);
    });
  }
  const ins = flow.reduce((a, d) => a + d.arrivals, 0);
  const outs = flow.reduce((a, d) => a + d.departures, 0);
  const text = ins || outs ? `En 7 días: ${ins ? `llegan ${plural(ins, 'vecino', 'vecinos')}` : 'no llega nadie'}${outs ? ` y se ${outs === 1 ? 'va' : 'van'} ${outs}` : ' y no se va nadie'}.` : 'Semana tranquila: ni llegadas ni despedidas.';
  return h('figure', { class: 'away-week' }, c, h('figcaption', {}, text, h('span', { class: 'away-legend' }, h('span', { class: 'sw up' }, ''), ' llegan ', h('span', { class: 'sw down' }, ''), ' se van')));
}

/** Lo que espera al alcalde (cuatro cosas como mucho). */
export function pendingItems(state: GameState): string[] {
  const out: string[] = [];
  const d = tickToDate(state.tick);
  if (rankCandidates(state)) out.push('Los vecinos votan el escudo y el lema del pueblo.');
  const offers = state.grants.filter((g) => g.status === 'offered').length;
  if (offers) out.push(`${plural(offers, 'subvención', 'subvenciones')} por responder.`);
  if (state.budget.status === 'open' && state.budget.year === d.year) out.push(`El presupuesto de ${d.year} está por aprobar.`);
  const asks = state.citizens.filter((c) => c.debt?.askedAt !== undefined).length;
  if (asks) out.push(`${plural(asks, 'vecino pide', 'vecinos piden')} aplazar lo que debe.`);
  if ((state.associations ?? []).some((a) => a.protestDay >= 0)) out.push('Hay una manifestación convocada.');
  const promises = state.promises.filter((p) => p.status === 'pending').length;
  if (promises) out.push(`${plural(promises, 'promesa', 'promesas')} por cumplir.`);
  if (canUpgradeTownhall(state).ok) out.push('Ya puedes ampliar el ayuntamiento.');
  return out.slice(0, 4);
}

function slide(i: number, n: number, title: string, ...body: (Node | string)[]): HTMLElement {
  return h('section', { class: 'away-slide', role: 'group', 'aria-roledescription': 'momento', 'aria-label': `${i + 1} de ${n}: ${title}` }, h('h3', {}, title), ...body);
}

export function openAway(token: string, state: GameState, since: AwaySince, act: AwayActions): HTMLElement {
  const parts: { title: string; body: (Node | string)[] }[] = [];

  // 1. El pueblo: rango, escudo y cambios.
  const changes: string[] = [];
  const dp = state.citizens.length - since.pop;
  if (dp) changes.push(`${dp > 0 ? '+' : ''}${plural(dp, 'vecino', 'vecinos')}`);
  const dm = state.treasury - since.treasury;
  if (since.advanced) changes.push(`Caja: ${dm >= 0 ? '+' : ''}${money(dm)}`);
  else changes.push(`Caja: ${money(state.treasury)}`);
  const motto = mottoText(state);
  const rose = (state.rank?.level ?? 0) > since.rank;
  const rankBtn = h('button', { class: 'btn small' }, 'Ver el escudo');
  rankBtn.addEventListener('click', act.openRank);
  parts.push({
    title: rose ? `¡Ahora es ${rankName(state)}!` : `${rankName(state)} de Bitópolis`,
    body: [
      h('div', { class: 'away-rank' }, crestCanvas(state, 'crest crest-l'), h('div', {}, motto ? h('p', { class: 'rank-motto' }, `«${motto}»`) : '', h('p', {}, changes.join(' · ')), h('p', { class: 'muted small' }, nextRankText(state)))),
      rankBtn,
    ],
  });

  // 2. Fotos del álbum desde entonces (o el último recuerdo).
  const album = state.album ?? [];
  const c = citizenOfDay(state);
  // Con vecino del día cabe una foto; sin él, dos (cinco momentos como mucho).
  let moments: Moment[] = album.filter((m) => m.tick > since.tick).slice(c ? -1 : -2).reverse();
  const fresh = moments.length > 0;
  if (!fresh && album.length) moments = [album.at(-1)!];
  for (const m of moments) {
    const ph = photo(token, state, m).el;
    ph.classList.add('away-photo');
    ph.setAttribute('role', 'img');
    ph.setAttribute('aria-label', `Foto: ${m.text}`);
    parts.push({ title: fresh ? 'Un momento' : 'El último recuerdo', body: [ph, h('p', {}, h('strong', {}, formatDate(tickToDate(m.tick))), ` · ${m.text}`)] });
  }

  // 3. El vecino del día.
  if (c) {
    const mood = c.happiness >= 70 ? 'contenta' : c.happiness >= 45 ? 'tirando' : 'de capa caída';
    const said = c.thought ?? (c.summary || null);
    const see = h('button', { class: 'btn small' }, `Ver a ${c.name.split(' ')[0]}`);
    see.addEventListener('click', () => act.openCitizen(c.id));
    parts.push({
      title: 'El vecino del día',
      body: [h('div', { class: 'away-who' }, portraitCanvas(c.id, 4, 'portrait away-face'), h('div', {}, h('p', {}, h('strong', {}, c.name), `, ${c.age} años${c.profession ? `, ${c.profession}` : ''}.`), h('p', {}, `Anda ${mood} (felicidad ${Math.round(c.happiness)}).`), said ? h('p', { class: 'away-quote' }, `«${said}»`) : '')), see],
    });
  }

  // 4. La semana y 5. lo pendiente (juntos si no hay sitio).
  parts.push({ title: 'La semana', body: [weekChart(state)] });
  const todo = pendingItems(state);
  parts.push({ title: 'Lo pendiente', body: todo.length ? [h('ul', { class: 'away-todo' }, ...todo.map((t) => h('li', {}, t)))] : [h('p', {}, 'Nada urgente. Buen momento para crecer.')] });

  // De 3 a 5 momentos: el pueblo, 1–2 fotos, el vecino del día, la semana y lo pendiente.
  const n = parts.length;
  const slides = parts.map((p, i) => slide(i, n, p.title, ...p.body));
  const track = h('div', { class: 'away-track', tabindex: '0', 'aria-label': 'Momentos: desliza o usa los botones' }, ...slides);
  const status = h('p', { class: 'away-status', 'aria-live': 'polite' }, `1 de ${n}`);
  const prev = h('button', { class: 'btn away-prev' }, '‹ Anterior');
  const next = h('button', { class: 'btn away-next' }, 'Siguiente ›');
  const dots = h('div', { class: 'away-dots' }, ...slides.map((_, i) => h('button', { class: 'away-dot', tabindex: '-1', 'aria-label': `Ir al momento ${i + 1} de ${n}` }, '')));
  let at = 0;
  // Mientras se desliza por un botón, el contador no sigue al scroll (iría por los intermedios).
  let auto = 0;
  const show = (i: number, scroll = true) => {
    at = Math.max(0, Math.min(n - 1, i));
    if (scroll) auto = performance.now();
    if (scroll) track.scrollTo({ left: at * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    status.textContent = `${at + 1} de ${n}`;
    (prev as HTMLButtonElement).disabled = at === 0;
    next.textContent = at === n - 1 ? 'A jugar' : 'Siguiente ›';
    // Ronda 17: el nombre accesible contiene el texto visible; los momentos que no se ven, inertes.
    slides.forEach((sl, k) => ((sl as HTMLElement).inert = k !== at));
    [...dots.children].forEach((d, k) => d.setAttribute('aria-current', String(k === at)));
  };
  prev.addEventListener('click', () => show(at - 1));
  next.addEventListener('click', () => {
    if (at === n - 1) (document.querySelector('.sheet .sheet-close') as HTMLElement | null)?.click();
    else show(at + 1);
  });
  [...dots.children].forEach((d, k) => d.addEventListener('click', () => show(k)));
  // Al deslizar con el dedo, el contador sigue al momento que queda a la vista.
  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (performance.now() - auto < 800) return;
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== at) show(i, false);
    });
  });
  // Al acabar cualquier desplazamiento (dedo o botón), el contador queda en el que se ve.
  track.addEventListener('scrollend', () => {
    auto = 0;
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (i !== at) show(i, false);
  });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      show(at + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      show(at - 1);
    }
  });
  const el = sheet(
    'Mientras no estabas',
    h('p', { class: 'muted small' }, since.advanced ? `Desde el ${formatDate(tickToDate(since.tick))}.` : 'Así dejaste el pueblo.'),
    h('div', { class: 'away', role: 'region', 'aria-roledescription': 'carrusel', 'aria-label': 'Mientras no estabas' }, track, h('div', { class: 'away-nav' }, prev, status, next), dots),
  );
  el.classList.add('away-sheet');
  show(0, false);
  return el;
}
