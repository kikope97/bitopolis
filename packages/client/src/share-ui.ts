import type { GameState } from '@bitopolis/sim';
import { api, type ShareStatus } from './api.ts';
import { sharePostcard } from './postcard.ts';
import { confirmDialog, h, toast } from './ui.ts';

/**
 * 2.3: «Compartir el pueblo» (Pueblo › Ajustes). Un enlace de solo lectura,
 * distinto del de partida: quien lo tenga ve el pueblo pero no puede tocarlo.
 * Y la postal en PNG para mandarla por donde se quiera.
 */
export const viewUrl = (viewToken: string) => `${location.origin}/v/${viewToken}`;

async function copy(text: string, input: HTMLInputElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Enlace copiado', { kind: 'good' });
  } catch {
    // Sin permiso para el portapapeles: se deja seleccionado para copiarlo a mano.
    input.focus();
    input.select();
    toast('Mantén pulsado el enlace para copiarlo', { kind: 'info' });
  }
}

export function shareBlock(token: string, sessionId: string, state: () => GameState): HTMLElement {
  const box = h('div', { class: 'share-box', 'aria-live': 'polite' });
  const postcard = h('button', { class: 'btn wide', id: 'share-postcard' }, 'Compartir postal');
  postcard.addEventListener('click', () => void sharePostcard(state()).catch(() => toast('No se pudo hacer la postal', { kind: 'warn' })));

  const draw = (st: ShareStatus | null, error?: string) => {
    box.replaceChildren();
    if (error) box.append(h('p', { class: 'muted small' }, error));
    if (!st) return;
    if (!st.active) {
      const make = h('button', { class: 'btn wide', id: 'share-create' }, 'Crear enlace de solo lectura');
      make.addEventListener('click', async () => {
        make.setAttribute('disabled', '');
        try {
          draw(await api.share(token, sessionId));
        } catch (e) {
          draw(st, (e as Error).message);
        }
      });
      box.append(h('p', { class: 'muted small' }, 'Ahora mismo nadie más puede ver tu pueblo.'), make);
      return;
    }
    const url = viewUrl(st.viewToken);
    const input = h('input', { id: 'share-url', class: 'share-url mono', type: 'text', readonly: true, value: url, 'aria-label': 'Enlace de solo lectura' }) as HTMLInputElement;
    const copyBtn = h('button', { class: 'btn small', id: 'share-copy' }, 'Copiar enlace');
    copyBtn.addEventListener('click', () => void copy(url, input));
    const row = h('div', { class: 'row share-row' }, copyBtn);
    if (typeof navigator.share === 'function') {
      const send = h('button', { class: 'btn small', id: 'share-send' }, 'Enviar…');
      send.addEventListener('click', () => void navigator.share({ title: 'Mi pueblo en Bitópolis', url }).catch(() => undefined));
      row.append(send);
    }
    const stop = h('button', { class: 'btn danger wide', id: 'share-stop' }, 'Dejar de compartir');
    stop.addEventListener('click', async () => {
      const ok = await confirmDialog('Dejar de compartir', 'El enlace dejará de funcionar para todos. Si luego compartes otra vez, será un enlace nuevo.', 'Dejar de compartir');
      if (!ok) return;
      try {
        draw(await api.unshare(token, sessionId));
        toast('El enlace ya no funciona', { kind: 'info' });
      } catch (e) {
        draw(st, (e as Error).message);
      }
    });
    box.append(
      h('p', { class: 'share-on' }, h('strong', {}, 'Enlace activo.'), ' Quien lo tenga ve el pueblo como quedó en el último guardado, sin poder tocar nada.'),
      input,
      row,
      stop,
    );
  };

  draw(null, 'Mirando si ya lo compartes…');
  void api
    .shareStatus(token)
    .then((st) => draw(st))
    .catch(() => draw(null, 'No se puede consultar ahora. Prueba más tarde.'));

  return h(
    'section',
    { class: 'share-section', 'aria-labelledby': 'share-title' },
    h('h3', { id: 'share-title' }, 'Compartir el pueblo'),
    h('p', { class: 'muted small' }, 'Un enlace para enseñar tu pueblo. No es tu enlace de partida: con él no se puede jugar.'),
    box,
    postcard,
  );
}
