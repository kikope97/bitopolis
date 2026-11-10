import type { Command, TaxLevel } from '@bitopolis/shared';
import { BUILD_NAMES, IBI_RATE, ibiForecast, monthNet, totalDebt, type Citizen, type GameState, MIN_WAGE, type MinWageLevel, PLUSVALIA_RATE, TASA_BASURAS, TASA_TERRAZAS, TAX_SPLIT_POP, trashActive, trashFee, trashServed } from '@bitopolis/sim';
import { money, MONTHS } from './i18n.ts';
import { netText, splitText } from './cash.ts';
import { economyLines } from './money-ui.ts';
import { maintenanceSection } from './nucleo-ui.ts';
import { h, sheet } from './ui.ts';

type Cmd = (c: Command) => Promise<boolean>;

const LEVEL_NAME: Record<TaxLevel, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto' };
const pct = (n: number) => `${Math.round(n * 1000) / 10} %`.replace('.', ',');

/** Glosario a un toque: una frase sencilla por tributo (spec §5.4). */
export const GLOSSARY: Record<string, { name: string; text: string }> = {
  ibi: { name: 'IBI', text: 'Impuesto sobre la vivienda. Sube tu dinero y baja la felicidad de los propietarios (y algo la de los inquilinos, porque sube el alquiler).' },
  tasas: { name: 'Tasas', text: 'Basuras por vecino y terrazas por comercio. Sube tu dinero y baja un poco la felicidad de todo el pueblo. Cuando el pueblo crece, la de basuras solo la paga quien tiene recogida (donde pasa el camión del punto limpio).' },
  plusvalia: { name: 'Plusvalía', text: 'Se cobra al vender una vivienda con ganancia. Frena la especulación y molesta a los propietarios.' },
  pie: { name: 'PIE', text: 'Participación en los Ingresos del Estado: el Estado te paga por cada vecino empadronado. Crecer da dinero.' },
};

/** 2.1: quién paga la tasa de basuras (solo con recogida). */
function trashNote(state: GameState): HTMLElement | string {
  if (!trashActive(state)) return '';
  const served = trashServed(state);
  const homes = state.citizens.filter((c) => c.homeId !== null);
  const paying = homes.filter((c) => served.has(c.homeId!)).length;
  const free = homes.length - paying;
  return h(
    'p',
    { class: 'affects' },
    free
      ? `Basuras: la pagan ${paying} vecinos (por su calle pasa el camión). ${free} no la pagan porque no tienen recogida… y lo notan en la puerta de casa.`
      : `Basuras: la pagan los ${paying} vecinos; el camión pasa por todas las calles.`,
  );
}

/** «Las decisiones tienen cara»: a quién afecta un tributo, con nombre. */
function affected(state: GameState, key: 'ibi' | 'tasas' | 'plusvalia' | 'all'): string {
  const named = state.citizens.filter((c) => c.named);
  const isOwner = (c: Citizen) => c.owns || state.buildings.some((b) => b.owner === c.id);
  const group = key === 'tasas' || key === 'all' ? state.citizens : state.citizens.filter(isOwner);
  const names = named.filter((c) => group.includes(c)).map((c) => c.name.split(' ')[0]);
  if (group.length === 0) return 'Ahora mismo no afecta a nadie.';
  const who = key === 'tasas' || key === 'all' ? 'vecinos' : 'propietarios';
  if (names.length === 0) return `Afecta a ${group.length} ${who}.`;
  const shown = names.slice(0, 3).join(', ');
  const rest = group.length - Math.min(3, names.length);
  return `Afecta a ${shown}${rest > 0 ? ` y ${rest} ${who} más` : ''}.`;
}

/** Cuánto ingresaría al mes cada nivel (estimación con el estado actual). */
function estimate(state: GameState, key: 'ibi' | 'tasas' | 'plusvalia', lv: TaxLevel): string {
  if (key === 'plusvalia') return 'solo cuando se vende una vivienda con ganancia';
  if (key === 'tasas') {
    const shops = state.buildings.filter((b) => b.kind === 'shop' && b.built).length;
    // 2.1: la de basuras, solo quien tiene recogida (con reciclaje, más barata).
    const served = trashServed(state);
    const fees = state.citizens.reduce((a, c) => a + (c.homeId === null ? 0 : trashFee(state, TASA_BASURAS[lv], served.get(c.homeId))), 0);
    return `≈ ${money(fees + shops * TASA_TERRAZAS[lv])}/mes`;
  }
  // 2.8: la misma cuenta que el cobro (densidad, fincas, gran empresa, casas vacías y quemadas).
  return `≈ ${money(ibiForecast(state, lv))}/mes`;
}

