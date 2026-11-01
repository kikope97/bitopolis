/**
 * 2.2: licitaciones de obras. Las obras con materiales desde `TENDER.minCost`
 * eligen entre tres ofertas:
 * - local (la de siempre y la de por defecto: no toca el estado ni el azar);
 * - barata de fuera: menos materiales, más plazo, su propia cuadrilla (los
 *   parados del pueblo no cobran) y, a veces, sobrecoste al terminar;
 * - la del primo del concejal: algo más barata y rápida, parte de los
 *   materiales va a la caja del negocio del primo y puede haber escándalo
 *   (rumor a los 14 días, estallido a los 28; «Revisar el contrato» lo anula).
 * El azar sale de `state.rng` al firmar y queda guardado.
 */
import { TICKS_PER_DAY, type BuildKind } from '@bitopolis/shared';
import { BUILD, TENDER, WAGE_LOCAL, WAGE_OUTSIDE } from './balance.ts';
import { materialsCost } from './civic.ts';
import { directorOwns } from './director-core.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { FACTIONS } from './politics-core.ts';
import { chance } from './prng.ts';
import { addMemory } from './social.ts';
import { type Building, type Citizen, type GameState, type Project, pushEvent } from './state.ts';

export const OFFERS = ['local', 'fuera', 'primo'] as const;
export type Offer = (typeof OFFERS)[number];

export interface Tender {
  /** La obra (id del edificio). */
  buildingId: number;
  kind: string;
  offer: Exclude<Offer, 'local'>;
  tick: number;
  /** Lo que se pagó al firmar (materiales) y, en la de fuera, el sobrecoste que llegará al terminar. */
  paid: number;
  /** Materiales de la obra a precio local (base de comisión, sobrecoste y revisión). */
  mat: number;
  overrun?: number;
  /** La del primo: quién se queda la obra, el concejal y el negocio que cobró la comisión. */
  ownerId?: number;
  councillorId?: number;
  businessName?: string;
  kick?: number;
  /** Escándalo (decidido al firmar): rumor y estallido. */
  risk?: boolean;
  warnAt?: number;
  revealAt?: number;
  status: 'firmado' | 'avisado' | 'estallado' | 'revisado' | 'olvidado' | 'cerrado';
}

/** Nombre de una obra para los avisos. */
const NAMES: Record<string, string> = {
  water: 'la bomba de agua', power: 'la central', school: 'el colegio', clinic: 'el centro de salud', police: 'la comisaría',
  plaza: 'la Plaza Mayor', market: 'el Mercado', chapel: 'la ermita', library: 'la biblioteca', sports: 'el polideportivo',
  jail: 'la cárcel', firestation: 'el parque de bomberos', civilprotection: 'protección civil', cleanpoint: 'el punto limpio',
  house: 'la casa municipal', bar: 'el bar', cemetery: 'el cementerio', park: 'el parque',
};
export const worksName = (kind: string) => NAMES[kind] ?? 'la obra';

const first = (c: { name: string }) => c.name.split(' ')[0]!;

/** ¿Esta obra se licita? (materiales desde `TENDER.minCost`, con el presupuesto y la colina). */
export function tenderApplies(state: GameState, kind: BuildKind, x: number, y: number): boolean {
  return kind !== 'road' && (state.townhallLevel ?? 1) >= TENDER.fromLevel && materialsCost(state, kind, x, y) >= TENDER.minCost;
}

/**
 * El concejal (el vecino con nombre que más apoya al alcalde) y su primo: él
 * mismo, su pareja o un amigo con un negocio abierto en el pueblo. Sin eso, no
 * hay oferta del primo.
 */
export function cronyOf(state: GameState): { councillor: Citizen; owner: Citizen; business: Building } | null {
  if (state.politics?.mayor && state.politics.mayor !== 'player') return null;
  const support = (c: Citizen) => (c.attitude ?? 0) * 20 + c.happiness + (c.vote === 'gobierno' ? 10 : 0);
  const councillor = state.citizens.filter((c) => c.named && c.age >= 18).sort((a, b) => support(b) - support(a) || a.id - b.id)[0];
  if (!councillor) return null;
  const shopOf = (c: Citizen) => state.buildings.find((b) => b.owner === c.id && (b.kind === 'shop' || b.kind === 'factory') && b.built && !b.damaged);
  const near = [councillor, ...councillor.relations.filter((r) => r.kind === 'pareja' || r.kind === 'amistad').map((r) => state.citizens.find((c) => c.id === r.id))];
  for (const c of near) {
    const business = c && shopOf(c);
    if (c && business) return { councillor, owner: c, business };
  }
  return null;
}

