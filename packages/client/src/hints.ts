import type { BuildKind } from '@bitopolis/shared';
import { buildingAt, canUpgradeTownhall, LANDMARK_KINDS, LANDMARK_NAMES, landmarkReqs, phaseCost, coverageSummary, type GameState, monthlyCostOf, NEED_LABEL, nextLevel, TOWNHALL_LEVELS, freeHomes, taxLevels, zonesUnlocked } from '@bitopolis/sim';
import { monthFlow, monthsText, runwayMonths } from './cash.ts';
import { money, plural } from './i18n.ts';
import type { ToolId } from './tools.ts';
import { verbo } from './wording.ts';

export interface Hint {
  text: string;
  tool?: ToolId;
}

/** Lo que entra menos el gasto corriente al mes (sin obras), o null si aún no hay ningún mes cerrado. */
function monthNet(state: GameState): number | null {
  const f = monthFlow(state);
  return f.closed ? f.income - f.running : null;
}

/** 2.8: qué se puede hacer para que cuadre el mes, por orden: impuestos o esperar; el préstamo, al final. */
function moneyFix(state: GameState): string {
  const allHigh = Object.values(taxLevels(state)).every((l) => l === 'high');
  return allHigh
    ? 'Los impuestos ya están altos: prueba un presupuesto austero (Pueblo › Ayuntamiento) o derriba lo que menos se usa; el préstamo, solo si no basta.'
    : 'Antes, sube un escalón los impuestos (Pueblo › Impuestos) o espera a que terminen las obras; el préstamo, solo si no basta.';
}

/**
 * 2.8 (informes 01, 05): un servicio nuevo no se recomienda sin decir lo que cuesta al mes
 * si deja el mes en pérdidas: «te costará 2450 €/mes y pasarías a perder ~700 €/mes».
 * Devuelve el texto del coste (vacío si el mes sigue en positivo) y si se puede pagar.
 */
export function serviceCost(state: GameState, kind: BuildKind): { text: string; ok: boolean } {
  const cost = monthlyCostOf(kind, state).total;
  const net = monthNet(state);
  if (!cost || net === null) return { text: '', ok: true };
  const after = net - cost;
  if (after >= 0) return { text: '', ok: true };
  const lose = Math.max(10, Math.round(-after / 10) * 10);
  return { text: `Te costará ${money(cost)}/mes y pasarías a perder ~${money(lose)}/mes.`, ok: false };
}

/** «≈ 3 meses» hasta juntar `missing` € al ritmo de ahora (o vacío si el mes no sale en positivo). */
function monthsTo(state: GameState, missing: number): string {
  const net = monthNet(state);
  if (net === null || net <= 0) return '';
  const m = Math.max(1, Math.ceil(missing / net));
  return ` (≈ ${m === 1 ? '1 mes' : `${m} meses`})`;
}

