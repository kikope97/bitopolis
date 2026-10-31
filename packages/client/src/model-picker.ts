import { h } from './ui.ts';

/**
 * Selector de modelo (petición del creador): desplegable con los modelos que
 * devuelve la API key y «Otro…» para escribir uno a mano. Mientras no hay
 * lista (o si falla) es un campo de texto normal.
 */
export interface ListedModel {
  id: string;
  name?: string;
  deprecated?: boolean;
  /** false: no está en la tabla de precios, el coste es aproximado. */
  priced: boolean;
}

const OTHER = '__otro__';

export interface ModelPicker {
  /** Va dentro del `.field`, tras la etiqueta. */
  root: HTMLElement;
  /** El control al que apunta la etiqueta (el desplegable si hay lista; si no, el texto). */
  readonly control: HTMLSelectElement | HTMLInputElement;
  value(): string;
  fill(models: ListedModel[]): void;
  /** Sin lista: vuelve al campo de texto. */
  text(): void;
  onChange(fn: () => void): void;
}

export function modelPicker(opts: { id: string; value: string; placeholder: string; auto: string; disabled?: boolean }): ModelPicker {
  const select = h('select', { id: `${opts.id}-list`, hidden: true, ...(opts.disabled ? { disabled: true } : {}) }) as HTMLSelectElement;
  const input = h('input', { id: opts.id, value: opts.value, placeholder: opts.placeholder, autocomplete: 'off', spellcheck: 'false', ...(opts.disabled ? { disabled: true } : {}) }) as HTMLInputElement;
  const note = h('span', { class: 'help', 'aria-live': 'polite' });
  const root = h('div', { class: 'model-picker' }, select, input, note);
  let label: HTMLLabelElement | null = null;
  let models: ListedModel[] = [];
  const listeners: (() => void)[] = [];
  const changed = () => listeners.forEach((f) => f());

  const current = () => (select.hidden ? input.value.trim() : select.value === OTHER ? input.value.trim() : select.value);
  const sync = () => {
    const other = !select.hidden && select.value === OTHER;
    input.hidden = !select.hidden && !other;
    if (other) input.setAttribute('aria-label', 'Otro modelo (escríbelo)');
    else input.removeAttribute('aria-label');
    label ??= root.closest('.field')?.querySelector('label') ?? null;
    // La ayuda del campo (aria-describedby) vale para los dos controles.
    const help = root.getAttribute('aria-describedby');
    if (help) for (const c of [select, input]) c.setAttribute('aria-describedby', help);
    if (label) label.htmlFor = select.hidden ? input.id : select.id;
    const m = models.find((x) => x.id === current());
    note.textContent = m && !m.priced ? 'Este modelo no está en la tabla de precios: el coste es aproximado.' : m?.deprecated ? 'El proveedor va a retirar este modelo.' : '';
  };
  select.addEventListener('change', () => {
    if (select.value === OTHER) {
      input.value = '';
      sync();
      input.focus();
    } else sync();
    changed();
  });
  input.addEventListener('change', changed);

  const picker: ModelPicker = {
    root,
    get control() {
      return select.hidden ? input : select;
    },
    value: current,
    fill(list) {
      const keep = current();
      models = list;
      const text = (m: ListedModel) => `${m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}${m.priced ? '' : ' · coste aproximado'}${m.deprecated ? ' · se retirará' : ''}`;
      select.replaceChildren(
        h('option', { value: '' }, opts.auto),
        ...list.map((m) => h('option', { value: m.id }, text(m))),
        h('option', { value: OTHER }, 'Otro…'),
      );
      select.hidden = false;
      if (!keep || list.some((m) => m.id === keep)) select.value = keep;
      else {
        // Un modelo guardado que la API no lista se conserva en «Otro…».
        select.value = OTHER;
        input.value = keep;
      }
      sync();
    },
    text() {
      const keep = current();
      models = [];
      select.hidden = true;
      input.value = keep;
      sync();
    },
    onChange(fn) {
      listeners.push(fn);
    },
  };
  queueMicrotask(sync);
  return picker;
}

/** Recarga las listas de varios selectores con una petición; si falla, quedan como texto. */
export async function loadModels(pickers: ModelPicker[], status: HTMLElement, fetchList: () => Promise<{ models: ListedModel[] }>): Promise<boolean> {
  status.textContent = 'Cargando modelos…';
  status.classList.remove('error');
  try {
    const r = await fetchList();
    if (!r.models.length) throw new Error('La API key no devuelve ningún modelo');
    for (const p of pickers) p.fill(r.models);
    status.textContent = `${r.models.length} ${r.models.length === 1 ? 'modelo disponible' : 'modelos disponibles'}.`;
    return true;
  } catch (e) {
    for (const p of pickers) p.text();
    status.textContent = `No se pudo cargar la lista de modelos: ${(e as Error).message}. Escribe el modelo a mano.`;
    status.classList.add('error');
    return false;
  }
}
