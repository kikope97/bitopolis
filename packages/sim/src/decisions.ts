import { TICKS_PER_DAY } from '@bitopolis/shared';
import { BUILD_NAMES } from './commands.ts';
import { JOBS, SHOP_NAMES } from './balance.ts';
import { buyHome, canBuyHome, canFound, foundBusiness, sellOnDeparture, shopTypesFor } from './economy.ts';
import { OUTSIDE, transfer } from './money.ts';
import { hash32 } from './hash.ts';
import { onCitizenLeaves } from './social.ts';
import { factionOf, voteLean } from './politics.ts';
import { protestFor } from './associations.ts';
import { DEBT } from './balance.ts';
import { totalDebt } from './household.ts';
import { extraAction, isAiCitizen, setPerformImpl } from './turns.ts';
import {
  type Citizen,
  type DecisionLogEntry,
  type GameState,
  type Pending,
  pushEvent,
  type Trigger,
} from './state.ts';

/**
 * Decisiones de los vecinos con nombre (spec §6.3 y §9).
 * El motor detecta detonantes y calcula las acciones válidas; quien decide
 * (IA o reglas) solo elige una de ellas. El motor aplica y cuadra el dinero.
 */

export const DECISION_DELAY_TICKS = 12;
/** Días antes de las elecciones en que los vecinos con nombre deciden su voto. */
const VOTE_WINDOW_DAYS = 10;
const COOLDOWN_TICKS = TICKS_PER_DAY * 4;
/** v1.9: se le pregunta qué hace con sus deudas como mucho cada 2 meses. */
const DEBT_ASK_TICKS = TICKS_PER_DAY * 60;
const LOG_LIMIT = 300;
export const LEISURE_COST = 120;
export const MOTIVO_MAX = 160;

export const ACTION_LABELS: Record<string, string> = {
  quedarse: 'quedarse en el pueblo',
  irse: 'irse del pueblo y vender lo que tenga',
  aceptar_trabajo: 'aceptar el empleo',
  seguir_fuera: 'seguir trabajando fuera del pueblo',
  quejarse: 'quejarse al ayuntamiento',
  gastar_ocio: `gastar ${LEISURE_COST} € en ocio`,
  ahorrar: 'ahorrar',
  comprar_casa: 'comprar la vivienda en la que vive (con hipoteca)',
  seguir_alquilando: 'seguir de alquiler',
  fundar: 'fundar su propio negocio',
  pedir: 'pedir al alcalde',
  votar_gobierno: 'votar al alcalde que gobierna',
  votar_oposicion: 'votar a la candidatura de la oposición',
  abstenerse: 'no ir a votar',
  manifestarse: 'ir a la manifestación de su asociación ante el ayuntamiento',
  no_ir: 'no ir a la manifestación',
  apretarse: 'apretarse el cinturón para pagar lo que debe',
  pedir_aplazamiento: 'pedir al alcalde que le aplace la deuda con el ayuntamiento',
};

const NEEDS = ['parque', 'colegio', 'centro_salud', 'tienda', 'empleo'] as const;

function vacantJobs(state: GameState, c: Citizen) {
  const used = new Map<number, number>();
  for (const x of state.citizens) if (x.jobId !== null) used.set(x.jobId, (used.get(x.jobId) ?? 0) + 1);
  const home = state.buildings.find((b) => b.id === c.homeId);
  return state.buildings
    .filter((b) => b.built && JOBS[b.kind] > (used.get(b.id) ?? 0))
    .sort((a, b) => (home ? Math.abs(a.x - home.x) + Math.abs(a.y - home.y) - (Math.abs(b.x - home.x) + Math.abs(b.y - home.y)) : a.id - b.id))
    .slice(0, 3);
}

