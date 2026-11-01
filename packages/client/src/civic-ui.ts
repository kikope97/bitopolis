import { tickToDate } from '@bitopolis/shared';
import { ACT_NAMES, ASSOCIATIONS, attraction, canApproveFestival, type FestivalAct, type FestivalBudget, type FestivalSeason, FESTIVAL_SEASONS, programCost, SEASON_NAMES, SEASONS, seasonPossible, townShare, BUDGET_TEXT, BUILD, BUILD_LEVEL, type BudgetPlan, CAUSE_ASK, canHoldFestival, FESTIVAL, type GameState, grantTerms, HERITAGE_NAMES, heritageOf, heritageVariant, kidsCount, ruralHomes, ruralShare, TOURISM, touristified } from '@bitopolis/sim';
import { formatDate, money } from './i18n.ts';
import { openCitizen, type SocialCtx } from './social-ui.ts';
import { confirmDialog, h, sheet } from './ui.ts';

/**
 * v1.5: el ayuntamiento por dentro, en una sola hoja: presupuesto del año,
 * fiestas del pueblo y subvenciones de la Diputación.
 */
const STATUS: Record<string, string> = { open: 'por aprobar (enero)', approved: 'aprobado', prorrogado: 'prorrogado' };
const SIZE: Record<string, string> = { none: 'aún no', pequena: 'pequeñas', grande: 'grandes', popular: 'populares (las montaron los vecinos)' };

