import type { BuildKind, Command, ZoneKind } from '@bitopolis/shared';
import { BUILD, BUILD_LEVEL, buildCost, CIVIL, FARM, type GameState, TERRAIN, TOWNHALL_LEVELS, townLevel, ZONE_COST_PER_TILE } from '@bitopolis/sim';
import { money } from './i18n.ts';

export type ToolId =
  | 'inspect'
  | 'road'
  | 'house'
  | 'water'
  | 'power'
  | 'zoneR'
  | 'zoneC'
  | 'zoneI'
  | 'zoneA'
  | 'dezone'
  | 'park'
  | 'school'
  | 'clinic'
  | 'police'
  | 'plaza'
  | 'market'
  | 'bar'
  | 'chapel'
  | 'cemetery'
  | 'library'
  | 'sports'
  | 'jail'
  | 'firestation'
  | 'civilprotection'
  | 'dike'
  | 'cleanpoint'
  | 'demolish';

export interface Tool {
  id: ToolId;
  label: string;
  /** tap: un tile; line: arrastrar en línea recta; rect: arrastrar un rectángulo. */
  shape: 'tap' | 'line' | 'rect';
  build?: BuildKind;
  zone?: ZoneKind;
  key: string;
  help: string;
}

export const TOOLS: Tool[] = [
  { id: 'inspect', label: 'Mirar', shape: 'tap', key: '0', help: 'Toca un edificio para ver quién vive o trabaja allí.' },
  { id: 'road', label: 'Carretera', shape: 'line', build: 'road', key: '1', help: 'Arrastra en línea recta. Por debajo van el agua y la luz.' },
  { id: 'house', label: 'Casa', shape: 'tap', build: 'house', key: '2', help: 'Casa municipal para 3 vecinos. Cobras alquiler.' },
  { id: 'water', label: 'Agua', shape: 'tap', build: 'water', key: '3', help: `Da agua por la red de carreteras a 30 edificios.` },
  { id: 'power', label: 'Luz', shape: 'tap', build: 'power', key: '4', help: 'Da luz por la red de carreteras a 40 edificios.' },
  { id: 'zoneR', label: 'Zona R', shape: 'rect', zone: 'R', key: '5', help: 'Residencial: aquí se construyen viviendas solas.' },
  { id: 'zoneC', label: 'Zona C', shape: 'rect', zone: 'C', key: '6', help: 'Comercial: tiendas que dan empleo y venden a los vecinos.' },
  { id: 'zoneI', label: 'Zona I', shape: 'rect', zone: 'I', key: '7', help: 'Industrial: talleres con empleo. Contaminan cerca.' },
  // 2.2: el campo.
  { id: 'zoneA', label: 'Zona agraria', shape: 'rect', zone: 'A', key: 'c', help: 'Fincas con un empleo y temporeros en la cosecha. Solo piden carretera (ni agua ni luz). Junto al río, huerta de regadío; en la colina, olivar o viñedo; en el resto, cereal de secano.' },
  { id: 'park', label: 'Parque', shape: 'tap', build: 'park', key: '8', help: 'Más felicidad en 5 casillas a la redonda.' },
  { id: 'school', label: 'Colegio', shape: 'tap', build: 'school', key: '9', help: 'Más felicidad en 8 casillas. 3 empleos.' },
  { id: 'clinic', label: 'Salud', shape: 'tap', build: 'clinic', key: 'h', help: 'Centro de salud: más felicidad en 8 casillas.' },
  { id: 'police', label: 'Policía', shape: 'tap', build: 'police', key: 'p', help: 'Baja la delincuencia en 10 casillas.' },
  { id: 'plaza', label: 'Plaza', shape: 'tap', build: 'plaza', key: 'm', help: 'Plaza Mayor: mucha felicidad en 6 casillas. Premio del hito de 50 vecinos.' },
  { id: 'market', label: 'Mercado', shape: 'tap', build: 'market', key: 'k', help: 'Mercado municipal: empleo y felicidad en 8 casillas. Premio del hito de 200 vecinos.' },
  // v1.7: lugares de vida social.
  { id: 'bar', label: 'Bar', shape: 'tap', build: 'bar', key: 'b', help: 'Felicidad en 5 casillas y amistades que nacen tomando algo. Hace algo de ruido.' },
  { id: 'chapel', label: 'Ermita', shape: 'tap', build: 'chapel', key: 'e', help: 'Felicidad en 8 casillas. Con ermita, las fiestas alegran más.' },
  { id: 'cemetery', label: 'Cementerio', shape: 'tap', build: 'cemetery', key: 'n', help: 'Para despedir a los que se van: el duelo pesa menos. Sin él, se nota.' },
  { id: 'library', label: 'Biblioteca', shape: 'tap', build: 'library', key: 'y', help: 'Felicidad en 8 casillas; más aún para quien quiere prosperar.' },
  { id: 'sports', label: 'Polideportivo', shape: 'tap', build: 'sports', key: 'g', help: 'Felicidad en 8 casillas; los mayores de cerca viven más.' },
  // v1.8: la cárcel vacía los calabozos de las comisarías.
  { id: 'jail', label: 'Cárcel', shape: 'tap', build: 'jail', key: 'j', help: '30 plazas: los detenidos pasan aquí y los calabozos de las comisarías se vacían. A los vecinos no les gusta tenerla cerca.' },
  // 2.1: emergencias.
  { id: 'firestation', label: 'Bomberos', shape: 'tap', build: 'firestation', key: 'f', help: 'Parque de bomberos: en 9 casillas apaga los incendios en pocas horas. Sin él, lo que arde queda destrozado. Con cisterna (nivel 2) llega a las colinas.' },
  { id: 'civilprotection', label: 'Protección civil', shape: 'tap', build: 'civilprotection', key: 'v', help: 'Caseta de voluntarios: en 10 casillas, las riadas un 60 % menos y el quitanieves a mitad de precio. Permite levantar diques.' },
  { id: 'dike', label: 'Dique', shape: 'tap', key: 'q', help: 'Muro en una casilla junto al río: ahí y alrededor no llega la riada. Hace falta una caseta de protección civil.' },
  // 2.1: recogida de basura.
  { id: 'cleanpoint', label: 'Punto limpio', shape: 'tap', build: 'cleanpoint', key: 'u', help: 'Su camión recoge la basura por las calles de alrededor (60 casillas al día). Solo quien tiene recogida paga la tasa de basuras.' },
  { id: 'dezone', label: 'Sin zona', shape: 'rect', zone: 'none', key: 'z', help: 'Quita la zona (no derriba lo construido).' },
  { id: 'demolish', label: 'Derribar', shape: 'tap', key: 'x', help: 'Derriba un edificio o una carretera. Pide confirmación.' },
];

