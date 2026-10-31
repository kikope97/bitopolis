import { openSettings } from './settings-ui.ts';
import { drawSkyline } from './skyline.ts';
import { openAiConfig } from './ai-ui.ts';
import { type AiMeta, api, ApiError, type Summary } from './api.ts';
import { startGame } from './game.ts';
import { formatDate, money, plural, t } from './i18n.ts';
import { sessionId } from './session.ts';
import { $, confirmDialog, h, sheet, toast } from './ui.ts';

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
  // Con key de servidor solo existe el Modo IA (spec §10.2).
  let mode: 'normal' | 'ai' = meta.serverKey ? 'ai' : 'normal';
  const body = $('#start-body');
  body.replaceChildren();
  if (info.exists) {
    body.append(statsCard(info.summary, info.mode));
  } else if (closed) {
    body.append(h('p', { class: 'notice closed' }, 'Ahora mismo no se pueden empezar partidas nuevas (lo decide quien gestiona este servidor). Si ya jugabas, abre el enlace que guardaste; si lo perdiste, pídeselo a esa persona.'));
  } else {
    body.append(modePicker());
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
        const r = await api.create(token, mode, sid);
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
    if (!meta.serverKey) list.append(choice('normal', t('modeNormal'), 'Los vecinos deciden con reglas. Sin coste.'));
    // Sin IA del servidor ni keys propias, solo queda el Modo normal.
    if (meta.serverKey || meta.playerKeys) list.append(
      choice(
        'ai',
        t('modeAi'),
        meta.serverKey
          ? `Los vecinos con nombre deciden con IA. Configurada por el servidor.`
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
