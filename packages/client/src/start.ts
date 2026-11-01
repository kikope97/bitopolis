import { openSettings } from './settings-ui.ts';
import { drawSkyline } from './skyline.ts';
import { openAiConfig } from './ai-ui.ts';
import { type AiMeta, api, ApiError, type Summary } from './api.ts';
import { startGame } from './game.ts';
import { formatDate, money, plural, t } from './i18n.ts';
import { sessionId } from './session.ts';
import { $, confirmDialog, h, sheet, toast } from './ui.ts';
import { SCENARIO_INFO } from '@bitopolis/sim';
import type { ScenarioId, TerrainShape } from '@bitopolis/shared';

/**
 * 2.3: escenario y terreno de la partida nueva. Fuera de `showStart` para que no
 * se pierdan al volver de configurar la IA. Por defecto, Libre y aleatorio: lo de siempre.
 */
let pickedScenario: ScenarioId = 'libre';
let pickedTerrain: TerrainShape = 'aleatorio';
const SCENARIOS_SHOWN: ScenarioId[] = ['libre', 'quiebra', 'vaciado', 'riada'];
const TERRAINS: [TerrainShape, string][] = [
  ['aleatorio', 'Al azar'],
  ['rio', 'Con río'],
  ['costa', 'Costa'],
  ['colina', 'Colinas'],
  ['llano', 'Llano'],
];

/** Grupo de radio accesible: flechas para moverse, Inicio/Fin, un solo tabulador (roving tabindex). */
function radioKeys(group: HTMLElement, items: HTMLElement[]): void {
  group.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const b = items[(next + items.length) % items.length]!;
    b.focus();
    b.click();
  });
}

function setChecked(items: HTMLElement[], on: HTMLElement): void {
  for (const r of items) {
    r.setAttribute('aria-checked', String(r === on));
    r.tabIndex = r === on ? 0 : -1;
  }
}

/** Bloque plegado «Escenario: Libre ▾» con 4 tarjetas y 5 chips de terreno (solo en partidas nuevas). */
function scenarioPicker(): HTMLElement {
  const summaryText = h('span', {}, '');
  const terrainNote = h('p', { class: 'muted small', id: 'terrain-note' }, '');
  const refresh = () => {
    const terr = TERRAINS.find(([k]) => k === pickedTerrain)![1].toLowerCase();
    summaryText.textContent = `Escenario: ${SCENARIO_INFO[pickedScenario].name}${pickedTerrain === 'aleatorio' ? '' : ` · ${terr}`}`;
    terrainNote.textContent = pickedScenario === 'riada' ? 'Tras la riada el mapa siempre tiene río.' : '';
  };
  const cards: HTMLElement[] = [];
  const cardList = h('div', { class: 'radio-list compact', role: 'radiogroup', 'aria-label': 'Escenario' });
  for (const id of SCENARIOS_SHOWN) {
    const info = SCENARIO_INFO[id];
    const b = h('button', { class: 'btn choice', type: 'button', role: 'radio', 'aria-checked': String(id === pickedScenario), 'data-scenario': id }, h('strong', {}, info.name), h('span', {}, info.goal));
    b.tabIndex = id === pickedScenario ? 0 : -1;
    b.title = info.story;
    b.addEventListener('click', () => {
      pickedScenario = id;
      setChecked(cards, b);
      refresh();
    });
    cards.push(b);
    cardList.append(b);
  }
  radioKeys(cardList, cards);
  const chips: HTMLElement[] = [];
  const chipList = h('div', { class: 'terrain-chips', role: 'radiogroup', 'aria-label': 'Terreno', 'aria-describedby': 'terrain-note' });
  for (const [id, label] of TERRAINS) {
    const c = h('button', { class: 'terrain-chip', type: 'button', role: 'radio', 'aria-checked': String(id === pickedTerrain), 'data-terrain': id }, label);
    c.tabIndex = id === pickedTerrain ? 0 : -1;
    c.addEventListener('click', () => {
      pickedTerrain = id;
      setChecked(chips, c);
      refresh();
    });
    chips.push(c);
    chipList.append(c);
  }
  radioKeys(chipList, chips);
  refresh();
  const story = h('p', { class: 'muted small' }, 'Un escenario empieza con un pueblo ya hecho y una meta con plazo. Si no llegas, no pierdes: sigue como partida libre.');
  const details = h(
    'details',
    { class: 'scenario-picker' },
    h('summary', {}, summaryText, h('span', { class: 'chev', 'aria-hidden': 'true' }, '▾')),
    story,
    cardList,
    h('h3', { class: 'small-title', id: 'terrain-title' }, 'Terreno'),
    chipList,
    terrainNote,
  ) as HTMLDetailsElement;
  // Abierto si ya se había elegido algo (al volver de configurar la IA).
  details.open = pickedScenario !== 'libre' || pickedTerrain !== 'aleatorio';
  return details;
}

