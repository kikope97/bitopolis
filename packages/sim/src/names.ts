/** Nombres de los vecinos (los usa el motor y el filtro de nombres inventados). */
export const FIRST_NAMES = [
  'Ana', 'Pablo', 'Carmen', 'Javier', 'Elena', 'Diego', 'Rosa', 'Marcos', 'Nuria', 'Iker',
  'Marta', 'Andrés', 'Lola', 'Sergio', 'Inés', 'Raúl', 'Pilar', 'Hugo', 'Sara', 'Tomás',
  'Julia', 'Álvaro', 'Irene', 'Mario', 'Alba', 'Rubén', 'Clara', 'Óscar', 'Noelia', 'Adrián',
  'Celia', 'Gonzalo', 'Paula', 'Víctor', 'Lorena', 'Emilio', 'Teresa', 'Jaime', 'Aitana', 'Félix',
];
export const SURNAMES = [
  'García', 'López', 'Martín', 'Sánchez', 'Romero', 'Navarro', 'Torres', 'Gil', 'Ruiz', 'Molina',
  'Ortega', 'Delgado', 'Castro', 'Vidal', 'Rubio', 'Serrano', 'Marín', 'Iglesias', 'Pascual', 'Prieto',
];

/**
 * Nombres y apellidos habituales en España que el juego no usa (v1.3, ronda 09).
 * Sirven para detectar si el LLM se inventa a alguien: solo se marcan palabras
 * que son nombres de verdad, no «Lunes», «Don» o «Comisaría».
 */
export const COMMON_NAMES = [
  'Antonio', 'Manuel', 'José', 'Francisco', 'David', 'Juan', 'Daniel', 'Luis', 'Carlos', 'Jesús', 'Alejandro', 'Miguel', 'Rafael', 'Pedro',
  'Fernando', 'Jorge', 'Alberto', 'Ramón', 'Enrique', 'Vicente', 'Paco', 'Pepe', 'Manolo', 'Juanjo', 'Santiago', 'Ignacio', 'Alfonso', 'Joaquín',
  'Rodrigo', 'Nicolás', 'Martín', 'Lucas', 'Mateo', 'Marco', 'Bruno', 'Iván', 'Rubén', 'Eduardo', 'Ricardo', 'Agustín', 'Anacleto', 'Wenceslao',
  'María', 'Isabel', 'Laura', 'Cristina', 'Lucía', 'Lucia', 'Josefa', 'Rocío', 'Patricia', 'Raquel', 'Beatriz', 'Silvia',
  'Encarna', 'Eva', 'Lola', 'Tere', 'Maribel', 'Marisa', 'Montse', 'Begoña', 'Nerea', 'Olga', 'Sonia',
  'Natalia', 'Andrea', 'Sofía', 'Valeria', 'Daniela', 'Carla', 'Martina', 'Emma',
  'Fernández', 'González', 'Rodríguez', 'Pérez', 'Gómez', 'Díaz', 'Hernández', 'Muñoz', 'Álvarez', 'Jiménez', 'Gutiérrez', 'Alonso',
  'Domínguez', 'Vázquez', 'Ramírez', 'Morales', 'Suárez', 'Ortiz', 'Garrido', 'Cortés', 'Lozano',
];