export function openTownHall(ctx: SocialCtx, focus?: 'budget' | 'festival' | 'seasons' | 'grants' | 'associations' | 'tourism'): void {
  const s = ctx.state();
  const b = s.budget;
  const d = tickToDate(s.tick);
  const reopen = () => openTownHall(ctx, focus === 'tourism' ? 'tourism' : undefined);
  // Lo que cuesta al mes lo que cambia cada plan (con el último parte).
  const last = s.stats.at(-1)?.breakdown ?? {};
  const maint = Math.abs(last['mantenimiento'] ?? 0);
  const wages = Math.abs(last['sueldos'] ?? 0);
  const euros: Record<BudgetPlan, string> = {
    austero: maint + wages ? ` (≈ ahorras ${money(Math.round(maint * 0.15 + wages * 0.1))} al mes)` : '',
    equilibrado: '',
    inversor: maint ? ` (≈ +${money(Math.round(maint * 0.1))} al mes de mantenimiento)` : '',
  };

  /* --- presupuesto --- */
  const budget: (Node | string)[] = [
    h('h3', { id: 'th-budget' }, `Presupuesto del año ${d.year}`),
    h('p', {}, `Plan en vigor: `, h('strong', {}, b.plan), b.year === d.year ? ` · ${STATUS[b.status]}${b.votesFor + b.votesAgainst ? ` (${b.votesFor} a favor, ${b.votesAgainst} en contra)` : ''}.` : ' · el del año que viene se presenta en enero.'),
  ];
  if (b.status === 'open') {
    budget.push(h('p', { class: 'muted small' }, 'Elige el plan del año. El pleno lo vota: cada facción según lo que prefiere y lo contenta que esté. Si no lo presentas en enero, se prorroga el actual.'));
    for (const plan of ['austero', 'equilibrado', 'inversor'] as BudgetPlan[]) {
      const btn = h('button', { class: 'btn choice' }, h('strong', {}, plan[0]!.toUpperCase() + plan.slice(1)), h('span', { class: 'muted small' }, ` ${BUDGET_TEXT[plan].split(': ')[1]}${euros[plan]}`));
      btn.addEventListener('click', async () => {
        if (await ctx.command({ type: 'ProposeBudget', plan })) reopen();
      });
      budget.push(btn);
    }
  } else budget.push(h('p', { class: 'muted small' }, BUDGET_TEXT[b.plan]));

  /* --- fiestas --- */
  const f = s.festival;
  const fest: (Node | string)[] = [
    h('h3', { id: 'th-festival' }, f.name ? `Fiestas de ${f.name}` : 'Fiestas del pueblo'),
    h('p', {}, f.year === d.year ? `Este año: ${SIZE[f.size]}.` : 'Son en julio y agosto. Si no las organizas, en septiembre las montan los vecinos (más pequeñas).'),
  ];
  if (f.until > s.tick) fest.push(h('p', { class: 'muted small' }, `El buen ambiente dura hasta el ${formatDate(tickToDate(f.until))}.`));
  // Un solo motivo para los dos botones (ronda 11: solo lo explicaba uno, y repetido).
  const why = canHoldFestival(s, 'pequena');
  if (!why.ok) fest.push(h('p', { class: 'muted small' }, why.error ?? ''));
  for (const size of ['pequena', 'grande'] as const) {
    const can = canHoldFestival(s, size);
    const label = `${size === 'grande' ? 'Fiestas grandes' : 'Fiestas pequeñas'} · ${money(FESTIVAL[size].cost)} · +${FESTIVAL[size].mood} de felicidad`;
    const btn = h('button', { class: 'btn wide', ...(can.ok ? {} : { 'aria-disabled': 'true' }) }, label);
    btn.addEventListener('click', async () => {
      if (!can.ok) return;
      if (!(await confirmDialog('Organizar las fiestas', `Cuestan ${money(FESTIVAL[size].cost)}.`, 'Organizar'))) return;
      if (await ctx.command({ type: 'HoldFestival', size })) reopen();
    });
    fest.push(btn);
    if (!can.ok && why.ok) fest.push(h('p', { class: 'muted small' }, can.error ?? ''));
  }

  /* --- subvenciones --- */
  const grants: (Node | string)[] = [h('h3', { id: 'th-grants' }, 'Subvenciones de la Diputación')];
  const live = s.grants.filter((g) => g.status === 'offered' || g.status === 'accepted');
  if (!live.length) grants.push(h('p', { class: 'muted' }, 'Ahora mismo no hay ofertas. Llegan de vez en cuando (desde 10 vecinos).'));
  for (const g of live) {
    // 2.3: las de las grandes obras y el FEDER tienen sus condiciones (grantTerms).
    const terms = grantTerms(g);
    if (g.status === 'offered') {
      const yes = h('button', { class: 'btn primary' }, 'Aceptar');
      const no = h('button', { class: 'btn' }, 'Rechazar');
      yes.addEventListener('click', async () => {
        if (await ctx.command({ type: 'AnswerGrant', grantId: g.id, accept: true })) reopen();
      });
      no.addEventListener('click', async () => {
        if (await ctx.command({ type: 'AnswerGrant', grantId: g.id, accept: false })) reopen();
      });
      grants.push(
        h('div', { class: 'petition' },
          h('p', {}, terms.offer),
          h('p', { class: 'muted small' }, terms.terms),
          h('div', { class: 'row' }, yes, no),
        ),
      );
    } else {
      grants.push(h('p', {}, terms.accepted));
    }
  }

  /* --- asociaciones (v1.7) --- */
  const assoc: (Node | string)[] = [h('h3', { id: 'th-associations' }, 'Asociaciones vecinales')];
  if (!s.associations?.length) {
    assoc.push(h('p', { class: 'muted' }, `Ninguna ahora. Nacen cuando ${ASSOCIATIONS.minMembers} o más vecinos con nombre comparten una queja (desde ${ASSOCIATIONS.minPop} vecinos).`));
  }
  for (const a of s.associations ?? []) {
    const leader = s.citizens.find((c) => c.id === a.leaderId);
    const lines: (Node | string)[] = [
      h('p', {}, h('strong', {}, a.name)),
      h('p', { class: 'muted small' }, `${a.members.length} socios con nombre, con ${leader?.name ?? 'su junta'} al frente. Piden ${CAUSE_ASK[a.cause]}.`),
    ];
    if (a.protestDay >= 0) lines.push(h('p', { class: 'pol-tag' }, `Manifestación convocada para el ${formatDate(tickToDate(a.protestDay))}.`));
    if (a.promiseUntil >= 0) lines.push(h('p', { class: 'small' }, `Les prometiste una solución antes del ${formatDate(tickToDate(a.promiseUntil))}. Si no, volverán más enfadados.`));
    const met = a.lastMeeting >= 0 && s.tick - a.lastMeeting < 30 * 24;
    const btn = h('button', { class: 'btn wide', ...(met ? { 'aria-disabled': 'true' } : {}) }, met ? 'Ya os reunisteis este mes' : `Reunirse y prometer una solución en ${ASSOCIATIONS.promiseMonths} meses`);
    btn.addEventListener('click', async () => {
      if (met) return;
      if (await ctx.command({ type: 'MeetAssociation', associationId: a.id })) reopen();
    });
    lines.push(btn);
    assoc.push(h('div', { class: 'petition' }, ...lines));
  }

  /* --- vecinos --- */
  const kids = kidsCount(s);
  const census = h('p', { class: 'muted small' }, `${s.citizens.length} adultos y ${kids} ${kids === 1 ? 'niño' : 'niños'} (los niños van al colegio y a los 18 se independizan).`);

  const el = sheet('Ayuntamiento', ...budget, ...assoc, ...seasonsSection(ctx, s, () => openTownHall(ctx, 'seasons')), ...fest, ...tourismSection(ctx, s, reopen), ...grants, h('h3', {}, 'Censo'), census);
  // Desde un aviso, directo a su sección (ronda 11: «Aceptar» quedaba fuera de la pantalla).
  if (focus) el.querySelector(`#th-${focus}`)?.scrollIntoView({ block: 'start' });
}

