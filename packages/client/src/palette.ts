/**
 * Paleta cerrada de 64 colores (decisión del creador, ronda 04). Los 32
 * primeros son los de siempre (los sprites usan sus índices); los 32 nuevos
 * dan tonos intermedios, piel, agua, humo y noche. Cualquier color del arte
 * debe estar aquí: scripts/check-palette.ts lo valida en el build.
 */
export const PALETTE = [
  // 0–31: base
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
  '#472d3c', '#7a444a', '#a05b53', '#bf7958', '#eea160', '#f4cca1', '#b6d53c', '#71aa34',
  '#397b44', '#3c5956', '#302c2e', '#5a5353', '#7d7071', '#a0938e', '#cfc6b8', '#dff6f5',
  // 32–39: piel y pelo
  '#f2c8a2', '#d9a066', '#a0674b', '#6e4a3a', '#3f2a24', '#e8b04b', '#c24a2c', '#8a8f99',
  // 40–47: verdes y tierra intermedios
  '#d4e86c', '#8cc63f', '#5c9a3a', '#2f6b3a', '#1e4d3b', '#c9a46a', '#94714a', '#5e4632',
  // 48–55: agua, humo y metal
  '#9fe4ff', '#2a8fd6', '#1f5fa0', '#c9cdd2', '#9aa1aa', '#6b7280', '#d7dee6', '#3d4552',
  // 56–63: noche, luces y acentos
  '#141428', '#20203c', '#2e2f55', '#ffe9a0', '#ffd34d', '#ff8fa3', '#9b6bd3', '#6be0c0',
] as const;

/** Índices con nombre de los colores nuevos que usa el código. */
export const C = {
  skin: 32,
  skinTan: 33,
  skinBrown: 34,
  skinDark: 35,
  hairDark: 36,
  hairBlond: 37,
  hairRed: 38,
  hairGray: 39,
  water: 49,
  waterDeep: 50,
  waterLight: 48,
  smoke: 51,
  smokeMid: 52,
  smokeDark: 53,
  night: 56,
  nightMid: 57,
  nightLight: 58,
  lamp: 59,
  lampWarm: 60,
} as const;