export interface OfferInfo {
  offer: Offer;
  /** Precio previsto (materiales + mano de obra). */
  price: number;
  days: number;
  who: string;
  risk: string;
  available: boolean;
}

/** Las tres ofertas de una obra, en palabras (el riesgo nunca en %). */
export function tenderOffers(state: GameState, kind: BuildKind, x: number, y: number): OfferInfo[] {
  const s = BUILD[kind];
  const mat = materialsCost(state, kind, x, y);
  const jobless = state.citizens.filter((c) => c.jobId === null).length;
  const locals = Math.min(s.workers, jobless);
  const localLabor = s.days * (locals * WAGE_LOCAL + (s.workers - locals) * WAGE_OUTSIDE);
  const cheapDays = Math.ceil(s.days * TENDER.cheap.days);
  const cronyDays = Math.max(1, Math.ceil(s.days * TENDER.crony.days - 1e-9));
  const crony = cronyOf(state);
  return [
    {
      offer: 'local',
      price: mat + localLabor,
      days: s.days,
      who: locals ? `Obreros del pueblo: ${locals} ${locals === 1 ? 'vecino en paro cobra' : 'vecinos en paro cobran'} la obra` : 'Obreros del pueblo (y de fuera si no hay parados)',
      risk: 'Sin sorpresas',
      available: true,
    },
    {
      offer: 'fuera',
      price: Math.round(mat * TENDER.cheap.mat) + Math.round(s.workers * s.days * TENDER.cheap.days * TENDER.cheap.wage),
      days: cheapDays,
      who: 'Una empresa de fuera con su cuadrilla: los parados del pueblo no cobran',
      risk: 'A veces se encarece al terminar',
      available: true,
    },
    {
      offer: 'primo',
      price: Math.round(mat * TENDER.crony.mat) + Math.round(localLabor * TENDER.crony.days),
      days: cronyDays,
      who: crony ? `${crony.business.name ?? 'El negocio'} de ${first(crony.owner)}, ${crony.owner === crony.councillor ? 'el concejal' : `amigo del concejal ${first(crony.councillor)}`}` : 'No hay ningún primo con negocio en el pueblo',
      risk: crony ? 'Si se sabe, escándalo en el pueblo' : '—',
      available: !!crony,
    },
  ];
}

/** Lo que cuesta, como mucho, la obra con esa oferta (para validar y avisar). */
export function offerOutlay(state: GameState, kind: BuildKind, x: number, y: number, offer: Offer): number {
  const s = BUILD[kind];
  const mat = materialsCost(state, kind, x, y);
  if (offer === 'fuera') return Math.round(mat * TENDER.cheap.mat) + Math.round(s.workers * s.days * TENDER.cheap.days * TENDER.cheap.wage);
  if (offer === 'primo') return Math.round(mat * TENDER.crony.mat) + Math.round(s.workers * s.days * TENDER.crony.days * WAGE_OUTSIDE);
  return mat + s.workers * s.days * WAGE_OUTSIDE;
}

export function canOffer(state: GameState, kind: BuildKind, x: number, y: number, offer: Offer): { ok: true } | { ok: false; error: string } {
  if (offer === 'local') return { ok: true };
  if ((state.townhallLevel ?? 1) < TENDER.fromLevel) return { ok: false, error: `Las licitaciones llegan con el ayuntamiento de nivel ${TENDER.fromLevel}` };
  if (!tenderApplies(state, kind, x, y)) return { ok: false, error: `Solo se licitan las obras de más de ${TENDER.minCost} € de materiales` };
  if (offer === 'primo' && !cronyOf(state)) return { ok: false, error: 'No hay ningún primo del concejal con negocio en el pueblo' };
  return { ok: true };
}

/** Ritmo de la obra según la oferta (1 = el de siempre). */
export function tenderPace(p: Project): number {
  return p.offer === 'fuera' ? 1 / TENDER.cheap.days : p.offer === 'primo' ? 1 / TENDER.crony.days : 1;
}

/**
 * Firma la oferta (no `local`: esa la paga `Build` como siempre). Paga los
 * materiales, tira los dados de la firma y guarda la licitación.
 */