/** Vecinos del hito (Plaza Mayor y Mercado). */
export function unlockPop(tool: Tool): number {
  if (tool.zone === 'A') return FARM.unlockPop;
  return tool.build ? BUILD[tool.build].unlockPop : 0;
}

/** v1.8: nivel del ayuntamiento que pide la herramienta (las zonas, el 2). */
export function toolLevel(tool: Tool): number {
  if (tool.build) return BUILD_LEVEL[tool.build];
  if (tool.id === 'dike') return BUILD_LEVEL.civilprotection;
  if (tool.zone === 'A') return FARM.level;
  if (tool.zone && tool.zone !== 'none') return 2;
  return 1;
}

/** Qué falta, en dos palabras («nivel 3», «hito de 50»), o null si está libre. */
export function lockShort(tool: Tool, state: GameState): string | null {
  const lv = toolLevel(tool);
  if (townLevel(state) < lv) return `ayto. nivel\u00a0${lv}`;
  if ((tool.build === 'plaza' || tool.build === 'market') && !state.unlocked.includes(tool.build)) return `hito de ${unlockPop(tool)}`;
  if (state.citizens.length < unlockPop(tool) && tool.build !== 'plaza' && tool.build !== 'market') return `${unlockPop(tool)} vecinos`;
  if (tool.id === 'dike' && !state.buildings.some((b) => b.kind === 'civilprotection' && b.built)) return 'protección civil';
  return null;
}

/** Qué falta, explicado (para la bandeja, la franja y los avisos). */
export function lockLong(tool: Tool, state: GameState): string {
  const lv = toolLevel(tool);
  if (townLevel(state) < lv) {
    const L = TOWNHALL_LEVELS[lv - 1]!;
    return `${tool.label}: llega con el ayuntamiento de nivel ${lv} (${L.name}; pide ${L.pop} vecinos y ${money(L.cost)}). Toca el ayuntamiento para ampliarlo.`;
  }
  if (tool.build === 'plaza' || tool.build === 'market') return `${tool.label}: es el premio del hito de ${unlockPop(tool)} vecinos (tienes ${state.citizens.length}).`;
  if (tool.id === 'dike' && lockShort(tool, state) === 'protección civil') return 'Dique: primero construye una caseta de protección civil.';
  return `${tool.label}: hacen falta ${unlockPop(tool)} vecinos (tienes ${state.citizens.length}).`;
}