/** "¿Qué hago ahora?": consejo por reglas a partir del estado real. */
export function nextHint(state: GameState): Hint {
  const has = (k: string) => state.buildings.some((b) => b.kind === k);
  const pop = state.citizens.length;
  const roads = state.map.tiles.filter((t) => t === 1).length;
  if (state.bankrupt || state.treasury < 0) {
    // Ronda 12: no pedir que suban los impuestos si ya están en «Alto».
    const allHigh = Object.values(taxLevels(state)).every((l) => l === 'high');
    if (allHigh) {
      return { text: 'La caja está en negativo y los impuestos ya están altos. No construyas; prueba un presupuesto austero (Pueblo › Ayuntamiento) o derriba lo que no se usa.' };
    }
    return { text: 'La caja está en negativo. Sube un poco los impuestos (Pueblo › Impuestos) y espera a que lleguen ingresos antes de construir.' };
  }
  // 2.7: el dinero primero. Si a este ritmo la caja aguanta menos de 3 meses (con el gasto
  // corriente, sin las obras), el consejo es de dinero, no otro servicio que costaría más cada mes.
  // 2.8: primero los impuestos o esperar; el préstamo, al final.
  const runway = runwayMonths(state);
  if (runway !== null && runway < 3) {
    const f = monthFlow(state);
    const why = `A este ritmo la caja aguanta ${monthsText(runway)}: entran ${money(f.income)} al mes y el gasto corriente es de ${money(f.running)}.`;
    return { text: `${why} ${moneyFix(state)} No empieces obras nuevas hasta que el mes salga en positivo.` };
  }
  if (roads <= 7) return { text: 'Alarga la calle: elige Carretera y arrastra desde la calle del ayuntamiento.', tool: 'road' };
  if (!has('water')) return { text: 'Sin agua nadie quiere vivir aquí. Construye una bomba de agua junto a una carretera.', tool: 'water' };
  if (!has('power')) return { text: 'Ahora la luz: pon una central eléctrica junto a una carretera conectada.', tool: 'power' };
  const unserved = state.buildings.filter((b) => b.built && b.kind !== 'water' && b.kind !== 'power' && b.kind !== 'farm' && (!b.hasWater || !b.hasPower));
  if (unserved.length > 0) {
    return { text: `${plural(unserved.length, 'edificio', 'edificios')} sin agua o luz (icono de gota o rayo). Conéctalos con carretera a las plantas, o construye otra si están llenas.` };
  }
  // v1.7: el servicio que falta en más viviendas (la capa «Qué falta» lo enseña casa por casa).
  const TOOL: Record<string, ToolId> = { colegio: 'school', salud: 'clinic', policia: 'police', ocio: 'park', bomberos: 'firestation', basuras: 'cleanpoint' };
  const gap = coverageSummary(state)
    .filter((r) => TOOL[r.key] && r.falta + r.lleno >= 3)
    .sort((a, b) => b.falta + b.lleno - (a.falta + a.lleno))[0];
  if (gap) {
    const n = gap.falta + gap.lleno;
    const tool = TOOL[gap.key]!;
    const base = `${n} viviendas no tienen ${NEED_LABEL[gap.key]}${gap.lleno && !gap.falta ? ' con sitio libre (está lleno)' : ' cerca'}.`;
    // 2.8: si el servicio deja el mes en pérdidas, se dice antes de elegirlo (y no se elige solo).
    const cost = serviceCost(state, tool as BuildKind);
    if (!cost.ok) return { text: `${base} ${cost.text} ${moneyFix(state)}` };
    return { text: `${base} Constrúyelo donde más falta: mira la capa «Qué falta».`, tool };
  }
  if (!zonesUnlocked(state)) {
    const need = TOWNHALL_LEVELS[1]!;
    if (pop >= need.pop) {
      return canUpgradeTownhall(state).ok
        ? { text: `${verbo({ cap: true })} el ayuntamiento y amplíalo a nivel 2: desbloquea las zonas R, C e I, el colegio y la policía.` }
        : { text: `Para el nivel 2 te faltan ${money(need.cost - state.treasury)}${monthsTo(state, need.cost - state.treasury)}. Espera a cobrar los tributos del mes.` };
    }
    // 2.8: cuando el progreso se para, cuánto falta y qué hacer.
    const missing = need.pop - pop;
    const short = `Te ${missing === 1 ? 'falta 1 vecino' : `faltan ${missing} vecinos`} para ampliar el ayuntamiento`;
    if (freeHomes(state) === 0 && !state.projects.some((p) => p.payer === 0)) {
      return { text: `${short}: construye ${missing <= 4 ? 'otra casa' : 'más casas'} para que llegue gente.`, tool: 'house' };
    }
    return { text: `${short}. Hay casas libres: pon el tiempo en marcha (▶, y acelera a x3) y espera a que llegue gente.` };
  }
  const { R, C, I } = state.demand;
  const zoned = (z: number) => state.map.zones.some((v, i) => v === z && !buildingAt(state, i % state.map.w, Math.floor(i / state.map.w)));
  if (R > 20 && !zoned(1)) return { text: 'Hay demanda de viviendas (R). Pinta una zona residencial junto a una carretera con agua y luz.', tool: 'zoneR' };
  if (I > 20 && !zoned(3)) return { text: 'Hay gente sin trabajo en el pueblo. Pinta una zona industrial (I), mejor lejos de las casas.', tool: 'zoneI' };
  if (C > 20 && !zoned(2)) return { text: 'Los vecinos quieren tiendas. Pinta una zona comercial (C).', tool: 'zoneC' };
  if (!has('park')) {
    const cost = serviceCost(state, 'park');
    if (!cost.ok) return { text: `Un parque sube la felicidad de las casas cercanas. ${cost.text} ${moneyFix(state)}` };
    return { text: 'Un parque sube la felicidad de las casas cercanas.', tool: 'park' };
  }
  // 2.8: el siguiente nivel del ayuntamiento, si está cerca: cuánto falta.
  const up = nextLevel(state);
  if (up) {
    if (pop >= up.pop && state.treasury < up.cost) {
      const miss = up.cost - state.treasury;
      return { text: `Para el nivel ${up.level} te faltan ${money(miss)}${monthsTo(state, miss)}. Mientras, no empieces obras caras.` };
    }
    if (pop >= up.pop && canUpgradeTownhall(state).ok) return { text: `Ya puedes ampliar el ayuntamiento a nivel ${up.level}: ${verbo()} el ayuntamiento para ver qué desbloquea.` };
    const missing = up.pop - pop;
    if (missing > 0 && missing <= Math.max(5, Math.round(up.pop * 0.15))) {
      return { text: `Para el nivel ${up.level} te ${missing === 1 ? 'falta 1 vecino' : `faltan ${missing} vecinos`}: pinta más zona R o construye casas.`, tool: R > 0 ? 'zoneR' : 'house' };
    }
  }
  // 2.3: el consejero avisa cuando se puede empezar una gran obra (o pagar la fase siguiente).
  const next = state.landmarks.find((l) => l.phase < l.phases && l.phaseUntil === -1 && !l.paused && landmarkReqs(state, l.kind, phaseCost(state, l)).every((r) => r.ok));
  if (next) return { text: `Ya puedes pagar la fase ${next.phase + 1} de ${LANDMARK_NAMES[next.kind].toLowerCase()}: ${verbo()} la obra en el mapa.` };
  const ready = LANDMARK_KINDS.find((k) => !state.landmarks.some((l) => l.kind === k) && landmarkReqs(state, k).every((r) => r.ok));
  if (ready) return { text: `Ya puedes empezar una gran obra: ${LANDMARK_NAMES[ready].toLowerCase()} (Construir › Grandes obras).`, tool: ready };
  if (state.demand.R <= 0) return { text: 'La demanda de vivienda está baja: crea empleo (zonas C e I) o servicios para atraer gente.' };
  return { text: 'Todo en orden. Amplía las calles y deja que el pueblo crezca.' };
}