export function openTaxes(getState: () => GameState, command: Cmd): void {
  const state = getState();
  // En la oposición los impuestos los pone el alcalde rival: se ven, pero no se tocan.
  if (state.politics.mayor !== 'player') {
    const lv = state.taxesSplit ? state.taxes : { ibi: state.taxLevel, tasas: state.taxLevel, plusvalia: state.taxLevel };
    sheet(
      'Impuestos',
      h('p', { class: 'pol-banner' }, h('strong', {}, 'Estás en la oposición. '), `Los impuestos los decide el alcalde ${state.politics.party?.leaderName ?? 'rival'}.`),
      h('p', {}, `IBI ${LEVEL_NAME[lv.ibi].toLowerCase()}, tasas ${LEVEL_NAME[lv.tasas].toLowerCase()} y plusvalía ${LEVEL_NAME[lv.plusvalia].toLowerCase()}.`),
    );
    return;
  }
  const radio = (current: TaxLevel, label: string, detail: (lv: TaxLevel) => string, onPick: (lv: TaxLevel) => Command) => {
    const box = h('div', { class: 'radio-list compact', role: 'radiogroup', 'aria-label': label });
    for (const lv of ['low', 'medium', 'high'] as const) {
      const b = h(
        'button',
        { class: 'btn choice', role: 'radio', 'aria-checked': String(current === lv) },
        h('strong', {}, `${current === lv ? '✓ ' : ''}${LEVEL_NAME[lv]}${current === lv ? ' (actual)' : ''}`),
        h('span', {}, detail(lv)),
      );
      b.addEventListener('click', async () => {
        await command(onPick(lv));
        openTaxes(getState, command);
      });
      box.append(b);
    }
    return box;
  };
  const gloss = (k: keyof typeof GLOSSARY) => h('details', { class: 'gloss' }, h('summary', {}, `¿Qué es ${GLOSSARY[k]!.name}?`), h('p', {}, GLOSSARY[k]!.text));
  // v1.9 (petición del creador): sueldo mínimo obligatorio en las empresas del pueblo.
  const wageBox = h('div', { class: 'radio-list compact', role: 'radiogroup', 'aria-label': 'Sueldo mínimo' });
  const cur = state.minWage ?? 'none';
  const shops = state.buildings.filter((b) => (b.kind === 'shop' || b.kind === 'factory') && b.built);
  const workers = state.citizens.filter((c) => shops.some((b) => b.id === c.jobId)).length;
  const owners = new Set(shops.map((b) => b.owner).filter((o) => state.citizens.some((c) => c.id === o))).size;
  for (const lv of ['none', 'low', 'medium', 'high'] as const) {
    const extra = (MIN_WAGE[lv] - MIN_WAGE.none) * workers;
    const b = h(
      'button',
      { class: 'btn choice', role: 'radio', 'aria-checked': String(cur === lv) },
      h('strong', {}, `${cur === lv ? '✓ ' : ''}${MIN_WAGE_NAME[lv]}${cur === lv ? ' (actual)' : ''}`),
      h('span', {}, `${lv === 'none' ? `pagan lo de siempre (${money(MIN_WAGE[lv])} al mes)` : `${money(MIN_WAGE[lv])} al mes`}${extra > 0 ? ` · las empresas pagan ${money(extra)} más al mes en nóminas` : ''}`),
    );
    b.addEventListener('click', async () => {
      await command({ type: 'SetMinimumWage', level: lv });
      openTaxes(getState, command);
    });
    wageBox.append(b);
  }
  const wageSection = [
    h('h3', {}, 'Sueldo mínimo'),
    wageBox,
    h('p', { class: 'affects' }, `A quién afecta: ${workers} ${workers === 1 ? 'vecino trabaja' : 'vecinos trabajan'} en empresas del pueblo (cobran más y están más contentos); ${owners} ${owners === 1 ? 'vecino tiene' : 'vecinos tienen'} empresa (pagan más, ganan menos y se enfadan; si no llegan a las nóminas, cierran). Con el sueldo alto, las empresas suben precios y se abren menos.`),
  ];

  if (!state.taxesSplit) {
    sheet(
      'Impuestos',
      h('p', {}, 'Un único control para IBI, tasas y plusvalía. Se cobra a fin de mes con el nivel medio del mes.'),
      radio(
        state.taxLevel,
        'Nivel de impuestos',
        (lv) => `${lv === 'low' ? 'Vecinos más contentos, llega más gente.' : lv === 'high' ? 'Más dinero ahora; baja la felicidad y la recuerdan.' : 'Equilibrio.'} IBI ${estimate(state, 'ibi', lv)}, tasas ${estimate(state, 'tasas', lv)}.`,
        (lv) => ({ type: 'SetTax', level: lv }),
      ),
      h('p', { class: 'affects' }, affected(state, 'all')),
      gloss('ibi'),
      gloss('tasas'),
      gloss('plusvalia'),
      gloss('pie'),
      ...wageSection,
      h('p', { class: 'muted' }, `Con ${TAX_SPLIT_POP} vecinos podrás ajustar cada tributo por separado.`),
    );
    return;
  }
  sheet(
    'Tributos municipales',
    h('p', {}, 'Cada tributo afecta a un grupo de vecinos distinto. Se cobran a fin de mes con el nivel medio del mes, y las subidas se recuerdan.'),
    h('h3', {}, 'IBI'),
    radio(state.taxes.ibi, 'IBI', (lv) => `${pct(IBI_RATE[lv])} anual del valor · ${estimate(state, 'ibi', lv)}`, (lv) => ({ type: 'SetTaxes', ibi: lv })),
    h('p', { class: 'affects' }, affected(state, 'ibi')),
    gloss('ibi'),
    h('h3', {}, 'Tasas'),
    radio(state.taxes.tasas, 'Tasas', (lv) => `${money(TASA_BASURAS[lv])} por vecino y ${money(TASA_TERRAZAS[lv])} por terraza · ${estimate(state, 'tasas', lv)}`, (lv) => ({ type: 'SetTaxes', tasas: lv })),
    h('p', { class: 'affects' }, affected(state, 'tasas')),
    trashNote(state),
    gloss('tasas'),
    h('h3', {}, 'Plusvalía'),
    radio(state.taxes.plusvalia, 'Plusvalía', (lv) => `${pct(PLUSVALIA_RATE[lv])} de la ganancia`, (lv) => ({ type: 'SetTaxes', plusvalia: lv })),
    h('p', { class: 'affects' }, affected(state, 'plusvalia')),
    gloss('plusvalia'),
    gloss('pie'),
    ...wageSection,
  );
}

