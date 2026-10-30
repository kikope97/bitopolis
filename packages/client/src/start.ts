import { api, ApiError, type Summary } from './api.ts';
import { startGame } from './game.ts';
import { formatDate, money, plural, t } from './i18n.ts';
import { sessionId } from './session.ts';
import { $, confirmDialog, h, sheet, toast } from './ui.ts';

/** Pantalla de inicio de /p/<token>. */
export async function showStart(token: string): Promise<void> {
  const sid = sessionId();
  const root = $('#start');
  root.hidden = false;
  $('#game').hidden = true;
  const url = `${location.origin}/p/${token}`;

  let info: Awaited<ReturnType<typeof api.get>>;
  try {
    info = await api.get(token);
  } catch (e) {
    root.replaceChildren(h('p', { class: 'error' }, (e as Error).message));
    return;
  }

  const body = $('#start-body');
  body.replaceChildren();
  if (info.exists) {
    body.append(statsCard(info.summary));
  } else {
    body.append(modePicker());
  }

  const playBtn = $('#play') as HTMLButtonElement;
  playBtn.textContent = info.exists ? t('continue') : t('play');
  playBtn.onclick = async () => {
    playBtn.disabled = true;
    try {
      if (!info.exists) {
        const r = await api.create(token, 'normal', sid);
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
  ($('#copy-link') as HTMLButtonElement).onclick = () => copy(url);
  ($('#configure') as HTMLButtonElement).onclick = () => openConfig(info.exists);

  function statsCard(s: Summary) {
    return h(
      'dl',
      { class: 'stats-card', 'aria-label': 'Estado de la partida' },
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
    const normal = h('button', { class: 'btn choice', role: 'radio', 'aria-checked': 'true' }, h('strong', {}, t('modeNormal')), h('span', {}, 'Los vecinos deciden con reglas. Sin coste.'));
    const ai = h(
      'button',
      { class: 'btn choice', role: 'radio', 'aria-checked': 'false', 'aria-disabled': 'true' },
      h('strong', {}, t('modeAi')),
      h('span', {}, t('modeAiSoon')),
    );
    ai.addEventListener('click', () => toast(`${t('modeAi')}: ${t('modeAiSoon')}.`));
    return h(
      'div',
      { class: 'mode-picker' },
      h('p', { class: 'muted' }, 'El modo se elige ahora y queda fijo para toda la partida.'),
      h('div', { class: 'radio-list', role: 'radiogroup', 'aria-label': 'Modo de juego' }, normal, ai),
    );
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
    items.push(h('h3', {}, 'Modo'), h('p', {}, exists ? `${t('modeNormal')} (fijo en esta partida)` : `${t('modeNormal')}. ${t('modeAi')}: ${t('modeAiSoon')}.`));
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