export function signTender(state: GameState, b: Building, p: Project, offer: Exclude<Offer, 'local'>, mat: number): void {
  p.offer = offer;
  const list = (state.tenders ??= []);
  const t: Tender = { buildingId: b.id, kind: b.kind, offer, tick: state.tick, paid: 0, mat, status: 'cerrado' };
  if (offer === 'fuera') {
    t.paid = transfer(state, TREASURY, OUTSIDE, Math.round(mat * TENDER.cheap.mat), 'obras');
    if (chance(state.rng, TENDER.cheap.p)) t.overrun = Math.round(mat * TENDER.cheap.overrun);
    // Los parados del pueblo lo ven: la obra es de fuera.
    for (const c of state.citizens) if (c.named && c.jobId === null) addMemory(state, c, 'obra_de_fuera', 2, -2);
    pushEvent(state, 'project', `La obra de ${worksName(b.kind)} se adjudica a una empresa de fuera`, { ref: b.id });
  } else {
    const crony = cronyOf(state)!;
    const total = Math.round(mat * TENDER.crony.mat);
    const kick = Math.min(total, Math.round(mat * TENDER.crony.kick));
    t.paid = transfer(state, TREASURY, OUTSIDE, total - kick, 'obras') + transfer(state, TREASURY, crony.business.id, kick, 'obras');
    t.kick = kick;
    t.ownerId = crony.owner.id;
    t.councillorId = crony.councillor.id;
    t.businessName = crony.business.name ?? 'su negocio';
    t.risk = chance(state.rng, TENDER.crony.p);
    t.warnAt = state.tick + TENDER.warnDays * TICKS_PER_DAY;
    t.revealAt = state.tick + TENDER.revealDays * TICKS_PER_DAY;
    t.status = 'firmado';
    pushEvent(state, 'project', `La obra de ${worksName(b.kind)} se adjudica a la empresa de ${crony.owner.name}`, { ref: b.id });
  }
  list.push(t);
  trimTenders(state);
}

function trimTenders(state: GameState): void {
  const list = state.tenders ?? [];
  while (list.length > TENDER.keep) {
    const i = list.findIndex((t) => t.status !== 'firmado' && t.status !== 'avisado');
    if (i < 0) break;
    list.splice(i, 1);
  }
}

/** Al terminar la obra: el sobrecoste de la de fuera, si tocó. */
export function tenderDone(state: GameState, b: Building): void {
  const t = state.tenders?.find((x) => x.buildingId === b.id && x.offer === 'fuera' && x.overrun);
  if (!t) return;
  const paid = transfer(state, TREASURY, OUTSIDE, t.overrun!, 'obras (sobrecoste)');
  t.paid += paid;
  pushEvent(state, 'warning', `La empresa de fuera cobra ${paid} € de sobrecoste por ${worksName(b.kind)}`, { ref: b.id, notify: true });
  delete t.overrun;
}

/** Contratos del primo con rumor en el bar (lo que puede revisar el alcalde y elegir el director). */
export function rumoredTenders(state: GameState): Tender[] {
  return (state.tenders ?? []).filter((t) => t.status === 'avisado');
}

/** Cada día: rumores y estallidos de los contratos del primo. */
export function tenderDay(state: GameState): void {
  for (const t of state.tenders ?? []) {
    if (t.offer !== 'primo' || (t.status !== 'firmado' && t.status !== 'avisado')) continue;
    if (!t.risk) {
      if (state.tick >= t.revealAt!) t.status = 'cerrado';
      continue;
    }
    if (t.status === 'firmado' && state.tick >= t.warnAt!) {
      t.status = 'avisado';
      pushEvent(state, 'warning', `Se comenta en el bar quién se queda la obra de ${worksName(t.kind)}… (toca para revisar el contrato)`, { ref: t.buildingId, notify: true });
      continue;
    }
    if (t.status !== 'avisado' || state.tick < t.revealAt!) continue;
    // Con director (Modo IA) estalla cuando lo elija; si nunca lo elige, se olvida. Sin él, ahora.
    if (!directorOwns(state)) scandal(state, t);
    else if (state.tick >= t.revealAt! + TENDER.forgetDays * TICKS_PER_DAY) t.status = 'olvidado';
  }
}

