import { canUpgradeTownhall, coverageSummary, type GameState, NEED_LABEL, TOWNHALL_LEVELS, freeHomes, taxLevels, zonesUnlocked } from '@bitopolis/sim';
import type { ToolId } from './tools.ts';

export interface Hint {
  text: string;
  tool?: ToolId;
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
  if (roads <= 7) return { text: 'Alarga la calle: elige Carretera y arrastra desde la calle del ayuntamiento.', tool: 'road' };
  if (!has('water')) return { text: 'Sin agua nadie quiere vivir aquí. Construye una bomba de agua junto a una carretera.', tool: 'water' };
  if (!has('power')) return { text: 'Ahora la luz: pon una central eléctrica junto a una carretera conectada.', tool: 'power' };
  const unserved = state.buildings.filter((b) => b.built && b.kind !== 'water' && b.kind !== 'power' && (!b.hasWater || !b.hasPower));
  if (unserved.length > 0) {
    return { text: `${unserved.length} edificio(s) sin agua o luz (icono de gota o rayo). Conéctalos con carretera a las plantas, o construye otra si están llenas.` };
  }
  // v1.7: el servicio que falta en más viviendas (la capa «Qué falta» lo enseña casa por casa).
  const TOOL: Record<string, ToolId> = { colegio: 'school', salud: 'clinic', policia: 'police', ocio: 'park' };
  const gap = coverageSummary(state)
    .filter((r) => TOOL[r.key] && r.falta + r.lleno >= 3)
    .sort((a, b) => b.falta + b.lleno - (a.falta + a.lleno))[0];
  if (gap) {
    const n = gap.falta + gap.lleno;
    return {
      text: `${n} viviendas no tienen ${NEED_LABEL[gap.key]}${gap.lleno && !gap.falta ? ' con sitio libre (está lleno)' : ' cerca'}. Constrúyelo donde más falta: mira la capa «Qué falta».`,
      tool: TOOL[gap.key],
    };
  }
  if (!zonesUnlocked(state)) {
    const need = TOWNHALL_LEVELS[1]!;
    if (pop >= need.pop) {
      return canUpgradeTownhall(state).ok
        ? { text: 'Toca el ayuntamiento y amplíalo a nivel 2: desbloquea las zonas R, C e I, el colegio y la policía.' }
        : { text: `Para ampliar el ayuntamiento hacen falta ${need.cost} € en la caja. Espera a cobrar los tributos del mes.` };
    }
    if (freeHomes(state) === 0 && !state.projects.some((p) => p.payer === 0)) {
      return { text: `Construye casas para que llegue gente. Con ${need.pop} vecinos podrás ampliar el ayuntamiento y desbloquear las zonas.`, tool: 'house' };
    }
    return { text: 'Hay casas libres. Pon el tiempo en marcha (▶, y acelera a x3) y espera a que llegue gente.' };
  }
  const { R, C, I } = state.demand;
  const zoned = (z: number) => state.map.zones.some((v, i) => v === z && !state.buildings.some((b) => b.y * state.map.w + b.x === i));
  if (R > 20 && !zoned(1)) return { text: 'Hay demanda de viviendas (R). Pinta una zona residencial junto a una carretera con agua y luz.', tool: 'zoneR' };
  if (I > 20 && !zoned(3)) return { text: 'Hay gente sin trabajo en el pueblo. Pinta una zona industrial (I), mejor lejos de las casas.', tool: 'zoneI' };
  if (C > 20 && !zoned(2)) return { text: 'Los vecinos quieren tiendas. Pinta una zona comercial (C).', tool: 'zoneC' };
  if (!has('park')) return { text: 'Un parque sube la felicidad de las casas cercanas.', tool: 'park' };
  if (state.demand.R <= 0) return { text: 'La demanda de vivienda está baja: crea empleo (zonas C e I) o servicios para atraer gente.' };
  return { text: 'Todo en orden. Amplía las calles y deja que el pueblo crezca.' };
}