/** Coste corto para la barra de confirmación: «hasta 3.500 €». */
export function shortCost(tool: Tool): string {
  return tool.build && tool.build !== 'road' ? `hasta ${money(buildCost(tool.build))}` : costText(tool);
}

/** Precio en una línea para la bandeja «Construir» (v1.6). */
export function trayCost(tool: Tool): string {
  if (tool.build && tool.build !== 'road') return money(buildCost(tool.build));
  if (tool.zone && tool.zone !== 'none') return `${money(ZONE_COST_PER_TILE)}/casilla`;
  if (tool.zone === 'none') return 'gratis';
  if (tool.id === 'dike') return `${money(CIVIL.dikeCost)}/casilla`;
  return '';
}

/** Categorías de la bandeja «Construir»; Mirar, Carretera y Derribar van en las pestañas. */
export const TRAY: { title: string; tools: ToolId[] }[] = [
  { title: 'Lo básico', tools: ['house', 'water', 'power'] },
  { title: 'Zonas (los vecinos construyen)', tools: ['zoneR', 'zoneC', 'zoneI', 'zoneA', 'dezone'] },
  { title: 'Servicios', tools: ['park', 'school', 'clinic', 'police', 'cleanpoint', 'jail'] },
  { title: 'Vida social', tools: ['bar', 'chapel', 'cemetery', 'library', 'sports'] },
  { title: 'Emergencias', tools: ['firestation', 'civilprotection', 'dike'] },
  { title: 'Premios de los hitos', tools: ['plaza', 'market'] },
];

export function costText(tool: Tool): string {
  if (tool.build === 'road') return `${money(BUILD.road.materials)} por casilla (puente sobre el río: ${money(TERRAIN.bridgePerTile)})`;
  if (tool.build) {
    const s = BUILD[tool.build];
    return `${money(s.materials)} + obra (${s.workers} obreros × ${s.days} días, hasta ${money(buildCost(tool.build))})`;
  }
  if (tool.zone && tool.zone !== 'none') return `${money(ZONE_COST_PER_TILE)} por casilla`;
  if (tool.id === 'dike') return `${money(CIVIL.dikeCost)} por casilla de orilla`;
  return '';
}

export function isLocked(tool: Tool, state: GameState): boolean {
  return lockShort(tool, state) !== null;
}

/** Comando para un trazo del jugador entre dos tiles. */
export function commandFor(tool: Tool, a: { x: number; y: number }, b: { x: number; y: number }): Command | null {
  if (tool.shape === 'line') {
    // Recta en el eje con más recorrido.
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const end = horizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    return { type: 'BuildRoad', x: a.x, y: a.y, x2: end.x, y2: end.y };
  }
  if (tool.shape === 'rect' && tool.zone) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.min(16, Math.abs(b.x - a.x) + 1);
    const h = Math.min(16, Math.abs(b.y - a.y) + 1);
    return { type: 'Zone', zone: tool.zone, x, y, w, h };
  }
  if (tool.build) return { type: 'Build', kind: tool.build, x: b.x, y: b.y };
  if (tool.id === 'demolish') return { type: 'Demolish', x: b.x, y: b.y };
  if (tool.id === 'dike') return { type: 'BuildDike', x: b.x, y: b.y };
  return null;
}

export function tilesOf(cmd: Command): { x: number; y: number }[] {
  if (cmd.type === 'BuildRoad') {
    const out = [];
    const dx = Math.sign(cmd.x2 - cmd.x);
    const dy = Math.sign(cmd.y2 - cmd.y);
    let x = cmd.x;
    let y = cmd.y;
    for (;;) {
      out.push({ x, y });
      if (x === cmd.x2 && y === cmd.y2) break;
      x += dx;
      y += dy;
    }
    return out;
  }
  if (cmd.type === 'Zone') {
    const out = [];
    for (let y = cmd.y; y < cmd.y + cmd.h; y++) for (let x = cmd.x; x < cmd.x + cmd.w; x++) out.push({ x, y });
    return out;
  }
  if ('x' in cmd) return [{ x: cmd.x, y: cmd.y }];
  return [];
}
