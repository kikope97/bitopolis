/**
 * Textos de la interfaz. Preparado para añadir inglés: basta con otro
 * diccionario con las mismas claves.
 */
const es = {
  play: 'Jugar',
  continue: 'Continuar',
  configure: 'Configurar',
  modeNormal: 'Modo normal',
  modeAi: 'Modo IA',
  saveLink: 'Guarda este enlace: es tu partida. No lo publiques: quien lo tenga puede jugarla.',
  copyLink: 'Copiar enlace',
  copied: 'Enlace copiado',
  regenerate: 'Regenerar enlace',
  regenerateConfirm: 'El enlace actual dejará de funcionar. ¿Seguro?',
  export: 'Exportar copia (.bitopolis)',
  import: 'Importar copia',
  busyTitle: 'Partida abierta en otro dispositivo',
  busyText: 'Solo se puede jugar desde un sitio a la vez.',
  playHere: 'Jugar aquí',
  cancel: 'Cancelar',
  close: 'Cerrar',
  yes: 'Sí',
  no: 'No',
  whatNow: '¿Qué hago ahora?',
  saved: 'Guardado',
  saving: 'Guardando…',
  saveFailed: 'Sin conexión: se guardará al volver',
  desync: 'Se ha recuperado la última partida guardada',
} as const;

export type Key = keyof typeof es;
const dict: Record<Key, string> = es;

export function t(key: Key): string {
  return dict[key];
}

export const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function plural(n: number, one: string, many: string): string {
  return `${new Intl.NumberFormat('es-ES').format(n)} ${n === 1 ? one : many}`;
}

export const money = (n: number) => `${new Intl.NumberFormat('es-ES').format(n)} €`;

/** «1 ene A2»: para la cabecera en pantallas estrechas. */
export function shortDate(d: { year: number; month: number; day: number }): string {
  return `${d.day} ${MONTHS[d.month - 1]!.slice(0, 3).toLowerCase()} A${d.year}`;
}

export function formatDate(d: { year: number; month: number; day: number }): string {
  return `${d.day} ${MONTHS[d.month - 1]} · Año ${d.year}`;
}
