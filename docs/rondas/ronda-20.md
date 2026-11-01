# Ronda 20 — cierre de la v2.4 «Vida»

## Qué trae la v2.4 (plan aprobado por el creador: `docs/propuestas/v2.4-vida-comarca.md`)

Hecha con cuatro agentes del motor en paralelo, uno del cliente y el coordinador (bloque 0 y fusiones).

- **Cuidados** (`care.ts`): guardería (plazas, natalidad, padres que dejan el trabajo de fuera sin plaza) y residencia (mayores atendidos que no se van, cuotas con `charge()`, la decisión «llevar a la residencia o cuidar en casa»). Pensión mínima desde los 67 años, en lugar del sueldo de fuera.
- **Autobús** (`transit.ts`): estación de autobuses (`busstation`; `station` es la estación de tren de la 2.3), más trabajo fuera, billete al ayuntamiento, Consorcio y excursionistas; autobús animado.
- **El río** (`waterworks.ts`): suciedad aguas abajo, depuradora, multa de la Confederación, placas y molinos (solo en colina), «Salvemos el Río» y el vertido del director.
- **Plenos hablados y dilemas** (`pleno-prompt.ts`, `dilemmas.ts`): hasta 4 vecinos hablan en el pleno (IA, una llamada, fuera del estado; si no, plantillas) y el público reacciona; cuatro dilemas con datos reales y opciones del motor.
- **Fiestas de temporada** (`seasons.ts`): romería, San Juan, patronales y Navidad con comisión de festejos, programa y presupuesto.
- **Más IA**: acciones `llevar_a_residencia`, `cuidar_en_casa`, `buscar_trabajo_fuera`, `apuntarse_comision`, `reaccion_pleno` y `programa`; director con `excursion`, `vertido` y `dilema`; bloque «vida» en el prompt común. TURN_PROMPT_VERSION 14, formato de partida 17.

## Métricas (antes de la ronda; 8 semillas, 4 años)
| Perfil | Vecinos (mediana) | Caja (mediana) | Felicidad | Nacimientos | Mayores que se van |
|---|---|---|---|---|---|
| Casual 2.3 | 76 | 38.979 € | 71 | — | — |
| Casual 2.4 | 76 | 29.297 € (media −10 %) | 72 | 44–50 | 3 |
| Constructor 2.3 | 216 | 26.071 € | 73 | — | — |
| Constructor 2.4 | 224 | 23.514 € | 71 | 75 | 15 |

- Invariantes y deriva de dinero 0 en todo; billete por debajo del 1 % de los ingresos; vitest 475/475.

## Agentes de la ronda 20

1. **Equilibrio y diversión**:
   - «Ampliar la residencia» cobraba 3.000 € y no añadía plazas.
   - Cuotas y billete: «normal» ganaba siempre (el nivel solo movía dinero).
   - Fiestas: la comisión recaudaba como mucho 200 €, «poco» dejaba la fiesta sin actos y «todo» marcaba unas patronales grandes por 900 €.
   - Dilemas: 175 de 182 eran de la fábrica, saltaban aunque hubiera depuradora y ninguna opción tenía consecuencia.
   - Río: la multa no llegaba nunca; renovables mucho más baratas que la central.
2. **Móvil**:
   - Con texto al 150/200 % los botones de cuota y billete se montaban y «Rechazar» del pleno se salía.
   - El dilema podía caducar sin verse a x10 y el aviso abría el primero sin resolver, no el nuevo.
   - Postura del pleno a 2,1:1 y solo por color; textos con faltas (preso en masculino fijo, minúscula tras punto, doble dos puntos).
3. **Código**:
   - La grabación de la IA era del prompt 12 (el CI fallaría).
   - Plaza y desahucio no se volvían a comprobar al decidir; billete sin `charge()`; rencor de la comisión sin tope; la ruta del pleno se fiaba del cliente.
   - Con la IA caída, el parado ambicioso tiraba dados de trabajo cada semana.
4. **IA**:
   - `buscar_trabajo_fuera` sin espera y saltándose la crisis de la comarca.
   - En Modo IA un pueblo contento no tenía nunca dilemas (gastaban cupo de drama malo).
   - El prompt no sabía nada de fiestas, billete, cuotas ni río; los actos iban sin coste.
   - El pleno admitía ids como cifras y tiraba líneas buenas si cambiaba la postura.

## Cambios aceptados (5)

1. **Móvil**: botones de cuota y billete en columna con texto grande; filas del pleno que se ajustan; el dilema siempre frena a x1, abre el suyo, dice «Quedan N días», avisa a 2 días y cada nombre dice quién es; postura del pleno con ✓/✗/≈ y contraste; plantillas y textos corregidos.
2. **Código**: la ampliación suma 3 plazas (`care.extraPlaces`); plaza y desahucio se comprueban al decidir; billete con `charge()`; búsqueda de trabajo fuera una vez al mes y con la comarca (`TRANSIT.searchBonus`); rencor con tope; la ruta del pleno usa los datos del servidor; e2e con `PW_LLM_PORT`.
3. **IA**: dilemas con cupo propio y fuera de «Se está cociendo»; bloque `vida` en `turnShared` (fiesta, autobús, cuotas, río, en palabras); actos con coste y efecto; una línea en `TURN_SYSTEM` para las acciones nuevas; la postura del pleno la pone el motor y los ids no cuentan como cifras. Grabación nueva en vivo.
4. **Equilibrio de cuotas, billete y fiestas**: natalidad con plaza según la cuota (×1,7/1,5/1,25), residencia con cuota de más de media pensión solo con ahorros, billete que mueve el empleo de fuera (0,50/0,45/0,38) y gratis +1 de ánimo; la comisión recauda 40 € por vecino con nombre, se quita primero el acto más caro y el programa de la comisión es una fiesta pequeña.
5. **Dilemas, río y renovables**: la fábrica solo da dilema con el río sucio a su lado; multar la deja vertiendo la mitad un año y manda a los despedidos al paro; mirar a otro lado provoca un vertido; deuda mínima de la familia 200 €; el río arrastra más (caída 0,02) y multa desde 35 a la salida; placas 120 € y molino 300 € de mantenimiento.

## Aplazados

- El recorte del 20 % a quien cuida en casa sale de todo lo que le entra (también paro o microcréditos), no solo del sueldo.
- Respaldo por reglas para los vecinos con IA que dejan a un padre solo semanas y semanas (`CARE.aiGraceMonths`); `dejar_trabajo_crianza` como acción de la IA; carta de la comisión escrita por el director; `ApproveFestival` con «nada» como medida gorda.
- Cobertura de guardería en «Qué falta» (solo para hogares con niños pequeños).
- Autobús que se confunde con un coche al zoom alejado (franja de color, parada con cartel); dos autobuses a la vez en la estación; opciones del dilema bajo el pliegue en la hoja `.half`; iconos pequeños en las cabeceras de las fichas.
- Romería que casi nunca sale (los perfiles no construyen ermita); perfiles que prueben las renovables y cambien cuotas y billete.
- Barra de arriba con texto grande (cifras pegadas), de antes de la 2.4.
