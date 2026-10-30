import type { Command, TaxLevel } from '@bitopolis/shared';
import { BUILD_NAMES, type Citizen, type GameState, IBI_RATE, PLUSVALIA_RATE, TASA_BASURAS, TASA_TERRAZAS, TAX_SPLIT_POP } from '@bitopolis/sim';
import { money, MONTHS } from './i18n.ts';
import { h, sheet } from './ui.ts';

type Cmd = (c: Command) => Promise<boolean>;

const LEVEL_NAME: Record<TaxLevel, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto' };
const pct = (n: number) => `${Math.round(n * 1000) / 10} %`.replace('.', ',');

/** Glosario a un toque: una frase sencilla por tributo (spec §5.4). */
export const GLOSSARY: Record<string, { name: string; text: string }> = {
  ibi: { name: 'IBI', text: 'Impuesto sobre la vivienda. Sube tu dinero y baja la felicidad de los propietarios (y algo la de los inquilinos, porque sube el alquiler).' },
  tasas: { name: 'Tasas', text: 'Basuras por hogar y terrazas por comercio. Las pagan todos: sube tu dinero y baja un poco la felicidad de todo el pueblo.' },
  plusvalia: { name: 'Plusvalía', text: 'Se cobra al vender una vivienda con ganancia. Frena la especulación y molesta a los propietarios.' },
  pie: { name: 'PIE', text: 'Participación en los Ingresos del Estado: el Estado te paga por cada vecino empadronado. Crecer da dinero.' },
};

/** «Las decisiones tienen cara»: a quién afecta un tributo, con nombre. */
function affected(state: GameState, key: 'ibi' | 'tasas' | 'plusvalia' | 'all'): string {
  const named = state.citizens.filter((c) => c.named);
  const isOwner = (c: Citizen) => c.owns || state.buildings.some((b) => b.owner === c.id);
  const group = key === 'tasas' || key === 'all' ? state.citizens : state.citizens.filter(isOwner);
  const names = named.filter((c) => group.includes(c)).map((c) => c.name.split(' ')[0]);
  if (group.length === 0) return 'Ahora mismo no afecta a nadie.';
  const shown = names.slice(0, 3).join(', ');
  const rest = group.length - Math.min(3, names.length);
  return `Afecta a ${shown || 'vecinos'}${rest > 0 ? ` y ${rest} más` : ''}.`;
}

export function openTaxes(getState: () => GameState, command: Cmd): void {
  const state = getState();
  const radio = (current: TaxLevel, label: string, detail: (lv: TaxLevel) => string, onPick: (lv: TaxLevel) => Command) => {
    const box = h('div', { class: 'radio-list compact', role: 'radiogroup', 'aria-label': label });
    for (const lv of ['low', 'medium', 'high'] as const) {
      const b = h('button', { class: 'btn choice', role: 'radio', 'aria-checked': String(current === lv) }, h('strong', {}, LEVEL_NAME[lv]), h('span', {}, detail(lv)));
      b.addEventListener('click', async () => {
        await command(onPick(lv));
        openTaxes(getState, command);
      });
      box.append(b);
    }
    return box;
  };
  const gloss = (k: keyof typeof GLOSSARY) => h('details', { class: 'gloss' }, h('summary', {}, `¿Qué es ${GLOSSARY[k]!.name}?`), h('p', {}, GLOSSARY[k]!.text));

  if (!state.taxesSplit) {
    sheet(
      'Impuestos',
      h('p', {}, 'Un único control para IBI, tasas y plusvalía. Se cobra a fin de mes con el nivel medio del mes.'),
      radio(state.taxLevel, 'Nivel de impuestos', (lv) => (lv === 'low' ? 'Vecinos más contentos, llega más gente.' : lv === 'high' ? 'Más dinero ahora; baja la felicidad y la recuerdan.' : 'Equilibrio.'), (lv) => ({ type: 'SetTax', level: lv })),
      h('p', { class: 'affects' }, affected(state, 'all')),
      gloss('ibi'),
      gloss('tasas'),
      gloss('plusvalia'),
      gloss('pie'),
      h('p', { class: 'muted' }, `Con ${TAX_SPLIT_POP} vecinos podrás ajustar cada tributo por separado.`),
    );
    return;
  }
  sheet(
    'Tributos municipales',
    h('p', {}, 'Cada tributo afecta a un grupo de vecinos distinto. Se cobran a fin de mes con el nivel medio del mes, y las subidas se recuerdan.'),
    h('h3', {}, 'IBI'),
    radio(state.taxes.ibi, 'IBI', (lv) => `${pct(IBI_RATE[lv])} anual del valor`, (lv) => ({ type: 'SetTaxes', ibi: lv })),
    h('p', { class: 'affects' }, affected(state, 'ibi')),
    gloss('ibi'),
    h('h3', {}, 'Tasas'),
    radio(state.taxes.tasas, 'Tasas', (lv) => `${money(TASA_BASURAS[lv])} por hogar · ${money(TASA_TERRAZAS[lv])} por terraza`, (lv) => ({ type: 'SetTaxes', tasas: lv })),
    h('p', { class: 'affects' }, affected(state, 'tasas')),
    gloss('tasas'),
    h('h3', {}, 'Plusvalía'),
    radio(state.taxes.plusvalia, 'Plusvalía', (lv) => `${pct(PLUSVALIA_RATE[lv])} de la ganancia`, (lv) => ({ type: 'SetTaxes', plusvalia: lv })),
    h('p', { class: 'affects' }, affected(state, 'plusvalia')),
    gloss('plusvalia'),
    gloss('pie'),
  );
}

