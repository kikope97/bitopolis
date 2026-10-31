# Ronda 10 — cierre de la v1.4 (auditoría táctil)

## Por qué

El creador probó el juego en su móvil y fue claro: «no has cuidado nada la interfaz ni la usabilidad táctil, que era la principal norma». En concreto:
- el mapa ocupaba muy poco;
- las obras caían casillas por encima;
- se ponían edificios al arrastrar el mapa;
- el menú ☰ «se abría en bucle»;
- a x10, la pantalla se llenaba de mensajes que no se iban y no se podía tocar nada.

Esta versión es una auditoría a fondo y los arreglos. Lo que pidió el creador va fuera del cupo de 5 cambios.

## Qué trae la v1.4

- **Pendientes de la ronda 09:**
  - saturación de servicios por radio: cada vecino cuenta para el más cercano que le alcanza;
  - resúmenes en las tarjetas plegadas de `/admin`.
- **Auditoría táctil** con 4 agentes en móviles emulados y toques reales por CDP, más una verificación final.

## Fallos encontrados y arreglados

| Queja | Causa | Arreglo |
|---|---|---|
| Obras 3 casillas por encima | El canvas solo se redimensionaba con la ventana: al cambiar el alto del texto de ayuda quedaba estirado | `ResizeObserver` en el mapa; 27 de 27 toques aciertan |
| Muchos edificios al arrastrar | Un toque con temblor colocaba la obra al momento | En táctil, «Construir / ✕»; doble toque y toques repetidos no construyen; margen de arrastre de 18 px |
| Menú ☰ «en bucle» | La ficha del último edificio mirado se seguía refrescando y sustituía cualquier hoja varias veces por segundo (menú, impuestos, vecino, noche electoral) | Solo se refresca la hoja que está abierta |
| x10 imposible | Burbujas grandes de 9 s que capturaban el dedo; avisos fijos que se acumulaban | A x10, ni burbujas ni avisos menores; burbujas pequeñas, sin capturar el dedo y siempre dentro de la pantalla; los fijos caducan a los 15 s (salvo en el modo tranquilo) |
| Mapa pequeño | Cabecera, demanda, ayuda, herramientas y velocidad apiladas | Un solo dock (⏯, velocidad, herramientas, ☰) y la ayuda encima del mapa |
| Clic fantasma (verificación) | El clic que el navegador genera tras el toque caía sobre «Construir» recién aparecido | El mapa se queda el toque y la barra ignora sus primeros 350 ms |

Además:
- tocar el tejado de un edificio lo elige a él;
- con carretera o zona, un dedo mueve el mapa;
- inercia al deslizar, zoom mínimo usable y borde del mapa limitado;
- las hojas quedan por encima del dock, así que se puede pausar con una hoja abierta;
- botón atrás: cierra la hoja y, sin hojas, pregunta antes de salir;
- menú ☰ en rejilla;
- botones del mapa junto al pulgar;
- horizontal con columna de herramientas;
- cabecera corta en pantallas estrechas;
- pleno y campaña piden confirmación;
- la noche electoral ya no deja su clase puesta;
- el movimiento reducido del sistema se aplica al momento.

## Métricas

| Pantalla | Área del mapa antes | Área del mapa ahora |
|---|---|---|
| iPhone SE (320×568) | 69 % de alto; unos 50 % libres | 77 % del área |
| Android 360×640 | 72 %; unos 50 % libres | 80 % |
| Pixel 7 | 79 % | 85 % |
| Pixel 7 en horizontal | 39 % (botones tapados) | 80 % |

- **Verificación final:** 15 de 17 arreglos funcionando a la primera; los otros 2 se arreglaron después (clic fantasma e instrucción al trazar). Nota del verificador: 6,5/10 antes de esos dos arreglos.
- **Pruebas:** 147 tests unitarios y 52 e2e. Nuevo `e2e/tactil.spec.ts`, con toques reales: obra en la casilla tocada, arrastrar no construye, carretera con dos toques, menú sin bucle, sin clic fantasma e instrucción al trazar.
- **Motor:** sin cambios de equilibrio por la saturación por radio. Con 20 semillas, el constructor quiebra 3 veces y el derrochador 10; en la v1.3, 4 y 10.

## Aplazados (al rediseño grande posterior a la v1.5, que pidió el creador)

- **Mover el mapa sin arrastrar** (WCAG 2.5.7): hay +/− y teclado, pero falta una cruceta táctil.
- **Zoom continuo con la pinza:** se mantienen niveles enteros para que el pixel art se vea nítido.
- **Foco por clave** en las hojas que se refrescan, en vez de por posición.
- **Ayuda de la herramienta que se pliegue sola** a los pocos segundos.
