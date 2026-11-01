import './style.css';
import { formatDate } from './i18n.ts';
import { type ListedModel, loadModels, modelPicker } from './model-picker.ts';
import { apply as applyPrefs } from './prefs.ts';
import { $, confirmDialog, h, toast } from './ui.ts';

/**
 * Panel /admin: todo lo que antes eran variables de entorno (decisión del
 * creador). La primera vez se entra con admin / admin y hay que cambiar la
 * contraseña antes de poder tocar nada.
 */
interface Price {
  in: number;
  cachedIn?: number;
  out: number;
}
interface View {
  version: string;
  admin: { user: string; mustChange: boolean };
  publicUrl: string;
  newGames: boolean;
  access: { enabled: boolean; hasPassword: boolean };
  ai: {
    hasKey: boolean;
    keyMask: string | null;
    provider: string | null;
    baseUrl: string;
    model: string;
    modelPremium: string;
    maxCitizens: number;
    aiShare: number;
    turnQuality: 'calidad' | 'ahorro';
    serverMonthly: number | null;
    gameMonthly: number | null;
    gameDaily: number | null;
    prices: Record<string, Price> | null;
    playerKeys: boolean;
  };
  backups: { keep: number };
  estimate: { citizens: number; provider: string; eurPerGameMonth: number; eurPerHourX1: number; known: boolean };
  defaults: { prices: Record<string, Price>; models: Record<string, { cheap: string; premium: string; models: string[] }> };
}
interface GameRow {
  token: string;
  mode: string;
  /** 2.3: escenario con el que empezó. */
  scenario: string;
  createdAt: string;
  updatedAt: string;
  population: number;
  date: { year: number; month: number; day: number } | null;
  aiMonthEur: number;
}

class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public mustChange = false,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(data.error ?? `Error ${r.status}`, r.status, !!data.mustChange);
  return data as T;
}

const body = () => $('#admin-body');
const eur = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
/** 2.3: escenarios de la lista de partidas (los nombres, como en la pantalla de inicio). */
const SCENARIO_LABEL: Record<string, string> = { quiebra: 'Pueblo en quiebra', vaciado: 'El pueblo que se vacía', riada: 'Tras la riada' };
const PROVIDER_LABEL: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', 'openai-compatible': 'Endpoint propio (compatible con OpenAI)' };