/** Estalla el escándalo: campaña, recuerdos y titular. Devuelve si pasó. */
export function scandal(state: GameState, t: Tender): boolean {
  if (t.status !== 'avisado') return false;
  t.status = 'estallado';
  const pol = state.politics;
  if (pol) for (const f of FACTIONS) pol.campaign[f] = Math.max(0, pol.campaign[f] - TENDER.scandalCampaign);
  for (const c of state.citizens) if (c.named) addMemory(state, c, 'escandalo', 4, TENDER.scandalMood, t.councillorId !== undefined && t.councillorId !== c.id ? [t.councillorId] : []);
  const owner = state.citizens.find((c) => c.id === t.ownerId);
  const councillor = state.citizens.find((c) => c.id === t.councillorId);
  const who = owner ? `${t.businessName} de ${owner.name}` : 'una empresa amiga';
  pushEvent(state, 'crime', `Escándalo en el ayuntamiento: la obra de ${worksName(t.kind)} fue para ${who}${councillor && councillor !== owner ? `, amigo del concejal ${councillor.name}` : ''}`, { ref: t.buildingId, notify: true });
  return true;
}

export function canReviewContract(state: GameState, buildingId: number): { ok: true } | { ok: false; error: string } {
  const t = (state.tenders ?? []).find((x) => x.buildingId === buildingId && x.offer === 'primo');
  if (!t) return { ok: false, error: 'Esa obra no tiene contrato que revisar' };
  if (t.status !== 'avisado') return { ok: false, error: t.status === 'estallado' ? 'El escándalo ya ha estallado' : 'No hay nada que revisar en ese contrato' };
  if (state.treasury < reviewCost(t)) return { ok: false, error: 'No hay dinero suficiente' };
  return { ok: true };
}

/** Lo que cuesta revisar el contrato (el 10 % de los materiales de la obra). */
export function reviewCost(t: Tender): number {
  return Math.round(t.mat * TENDER.cancelFee);
}

/** El alcalde revisa el contrato: paga y el escándalo no llega; el concejal se ofende. */
export function reviewContract(state: GameState, buildingId: number): void {
  const t = (state.tenders ?? []).find((x) => x.buildingId === buildingId && x.offer === 'primo')!;
  const paid = transfer(state, TREASURY, OUTSIDE, reviewCost(t), 'revisión de contratos');
  t.status = 'revisado';
  const councillor = state.citizens.find((c) => c.id === t.councillorId);
  if (councillor) {
    councillor.grudge = Math.min(40, councillor.grudge + TENDER.offendedGrudge);
    addMemory(state, councillor, 'contrato_revisado', 3, -3);
  }
  pushEvent(state, 'info', `Revisas el contrato de ${worksName(t.kind)} (−${paid} €): el rumor se apaga${councillor ? `, pero ${first(councillor)} se siente señalado` : ''}`, { ref: buildingId });
}

/** Quien se va o fallece deja de figurar en los contratos (el rumor se apaga). */
export function tendersForget(state: GameState, citizenId: number): void {
  for (const t of state.tenders ?? []) {
    if (t.ownerId !== citizenId && t.councillorId !== citizenId) continue;
    delete t.ownerId;
    delete t.councillorId;
    if (t.status === 'firmado' || t.status === 'avisado') t.status = 'olvidado';
  }
}

/** Invariantes de las licitaciones. */
export function tenderErrors(state: GameState): string[] {
  const errors: string[] = [];
  const ids = new Set(state.citizens.map((c) => c.id));
  for (const p of state.projects) if (p.offer !== undefined && !(OFFERS as readonly string[]).includes(p.offer)) errors.push(`obra ${p.buildingId} con oferta inválida`);
  for (const t of state.tenders ?? []) {
    if (!(OFFERS as readonly string[]).includes(t.offer) || t.offer === ('local' as string)) errors.push(`licitación ${t.buildingId} con oferta inválida`);
    if (t.ownerId !== undefined && !ids.has(t.ownerId)) errors.push(`licitación ${t.buildingId}: el primo ${t.ownerId} no existe`);
    if (t.councillorId !== undefined && !ids.has(t.councillorId)) errors.push(`licitación ${t.buildingId}: el concejal ${t.councillorId} no existe`);
    if ((t.status === 'firmado' || t.status === 'avisado') && (t.ownerId === undefined || t.councillorId === undefined)) errors.push(`licitación ${t.buildingId} viva sin primo o concejal`);
    if (!Number.isInteger(t.paid) || t.paid < 0) errors.push(`licitación ${t.buildingId} con pago inválido`);
  }
  return errors;
}
