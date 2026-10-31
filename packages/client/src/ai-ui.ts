import { api, type AiMeta, type AiSettings } from './api.ts';
import { $, closeSheet, h, sheet, toast } from './ui.ts';

/** Un único formato de euros: «0,42 €» o «menos de 1 céntimo». */
export const eur = (n: number) => (n > 0 && n < 0.01 ? 'menos de 1 céntimo' : `${n.toFixed(2).replace('.', ',')} €`);

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

  // El proveedor no se elige: se deduce de la key («sk-ant-…» es Anthropic; el resto, OpenAI).
  const providerOf = (k: string, base: string) => (base ? 'openai-compatible' : k.startsWith('sk-ant-') ? 'anthropic' : k ? 'openai' : cur.provider);
  // Modelos en blanco = automáticos según la key; se puede escribir otro.
  const models = h('datalist', { id: 'ai-models' }, ...[...new Set(meta.providers.flatMap((p) => p.models ?? []))].map((m) => h('option', { value: m })));
  const explicit = (m: string, kind: 'cheap' | 'premium') => (meta.providers.some((p) => p[kind] === m) ? '' : m);
  const model = h('input', { id: 'ai-model', value: explicit(cur.model, 'cheap'), placeholder: `Automático (${cur.model})`, autocomplete: 'off', list: 'ai-models', ...ro('model') }) as HTMLInputElement;
  const premium = h('input', { id: 'ai-premium', value: explicit(cur.modelPremium, 'premium'), placeholder: `Automático (${cur.modelPremium})`, autocomplete: 'off', list: 'ai-models', ...ro('modelPremium') }) as HTMLInputElement;
  const baseUrl = h('input', { id: 'ai-base', type: 'url', value: cur.baseUrl ?? '', placeholder: 'http://ollama:11434/v1', ...ro('baseUrl') }) as HTMLInputElement;
  const key = h('input', {
    id: 'ai-key',
    type: 'password',
    autocomplete: 'off',
    placeholder: cur.keyMask ? `Guardada: ${cur.keyMask}` : 'sk-ant-… o sk-…',
    ...ro('key'),
  }) as HTMLInputElement;
  const capDay = h('input', { id: 'ai-cap-day', type: 'number', min: '0', step: '0.1', value: String(cur.capDay ?? 0.5), ...ro('capDay') }) as HTMLInputElement;
  const capMonth = h('input', { id: 'ai-cap-month', type: 'number', min: '0', step: '0.5', value: String(cur.capMonth ?? 5), ...ro('capMonth') }) as HTMLInputElement;
  const accept = h('input', { type: 'checkbox', id: 'ai-accept' }) as HTMLInputElement;
  const estimate = h('p', { class: 'estimate', 'aria-live': 'polite' });
  const detected = h('span', { class: 'help', 'aria-live': 'polite' });

  const refresh = async () => {
    const provider = providerOf(key.value.trim(), baseUrl.value.trim());
    const info = meta.providers.find((p) => p.id === provider)!;
    detected.textContent = key.value.trim() ? `Detectada: ${info.label}.` : '';
    const m = model.value.trim() || info.cheap;
    try {
      const e = await api.estimate(provider, m, meta.maxCitizens);
      estimate.textContent = `≈ ${eur(e.eurPerHour.x1! * 30)} al mes jugando 1 hora al día a x1 (${eur(e.eurPerHour.x10! * 30)} a x10), con ${meta.maxCitizens} vecinos con nombre.${
        e.known ? '' : ' (Modelo sin precio en la tabla: se estima con uno caro.)'
      } Incluye reintentos y la crónica del mes.`;
    } catch {
      estimate.textContent = '';
    }
  };
  key.addEventListener('input', refresh);
  model.addEventListener('change', refresh);
  baseUrl.addEventListener('change', refresh);

  const save = h('button', { class: 'btn primary wide' }, 'Guardar y usar el Modo IA');
  save.addEventListener('click', async () => {
    if (!accept.checked) {
      toast('Marca la casilla del aviso para continuar.', { kind: 'warn' });
      accept.focus();
      return;
    }
    save.disabled = true;
    try {
      const body: Record<string, unknown> = { sessionId, accepted: true };
      if (!locked.has('model') && model.value.trim()) body.model = model.value.trim();
      if (!locked.has('modelPremium') && premium.value.trim()) body.modelPremium = premium.value.trim();
      if (!locked.has('baseUrl')) body.baseUrl = baseUrl.value.trim();
      if (!locked.has('capDay')) body.capDay = Number(capDay.value);
      if (!locked.has('capMonth')) body.capMonth = Number(capMonth.value);
      if (key.value.trim() && !locked.has('key')) body.key = key.value.trim();
      const s = await api.saveAiConfig(token, body);
      key.value = '';
      if (!s.configured) {
        toast('Falta la API key de Anthropic o de OpenAI.', { kind: 'warn' });
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

  const advanced = h(
    'details',
    { class: 'advanced' },
    h('summary', {}, 'Opciones avanzadas (modelos, tope diario, endpoint propio)'),
    h('label', { class: 'field' }, 'Modelo para decisiones diarias', serverNote('model'), model, h('span', { class: 'help' }, 'En blanco: Claude Haiku con key de Anthropic, GPT nano con key de OpenAI.')),
    h('label', { class: 'field' }, 'Modelo para plenos, consejero y diario', serverNote('modelPremium'), premium),
    models,
    h('label', { class: 'field' }, 'Tope diario (€)', serverNote('capDay'), capDay),
    h('label', { class: 'field' }, 'Endpoint propio (Ollama, LM Studio…)', serverNote('baseUrl'), baseUrl, h('span', { class: 'help' }, 'Solo si usas un modelo local compatible con OpenAI. Normalmente, en blanco.')),
  );
  const fromServer = locked.has('key');
  sheet(
    'Configurar la IA',
    h('p', {}, 'Los vecinos con nombre decidirán con IA. Las llamadas las hace el servidor: tu key no vuelve nunca a este dispositivo.'),
    fromServer
      ? h('p', { class: 'server-ai' }, 'La API key ya la pone el servidor. Solo tienes que aceptar el aviso.')
      : h('label', { class: 'field' }, 'API key', key, h('span', { class: 'help' }, 'Se acepta API key de Anthropic (sk-ant-…) o de OpenAI (sk-…).'), detected),
    h('label', { class: 'field' }, 'Gasto máximo al mes (€)', serverNote('capMonth'), capMonth),
    estimate,
    advanced,
    h('label', { class: 'check warning' }, accept, h('span', {}, 'Pon un límite de gasto en el panel de tu proveedor. Bitópolis es un proyecto personal y no se hace responsable si la key se filtra o se usa de más.')),
    h('div', { class: 'sticky-actions' }, save, previewBtn),
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
    const ok = u.requested ? Math.round((100 * (u.valid + u.retried)) / u.requested) : 100;
    const kinds = Object.entries(u.byKind);
    const cap = u.caps.month;
    const bar = cap ? h('progress', { max: String(cap), value: String(Math.min(cap, u.spend.gameMonth)), 'aria-label': 'Gasto del mes' }) : '';
    const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;
    sheet(
      'Gasto de la IA',
      h('p', { class: 'big-number' }, cap ? `Este mes: ${eur(u.spend.gameMonth)} de ${eur(cap)}` : `Este mes: ${eur(u.spend.gameMonth)} (sin tope)`),
      bar,
      h('p', {}, `Hoy: ${eur(u.spend.gameDay)}${u.caps.day ? ` de ${eur(u.caps.day)}` : ''}. Total de la partida: ${eur(u.eur)}.`),
      h('p', {}, `${ok} % de las decisiones las tomó la IA; el resto, las reglas.`),
      h(
        'details',
        { class: 'advanced' },
        h('summary', {}, 'Detalle técnico'),
        h('ul', { class: 'accounts' }, ...(kinds.length ? kinds.map(([k, v]) => h('li', {}, h('span', {}, k === 'decision' ? 'Decisiones' : k), h('span', {}, eur(v)))) : [h('li', {}, 'Sin llamadas todavía.')])),
        h('p', {}, `${plural(u.calls, 'llamada', 'llamadas')}, ${plural(u.requested, 'decisión pedida', 'decisiones pedidas')} (${u.retried} tras reintento).`),
        h('p', {}, `Tokens: ${u.tokensIn} de entrada y ${u.tokensOut} de salida.`),
        u.caps.server ? h('p', {}, `Servidor (todas las partidas) este mes: ${eur(u.spend.serverMonth)} de ${eur(u.caps.server)}.`) : '',
      ),
    );
  } catch (e) {
    toast((e as Error).message, { kind: 'warn' });
  }
}

/** Burbuja con el motivo sobre el mapa (HTML para que el texto sea legible). */
export function makeBubble(name: string, motivo: string, ai: boolean): HTMLElement {
  const layer = $('#bubbles');
  const el = h(
    'button',
    { class: 'bubble', type: 'button', 'aria-label': `${name}${ai ? ' (decidido por la IA)' : ''}: ${motivo}. Abrir su ficha.` },
    h('strong', {}, name, ai ? h('span', { class: 'ai-badge' }, 'IA', h('span', { class: 'visually-hidden' }, ' (decidido por la IA)')) : ''),
    h('span', { class: 'bubble-text' }, `«${motivo}»`),
  );
  layer.append(el);
  // Lo anuncia el lector de pantalla aunque la burbuja se mueva con el mapa.
  $('#sr-live').textContent = `${name}${ai ? ', decidido por la IA' : ''}: ${motivo}`;
  while (layer.children.length > 3) layer.firstElementChild?.remove();
  return el;
}