function input(attrs: Record<string, string | boolean>): HTMLInputElement {
  return h('input', attrs) as HTMLInputElement;
}
let uid = 0;
/** Campo con etiqueta corta; la ayuda va aparte, enlazada con aria-describedby. */
function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  if (!control.id) control.id = `f${++uid}`;
  const box = h('div', { class: 'field' }, h('label', { class: 'field-label', for: control.id }, label), control);
  if (help) {
    box.append(h('span', { class: 'help', id: `${control.id}-help` }, help));
    describe(control, `${control.id}-help`);
  }
  return box;
}
function describe(control: HTMLElement, id: string): void {
  const ids = new Set((control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
  ids.add(id);
  control.setAttribute('aria-describedby', [...ids].join(' '));
}
/** Error junto al campo culpable: lo marca, lo enlaza y le pone el foco. */
function invalid(control: HTMLElement, err: HTMLElement, msg: string): void {
  if (!err.id) err.id = `e${++uid}`;
  err.textContent = msg;
  control.setAttribute('aria-invalid', 'true');
  describe(control, err.id);
  control.focus();
  control.addEventListener('input', () => control.removeAttribute('aria-invalid'), { once: true });
}
function check(label: string, on: boolean, help?: string): [HTMLElement, HTMLInputElement] {
  const box = input({ type: 'checkbox', ...(on ? { checked: true } : {}) });
  return [h('label', { class: 'check' }, box, h('span', {}, label, help ? h('small', { class: 'help' }, ` ${help}`) : '')), box];
}
function card(title: string, ...content: (Node | string)[]): HTMLElement {
  const id = `c${++uid}`;
  // El título se puede enfocar: tras redibujar, el foco vuelve a la tarjeta en la que se estaba.
  return h('section', { class: 'admin-card', 'aria-labelledby': id }, h('h2', { id, tabindex: '-1', 'data-title': title }, title), ...content);
}

/** Tarjeta plegable (v1.3): el panel en móvil son muchas pantallas. Recuerda si estaba abierta. */
function foldCard(title: string, openByDefault: boolean, summary: HTMLElement | null, ...content: (Node | string)[]): HTMLElement {
  const id = `c${++uid}`;
  const key = `bitopolis.admin.open.${title}`;
  let open = openByDefault;
  try {
    // Si hay algo que mirar (abierta por defecto), manda eso; si no, lo que eligió la última vez.
    const saved = openByDefault ? null : localStorage.getItem(key);
    if (saved !== null) open = saved === '1';
  } catch {
    /* sin almacenamiento: por defecto */
  }
  const body = h('div', { id: `${id}-body`, class: 'admin-card-body' }, ...content);
  // La flecha va aparte y oculta al lector: el nombre del botón es solo el título.
  const arrow = h('span', { class: 'fold-arrow', 'aria-hidden': 'true' });
  const toggle = h('button', { id: `${id}-t`, class: 'admin-fold', type: 'button', 'aria-expanded': String(open), 'aria-controls': `${id}-body` }, arrow, title);
  const set = (v: boolean) => {
    open = v;
    body.hidden = !v;
    toggle.setAttribute('aria-expanded', String(v));
    arrow.textContent = v ? '▾' : '▸';
    try {
      localStorage.setItem(key, v ? '1' : '0');
    } catch {
      /* da igual */
    }
  };
  toggle.addEventListener('click', () => set(!open));
  body.hidden = !open;
  arrow.textContent = open ? '▾' : '▸';
  // El resumen (v1.4) se ve sin abrir la tarjeta; la sección se nombra solo con el título.
  summary?.classList.add('fold-summary');
  return h('section', { class: 'admin-card', 'aria-labelledby': `${id}-t` }, h('h2', { id, tabindex: '-1', 'data-title': title }, toggle, summary ?? ''), body);
}
function focusCard(title: string): void {
  [...document.querySelectorAll<HTMLElement>('.admin-card h2')].find((x) => x.dataset.title === title)?.focus();
}
/** Botón que se desactiva mientras trabaja y avisa del resultado. */
function action(text: string, run: () => Promise<string | void>, cls = 'btn'): HTMLButtonElement {
  const b = h('button', { class: cls, type: 'button' }, text) as HTMLButtonElement;
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const msg = await run();
      if (msg) toast(msg, { kind: 'good' });
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.mustChange)) return void start();
      toast((e as Error).message, { kind: 'warn' });
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
const money = (el: HTMLInputElement) => (el.value.trim() === '' ? null : Number(el.value.replace(',', '.')));
const moneyInput = (v: number | null) => input({ type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: v === null ? '' : String(v), placeholder: 'sin tope' });

/* ---------------- entrar ---------------- */

function renderLogin(): void {
  $('#logout').hidden = true;
  const user = input({ name: 'user', autocomplete: 'username', required: true, value: '' });
  const pw = input({ name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h(
    'form',
    { class: 'login admin-login' },
    h('h2', {}, 'Entrar como administrador'),
    field('Usuario', user),
    field('Contraseña', pw),
    err,
    h('button', { class: 'btn primary big' }, 'Entrar'),
    h('p', { class: 'muted small' }, 'La primera vez: usuario «admin» y contraseña «admin». Te pedirá cambiarla.'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await req<{ mustChange: boolean }>('POST', '/api/admin/login', { user: user.value.trim(), password: pw.value });
      if (r.mustChange) renderChange(user.value.trim(), pw.value);
      else void renderPanel('Resumen');
    } catch (x) {
      err.textContent = (x as Error).message;
    }
  });
  body().replaceChildren(form);
  user.focus();
}

/** Primer acceso: no se puede seguir con admin / admin. */
function renderChange(user: string, current = ''): void {
  $('#logout').hidden = false;
  const name = input({ autocomplete: 'username', value: user, required: true });
  const cur = input({ type: 'password', autocomplete: 'current-password', value: current, required: true });
  const pw = input({ type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  const pw2 = input({ type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h(
    'form',
    { class: 'login admin-login' },
    h('h2', {}, 'Cambia la contraseña'),
    h('p', {}, 'Estás usando la contraseña de serie. Antes de configurar nada, elige una nueva (mínimo 8 caracteres). Si quieres, cambia también el usuario.'),
    field('Usuario', name),
    current ? '' : field('Contraseña actual', cur),
    field('Contraseña nueva', pw),
    field('Repite la contraseña nueva', pw2),
    err,
    h('button', { class: 'btn primary big' }, 'Guardar y entrar'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pw.value !== pw2.value) {
      invalid(pw2, err, 'Las dos contraseñas nuevas no coinciden');
      return;
    }
    try {
      await req('POST', '/api/admin/account', { currentPassword: cur.value, user: name.value.trim(), newPassword: pw.value });
      toast('Contraseña cambiada', { kind: 'good' });
      void renderPanel('Resumen');
    } catch (x) {
      err.textContent = (x as Error).message;
    }
  });
  body().replaceChildren(form);
  pw.focus();
}

/* ---------------- panel ---------------- */

async function renderPanel(focus?: string): Promise<void> {
  let v: View;
  let stats: { games: number; aiMonthEur: number; serverMonthly: number | null };
  let games: GameRow[];
  let backups: { name: string; size: number }[];
  try {
    [v, stats, games, backups] = await Promise.all([
      req<View>('GET', '/api/admin/settings'),
      req<typeof stats>('GET', '/api/admin/stats'),
      req<GameRow[]>('GET', '/api/admin/games'),
      req<typeof backups>('GET', '/api/admin/backups'),
    ]);
  } catch (e) {
    if (e instanceof HttpError && e.mustChange) return renderChange('admin');
    if (e instanceof HttpError && e.status === 401) return renderLogin();
    body().replaceChildren(h('p', { class: 'error' }, (e as Error).message));
    return;
  }
  $('#logout').hidden = false;
  const save = (patch: unknown) => req<View>('PUT', '/api/admin/settings', patch);
  const base = v.publicUrl || location.origin;

  /* --- resumen --- */
  const summary = card(
    'Resumen',
    h(
      'dl',
      { class: 'stats-card' },
      h('dt', {}, 'Versión'),
      h('dd', {}, v.version),
      h('dt', {}, 'Partidas'),
      h('dd', {}, String(stats.games)),
      h('dt', {}, 'IA este mes'),
      h('dd', {}, stats.serverMonthly ? `${eur(stats.aiMonthEur)} de ${eur(stats.serverMonthly)}` : eur(stats.aiMonthEur)),
    ),
  );

  /* --- servidor y acceso --- */
  const url = input({ type: 'url', value: v.publicUrl, placeholder: location.origin, inputmode: 'url', autocomplete: 'off' });
  const [newGamesRow, newGames] = check('Permitir partidas nuevas', v.newGames, '(si lo quitas, las que ya existen siguen funcionando)');
  const [accessRow, access] = check('Pedir contraseña para jugar', v.access.enabled, '(una sola para todos, sin usuario)');
  const accessPw = input({ type: 'password', autocomplete: 'new-password', placeholder: v.access.hasPassword ? 'deja en blanco para mantener la actual' : 'contraseña para tus amigos' });
  // Sin la casilla, el campo de contraseña no aplica.
  const syncAccess = () => (accessPw.disabled = !access.checked);
  access.setAttribute('aria-controls', (accessPw.id = 'access-pw'));
  access.addEventListener('change', syncAccess);
  syncAccess();
  const httpWarn = h('p', { class: 'error small', id: 'url-warn' });
  describe(url, 'url-warn');
  const warnHttp = () => {
    const u = url.value.trim();
    httpWarn.textContent = u.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(u) ? 'Sin HTTPS, el enlace de la partida viaja sin cifrar y funciona como contraseña. Usa un proxy con HTTPS.' : '';
  };
  url.addEventListener('input', warnHttp);
  warnHttp();
  const invite = `${base}/`;
  const server = card(
    'Partidas y acceso',
    h(
      'div',
      { class: 'invite' },
      h('p', {}, 'Para invitar a tus amigos, mándales este enlace. Cada uno crea su propio pueblo; si pides contraseña para jugar, dásela también.'),
      h('p', { class: 'mono' }, invite),
      action('Copiar el enlace para invitar', async () => {
        await navigator.clipboard.writeText(invite);
        return 'Enlace copiado';
      }),
      h('p', { class: 'help' }, 'No compartas el enlace /p/… de una partida: da acceso a ese pueblo.'),
    ),
    field('URL pública', url, 'La que se usa en los enlaces de las partidas. En blanco, la del navegador.'),
    httpWarn,
    newGamesRow,
    accessRow,
    field('Contraseña para jugar', accessPw),
    action('Guardar acceso', async () => {
      const patch: Record<string, unknown> = { publicUrl: url.value.trim(), newGames: newGames.checked, access: { enabled: access.checked, ...(accessPw.value ? { password: accessPw.value } : {}) } };
      const r = await save(patch);
      accessPw.value = '';
      accessPw.placeholder = r.access.hasPassword ? 'deja en blanco para mantener la actual' : 'contraseña para tus amigos';
      if (url.value.trim() !== v.publicUrl) void renderPanel('Partidas y acceso');
      return 'Guardado';
    }, 'btn primary wide'),
  );

  /* --- IA --- */
  const a = v.ai;
  const key = input({ type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: a.hasKey ? `guardada: ${a.keyMask}` : 'sk-ant-… o sk-…' });
  const status = h('p', { class: 'server-ai' }, a.hasKey ? `API key del servidor: ${a.keyMask} (${PROVIDER_LABEL[a.provider ?? ''] ?? a.provider}). Quien empiece una partida puede elegir Modo IA sin poner nada, o Modo normal.` : a.baseUrl ? `Endpoint propio: ${a.baseUrl}. Quien empiece una partida puede elegir Modo IA sin poner nada, o Modo normal.` : 'Sin IA del servidor: cada partida elige Modo normal o pone su propia key.');
  const prov = a.provider ?? 'anthropic';
  // Modelos: desplegable con los que da la API key, «Otro…» para escribir uno (petición del creador).
  const defaults = v.defaults.models[prov];
  // 2.0: «Calidad» pone por defecto el modelo bueno para los vecinos; «Ahorro», el barato.
  const neighboursDefault = a.turnQuality === 'ahorro' ? defaults?.cheap : defaults?.premium;
  const model = modelPicker({ id: 'admin-model', value: a.model, placeholder: `por defecto: ${neighboursDefault ?? ''}`, auto: `Por defecto (${neighboursDefault ?? 'según la key'})` });
  const premium = modelPicker({ id: 'admin-premium', value: a.modelPremium, placeholder: `por defecto: ${defaults?.premium ?? ''}`, auto: `Por defecto (${defaults?.premium ?? 'según la key'})` });
  const modelsStatus = h('p', { class: 'help models-status', 'aria-live': 'polite' });
  /** Sin borrador, la key y el endpoint guardados; con borrador, los escritos (sin guardarlos). */
  const reloadModels = (draft?: { key?: string; baseUrl: string }) =>
    loadModels([model, premium], modelsStatus, () => (draft ? req<{ models: ListedModel[] }>('POST', '/api/admin/ai/models', draft) : req<{ models: ListedModel[] }>('GET', '/api/admin/ai/models')));
  const draft = () => {
    const k = key.value.trim();
    const b = baseUrl.value.trim();
    return k || b !== a.baseUrl ? { ...(k ? { key: k } : {}), baseUrl: b } : undefined;
  };
  const reload = action('Recargar modelos', async () => ((await reloadModels(draft())) ? 'Modelos cargados' : undefined));
  const baseUrl = input({ type: 'url', value: a.baseUrl, placeholder: 'http://ollama:11434/v1', inputmode: 'url', autocomplete: 'off' });
  const citizens = input({ id: 'admin-named', type: 'number', min: '1', max: '20', step: '1', value: String(a.maxCitizens), inputmode: 'numeric' });
  const share = input({ id: 'admin-share', type: 'number', min: '0', max: '100', step: '5', value: String(a.aiShare), inputmode: 'numeric' });
  const quality = h(
    'select',
    { id: 'admin-quality' },
    h('option', { value: 'calidad', ...(a.turnQuality !== 'ahorro' ? { selected: true } : {}) }, 'Calidad (Claude Sonnet o GPT mini)'),
    h('option', { value: 'ahorro', ...(a.turnQuality === 'ahorro' ? { selected: true } : {}) }, 'Ahorro (Claude Haiku o GPT nano)'),
  ) as HTMLSelectElement;
  const capServer = moneyInput(a.serverMonthly);
  const capGameMonth = moneyInput(a.gameMonthly);
  const capGameDay = moneyInput(a.gameDaily);
  const [playerRow, player] = check('Sin key del servidor, cada partida puede poner la suya', a.playerKeys);
  const prices = h('textarea', { rows: '6', class: 'mono', spellcheck: 'false', 'aria-label': 'Precios propios en JSON' }) as HTMLTextAreaElement;
  prices.value = a.prices ? JSON.stringify(a.prices, null, 2) : '';
  prices.placeholder = '{ "mi-modelo": { "in": 0.15, "out": 0.6 } }';
  const pricesErr = h('p', { class: 'error small', role: 'alert' });
  // Coste orientativo con lo guardado (v1.3): ayuda a elegir los topes.
  const costLine = h('p', { class: 'estimate', 'aria-live': 'polite' });
  const showCost = (e: View['estimate']) => {
    costLine.textContent = `En un pueblo de 60 vecinos (${e.citizens} con IA), un mes de juego cuesta unos ${eur(e.eurPerGameMonth)} (unos ${eur(e.eurPerHourX1)} por hora jugando a x1). Incluye segundas preguntas y la crónica mensual.${e.known ? '' : ' Modelo sin precio en la tabla: se estima con uno caro.'}`;
  };
  if (a.hasKey || a.baseUrl) showCost(v.estimate);
  else costLine.textContent = 'Pon la API key para ver cuánto cuesta un mes de juego con estos ajustes.';
  const advanced = () => prices.closest('details')!;
  // Al pegar otra key (o cambiar el endpoint), su lista; al abrir, la de lo guardado.
  key.addEventListener('change', () => {
    if (key.value.trim().length >= 8) void reloadModels(draft());
  });
  baseUrl.addEventListener('change', () => {
    if (key.value.trim() || baseUrl.value.trim() || a.hasKey) void reloadModels(draft());
  });
  if (a.hasKey || a.baseUrl) void reloadModels();
  else modelsStatus.textContent = 'Pon la API key para elegir el modelo en una lista.';
  /** Guarda el formulario de la IA tal como está escrito. */
  const saveAi = async (): Promise<void> => {
    let customPrices: Record<string, Price> | null = null;
    if (prices.value.trim()) {
      try {
        customPrices = JSON.parse(prices.value);
      } catch {
        advanced().open = true;
        invalid(prices, pricesErr, 'Los precios no son un JSON válido');
        throw new Error('Los precios no son un JSON válido');
      }
    }
    pricesErr.textContent = '';
    const r = await save({
      ai: {
        ...(key.value.trim() ? { key: key.value.trim() } : {}),
        model: model.value(),
        modelPremium: premium.value(),
        baseUrl: baseUrl.value.trim(),
        maxCitizens: Number(citizens.value),
        aiShare: Math.max(0, Math.min(100, Math.round(Number(share.value) || 0))),
        turnQuality: quality.value === 'ahorro' ? 'ahorro' : 'calidad',
        serverMonthly: money(capServer),
        gameMonthly: money(capGameMonth),
        gameDaily: money(capGameDay),
        prices: customPrices,
        playerKeys: player.checked,
      },
    });
    key.value = '';
    showCost(r.estimate);
    if (r.ai.hasKey !== a.hasKey || r.ai.keyMask !== a.keyMask || r.ai.baseUrl !== a.baseUrl) await renderPanel('IA');
  };
  const aiCard = card(
    'IA',
    status,
    field('API key del servidor', key, 'Se acepta API key de Anthropic (sk-ant-…) o de OpenAI (sk-…). Pégala y pulsa «Guardar y probar». Se guarda cifrada y nunca vuelve al navegador.'),
    h(
      'div',
      { class: 'row wrap' },
      action('Guardar y probar', async () => {
        await saveAi();
        const r = await req<{ ok: boolean; provider: string; model: string; ms: number; error?: string }>('POST', '/api/admin/ai/test');
        if (!r.ok) throw new Error(`No funciona (${r.model}): ${r.error ?? 'sin respuesta'}`);
        return `Funciona: ${PROVIDER_LABEL[r.provider] ?? r.provider}, ${r.model}, ${r.ms} ms`;
      }),
      a.hasKey
        ? action(
            'Quitar la key',
            async () => {
              if (!(await confirmDialog('Quitar la key', 'Las partidas de Modo IA dejarán de usar la IA del servidor y decidirán las reglas.', 'Quitar'))) return;
              await save({ ai: { key: null } });
              void renderPanel('IA');
              return 'Key quitada';
            },
            'btn danger',
          )
        : '',
    ),
    field('Turnos del pueblo', quality, 'Cada semana de juego la IA decide qué hace cada vecino. «Calidad» usa por defecto el modelo bueno; «Ahorro», el barato. Al pasar del 70 % de un tope, los turnos bajan solos al barato.'),
    field('Modelo de los vecinos (lotes)', model.root, 'Los turnos del pueblo: qué hace, piensa y gasta cada vecino.'),
    field('Modelo del director (y consejero)', premium.root, 'Director del pueblo, consejero y diario. Por defecto: Claude Sonnet o GPT mini.'),
    h('div', { class: 'row wrap models-row' }, reload, modelsStatus),
    field('Vecinos que piensan con IA (%)', share, 'En las partidas nuevas con la IA del servidor. Con una key propia, lo elige quien juega.'),
    field('Vecinos con nombre en Modo normal (1–20)', citizens),
    h('h3', {}, 'Topes de gasto (€)'),
    h('div', { class: 'row wrap' }, field('Servidor al mes', capServer), field('Cada partida al mes', capGameMonth), field('Cada partida al día', capGameDay)),
    h('p', { class: 'help' }, 'Al llegar a un tope, la IA se pausa y deciden las reglas. Pon también un límite en el panel de tu proveedor.'),
    costLine,
    playerRow,
    h(
      'details',
      { class: 'advanced' },
      h('summary', {}, 'Avanzado: endpoint propio y precios'),
      field('Endpoint propio (Ollama, LM Studio…)', baseUrl, 'Solo para un modelo local compatible con OpenAI. Normalmente, en blanco.'),
      field('Precios propios (€ por millón de tokens, JSON)', prices, 'Se suman a la tabla incluida. En blanco, la tabla incluida.'),
      pricesErr,
    ),
action('Guardar la IA', async () => (await saveAi(), 'IA guardada'), 'btn primary wide'),
  );

  /* --- partidas --- */
  const gameList = h('ul', { class: 'admin-list' });
  const gamesSummary = h('span', { class: 'muted small' });
  const countGames = () => {
    const n = gameList.querySelectorAll('li .btn.danger').length;
    gamesSummary.textContent = n ? `${n} ${n === 1 ? 'partida' : 'partidas'}` : 'ninguna';
  };
  const fillGames = (rows: GameRow[]) =>
    gameList.replaceChildren(
      ...(rows.length
        ? rows.map((g) => {
            const li = h(
              'li',
              {},
              h('a', { href: `${base}/p/${g.token}`, class: 'mono small', target: '_blank', rel: 'noopener' }, `…/p/${g.token.slice(0, 6)}…`),
              h('span', { class: 'small' }, `${g.mode === 'ai' ? 'IA' : 'Normal'}${g.scenario && g.scenario !== 'libre' ? ` · ${SCENARIO_LABEL[g.scenario] ?? g.scenario}` : ''} · ${g.population} ${g.population === 1 ? 'vecino' : 'vecinos'}${g.date ? ` · ${formatDate(g.date)}` : ''}${g.aiMonthEur ? ` · ${eur(g.aiMonthEur)} este mes` : ''}`),
              h('span', { class: 'muted small' }, `Última partida: ${new Date(g.updatedAt).toLocaleString('es-ES')}`),
            );
            const row = h('div', { class: 'row' }, h('a', { class: 'btn small', href: `/api/games/${g.token}/export`, download: '' }, 'Exportar'));
            row.append(
              action(
                'Borrar',
                async () => {
                  if (!(await confirmDialog('Borrar partida', 'Se borra para siempre (las copias de seguridad la conservan unos días).', 'Borrar'))) return;
                  await req('DELETE', `/api/admin/games/${g.token}`);
                  const next = li.nextElementSibling?.querySelector<HTMLElement>('.btn.danger') ?? li.previousElementSibling?.querySelector<HTMLElement>('.btn.danger');
                  li.remove();
                  countGames();
                  if (next) next.focus();
                  else focusCard('Partidas');
                  return 'Partida borrada';
                },
                'btn small danger',
              ),
            );
            li.append(row);
            return li;
          })
        : [h('li', { class: 'muted' }, 'Todavía no hay partidas.')]),
    );
  fillGames(games);
  countGames();
  const gamesCard = foldCard('Partidas', false, gamesSummary, h('p', { class: 'help' }, 'El enlace de cada partida es su contraseña: no lo compartas.'), gameList);

  /* --- copias --- */
  const keep = input({ type: 'number', min: '1', max: '60', step: '1', value: String(v.backups.keep), inputmode: 'numeric' });
  const backupList = h('ul', { class: 'admin-list' });
  const backupSummary = h('span', { class: 'muted small' });
  const fillBackups = (rows: { name: string; size: number }[]) => {
    const last = rows[0]?.name.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const days = last ? Math.floor((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(last)) / 86_400_000) : null;
    backupSummary.textContent = days === null ? '⚠ ninguna' : `última: ${days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`}`;
    backupSummary.classList.toggle('error', days === null || days > 2);
    backupList.replaceChildren(
      ...(rows.length
        ? rows.map((b) => h('li', { class: 'row between' }, h('span', { class: 'mono small' }, `${b.name} · ${(b.size / 1024).toFixed(0)} KB`), h('a', { class: 'btn small', href: `/api/admin/backups/${b.name}`, download: b.name }, 'Descargar')))
        : [h('li', { class: 'muted' }, 'Sin copias todavía.')]),
    );
  };
  fillBackups(backups);
  // Sin copias, o la última de hace más de 2 días: la tarjeta se abre sola (ronda 09).
  const lastBackup = backups[0]?.name.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const staleBackups = !lastBackup || Date.now() - Date.parse(lastBackup) > 2 * 86_400_000;
  const backupCard = foldCard(
    'Copias de seguridad',
    staleBackups,
    backupSummary,
    h('p', { class: 'help' }, 'Una al día en /data/backups. Para mover el servidor, copia la carpeta /data entera (incluye la clave que cifra las API keys).'),
    field('Copias que se guardan', keep),
    h(
      'div',
      { class: 'row wrap' },
      action('Guardar copias', async () => {
        await save({ backups: { keep: Number(keep.value) } });
        return 'Guardado';
      }),
      action('Hacer una copia ahora', async () => {
        await req('POST', '/api/admin/backups');
        fillBackups(await req('GET', '/api/admin/backups'));
        return 'Copia hecha';
      }),
    ),
    backupList,
  );

  /* --- cuenta --- */
  const user = input({ value: v.admin.user, autocomplete: 'username' });
  const cur = input({ type: 'password', autocomplete: 'current-password' });
  const npw = input({ type: 'password', autocomplete: 'new-password', minlength: '8', placeholder: 'en blanco: la misma' });
  const account = foldCard(
    'Cuenta del administrador',
    false,
    h('span', { class: 'muted small' }, v.admin.user),
    field('Usuario', user),
    field('Contraseña nueva', npw),
    field('Contraseña actual (para confirmar)', cur),
    action('Guardar cuenta', async () => {
      await req('POST', '/api/admin/account', { currentPassword: cur.value, user: user.value.trim(), ...(npw.value ? { newPassword: npw.value } : {}) });
      cur.value = '';
      npw.value = '';
      return 'Cuenta actualizada';
    }, 'btn primary wide'),
  );

  body().replaceChildren(summary, server, aiCard, gamesCard, backupCard, account);
  if (focus) focusCard(focus);
}

async function start(): Promise<void> {
  try {
    const me = await req<{ user: string; mustChange: boolean }>('GET', '/api/admin/me');
    if (me.mustChange) renderChange(me.user);
    else await renderPanel();
  } catch {
    renderLogin();
  }
}

applyPrefs();
$('#logout').addEventListener('click', async () => {
  await req('POST', '/api/admin/logout').catch(() => null);
  renderLogin();
});
void start();