/** Acciones válidas para un detonante (enum cerrado). */
export function validActions(state: GameState, c: Citizen, trigger: Trigger): string[] {
  switch (trigger) {
    case 'llegada':
      return ['quedarse', ...NEEDS.map((n) => `pedir:${n}`)];
    case 'sin_trabajo':
      return [...vacantJobs(state, c).map((b) => `aceptar_trabajo:${b.id}`), 'seguir_fuera'];
    case 'infeliz':
      return ['quedarse', 'quejarse', 'irse'];
    case 'subida_impuestos':
      return ['quedarse', 'quejarse', 'irse'];
    case 'ahorros':
      return ['gastar_ocio', 'ahorrar'];
    case 'comprar_casa':
      return ['comprar_casa', 'seguir_alquilando'];
    case 'emprender':
      return [...shopTypesFor(state, c).map((t) => `fundar:${t}`), 'ahorrar'];
    case 'elecciones':
      return ['votar_gobierno', 'votar_oposicion', 'abstenerse'];
    case 'protesta':
      return ['manifestarse', 'no_ir'];
    case 'deudas':
      // v1.9: debe dinero. Aplazar solo si lo debe al ayuntamiento.
      return [
        'apretarse',
        // Ronda 15: aplazar solo si lo que debe al ayuntamiento es de verdad (no por 24 €).
        ...(c.debt && c.debt.town >= DEBT.noticeable && !c.debt.plan ? ['pedir_aplazamiento'] : []),
        ...vacantJobs(state, c).map((b) => `aceptar_trabajo:${b.id}`),
        'irse',
      ];
    case 'opinion': {
      // Lo que le pide al alcalde: solo cosas que aún faltan.
      const has = (k: string) => state.buildings.some((b) => b.kind === k);
      const missing = NEEDS.filter((n) => (n === 'parque' ? !has('park') : n === 'colegio' ? !has('school') : n === 'centro_salud' ? !has('clinic') : n === 'tienda' ? !has('shop') : true));
      return ['quedarse', 'quejarse', ...missing.map((n) => `pedir:${n}`), ...(c.money > 600 ? ['gastar_ocio'] : [])];
    }
  }
}

function addPending(state: GameState, c: Citizen, trigger: Trigger) {
  const actions = validActions(state, c, trigger);
  if (actions.length < 2) return;
  state.pending.push({ citizenId: c.id, trigger, actions, createdTick: state.tick, dueTick: state.tick + DECISION_DELAY_TICKS });
  c.cooldownUntil = state.tick + COOLDOWN_TICKS;
}

/** Al llegar un vecino con nombre: primera decisión visible (el momento «wow»). */
export function onNamedArrival(state: GameState, c: Citizen) {
  // 2.0: en Modo IA, los vecinos con IA deciden en los turnos del pueblo.
  if (isAiCitizen(state, c)) return;
  addPending(state, c, 'llegada');
}

/** Detonantes al cerrar el día (solo vecinos con nombre, uno pendiente como mucho). */
export function detectTriggers(state: GameState): void {
  const taxUp =
    (state.prevTaxLevel === 'low' && state.taxLevel !== 'low') || (state.prevTaxLevel === 'medium' && state.taxLevel === 'high');
  state.prevTaxLevel = state.taxLevel;
  // Antes de unas elecciones con rival, cada vecino con nombre decide su voto (una vez).
  const pol = state.politics;
  const voting = pol.party !== null && pol.nextElection - state.tick <= VOTE_WINDOW_DAYS * TICKS_PER_DAY;
  for (const c of state.citizens) {
    if (!c.named || state.pending.some((p) => p.citizenId === c.id)) continue;
    // 2.0: los vecinos con IA no esperan a un detonante: deciden en los turnos del pueblo.
    if (isAiCitizen(state, c)) continue;
    if (voting && !c.vote) {
      addPending(state, c, 'elecciones');
      continue;
    }
    // v1.7: su asociación convoca una manifestación: decide si va (una vez por convocatoria).
    const assoc = protestFor(state, c);
    if (assoc && c.protest !== assoc.id && c.protest !== -assoc.id) {
      addPending(state, c, 'protesta');
      continue;
    }
    if (c.cooldownUntil > state.tick) continue;
    if (taxUp) addPending(state, c, 'subida_impuestos');
    else if (totalDebt(c) >= DEBT.noticeable && state.tick - (c.debtAsked ?? -Infinity) >= DEBT_ASK_TICKS) {
      c.debtAsked = state.tick;
      addPending(state, c, 'deudas');
    } else if (c.happiness < 38) addPending(state, c, 'infeliz');
    else if (c.jobId === null && vacantJobs(state, c).length > 0) addPending(state, c, 'sin_trabajo');
    else if (canFound(state, c) && c.traits.ambicion > 40) addPending(state, c, 'emprender');
    else if (canBuyHome(state, c)) addPending(state, c, 'comprar_casa');
    else if (c.money > 2_500 + c.traits.ahorro * 30) addPending(state, c, 'ahorros');
  }
  // Cada dos días, un vecino con nombre (por turnos) opina sobre el pueblo.
  const dayN = Math.floor(state.tick / TICKS_PER_DAY);
  const named = state.citizens.filter((c) => c.named);
  if (dayN % 2 === 0 && named.length > 0 && state.pending.length === 0) {
    const c = named[(dayN / 2) % named.length]!;
    if (c.cooldownUntil <= state.tick) addPending(state, c, 'opinion');
  }
}