const MIN_WAGE_NAME: Record<MinWageLevel, string> = { none: 'Sin mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto' };

const CONCEPT: Record<string, string> = {
  'deudas cobradas': 'Deudas cobradas a vecinos',
  microcréditos: 'Microcréditos concedidos',
  sueldos: 'Sueldos municipales',
  mantenimiento: 'Mantenimiento',
  // 2.6: gasto corriente que crece con el pueblo (upkeep.ts).
  'servicios generales': 'Alumbrado, limpieza y oficinas',
  calles: 'Conservación de calles',
  'viviendas municipales': 'Comunidad de las casas municipales',
  obras: 'Obras',
  intereses: 'Intereses de la deuda',
  préstamo: 'Préstamo recibido',
  préstamos: 'Cuotas de los préstamos',
  // 2.8: lo devuelto antes de tiempo (loans.ts).
  amortización: 'Amortización anticipada',
  subvenciones: 'Subvenciones',
  alquileres: 'Alquileres municipales',
  IBI: 'IBI',
  tasas: 'Tasas',
  plusvalía: 'Plusvalía',
  PIE: 'PIE (Estado)',
  'venta de viviendas': 'Venta de viviendas',
  multas: 'Multas a los detenidos',
  'reparaciones (disturbios)': 'Reparaciones tras disturbios',
  'reparaciones (incendio)': 'Reparaciones tras incendios',
  'reparaciones (inundación)': 'Reparaciones tras riadas',
  quitanieves: 'Quitanieves',
  'multa del río': 'Multa de la Confederación (río sucio)',
};

/**
 * 2.8: claves del parte que son lo mismo con otro nombre. La comarca apunta
 * «subvencion» (comarca.ts) y el resto del juego «subvenciones»; se juntan aquí
 * para no cambiar el concepto en el motor (cambiaría el hash de las partidas).
 */
const CONCEPT_ALIAS: Record<string, string> = { subvencion: 'subvenciones' };

