import { api, type AiMeta, type AiSettings } from './api.ts';
import { money } from './i18n.ts';
import { $, closeSheet, h, sheet, toast } from './ui.ts';

const eur = (n: number) => (n < 0.01 ? `${(n * 100).toFixed(2)} céntimos` : `${n.toFixed(2)} €`);

/** Configuración de la IA: proveedor, modelo, key y topes de gasto (spec §9.5, §11). */
export async function openAiConfig(token: string, sessionId: string, onSaved: (s: AiSettings) => void): Promise<void> {
  let meta: AiMeta;
  let cur: AiSettings;
  try {
    [meta, cur] = await Promise.all([api.aiMeta(), api.aiConfig(token)]);
  } catch (e) {
    toast((e as Error).message, { kind: 'warn' });
    return;
  }
  const locked = new Set(cur.locked);
  const ro = (field: string): Record<string, boolean> => (locked.has(field) ? { disabled: true } : {});
  const serverNote = (field: string) => (locked.has(field) ? h('span', { class: 'muted small' }, ' · definido por el servidor') : '');

  const provider = h('select', { id: 'ai-provider', ...ro('provider') }) as HTMLSelectElement;
  for (const p of meta.providers) provider.append(h('option', { value: p.id, ...(p.id === cur.provider ? { selected: true } : {}) }, p.label));
  const model = h('input', { id: 'ai-model', value: cur.model, autocomplete: 'off', ...ro('model') }) as HTMLInputElement;
  const premium = h('input', { id: 'ai-premium', value: cur.modelPremium, autocomplete: 'off', ...ro('modelPremium') }) as HTMLInputElement;
  const baseUrl = h('input', { id: 'ai-base', type: 'url', value: cur.baseUrl ?? '', placeholder: 'http://ollama:11434/v1', ...ro('baseUrl') }) as HTMLInputElement;
  const key = h('input', {
    id: 'ai-key',
    type: 'password',
    autocomplete: 'off',
    placeholder: cur.keyMask ? `Guardada: ${cur.keyMask}` : 'sk-…',
    ...ro('key'),
  }) as HTMLInputElement;
  const capDay = h('input', { id: 'ai-cap-day', type: 'number', min: '0', step: '0.1', value: String(cur.capDay ?? 0.5), ...ro('capDay') }) as HTMLInputElement;
  const capMonth = h('input', { id: 'ai-cap-month', type: 'number', min: '0', step: '0.5', value: String(cur.capMonth ?? 5), ...ro('capMonth') }) as HTMLInputElement;
  const accept = h('input', { type: 'checkbox', id: 'ai-accept' }) as HTMLInputElement;
  const estimate = h('p', { class: 'estimate', 'aria-live': 'polite' });
  const baseRow = h('label', { class: 'field' }, 'Endpoint (URL base)', serverNote('baseUrl'), baseUrl);

  const refresh = async () => {
    const info = meta.providers.find((p) => p.id === provider.value)!;
    if (!locked.has('model') && (!model.value || meta.providers.some((p) => p.cheap === model.value))) model.value = info.cheap;
    if (!locked.has('modelPremium') && (!premium.value || meta.providers.some((p) => p.premium === premium.value))) premium.value = info.premium;
    baseRow.hidden = provider.value !== 'openai-compatible' && !baseUrl.value;
    try {
      const e = await api.estimate(provider.value, model.value, meta.maxCitizens);
      estimate.textContent = `Coste estimado con ${meta.maxCitizens} vecinos con nombre: ${eur(e.eurPerHour.x1!)}/hora a x1, ${eur(e.eurPerHour.x3!)} a x3 y ${eur(e.eurPerHour.x10!)} a x10.${
        e.known ? '' : ' (Modelo sin precio en la tabla: se estima con uno caro.)'
      }`;
    } catch {
      estimate.textContent = '';
    }
  };
  provider.addEventListener('change', refresh);
  model.addEventListener('change', refresh);

  const save = h('button', { class: 'btn primary wide' }, 'Guardar y usar el Modo IA');
  save.addEventListener('click', async () => {
    if (!accept.checked) {
      toast('Marca la casilla del aviso para continuar.', { kind: 'warn' });
      accept.focus();
      return;
    }
    save.disabled = true;
    try {
      const body: Record<string, unknown> = { sessionId, provider: provider.value, accepted: true };
      if (!locked.has('model')) body.model = model.value.trim();
      if (!locked.has('modelPremium')) body.modelPremium = premium.value.trim();
      if (!locked.has('baseUrl')) body.baseUrl = baseUrl.value.trim();
      if (!locked.has('capDay')) body.capDay = Number(capDay.value);
      if (!locked.has('capMonth')) body.capMonth = Number(capMonth.value);
      if (key.value.trim() && !locked.has('key')) body.key = key.value.trim();
      const s = await api.saveAiConfig(token, body);
      key.value = '';
      if (!s.configured) {
        toast('Falta la API key (o el endpoint si es un modelo local).', { kind: 'warn' });
        return;
      }
      toast('IA configurada', { kind: 'good' });
      closeSheet();
      onSaved(s);
    } catch (e) {
      toast((e as Error).message, { kind: 'warn' });
    } finally {
      save.disabled = false;
    }
  });

  const previewBtn = h('button', { class: 'btn wide' }, 'Qué se envía a la IA');
  previewBtn.addEventListener('click', () => void openPreview(token));

  sheet(
    'Configurar la IA',
    h('p', {}, 'Los vecinos con nombre decidirán con un modelo de IA. Todas las llamadas las hace el servidor: la key no vuelve nunca a este dispositivo.'),
    h('label', { class: 'field' }, 'Proveedor', serverNote('provider'), provider),
    h('label', { class: 'field' }, 'Modelo barato (decisiones diarias)', serverNote('model'), model),
    h('label', { class: 'field' }, 'Modelo premium (plenos, consejero, diario)', serverNote('modelPremium'), premium),
    baseRow,
    h('label', { class: 'field' }, 'API key', serverNote('key'), key),
    h('div', { class: 'row' }, h('label', { class: 'field' }, 'Tope diario (€)', serverNote('capDay'), capDay), h('label', { class: 'field' }, 'Tope mensual (€)', serverNote('capMonth'), capMonth)),
    estimate,
    h(
      'label',
      { class: 'check warning' },
      accept,
      ' Pon un límite de gasto en el panel de tu proveedor. Bitópolis es un proyecto personal y no se hace responsable si la key se filtra o se usa de más.',
    ),
    !meta.canStoreKeys && !locked.has('key') ? h('p', { class: 'error' }, 'El servidor no tiene BITOPOLIS_MASTER_KEY: no se pueden guardar keys.') : '',
    save,
    previewBtn,
  );
  void refresh();
}