/**
 * 2.0: si la IA no responde a un turno, cada vecino del turno decide «por
 * costumbre» con las reglas de siempre (el mismo detonante y la misma puntuación).
 */
export function ruleTurn(state: GameState, ids: number[]): { id: number; text: string; motivo?: string }[] {
  const lines: { id: number; text: string; motivo?: string }[] = [];
  const pol = state.politics;
  const voting = pol.party !== null && pol.nextElection - state.tick <= VOTE_WINDOW_DAYS * TICKS_PER_DAY;
  for (const id of ids) {
    const c = state.citizens.find((x) => x.id === id);
    if (!c) continue;
    let trigger: Trigger | null = null;
    const assoc = protestFor(state, c);
    if (voting && !c.vote) trigger = 'elecciones';
    else if (assoc && c.protest !== assoc.id && c.protest !== -assoc.id) trigger = 'protesta';
    else if (totalDebt(c) >= DEBT.noticeable && state.tick - (c.debtAsked ?? -1e9) >= DEBT_ASK_TICKS) {
      c.debtAsked = state.tick;
      trigger = 'deudas';
    } else if (c.happiness < 38) trigger = 'infeliz';
    else if (c.jobId === null && vacantJobs(state, c).length > 0) trigger = 'sin_trabajo';
    else if (canFound(state, c) && c.traits.ambicion > 40) trigger = 'emprender';
    else if (canBuyHome(state, c)) trigger = 'comprar_casa';
    else if (c.money > 2_500 + c.traits.ahorro * 30) trigger = 'ahorros';
    if (!trigger) continue;
    const actions = validActions(state, c, trigger);
    if (actions.length < 2) continue;
    const p: Pending = { citizenId: c.id, trigger, actions, createdTick: state.tick, dueTick: state.tick };
    const d = ruleDecide(state, p);
    const effect = performAction(state, c, trigger, d.action, d.motivo, 'rule');
    lines.push({ id: c.id, text: `${c.name} ${effect}`, motivo: d.motivo });
  }
  return lines;
}

/* ---------------- aplicar ---------------- */