/** El desglose de un mes con los alias juntos. */
export function mergedBreakdown(bd: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bd)) {
    const key = CONCEPT_ALIAS[k] ?? k;
    out[key] = (out[key] ?? 0) + v;
  }
  return out;
}

const isWorks = (k: string) => k.startsWith('obras') || k.startsWith('reparaciones');

/**
 * Parte mensual: ingresos y gastos con flechas y «por qué baja tu saldo» con nombres.
 * 2.8 (ronda 24): la cabecera es el neto del mes (`monthNet`): «Entra» (sin el
 * préstamo) menos «Sale cada mes» (sin las obras). El préstamo recibido, las obras
 * y lo amortizado van en sus líneas aparte, así que la cabecera cuadra con las líneas.
 */
export function openReport(state: GameState): void {
  const last = state.stats.at(-1);
  const prev = state.stats.at(-2);
  if (!last) {
    sheet('Parte mensual', h('p', {}, 'Aún no ha terminado ningún mes.'), h('h3', {}, 'Este mes (en curso)'), rows(mergedBreakdown(state.month.breakdown), undefined), maintenanceSection(state));
    return;
  }
  const monthName = MONTHS[(last.month - 1 + 12) % 12] ?? '';
  const n = monthNet(last);
  const net = n.net;
  const bd = mergedBreakdown(last.breakdown);
  const prevBd = prev ? mergedBreakdown(prev.breakdown) : undefined;
  const pick = (f: (k: string, v: number) => boolean) => Object.fromEntries(Object.entries(bd).filter(([k, v]) => f(k, v)));
  const income = pick((k, v) => v > 0 && k !== 'préstamo');
  const spend = pick((k, v) => v < 0 && !isWorks(k) && k !== 'amortización');
  const once = pick((k, v) => v < 0 && (isWorks(k) || k === 'amortización'));
  const reasons = Object.entries(spend)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([k, v]) => `${CONCEPT[k] ?? k} (${money(v)})${k === 'sueldos' ? `: ${publicWorkers(state)}` : ''}`);
  const biggest = Object.entries(spend).sort((a, b) => a[1] - b[1])[0];
  const sentence =
    net >= 0
      ? `Sobran ${money(net)}.${biggest ? ` Tu mayor gasto: ${(CONCEPT[biggest[0]] ?? biggest[0]).toLowerCase()} (${money(-biggest[1])}).` : ''}`
      : `Por qué baja tu saldo: ${reasons.join('; ')}.`;
  const aside = [
    n.works ? `Aparte, ${money(n.works)} en obras, que se pagan una vez.` : '',
    n.repaid ? `Devolviste ${money(n.repaid)} de préstamos antes de tiempo.` : '',
    n.loansIn ? `El banco prestó ${money(n.loansIn)}: entra en la caja, pero no cuenta como ingreso.` : '',
  ].filter(Boolean);
  const live = Object.keys(state.month.breakdown).length;
  sheet(
    `Parte de ${monthName}`,
    h('p', { class: 'big-number', 'data-test': 'report-net' }, `${net >= 0 ? '▲' : '▼'} ${netText(net)} este mes`),
    h('p', {}, `Entra ${money(n.own)} y el gasto de cada mes es de ${money(n.running)}. ${sentence}`),
    aside.length ? h('p', { class: 'muted small', 'data-test': 'report-split' }, `${aside.join(' ')}${n.works || n.repaid ? ` ${splitText(last)}.` : ''}`) : '',
    h('h3', {}, `Entra: ${money(n.own)}`),
    rows(income, prevBd),
    n.loansIn ? h('ul', { class: 'accounts', 'data-test': 'report-loan' }, h('li', { class: 'muted' }, h('span', {}, 'Préstamo recibido', h('span', { class: 'p-sub' }, 'no cuenta en «Entra»: se devuelve')), h('span', {}, `+${money(n.loansIn)}`))) : '',
    h('h3', {}, `Sale cada mes: ${money(n.running)}`),
    rows(spend, prevBd),
    Object.keys(once).length ? h('h3', {}, `Una vez: ${money(n.works + n.repaid)}`) : '',
    Object.keys(once).length ? rows(once, prevBd) : '',
    // 2.6: el mantenimiento, por tipo de edificio.
    maintenanceSection(state),
    // v1.9: los vecinos que no llegan y la salud de las empresas.
    h('h3', {}, 'Vecinos y empresas'),
    h('ul', { class: 'accounts' }, ...economyLines(state).map((l) => h('li', { class: l.bad ? 'neg' : '' }, h('span', {}, l.label), h('span', { class: 'num' }, l.bad ? `⚠ ${l.value}` : l.value)))),
    live ? h('details', { class: 'advanced' }, h('summary', {}, 'Este mes (en curso)'), rows(mergedBreakdown(state.month.breakdown), undefined)) : '',
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
    // Pruebas 2.5: «IBI ↓» junto a «▲ +7924 €» confundía. Un solo signo (+/−) en la cifra
    // y la comparación con el mes anterior, en palabras y en valor absoluto («más», «menos»).
    const a = Math.abs(v);
    const b = p === undefined ? undefined : Math.abs(p);
    const trend = b === undefined || a === b ? '' : `${a > b ? 'más' : 'menos'} que el mes anterior`;
    ul.append(
      h(
        'li',
        { class: v < 0 ? 'neg' : 'pos' },
        h('span', {}, CONCEPT[k] ?? k, trend ? h('span', { class: 'p-sub' }, trend) : ''),
        h('span', {}, `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(a)}`),
      ),
    );
  }
  return ul;
}

