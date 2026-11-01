import { tickToDate } from '@bitopolis/shared';
import { ASSOCIATIONS, attraction, BUDGET_TEXT, BUILD, BUILD_LEVEL, type BudgetPlan, CAUSE_ASK, canHoldFestival, FESTIVAL, type GameState, grantTerms, HERITAGE_NAMES, heritageOf, heritageVariant, kidsCount, ruralHomes, ruralShare, TOURISM, touristified } from '@bitopolis/sim';
import { formatDate, money } from './i18n.ts';
import type { SocialCtx } from './social-ui.ts';
import { confirmDialog, h, sheet } from './ui.ts';

/**
 * v1.5: el ayuntamiento por dentro, en una sola hoja: presupuesto del año,
 * fiestas del pueblo y subvenciones de la Diputación.
 */
const STATUS: Record<string, string> = { open: 'por aprobar (enero)', approved: 'aprobado', prorrogado: 'prorrogado' };
const SIZE: Record<string, string> = { none: 'aún no', pequena: 'pequeñas', grande: 'grandes', popular: 'populares (las montaron los vecinos)' };

export function openTownHall(ctx: SocialCtx, focus?: 'budget' | 'festival' | 'grants' | 'associations' | 'tourism'): void {
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

  const el = sheet('Ayuntamiento', ...budget, ...assoc, ...fest, ...tourismSection(ctx, s, reopen), ...grants, h('h3', {}, 'Censo'), census);
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
    h('p', { 'data-test': 'tourism-month' }, `El mes pasado: ${t.visitors} ${t.visitors === 1 ? 'visitante' : 'visitantes'}; dejaron ${money(t.lastIncome)} (${money(t.lastTax ?? 0)} de tasa para el ayuntamiento y ${money(t.lastRural ?? 0)} para las casas rurales).`),
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