/**
 * 2.3: turismo. Visitantes e ingresos del mes, tasa turística (0, 1 o 2 € por
 * noche, tres botones de 44 px), proteger el entorno del patrimonio y la parte
 * de viviendas que son casas rurales (por encima del 15 %, suben los alquileres).
 */
/** Decimales con coma. */
const dec = (v: number) => String(v).replace('.', ',');

function tourismSection(ctx: SocialCtx, s: GameState, reopen: () => void): (Node | string)[] {
  const t = s.tourism;
  const her = heritageOf(s);
  const out: (Node | string)[] = [h('h3', { id: 'th-tourism' }, 'Turismo')];
  const a = attraction(s);
  if (!her) {
    out.push(h('p', { class: 'muted' }, `El pueblo aún no tiene patrimonio. Constrúyelo en Construir › Turismo (ayuntamiento de nivel ${BUILD_LEVEL.heritage} y ${BUILD.heritage.unlockPop} vecinos; ${TOURISM.heritage.attract} de atractivo): según el terreno será un faro, un molino, un castillo o un rollo con plaza porticada.`));
  } else {
    const name = HERITAGE_NAMES[heritageVariant(s, her.x, her.y)];
    out.push(h('p', {}, her.built ? `Patrimonio: ${name}.` : `Patrimonio: ${name} (en obras).`));
  }
  out.push(
    h('p', { 'data-test': 'tourism-month' }, t.visitors === 0 && a.total >= TOURISM.minAttract ? 'Aún sin datos: los primeros visitantes llegan al cerrar el mes.' : `El mes pasado: ${t.visitors} ${t.visitors === 1 ? 'visitante' : 'visitantes'}; dejaron ${money(t.lastIncome)} (${money(t.lastTax ?? 0)} de tasa para el ayuntamiento y ${money(t.lastRural ?? 0)} para las casas rurales).`),
    h('p', { class: 'muted small' }, `Atractivo ${dec(a.total)}: patrimonio ${dec(a.heritage)}, grandes obras ${dec(a.landmarks)}, fiestas ${dec(a.festival)}, parques y árboles ${dec(a.green)}, contaminación −${dec(a.pollution)}${a.protect > 1 ? `, entorno protegido ×${dec(a.protect)}` : ''}. Por debajo de ${TOURISM.minAttract} no viene nadie.`),
  );
  // Tasa turística: tres botones.
  out.push(h('p', {}, h('strong', {}, 'Tasa turística'), ` · cada nivel quita un ${Math.round(TOURISM.taxDrop * 100)} % de visitantes; cada visitante pasa ${TOURISM.nights} noches.`));
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tasa turística' });
  for (const level of [0, 1, 2] as const) {
    const on = t.tax === level;
    const b = h('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(on), 'data-tax': String(level) }, level === 0 ? 'Sin tasa' : `${level} € por noche`);
    b.addEventListener('click', async () => {
      if (on) return;
      if (await ctx.command({ type: 'SetTouristTax', level })) reopen();
    });
    seg.append(b);
  }
  out.push(seg);
  // Entorno protegido.
  const prot = !!her && t.protectedId === her.id;
  out.push(
    h('p', {}, h('strong', {}, 'Entorno protegido'), prot ? ' · sí' : ' · no'),
    h('p', { class: 'muted small' }, `A ${TOURISM.protect.radius} casillas del patrimonio, ni zona industrial ni talleres nuevos; el atractivo sube un ${Math.round((TOURISM.protect.attract - 1) * 100)} %. A los empresarios no les gusta (−${Math.abs(TOURISM.protect.ownerMood)} de satisfacción).`),
  );
  const can = !!her?.built;
  const pb = h('button', { class: 'btn wide', id: 'protect-area', ...(can ? {} : { 'aria-disabled': 'true' }) }, prot ? 'Levantar la protección' : 'Proteger el entorno');
  pb.addEventListener('click', async () => {
    if (!her || !can) return;
    if (!prot && !(await confirmDialog('Proteger el entorno', 'Las casillas vacías de zona industrial alrededor del patrimonio dejan de serlo.', 'Proteger'))) return;
    if (await ctx.command({ type: 'ProtectArea', heritageId: her.id })) reopen();
  });
  out.push(pb);
  if (!can) out.push(h('p', { class: 'muted small' }, 'Se puede cuando el patrimonio esté terminado.'));
  // Casas rurales.
  const n = ruralHomes(s).length;
  const pct = Math.round(ruralShare(s) * 100);
  out.push(
    h('p', { 'data-test': 'rural-share' }, h('strong', {}, 'Casas rurales'), ` · ${n} (${pct} % de las viviendas). Cada una tiene ${TOURISM.rural.beds} plazas y su dueño gana hasta ${money(TOURISM.rural.maxMonth)} al mes.`),
  );
  if (touristified(s)) out.push(h('p', { class: 'pol-tag' }, `Más del ${Math.round(TOURISM.touristified.share * 100)} %: los alquileres privados suben un ${Math.round(TOURISM.touristified.rent * 100)} % y los inquilinos están más descontentos (−${Math.abs(TOURISM.touristified.renterMood)} de felicidad). Una tasa más alta trae menos visitantes y frena las casas nuevas.`));
  else out.push(h('p', { class: 'muted small' }, `Las abren propietarios con ganas de negocio cuando hay visitantes de sobra. Por encima del ${Math.round(TOURISM.touristified.share * 100)} % de las viviendas, suben los alquileres. Mira la capa «Casas rurales».`));
  return out;
}

/* ---------------- 2.4: fiestas de temporada ---------------- */

/** Fiesta elegida en los chips (si no, la que se prepara o la próxima). */
let seasonPick: FestivalSeason | null = null;
/** Solo al refrescar la hoja desde la propia sección se conserva el chip elegido. */
let keepPick = false;

const BUDGET_LABEL: Record<FestivalBudget, string> = { nada: 'Nada', poco: 'La mitad', todo: 'Todo' };
const MONTH_NAME = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const when = (season: FestivalSeason) => `${SEASONS.day[season]} de ${MONTH_NAME[SEASONS.month[season]! - 1]}`;

/** La próxima fiesta por fecha (desde hoy). */
function nextSeason(s: GameState): FestivalSeason {
  const d = tickToDate(s.tick);
  const today = d.month * 100 + d.day;
  return FESTIVAL_SEASONS.find((x) => SEASONS.month[x]! * 100 + SEASONS.day[x]! >= today) ?? 'romeria';
}

/**
 * Romería, San Juan, patronales y Navidad: un chip por fiesta (44 px), la
 * comisión de festejos (nombres que abren la ficha), el programa con su coste y
 * los tres botones de presupuesto cuando la comisión lo pide.
 */
function seasonsSection(ctx: SocialCtx, s: GameState, reopen: () => void): (Node | string)[] {
  const cur = s.seasons?.current ?? null;
  const d = tickToDate(s.tick);
  const live = cur && (cur.status === 'comision' || cur.status === 'aprobada') ? cur : null;
  const sel = (keepPick ? seasonPick : null) ?? live?.season ?? nextSeason(s);
  keepPick = false;
  const out: (Node | string)[] = [
    h('h3', { id: 'th-seasons' }, 'Fiestas de temporada'),
    h('p', { class: 'muted small' }, 'Un mes antes de cada fiesta, tres vecinos forman la comisión de festejos, preparan el programa y te piden presupuesto. Lo que no pongas lo recaudan ellos (10 € por vecino).'),
  ];
  const chips = h('div', { class: 'seg season-chips', role: 'radiogroup', 'aria-label': 'Fiestas de temporada' });
  for (const season of FESTIVAL_SEASONS) {
    const on = season === sel;
    const asks = live?.season === season && live.status === 'comision' && !!live.asked;
    const b = h('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(on), 'data-season': season }, `${SEASON_NAMES[season]}${asks ? ' •' : ''}`);
    b.addEventListener('click', () => {
      seasonPick = season;
      keepPick = true;
      reopen();
    });
    chips.append(b);
  }
  out.push(chips);
  const f = cur && cur.season === sel && cur.year === d.year ? cur : null;
  const box: (Node | string)[] = [h('p', {}, h('strong', {}, SEASON_NAMES[sel]), ` · ${when(sel)}`)];
  if (!f || f.status === 'cancelada') {
    if (f?.status === 'cancelada' || s.seasons?.held[sel] === d.year) box.push(h('p', { class: 'muted small' }, 'Ya se celebró este año.'));
    else if (!seasonPossible(s, sel)) box.push(h('p', { class: 'muted small' }, 'Hace falta una ermita: sin ermita no hay romería.'));
    else box.push(h('p', { class: 'muted small' }, `La comisión se forma un mes antes (el ${SEASONS.day[sel]} de ${MONTH_NAME[SEASONS.month[sel]! - 2] ?? 'noviembre'}).`));
    if (sel === 'patronales') box.push(h('p', { class: 'muted small' }, 'Las patronales también puedes organizarlas tú en julio o agosto (más abajo).'));
    out.push(h('div', { class: 'petition', 'data-test': 'season-box' }, ...box));
    return out;
  }
  // Comisión (nombres que abren la ficha).
  const members = f.committee.map((id) => s.citizens.find((c) => c.id === id)).filter((c) => !!c);
  if (members.length) {
    const row = h('p', { class: 'season-committee' }, 'Comisión: ');
    members.forEach((c, i) => {
      const a = h('button', { class: 'link-btn', 'data-citizen': String(c.id) }, `${c.name}${i === 0 ? ' (al frente)' : ''}`);
      a.addEventListener('click', () => openCitizen(ctx, c.id));
      if (i) row.append(', ');
      row.append(a);
    });
    box.push(row);
  } else box.push(h('p', { class: 'muted small' }, 'Se está formando la comisión: los vecinos se apuntan estos días.'));
  // Programa.
  const acts = (f.status === 'celebrada' ? (f.held ?? []) : f.program) as FestivalAct[];
  if (acts.length || sel === 'navidad') {
    const list = h('ul', { class: 'season-program' });
    if (sel === 'navidad') list.append(h('li', {}, `Luces · ${money(SEASONS.lights.cost)}`));
    for (const a of acts) list.append(h('li', {}, `${ACT_NAMES[a]} · ${money(SEASONS.acts[a]!.cost)}`));
    box.push(h('p', {}, f.status === 'celebrada' ? 'Se hizo:' : `Programa${f.programBy === 'ia' ? ' (lo eligió la comisión)' : ''}:`), list);
  }
  if (f.status === 'comision' && f.asked) {
    box.push(h('p', {}, `Piden presupuesto: ${money(programCost(sel, f.program))} en total.`));
    for (const budget of ['nada', 'poco', 'todo'] as FestivalBudget[]) {
      const can = canApproveFestival(s, sel, budget);
      const pay = townShare(sel, f.program, budget);
      const note = budget === 'nada' ? 'fiesta popular con lo que recauden; la comisión se lo guardará' : budget === 'poco' ? 'la comisión recauda el resto; si no llega, quita actos' : 'el programa entero';
      const btn = h('button', { class: 'btn choice', 'data-budget': budget, ...(can.ok ? {} : { 'aria-disabled': 'true' }) }, h('strong', {}, `${BUDGET_LABEL[budget]} · ${money(pay)}`), h('span', { class: 'muted small' }, ` ${can.ok ? note : can.error}`));
      btn.addEventListener('click', async () => {
        if (!can.ok) return;
        seasonPick = sel;
        keepPick = true;
        if (await ctx.command({ type: 'ApproveFestival', season: sel, budget })) reopen();
        else keepPick = false;
      });
      box.push(btn);
    }
    box.push(h('p', { class: 'muted small' }, `Si no contestas antes del ${when(sel)}, la comisión hará lo que pueda con lo que recaude.`));
  } else if (f.status === 'aprobada') {
    box.push(h('p', {}, `Presupuesto: ${BUDGET_LABEL[f.budget ?? 'nada'].toLowerCase()} (${money(townShare(sel, f.program, f.budget ?? 'nada'))}). La fiesta es el ${when(sel)}.`));
  } else if (f.status === 'celebrada') {
    const paid = f.paid ? ` Pagó el ayuntamiento ${money(f.paid.town)} y la comisión recaudó ${money(f.paid.collected)}.` : '';
    box.push(h('p', { class: 'small' }, `${f.held?.length ? '' : 'Fiesta popular, sin programa. '}+${f.mood ?? 0} de felicidad${f.until && f.until > s.tick ? ` hasta el ${formatDate(tickToDate(f.until))}` : ''}.${paid}`));
  } else box.push(h('p', { class: 'muted small' }, 'La comisión está preparando el programa.'));
  out.push(h('div', { class: 'petition', 'data-test': 'season-box' }, ...box));
  return out;
}