/** Lista de vecinos con nombre; el resto es población estadística. */
export function openNeighbours(state: GameState, onPick: (c: Citizen) => void, onlyDebts = false): void {
  // v1.9: filtro «Con deudas» (también para los vecinos sin nombre, en un resumen).
  const named = state.citizens.filter((c) => c.named && (!onlyDebts || totalDebt(c) > 0));
  const ul = h('ul', { class: 'people' });
  for (const c of named) {
    const job = state.buildings.find((b) => b.id === c.jobId);
    const mood = c.happiness >= 65 ? ['😊', 'contento'] : c.happiness >= 40 ? ['😐', 'regular'] : ['☹️', 'descontento'];
    const btn = h(
      'button',
      { class: 'person-row' },
      h('span', { class: 'p-face', 'aria-hidden': 'true' }, mood[0]),
      // Ronda 21: nombre y detalle juntos en la columna ancha (antes el detalle caía en la de 28 px y salía palabra a palabra).
      h(
        'span',
        { class: 'p-main' },
        h('strong', {}, c.name),
        // 2.0: en Modo IA, los vecinos con nombre piensan con IA.
        state.aiMode && state.ai ? h('span', { class: 'ai-mark', title: 'Piensa con IA' }, ' ✦') : '',
        h('span', {}, ` (${mood[1]})`),
        h('span', { class: 'p-sub muted' }, `${c.age} años · ${job ? (job.name ?? BUILD_NAMES[job.kind]) : c.unemployedSince !== undefined ? 'en paro' : 'trabaja fuera'}${c.owns ? ' · propietario' : ''}`, totalDebt(c) > 0 ? h('span', { class: 'pocket-warn' }, ` · debe ${money(totalDebt(c))}`) : ''),
      ),
    );
    btn.addEventListener('click', () => onPick(c));
    ul.append(h('li', {}, btn));
  }
  const debtors = state.citizens.filter((c) => totalDebt(c) > 0);
  const filter = h('button', { class: 'btn small', 'aria-pressed': String(onlyDebts) }, onlyDebts ? 'Ver a todos' : `Con deudas (${debtors.length})`);
  filter.addEventListener('click', () => openNeighbours(state, onPick, !onlyDebts));
  const rest = (onlyDebts ? debtors.length : state.citizens.length) - named.length;
  sheet(
    'Vecinos',
    h('div', { class: 'mg-actions' }, filter),
    onlyDebts
      ? h('p', {}, `${debtors.length} vecinos deben dinero: ${money(debtors.reduce((a, c) => a + (c.debt?.town ?? 0), 0))} al ayuntamiento y ${money(debtors.reduce((a, c) => a + (c.debt?.bank ?? 0), 0))} a bancos y caseros.${rest > 0 ? ` ${rest} de ellos son vecinos sin nombre.` : ''} ${named.length ? ' Toca a uno con nombre para aplazar, perdonar o darle un microcrédito.' : ''}`)
      : h('p', {}, `${named.length} vecinos con nombre${state.aiMode && state.ai ? ' (✦ piensan con IA)' : ''}${rest > 0 ? ` y ${rest} vecinos más (población estadística, siguen la media de su barrio)` : ''}.`),
    ul,
  );
}