export function cleanMotivo(raw: string): string {
  // Texto de presentación: una línea, sin marcas, acotado.
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>`*_#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MOTIVO_MAX);
}

export function canApplyDecision(state: GameState, citizenId: number, action: string): boolean {
  const p = state.pending.find((x) => x.citizenId === citizenId);
  return !!p && p.actions.includes(action);
}

/** Aplica la acción elegida. Devuelve false si ya no es válida. */
export function applyDecision(state: GameState, citizenId: number, action: string, motivo: string, source: 'ai' | 'rule'): boolean {
  const p = state.pending.find((x) => x.citizenId === citizenId);
  const c = state.citizens.find((x) => x.id === citizenId);
  state.pending = state.pending.filter((x) => x !== p);
  if (!p || !c || !p.actions.includes(action)) return false;
  performAction(state, c, p.trigger, action, motivo, source);
  return true;
}

/**
 * Aplica una acción ya validada de un vecino (decisión con detonante o, en la 2.0,
 * acción del turno del pueblo) y la apunta en el registro y el diario.
 * Devuelve el texto del efecto.
 */
export function performAction(state: GameState, c: Citizen, trigger: Trigger, action: string, motivo: string, source: 'ai' | 'rule'): string {
  const citizenId = c.id;
  const p = { trigger };
  const text = cleanMotivo(motivo) || '…';
  const [verb, arg] = action.split(':') as [string, string | undefined];
  let effect: string;
  switch (verb) {
    case 'aceptar_trabajo': {
      const b = state.buildings.find((x) => x.id === Number(arg));
      const used = state.citizens.filter((x) => x.jobId === b?.id).length;
      if (b && b.built && JOBS[b.kind] > used) {
        c.jobId = b.id;
        effect = `empieza a trabajar en ${BUILD_NAMES[b.kind]?.toLowerCase()}`;
      } else effect = 'se queda sin el empleo (ya estaba cogido)';
      break;
    }
    case 'irse':
      sellOnDeparture(state, c);
      onCitizenLeaves(state, c);
      transfer(state, c.id, OUTSIDE, c.money);
      state.citizens = state.citizens.filter((x) => x !== c);
      effect = 'se va del pueblo';
      break;
    case 'gastar_ocio': {
      const shop = state.buildings.find((b) => b.kind === 'shop' && b.built);
      transfer(state, c.id, shop ? shop.id : OUTSIDE, LEISURE_COST);
      c.happiness = Math.min(100, c.happiness + 6);
      effect = shop ? 'se da un capricho en una tienda del pueblo' : 'se da un capricho fuera del pueblo';
      break;
    }
    case 'quejarse':
      c.happiness = Math.max(0, c.happiness - 1);
      effect = 'se queja al ayuntamiento';
      break;
    case 'pedir':
      effect = `pide al alcalde ${NEED_TEXT[arg ?? ''] ?? arg}`;
      break;
    case 'votar_gobierno':
    case 'votar_oposicion':
    case 'abstenerse': {
      c.vote = verb === 'votar_gobierno' ? 'gobierno' : verb === 'votar_oposicion' ? 'oposicion' : 'abstencion';
      // El voto es secreto: el diario solo cuenta que ya lo tiene decidido.
      effect = verb === 'abstenerse' ? 'no piensa ir a votar' : 'ya sabe a quién votará';
      break;
    }
    case 'seguir_fuera':
      effect = 'sigue trabajando fuera';
      break;
    case 'apretarse':
      c.happiness = Math.max(0, c.happiness - 1);
      effect = 'se aprieta el cinturón para pagar lo que debe';
      break;
    case 'pedir_aplazamiento':
      // v1.9.1: espera respuesta; si en DEBT.answerDays no se aplaza ni se perdona, se lo guarda.
      if (c.debt) c.debt.askedAt = state.tick;
      effect = `pide al alcalde que le aplace lo que debe al ayuntamiento (${c.debt?.town ?? 0} €)`;
      break;
    case 'manifestarse':
    case 'no_ir': {
      const a = protestFor(state, c);
      if (a) c.protest = verb === 'manifestarse' ? a.id : -a.id;
      effect = verb === 'manifestarse' ? 'irá a la manifestación' : 'no irá a la manifestación';
      break;
    }
    case 'comprar_casa':
      effect = buyHome(state, c) ? 'compra la vivienda en la que vive' : 'no llega a comprar la vivienda';
      break;
    case 'seguir_alquilando':
      effect = 'sigue de alquiler';
      break;
    case 'fundar':
      effect = foundBusiness(state, c, arg ?? 'bar') ? `abre su propio negocio (${SHOP_NAMES[arg ?? '']?.toLowerCase() ?? 'tienda'})` : 'no consigue abrir el negocio';
      break;
    default:
      effect = extraAction(state, c, verb!, arg) ?? (verb === 'ahorrar' ? 'decide ahorrar' : 'se queda');
  }
  const entry: DecisionLogEntry = { tick: state.tick, citizenId, trigger: p.trigger, action, motivo: text, source };
  state.decisionLog.push(entry);
  if (state.decisionLog.length > LOG_LIMIT) state.decisionLog.splice(0, state.decisionLog.length - LOG_LIMIT);
  // Ronda 13: lo rutinario (ahorrar, darse un capricho, seguir igual) queda en la ficha del
  // vecino, no en el diario ni en burbujas (en 12 años eran miles de «decide ahorrar»).
  const routine = ['ahorrar', 'gastar_ocio', 'seguir_alquilando', 'seguir_fuera'].includes(verb) || (verb === 'quedarse' && p.trigger === 'opinion');
  if (!routine) pushEvent(state, 'decision', `${c.name} ${effect}: «${text}»`, { ref: citizenId });
  return effect;
}

/* ---------------- reglas (Modo normal y fallback) ---------------- */

const TEMPLATES: Record<string, string[]> = {
  quedarse: [
    'Aquí tengo mi sitio, no me voy a ir por esto.',
    'Me quedo. Este pueblo todavía puede mejorar.',
    'Lo he pensado bien: me quedo, pero estaré atento.',
  ],
  irse: ['No aguanto más. Me voy a buscar otro sitio.', 'Lo siento, alcalde: aquí ya no me salen las cuentas.', 'Me marcho. Ojalá le vaya mejor al pueblo.'],
  quejarse: ['Esto no puede seguir así. Que el alcalde me escuche.', 'Voy a decir lo que pienso en el ayuntamiento.', 'Pago y no veo mejoras. Me quejaré.'],
  aceptar_trabajo: ['Por fin un trabajo cerca de casa.', 'Acepto. Prefiero trabajar en mi pueblo.', 'Mejor esto que coger el autobús cada día.'],
  seguir_fuera: ['Fuera me pagan mejor; de momento sigo allí.', 'No me convence. Sigo con mi trabajo de fuera.'],
  gastar_ocio: ['Me lo he ganado: hoy me doy un capricho.', 'Un día es un día. Voy a disfrutar un poco.'],
  ahorrar: ['Mejor guardo el dinero, nunca se sabe.', 'Ahorrar hoy es dormir tranquilo mañana.'],
  comprar_casa: ['Pagar alquiler es tirar el dinero. Me la quedo.', 'Por fin algo mío en este pueblo.', 'Con la hipoteca pago menos que de alquiler.'],
  seguir_alquilando: ['No me quiero atar a una hipoteca.', 'De momento, mejor de alquiler.', 'Hipotecas no, gracias.'],
  fundar: ['Siempre quise tener mi propio negocio.', 'Este pueblo necesita {x} y la voy a abrir yo.', 'Me la juego: abro mi negocio.'],
  pedir: ['Un pueblo sin {x} no es un pueblo. ¿Para cuándo?', 'Alcalde, aquí hace falta {x}.', 'Me gusta este sitio, pero echo de menos {x}.'],
  votar_gobierno: ['Las cosas van razonablemente bien; no voy a cambiar ahora.', 'Más vale lo conocido. Repito el voto.', 'Han cumplido lo suficiente para merecer otra oportunidad.'],
  votar_oposicion: ['Toca un cambio en el ayuntamiento.', 'Prometieron mucho y cumplieron poco. Esta vez, otros.', 'Quiero que alguien escuche de verdad a gente como yo.'],
  abstenerse: ['Todos son iguales. Ese día me quedo en casa.', 'No me convence nadie, la verdad.', 'Que decidan otros; yo paso.'],
  manifestarse: ['Si no nos escuchan, que nos vean en la calle.', 'Allí estaré, con la pancarta.', 'Llevamos meses pidiéndolo. Toca plantarse.'],
  no_ir: ['Estoy de acuerdo, pero manifestarme no va conmigo.', 'Ese día trabajo; que vayan otros.', 'Prefiero darle algo más de tiempo al alcalde.'],
  apretarse: ['Nada de caprichos hasta que lo pague todo.', 'Toca apretarse el cinturón unos meses.', 'Debo dinero y lo voy a devolver, aunque cueste.'],
  pedir_aplazamiento: ['Alcalde, deme unos meses: lo pagaré, pero ahora no llego.', 'No es que no quiera pagar, es que no puedo. Necesito tiempo.', 'Con un aplazamiento lo devuelvo poco a poco.'],
};

/** Coletillas según el rasgo dominante: la misma decisión suena distinta en cada vecino. */
const FLAVOR: Record<keyof Citizen['traits'], string[]> = {
  terco: ['Y no hay más que hablar.', 'Digan lo que digan.', 'Lo tengo decidido.', 'Cuando digo algo, lo cumplo.'],
  ahorro: ['Cada euro cuenta.', 'Las cuentas mandan.', 'Hay que mirar el bolsillo.', 'Sin gastar de más.'],
  social: ['Ya lo comentaré en el bar.', 'Seguro que más vecinos piensan igual.', 'Se lo diré a todos.', 'Aquí nos conocemos todos.'],
  ambicion: ['Quiero llegar lejos.', 'Esto es solo el principio.', 'Aspiro a más.', 'No pienso quedarme quieto.'],
};

const NEED_TEXT: Record<string, string> = {
  panaderia: 'una panadería',
  fruteria: 'una frutería',
  bar: 'un bar',
  ropa: 'una tienda de ropa',
  ferreteria: 'una ferretería',
  peluqueria: 'una peluquería',
  parque: 'un parque',
  colegio: 'un colegio',
  centro_salud: 'un centro de salud',
  tienda: 'una tienda',
  empleo: 'más empleo',
};

function score(c: Citizen, state: GameState, action: string): number {
  const t = c.traits;
  const [verb, arg] = action.split(':');
  switch (verb) {
    case 'irse':
      return (
        (40 - c.happiness) * 2 -
        t.terco * 0.6 +
        (c.fear === 'impuestos' ? 15 : 0) +
        (totalDebt(c) > 2_000 && c.money === 0 ? 30 : 0) +
        // Ronda 15: tras un desahucio o un embargo, irse pesa mucho más.
        (recentBlow(state, c) ? 45 : 0)
      );
    case 'quejarse':
      return 20 + t.social * 0.4 - t.terco * 0.1 + (c.fear === 'impuestos' ? 10 : 0);
    case 'quedarse':
      return 25 + t.terco * 0.5;
    case 'aceptar_trabajo':
      return 60 + t.ambicion * 0.2 - (arg ? 0 : 50);
    case 'seguir_fuera':
      return 20 + t.terco * 0.3;
    case 'gastar_ocio':
      return 30 + t.social * 0.5 - t.ahorro * 0.5;
    case 'ahorrar':
      return 20 + t.ahorro * 0.6 + (c.fear === 'deudas' ? 15 : 0);
    case 'comprar_casa':
      return 40 + t.ahorro * 0.3 + (c.desire === 'casa_propia' ? 30 : 0) - (c.fear === 'deudas' ? 25 : 0);
    case 'seguir_alquilando':
      return 35 + (c.fear === 'deudas' ? 20 : 0);
    case 'fundar':
      return 30 + t.ambicion * 0.6 + (c.desire === 'prosperar' ? 15 : 0) - (c.fear === 'deudas' ? 20 : 0);
    case 'votar_gobierno':
      return (voteLean(state, c) - 0.5) * 120 + 30;
    case 'votar_oposicion':
      return (0.5 - voteLean(state, c)) * 120 + 30 + (state.politics.party?.faction === factionOf(state, c) ? 15 : 0);
    case 'abstenerse':
      return 18 + c.traits.terco * 0.1 - c.traits.social * 0.1;
    case 'manifestarse': {
      const a = protestFor(state, c);
      return 25 + t.social * 0.4 + (c.happiness < 45 ? 15 : 0) + (a?.leaderId === c.id ? 40 : 0);
    }
    case 'no_ir':
      return 30 + t.ahorro * 0.1 + (c.happiness >= 60 ? 15 : 0);
    case 'apretarse':
      // Ronda 15: no se aprieta el cinturón una y otra vez sin probar otra cosa.
      return 35 + t.ahorro * 0.4 + t.terco * 0.2 + (c.fear === 'deudas' ? 10 : 0) - (lastDebtChoice(state, c) === 'apretarse' ? 30 : 0);
    case 'pedir_aplazamiento':
      return 30 + t.social * 0.3 + (totalDebt(c) > 1_000 ? 20 : 0);
    case 'pedir': {
      const has = (k: string) => state.buildings.some((b) => b.kind === k);
      const missing = arg === 'parque' ? !has('park') : arg === 'colegio' ? !has('school') : arg === 'centro_salud' ? !has('clinic') : arg === 'tienda' ? !has('shop') : true;
      const wish = (c.desire === 'parque' && arg === 'parque') || (c.desire === 'tienda' && arg === 'tienda') || (c.desire === 'trabajo_cerca' && arg === 'empleo');
      return (missing ? 40 : 5) + (wish ? 25 : 0) + t.social * 0.2;
    }
  }
  return 10;
}

/** Ronda 15: lo último que decidió sobre sus deudas. */
function lastDebtChoice(state: GameState, c: Citizen): string | undefined {
  for (let i = state.decisionLog.length - 1; i >= 0; i--) {
    const d = state.decisionLog[i]!;
    if (d.citizenId === c.id && d.trigger === 'deudas') return d.action.split(':')[0];
  }
  return undefined;
}

/** Ronda 15: le han echado de casa o le han embargado hace poco. */
function recentBlow(state: GameState, c: Citizen): boolean {
  return c.memories.some((m) => (m.kind === 'desahuciado' || m.kind === 'embargado') && state.tick - m.tick < 60 * TICKS_PER_DAY);
}

const AFTER_BLOW: Record<string, string[]> = {
  apretarse: ['Me han echado de casa, pero voy a pagar lo que debo.', 'Sin casa y con deudas. Toca aguantar como sea.'],
  irse: ['Me han echado de casa. No sé cuánto más aguanto aquí.', 'Sin casa no hay nada que me retenga. Me voy.'],
  pedir_aplazamiento: ['Me han quitado la casa. Alcalde, deme tiempo para lo que debo.'],
};

/** Decisión por reglas: determinista (no consume el PRNG de la partida). */
export function ruleDecide(state: GameState, p: Pending): { action: string; motivo: string } {
  const c = state.citizens.find((x) => x.id === p.citizenId)!;
  let best = p.actions[0]!;
  let bestScore = -Infinity;
  for (const a of p.actions) {
    const s = score(c, state, a) + hash32(state.seed, state.tick, c.id, a.length) % 15;
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  const [verb, arg] = best.split(':');
  const options = (p.trigger === 'deudas' && recentBlow(state, c) && AFTER_BLOW[verb!]) || TEMPLATES[verb!] || TEMPLATES.quedarse!;
  const base = options[hash32(state.seed, c.id, state.tick) % options.length]!.replace('{x}', NEED_TEXT[arg ?? ''] ?? 'más cosas');
  const top = (Object.entries(c.traits) as [keyof Citizen['traits'], number][]).sort((a, b) => b[1] - a[1])[0]!;
  // «Ya lo comentaré en el bar» solo si hay bar en el pueblo.
  const hasBar = state.buildings.some((b) => b.kind === 'bar' && b.built);
  const flavors = FLAVOR[top[0]].filter((f) => hasBar || !f.includes('bar'));
  // Ronda 15: sin coletillas en las decisiones sobre deudas (desentonaban: «Aspiro a más» tras un desahucio).
  const motivo = top[1] >= 60 && p.trigger !== 'deudas' ? `${base} ${flavors[hash32(c.id, state.tick, 7) % flavors.length]}` : base;
  return { action: best, motivo: cleanMotivo(motivo) };
}

/** En cada tick: las decisiones vencidas sin respuesta las toman las reglas. */
export function resolveDuePending(state: GameState): void {
  const due = state.pending.filter((p) => p.dueTick <= state.tick);
  for (const p of due) {
    if (!state.citizens.some((c) => c.id === p.citizenId)) {
      state.pending = state.pending.filter((x) => x !== p);
      continue;
    }
    const { action, motivo } = ruleDecide(state, p);
    applyDecision(state, p.citizenId, action, motivo, 'rule');
  }
}

export function namedCitizens(state: GameState): Citizen[] {
  return state.citizens.filter((c) => c.named);
}

// 2.0: los turnos del pueblo aplican las acciones con la misma función (sin ciclo al cargar).
setPerformImpl(performAction);