/** Pantalla de inicio de /p/<token>. */
export async function showStart(token: string): Promise<void> {
  const sid = sessionId();
  const root = $('#start');
  root.hidden = false;
  drawSkyline();
  $('#game').hidden = true;
  let info: Awaited<ReturnType<typeof api.get>>;
  let meta: AiMeta;
  try {
    [info, meta] = await Promise.all([api.get(token), api.aiMeta()]);
  } catch (e) {
    root.replaceChildren(h('p', { class: 'error' }, (e as Error).message));
    return;
  }

  const url = `${meta.publicUrl || location.origin}/p/${token}`;
  // Sin partidas nuevas (se decide en /admin), un enlace sin partida no lleva a nada.
  const closed = !info.exists && !meta.newGames;
  // Siempre se puede elegir Modo normal, también con IA del servidor (decisión del creador, spec §10.2).
  let mode: 'normal' | 'ai' = 'normal';
  const body = $('#start-body');
  body.replaceChildren();
  if (info.exists) {
    body.append(statsCard(info.summary, info.mode));
  } else if (closed) {
    body.append(h('p', { class: 'notice closed' }, 'Ahora mismo no se pueden empezar partidas nuevas (lo decide quien gestiona este servidor). Si ya jugabas, abre el enlace que guardaste; si lo perdiste, pídeselo a esa persona.'));
  } else {
    body.append(modePicker(), scenarioPicker());
  }

  const playBtn = $('#play') as HTMLButtonElement;
  playBtn.hidden = closed;
  $('.link-box').hidden = closed;
  playBtn.textContent = info.exists ? t('continue') : t('play');
  playBtn.onclick = async () => {
    playBtn.disabled = true;
    try {
      if (!info.exists) {
        if (mode === 'ai' && !meta.serverKey) {
          await openAiConfig(token, sid, () => void showStart(token));
          return;
        }
        const start = { ...(pickedScenario !== 'libre' ? { scenario: pickedScenario } : {}), ...(pickedTerrain !== 'aleatorio' ? { terrain: pickedTerrain } : {}) };
        const r = await api.create(token, mode, sid, start);
        startGame({ token, sessionId: sid, state: r.state, onExit: () => location.reload() });
      } else {
        await claimAndPlay(false);
      }
    } catch (e) {
      toast((e as Error).message, { kind: 'warn' });
    } finally {
      playBtn.disabled = false;
    }
  };

  async function claimAndPlay(force: boolean) {
    try {
      const r = await api.claim(token, sid, force);
      startGame({ token, sessionId: sid, state: r.state, onExit: () => location.reload() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        const ok = await confirmDialog(t('busyTitle'), `${t('busyText')} Si juegas aquí, el otro dispositivo dejará de poder guardar.`, t('playHere'));
        if (ok) await claimAndPlay(true);
      } else throw e;
    }
  }

  $('#link-text').textContent = url;
  // La URL pública (de /admin) puede no ser la de la barra del navegador: es la misma partida.
  const other = !!meta.publicUrl && new URL(meta.publicUrl).origin !== location.origin;
  $('#link-note').hidden = !other;
  if (other) $('#copy-link').setAttribute('aria-describedby', 'link-note');
  ($('#copy-link') as HTMLButtonElement).onclick = () => copy(url);
  ($('#configure') as HTMLButtonElement).onclick = () => openConfig(info.exists);

  function statsCard(s: Summary, gameMode: string) {
    return h(
      'dl',
      { class: 'stats-card', 'aria-label': 'Estado de la partida' },
      h('dt', {}, 'Modo'),
      h('dd', {}, gameMode === 'ai' ? t('modeAi') : t('modeNormal')),
      h('dt', {}, 'Población'),
      h('dd', {}, plural(s.population, 'vecino', 'vecinos')),
      h('dt', {}, 'Fecha'),
      h('dd', {}, formatDate(s.date)),
      h('dt', {}, 'Caja'),
      h('dd', {}, money(s.treasury)),
      h('dt', {}, 'Felicidad'),
      h('dd', {}, `☺ ${s.happiness}`),
      s.headline ? h('dt', {}, 'Último titular') : '',
      s.headline ? h('dd', { class: 'headline' }, `«${s.headline}»`) : '',
    );
  }

  function modePicker() {
    const radios: HTMLElement[] = [];
    const choice = (m: 'normal' | 'ai', title: string, desc: string) => {
      const b = h('button', { class: 'btn choice', role: 'radio', 'aria-checked': String(mode === m) }, h('strong', {}, title), h('span', {}, desc));
      b.addEventListener('click', () => {
        mode = m;
        for (const r of radios) r.setAttribute('aria-checked', String(r === b));
        if (m === 'ai' && !meta.serverKey) void openAiConfig(token, sid, () => void showStart(token));
      });
      radios.push(b);
      return b;
    };
    const list = h('div', { class: 'radio-list', role: 'radiogroup', 'aria-label': 'Modo de juego' });
    list.append(choice('normal', t('modeNormal'), 'Los vecinos deciden con reglas. Sin coste.'));
    // Sin IA del servidor ni keys propias, solo queda el Modo normal.
    if (meta.serverKey || meta.playerKeys) list.append(
      choice(
        'ai',
        t('modeAi'),
        meta.serverKey
          ? `Los vecinos con nombre deciden con IA. Configurada por el servidor: no tienes que poner nada.`
          : 'Los vecinos con nombre deciden con IA. Necesita una API key y tiene coste.',
      ),
    );
    const noAi = !meta.serverKey && !meta.playerKeys ? h('p', { class: 'muted small' }, 'El Modo IA no está disponible en este servidor.') : '';
    return h('div', { class: 'mode-picker' }, h('p', { class: 'muted' }, 'El modo se elige ahora y queda fijo para toda la partida.'), list, noAi);
  }

  function openConfig(exists: boolean) {
    const items: (Node | string)[] = [
      h('p', {}, t('saveLink')),
      h('p', { class: 'mono' }, url),
    ];
    const copyBtn = h('button', { class: 'btn wide' }, t('copyLink'));
    copyBtn.onclick = () => copy(url);
    items.push(copyBtn);
    if (exists) {
      const regen = h('button', { class: 'btn wide' }, t('regenerate'));
      regen.onclick = async () => {
        if (!(await confirmDialog(t('regenerate'), t('regenerateConfirm'), t('regenerate')))) return;
        const r = await api.regenerate(token, sid);
        location.replace(`/p/${r.token}`);
      };
      const exp = h('a', { class: 'btn wide', href: `/api/games/${token}/export`, download: '' }, t('export'));
      items.push(regen, exp);
    }
    if (meta.newGames) {
      const input = h('input', { type: 'file', accept: '.bitopolis,application/octet-stream', id: 'import-file', class: 'visually-hidden' }) as HTMLInputElement;
      const label = h('label', { class: 'btn wide', for: 'import-file' }, t('import'));
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          const r = await api.import(f);
          location.assign(`/p/${r.token}`);
        } catch (e) {
          toast((e as Error).message, { kind: 'warn' });
        }
      };
      items.push(input, label, h('p', { class: 'muted' }, 'Importar crea una partida nueva con otro enlace. Las copias nunca incluyen la API key.'));
    }
    const gameMode = info.exists ? info.mode : null;
    items.push(h('h3', {}, 'Modo'), h('p', {}, gameMode ? `${gameMode === 'ai' ? t('modeAi') : t('modeNormal')} (fijo en esta partida)` : 'Se elige en la pantalla de inicio.'));
    if (gameMode === 'ai' || (!gameMode && !meta.serverKey && meta.playerKeys && meta.newGames)) {
      const aiBtn = h('button', { class: 'btn wide' }, gameMode === 'ai' ? 'Ajustes de la IA (modelo, key y topes)' : 'Configurar la IA');
      aiBtn.onclick = () => void openAiConfig(token, sid, () => void showStart(token));
      items.push(aiBtn);
    }
    const settings = h('button', { class: 'btn wide' }, 'Ajustes (sonido y accesibilidad)');
    settings.onclick = () => openSettings();
    items.push(h('h3', {}, 'Este dispositivo'), settings);
    sheet(t('configure'), ...items);
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('copied'), { kind: 'good' });
  } catch {
    toast(text, { sticky: true });
  }
}
