# Ronda 25 — revisión de la v2.8

Las seis partes de la v2.8 se hicieron por separado y se juntaron a mano. Después la revisaron cinco agentes:
- revisión de código de las costuras;
- un jugador habitual en el iPhone a x10, también en horizontal y al 200 %;
- un jugador de escritorio;
- equilibrio y dinero;
- una novata en Android de 360 px con los escenarios.

## Lo que encontraron

1. **Código:**
   - el CI quedaba en rojo por los tipos de un test y por la grabación de la IA, porque cambian el oficio y los textos que llegan al prompt;
   - la tarjeta de fin de escenario salía junto a un aviso fijo repetido, porque se pintaba antes que los avisos;
   - lo que te piden podía caducar a x10 sin frenar si hubo otro frenazo en el último minuto;
   - la barra de la quiebra llegaba a «13/13» sin haber ganado (faltaba pagar la deuda).
2. **Móvil a x10:**
   - grave: con una hoja abierta, x10 bajaba a x1 y no volvía nunca, ni tras «Ver ›»;
   - 41 bajadas en 964 días, de ellas 12 por encargos («Lucía quiere un colegio» volvía cada vez que caducaba);
   - al 200 % la nota y el aviso tapan casi todo el mapa.
3. **Escritorio:**
   - Inicio seguido de rueda dejaba la cámara en un prado vacío, porque el deslizamiento no se cortaba;
   - Espacio no pausaba después de hacer clic en un botón;
   - los atajos no funcionaban con Bloq Mayús;
   - «jubilado, 71 años · trabaja en tienda».
   - Bien: el zoom a 16 px, nítido a 60 fps; los atajos; el parte cuadra con la caja los 11 meses; la nota del banco se cumple.
4. **Equilibrio:**
   - ningún cambio de reglas de la 2.8 provoca las quiebras de la semilla 2;
   - el perfil `endeudado` pedía 49.000 € con 13 vecinos (su condición se cumplía siempre);
   - en la semilla 2 el plan de calles del perfil no cruza el río;
   - fallo del juego: dos descubiertos pequeños (1.000 y 3.000 €) bastaban para la D y, sin banco, para la quiebra.
5. **Novata:**
   - grave: asociaciones duplicadas con los mismos 20 socios y el mismo líder, cada una con su manifestación;
   - alarma de caja falsa tras el tutorial («2 m», «entran 0 €»);
   - en la riada, «?» recomendaba un colegio y «Préstamos» no aparecía;
   - género mal puesto («Lucía (contento)», «holgado»).

## Cambios aceptados (5)

1. **Costuras:**
   - tipos del test;
   - `PROMPT_VERSION` 6 y `TURN_PROMPT_VERSION` 17, con nueva grabación en vivo;
   - la tarjeta de logro va después de los avisos y quita el aviso repetido;
   - los 2 últimos días de lo que te piden frenan aunque se haya frenado hace poco;
   - la barra de la quiebra dice lo que falta para pagar la deuda.
2. **Ritmo a x10:**
   - la velocidad prometida vuelve al cerrar la hoja (también tras «Ver ›»);
   - los encargos no frenan (siguen en la campana).
3. **Banco:**
   - una tesorería menor que el 25 % de lo que entra al mes no cuenta para la nota (`LOANS.smallGap`);
   - el perfil `endeudado` espera a un préstamo de 90.000 €;
   - sin un mes cerrado no se calcula cuánto aguanta la caja.
4. **Escritorio:**
   - cualquier gesto corta el deslizamiento de la cámara;
   - tras un clic de ratón el botón suelta el foco, así que Espacio pausa;
   - los atajos de letra valen con Bloq Mayús.
5. **Vecinos y escenarios:**
   - un socio no funda otra asociación, y policía e inseguridad son la misma queja;
   - «contenta», «holgada», «endeudada» (`forPerson` en wording.ts);
   - «jubilado · sigue trabajando en…»;
   - en «Tras la riada», «?» habla de reparar y Préstamos se ve desde el principio (también en la quiebra).

## Quitado tras medirlo

- **Retirar del empleo a los jubilados.** Con el cambio, el escenario «Se vacía» (un pueblo envejecido) pasaba de ganarse en el mes 20 a perderse en la semilla 1, y no contratarlos era aún peor en la semilla 3. Se queda como «sigue trabajando», que existe de verdad (jubilación activa).

## Aplazados

- **Salir de la quiebra:** tras tres meses con neto positivo, pasar el hueco a una tesorería a 24 meses con interés de C.
- **El plan de calles de los perfiles del simulador** que cruce el río. La semilla 2 de `endeudado` sigue en quiebra por eso.
- **Un solo neto en toda la interfaz:** «?», la «N m» de la barra y «Hoy» usan `monthFlow` con estimación; el parte usa `monthNet`.
- **Al 200 % y en horizontal,** la nota de velocidad en una línea y sin el aviso repetido debajo.
- **Ritmo:**
  - que un incendio no frene si los bomberos ya llegan;
  - devolver el zoom de antes al volver a x10;
  - cerrar las burbujas al pasar a x10.
- **«Ver ›»** que lleve a la oferta y a la asociación concretas.
- **El tooltip** que se recalcule al mover la cámara con el teclado.
- **«Hablar»** con variedad por facción y rasgo, y el mismo trato en preguntas y respuestas.
- **Avisar** cuando un edificio parte una carretera.
- **`EARLY` por nivel:** al ampliar a nivel 4 llegan de golpe cartas, ofertas, dilemas y la gran empresa.
- **La tarjeta de resultado** con lo conseguido («5/6 reparado») y sin cerrarse con cualquier toque.

## Métricas (tras los cambios, semillas 1–3, 4 años; caja en miles de € · vecinos)

| Perfil | Semilla 1 | Semilla 2 | Semilla 3 |
|---|---|---|---|
| casual | 24 · 72 | 31 · 72 | 22 · 71 |
| constructor | 8 · 175 | 1 · 65 | 15 · 232 |
| endeudado | 51 · 139 | −211 · 63 (quiebra el día 840, plan de calles que no cruza el río) | 89 · 203 |
| campo | 88 · 40 | 45 · 92 | 120 · 48 |

- Deriva de dinero 0 en todos los casos.
- Las invariantes y los escenarios pasan; la riada se cumple entre los meses 8 y 12.