/** «Qué se envía»: un ejemplo real del prompt (sin key, sin telemetría). */
export async function openPreview(token: string): Promise<void> {
  try {
    const p = await api.aiPreview(token);
    sheet(
      'Qué se envía a la IA',
      h('p', {}, 'Esto es exactamente lo que recibe el modelo: reglas fijas, datos del pueblo y de los vecinos generados por el juego. Nunca se envía texto escrito por ti, ni tu key, ni datos de tu dispositivo. Bitópolis no tiene telemetría.'),
      h('h3', {}, 'Instrucciones (fijas)'),
      h('pre', { class: 'prompt' }, p.system),
      h('h3', {}, 'Datos de este momento'),
      h('pre', { class: 'prompt' }, p.user),
    );
  } catch (e) {
    toast((e as Error).message, { kind: 'warn' });
  }
}

/** Panel de gasto y calidad de la IA. */
export async function openUsage(token: string): Promise<void> {
  try {
    const u = await api.aiUsage(token);
    const pct = (a: number, b?: number) => (b ? ` de ${money(b)} (${Math.round((100 * a) / b)} %)` : ' (sin tope)');
    const ok = u.requested ? Math.round((100 * (u.valid + u.retried)) / u.requested) : 100;
    const kinds = Object.entries(u.byKind);
    sheet(
      'Gasto de la IA',
      h('ul', { class: 'accounts' },
        h('li', {}, h('span', {}, 'Hoy'), h('span', {}, `${eur(u.spend.gameDay)}${pct(u.spend.gameDay, u.caps.day)}`)),
        h('li', {}, h('span', {}, 'Este mes'), h('span', {}, `${eur(u.spend.gameMonth)}${pct(u.spend.gameMonth, u.caps.month)}`)),
        h('li', {}, h('span', {}, 'Servidor (mes)'), h('span', {}, `${eur(u.spend.serverMonth)}${pct(u.spend.serverMonth, u.caps.server)}`)),
        h('li', {}, h('span', {}, 'Total de la partida'), h('span', {}, eur(u.eur))),
      ),
      h('h3', {}, 'Por uso'),
      h('ul', { class: 'accounts' }, ...(kinds.length ? kinds.map(([k, v]) => h('li', {}, h('span', {}, k === 'decision' ? 'Decisiones' : k), h('span', {}, eur(v)))) : [h('li', {}, 'Sin llamadas todavía.')])),
      h('h3', {}, 'Calidad'),
      h('p', {}, `${u.calls} llamadas · ${u.requested} decisiones pedidas · ${ok} % válidas (${u.retried} tras reintento). Las que fallan las toman las reglas.`),
      h('p', { class: 'muted' }, `Tokens: ${u.tokensIn} de entrada, ${u.tokensOut} de salida.`),
    );
  } catch (e) {
    toast((e as Error).message, { kind: 'warn' });
  }
}

/** Burbuja con el motivo sobre el mapa (HTML para que el texto sea legible). */
export function makeBubble(name: string, motivo: string, ai: boolean): HTMLElement {
  const layer = $('#bubbles');
  const el = h(
    'div',
    { class: 'bubble', role: 'note' },
    h('strong', {}, name, ai ? h('span', { class: 'ai-badge', title: 'Decidido por la IA' }, 'IA') : ''),
    h('span', { class: 'bubble-text' }, `«${motivo}»`),
  );
  layer.append(el);
  while (layer.children.length > 3) layer.firstElementChild?.remove();
  return el;
}