const CONCEPT: Record<string, string> = {
  sueldos: 'Sueldos municipales',
  mantenimiento: 'Mantenimiento',
  obras: 'Obras',
  intereses: 'Intereses de la deuda',
  alquileres: 'Alquileres municipales',
  IBI: 'IBI',
  tasas: 'Tasas',
  plusvalía: 'Plusvalía',
  PIE: 'PIE (Estado)',
  'venta de viviendas': 'Venta de viviendas',
};

/** Parte mensual: ingresos y gastos con flechas y «por qué baja tu saldo» con nombres. */
export function openReport(state: GameState): void {
  const last = state.stats.at(-1);
  const prev = state.stats.at(-2);
  if (!last) {
    sheet('Parte mensual', h('p', {}, 'Aún no ha terminado ningún mes.'), h('h3', {}, 'Este mes (en curso)'), rows(state.month.breakdown, undefined));
    return;
  }
  const monthName = MONTHS[(last.month - 1 + 12) % 12] ?? '';
  const net = last.income - last.expenses;
  const reasons = Object.entries(last.breakdown)
    .filter(([, v]) => v < 0)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([k, v]) => `${CONCEPT[k] ?? k} (${money(v)})${k === 'sueldos' ? `: ${publicWorkers(state)}` : ''}`);
  sheet(
    `Parte de ${monthName}`,
    h('p', { class: 'big-number' }, `${net >= 0 ? '▲ +' : '▼ '}${money(net)} este mes`),
    rows(last.breakdown, prev?.breakdown),
    net < 0 && reasons.length ? h('p', {}, `Por qué baja tu saldo: ${reasons.join('; ')}.`) : '',
    h('h3', {}, 'Este mes (en curso)'),
    rows(state.month.breakdown, undefined),
  );
}

function publicWorkers(state: GameState): string {
  const names = state.citizens
    .filter((c) => {
      const job = state.buildings.find((b) => b.id === c.jobId);
      return job && job.kind !== 'shop' && job.kind !== 'factory';
    })
    .map((c) => c.name.split(' ')[0]);
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} y ${names.length - 4} más` : names.join(', ');
}

function rows(bd: Record<string, number>, prev: Record<string, number> | undefined) {
  const ul = h('ul', { class: 'accounts' });
  const entries = Object.entries(bd).sort((a, b) => a[1] - b[1]);
  if (!entries.length) ul.append(h('li', {}, 'Sin movimientos todavía.'));
  for (const [k, v] of entries) {
    const p = prev?.[k];
    const trend = p === undefined ? '' : v > p ? ' ↑' : v < p ? ' ↓' : ' =';
    ul.append(h('li', { class: v < 0 ? 'neg' : 'pos' }, h('span', {}, `${CONCEPT[k] ?? k}${trend}`), h('span', {}, `${v > 0 ? '▲ +' : '▼ '}${money(v)}`)));
  }
  return ul;
}

/** Lista de vecinos con nombre; el resto es población estadística. */
export function openNeighbours(state: GameState, onPick: (c: Citizen) => void): void {
  const named = state.citizens.filter((c) => c.named);
  const ul = h('ul', { class: 'people' });
  for (const c of named) {
    const job = state.buildings.find((b) => b.id === c.jobId);
    const mood = c.happiness >= 65 ? '😊' : c.happiness >= 40 ? '😐' : '☹️';
    const btn = h(
      'button',
      { class: 'person-row' },
      h('strong', {}, `${mood} ${c.name}`),
      h('span', { class: 'muted' }, ` · ${c.age} años · ${job ? (job.name ?? BUILD_NAMES[job.kind]) : 'trabaja fuera'}${c.owns ? ' · propietario' : ''}`),
    );
    btn.addEventListener('click', () => onPick(c));
    ul.append(h('li', {}, btn));
  }
  const rest = state.citizens.length - named.length;
  sheet(
    'Vecinos',
    h('p', {}, `${named.length} vecinos con nombre${rest > 0 ? ` y ${rest} vecinos más (población estadística, siguen la media de su barrio)` : ''}.`),
    ul,
  );
}
