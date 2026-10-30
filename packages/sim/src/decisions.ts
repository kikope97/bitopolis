import { TICKS_PER_DAY } from '@bitopolis/shared';
import { BUILD_NAMES } from './commands.ts';
import { JOBS } from './balance.ts';
import { OUTSIDE, transfer } from './money.ts';
import { hash32 } from './hash.ts';
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
const COOLDOWN_TICKS = TICKS_PER_DAY * 4;
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
  pedir: 'pedir al alcalde',
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
  addPending(state, c, 'llegada');
}

/** Detonantes al cerrar el día (solo vecinos con nombre, uno pendiente como mucho). */
export function detectTriggers(state: GameState): void {
  const taxUp =
    (state.prevTaxLevel === 'low' && state.taxLevel !== 'low') || (state.prevTaxLevel === 'medium' && state.taxLevel === 'high');
  state.prevTaxLevel = state.taxLevel;
  for (const c of state.citizens) {
    if (!c.named || c.cooldownUntil > state.tick) continue;
    if (state.pending.some((p) => p.citizenId === c.id)) continue;
    if (taxUp) addPending(state, c, 'subida_impuestos');
    else if (c.happiness < 35) addPending(state, c, 'infeliz');
    else if (c.jobId === null && vacantJobs(state, c).length > 0) addPending(state, c, 'sin_trabajo');
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
      effect = `pide al alcalde: ${arg?.replace('_', ' ')}`;
      break;
    case 'seguir_fuera':
      effect = 'sigue trabajando fuera';
      break;
    default:
      effect = verb === 'ahorrar' ? 'decide ahorrar' : 'se queda';
  }
  const entry: DecisionLogEntry = { tick: state.tick, citizenId, trigger: p.trigger, action, motivo: text, source };
  state.decisionLog.push(entry);
  if (state.decisionLog.length > LOG_LIMIT) state.decisionLog.splice(0, state.decisionLog.length - LOG_LIMIT);
  c.memory = [...c.memory, `${p.trigger}: ${effect}`].slice(-3);
  pushEvent(state, 'decision', `${c.name} ${effect}: «${text}»`, { ref: citizenId });
  return true;
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
  pedir: ['Un pueblo sin {x} no es un pueblo. ¿Para cuándo?', 'Alcalde, aquí hace falta {x}.', 'Me gusta este sitio, pero echo de menos {x}.'],
};

/** Coletillas según el rasgo dominante: la misma decisión suena distinta en cada vecino. */
const FLAVOR: Record<keyof Citizen['traits'], string[]> = {
  terco: ['Y no hay más que hablar.', 'Digan lo que digan.', 'Lo tengo decidido.', 'Cuando digo algo, lo cumplo.'],
  ahorro: ['Cada euro cuenta.', 'Las cuentas mandan.', 'Hay que mirar el bolsillo.', 'Sin gastar de más.'],
  social: ['Ya lo comentaré en el bar.', 'Seguro que más vecinos piensan igual.', 'Se lo diré a todos.', 'Aquí nos conocemos todos.'],
  ambicion: ['Quiero llegar lejos.', 'Esto es solo el principio.', 'Aspiro a más.', 'No pienso quedarme quieto.'],
};

const NEED_TEXT: Record<string, string> = {
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
      return (40 - c.happiness) * 2 - t.terco * 0.6 + (c.fear === 'impuestos' ? 15 : 0);
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
    case 'pedir': {
      const has = (k: string) => state.buildings.some((b) => b.kind === k);
      const missing = arg === 'parque' ? !has('park') : arg === 'colegio' ? !has('school') : arg === 'centro_salud' ? !has('clinic') : arg === 'tienda' ? !has('shop') : true;
      const wish = (c.desire === 'parque' && arg === 'parque') || (c.desire === 'tienda' && arg === 'tienda') || (c.desire === 'trabajo_cerca' && arg === 'empleo');
      return (missing ? 40 : 5) + (wish ? 25 : 0) + t.social * 0.2;
    }
  }
  return 10;
}

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
  const options = TEMPLATES[verb!] ?? TEMPLATES.quedarse!;
  const base = options[hash32(state.seed, c.id, state.tick) % options.length]!.replace('{x}', NEED_TEXT[arg ?? ''] ?? 'más cosas');
  const top = (Object.entries(c.traits) as [keyof Citizen['traits'], number][]).sort((a, b) => b[1] - a[1])[0]!;
  const flavors = FLAVOR[top[0]];
  const motivo = top[1] >= 60 ? `${base} ${flavors[hash32(c.id, state.tick, 7) % flavors.length]}` : base;
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
