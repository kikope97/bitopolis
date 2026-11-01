import type { GameState } from './state.ts';
import { Tile } from './state.ts';
import { CRIME, DENSITY, FIELDS, REGION, TERRAIN, TRASH, WATERWORKS } from './balance.ts';
import { landmarkStamps } from './landmarks.ts';
import { radiusOf } from './levels.ts';
import { isWater, Terrain } from './terrain.ts';

/**
 * Externalidades por casilla (0–100): contaminación (persistente), ruido,
 * delincuencia y valor del suelo. Se recalculan al cerrar cada día.
 */
export interface Fields {
  pollution: number[];
  noise: number[];
  crime: number[];
  land: number[];
  /** 2.1: suciedad por la basura sin recoger (bolsas y ratas). */
  dirt: number[];
  /** 2.4: suciedad del río por casilla (0–100; solo en casillas de río, waterworks.ts). */
  river: number[];
}

export function emptyFields(n: number): Fields {
  return { pollution: new Array(n).fill(0), noise: new Array(n).fill(0), crime: new Array(n).fill(0), land: new Array(n).fill(50), dirt: new Array(n).fill(0), river: new Array(n).fill(0) };
}

/** Suma `amount` con caída lineal hasta `radius` (distancia Manhattan). */
function stamp(out: Float64Array, w: number, h: number, x0: number, y0: number, radius: number, amount: number) {
  for (let y = Math.max(0, y0 - radius); y <= Math.min(h - 1, y0 + radius); y++) {
    for (let x = Math.max(0, x0 - radius); x <= Math.min(w - 1, x0 + radius); x++) {
      const d = Math.abs(x - x0) + Math.abs(y - y0);
      if (d > radius) continue;
      out[y * w + x]! += amount * (1 - d / (radius + 1));
    }
  }
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function updateFields(state: GameState): void {
  const { w, h, tiles } = state.map;
  const n = w * h;
  const f = state.fields;
  const emit = new Float64Array(n);
  const noise = new Float64Array(n);
  const crime = new Float64Array(n);
  const police = new Float64Array(n);
  const good = new Float64Array(n);
  const dirt = new Float64Array(n);
  const residents = new Map<number, number>();
  // v1.9: la pobreza también cuenta: cada vecino endeudado suma delincuencia en su casa.
  const indebted = new Map<number, number>();
  for (const c of state.citizens) {
    if (c.homeId === null) continue;
    residents.set(c.homeId, (residents.get(c.homeId) ?? 0) + 1);
    if (c.debt && c.debt.town + c.debt.bank > 0) indebted.set(c.homeId, (indebted.get(c.homeId) ?? 0) + 1);
  }

  for (const b of state.buildings) {
    // Ronda 17: lo destrozado (fuego, disturbios) no actúa: ni policía ni fábrica.
    if (!b.built || b.damaged) continue;
    switch (b.kind) {
      case 'factory':
        stamp(emit, w, h, b.x, b.y, 4, 9);
        stamp(noise, w, h, b.x, b.y, 3, 45);
        break;
      case 'power':
        stamp(emit, w, h, b.x, b.y, 3, 5);
        stamp(noise, w, h, b.x, b.y, 2, 30);
        break;
      case 'shop':
        stamp(noise, w, h, b.x, b.y, 2, 15);
        stamp(good, w, h, b.x, b.y, 4, 8);
        break;
      case 'park':
        stamp(good, w, h, b.x, b.y, 5, 18);
        stamp(emit, w, h, b.x, b.y, 3, -4);
        break;
      case 'school':
      case 'clinic':
        stamp(good, w, h, b.x, b.y, 8, 12);
        break;
      case 'bar':
        // El bar alegra, pero hace ruido por la noche.
        stamp(good, w, h, b.x, b.y, 4, 6);
        stamp(noise, w, h, b.x, b.y, 3, 14);
        break;
      case 'library':
      case 'sports':
      case 'chapel':
        stamp(good, w, h, b.x, b.y, 7, 8);
        break;
      case 'jail':
        // A nadie le gusta vivir junto a la cárcel: baja el valor del suelo.
        stamp(good, w, h, b.x, b.y, 4, -12);
        break;
      case 'police':
        stamp(police, w, h, b.x, b.y, radiusOf(b), 1);
        stamp(good, w, h, b.x, b.y, 6, 5);
        break;
      case 'wind':
        // 2.4: el molino no contamina, pero zumba (radio 3).
        stamp(noise, w, h, b.x, b.y, WATERWORKS.wind.noiseRadius, WATERWORKS.wind.noise);
        break;
      case 'bigfactory':
        // 2.3: la fábrica de la gran empresa contamina el doble que un taller (REGION.bigCompany.pollution).
        stamp(emit, w, h, b.x, b.y, 5, 9 * REGION.bigCompany.pollution);
        stamp(noise, w, h, b.x, b.y, 4, 45);
        break;
      default:
        // 2.3: grandes obras (suelo alrededor del puente, ruido del estadio el día de partido).
        for (const st of landmarkStamps(state, b)) stamp(st.field === 'good' ? good : st.field === 'noise' ? noise : emit, w, h, st.x, st.y, st.radius, st.amount);
        break;
    }
    // 2.5: un bloque que creció con la densidad hace más ruido (DENSITY.noisePerLevel por nivel).
    if (b.kind === 'res' && b.dense) stamp(noise, w, h, b.x, b.y, DENSITY.noiseRadius, DENSITY.noisePerLevel * b.dense);
    // 2.1: la basura sin recoger ensucia la calle (bolsas desde dirtyAt; con ratas, a tope).
    if ((b.trash ?? 0) >= TRASH.dirtyAt) stamp(dirt, w, h, b.x, b.y, TRASH.dirtRadius, (100 * (b.trash ?? 0)) / TRASH.ratsAt);
    const people = residents.get(b.id) ?? 0;
    if (people > 0) stamp(crime, w, h, b.x, b.y, 4, people * 2.2 + (indebted.get(b.id) ?? 0) * CRIME.debtCrime);
  }
  // v1.8: los robos sin resolver suben la inseguridad alrededor durante un tiempo.
  for (const hs of state.justice?.hot ?? []) stamp(crime, w, h, hs.x, hs.y, 3, CRIME.hotCrime);
  // Tráfico: las carreteras hacen ruido según la población.
  const traffic = Math.min(25, 4 + state.citizens.length / 12);
  for (let i = 0; i < n; i++) if (tiles[i] === Tile.Road) noise[i]! += traffic;

  const cx = w / 2;
  const cy = h / 2;
  // v1.7: vistas al agua (a 2 casillas o menos) y en alto suben el valor del suelo.
  const ter = state.map.terrain ?? [];
  const view = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (ter[i] === Terrain.Hill) view[i] = TERRAIN.hillLand;
    if (isWater(ter[i])) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && isWater(ter[ny * w + nx])) {
          near = true;
          break;
        }
      }
    }
    if (near) view[i]! += TERRAIN.waterfrontLand;
  }
  f.dirt ??= new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    // La contaminación industrial persiste: se disipa muy despacio.
    f.pollution[i] = clamp(f.pollution[i]! * FIELDS.pollutionDecay + emit[i]!);
    f.noise[i] = clamp(noise[i]!);
    f.dirt[i] = clamp(dirt[i]!);
    // 2.1: con la calle sucia sube la delincuencia (hasta un 10 % con ratas).
    const filth = 1 + TRASH.crimeBoost * Math.min(1, f.dirt[i]! / TRASH.ratsField);
    f.crime[i] = clamp(crime[i]! * filth * (1 - Math.min(0.75, police[i]! * 0.9)));
    const x = i % w;
    const y = Math.floor(i / w);
    const centre = Math.max(0, 15 - (Math.abs(x - cx) + Math.abs(y - cy)) * 0.6);
    f.land[i] = clamp(40 + centre + view[i]! + good[i]! - f.pollution[i]! * 0.6 - f.noise[i]! * 0.25 - f.crime[i]! * 0.4 - f.dirt[i]! * 0.15);
  }
}

export function fieldAt(state: GameState, key: keyof Fields, x: number, y: number): number {
  return state.fields[key][y * state.map.w + x] ?? 0;
}
