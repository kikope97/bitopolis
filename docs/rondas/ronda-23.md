# Ronda 23 — v2.7 «Interfaz móvil 2.0»

## Por qué esta versión

El creador pidió una interfaz completamente renovada, pensada sobre todo para el móvil: que se vea bien, se pueda jugar, sea amigable y se entienda.

Primero jugaron cinco agentes en el móvil:
- un novato a 360 px;
- un jugador habitual en iPhone y en horizontal;
- un diseñador;
- una revisión de accesibilidad en siete pantallas;
- un jugador casual que entra en ratos con una mano.

Sus informes coincidían, y el plan salió de ahí: `docs/propuestas/v2.7-interfaz-movil.md`.

## Qué trae la v2.7

Hecha en dos tiempos. Primero el coordinador puso la base; después, cinco agentes en paralelo hicieron una parte cada uno y se juntó a mano.

- **Sistema de diseño** (`mobile2.css`, que va después de `style.css` y manda):
  - escala de letra, espaciado y capas;
  - colores por función de la paleta de 64;
  - botones unificados (lo desactivado lleva candado);
  - `touch-action` en toda la interfaz;
  - el texto al 150 y al 200 % agranda de verdad (×1,5 y ×2).
- **Barra de arriba en una fila, siempre:**
  - lo que no cabe va a «⋯» (vecinos, votos, IA, y luego la felicidad);
  - la caja avisa con «N m» de cuántos meses aguanta, calculado con el gasto corriente;
  - «Guardado» es un punto;
  - el calendario va en la barra y se quita si no cabe.
- **Mapa limpio:**
  - Capas, «?» y ⌂ en la zona del pulgar;
  - con una herramienta elegida solo queda «Capas» y las burbujas no roban toques;
  - la leyenda es un chip de una línea.
- **Ritmo:**
  - «A x3 y x10, bajar a x1 por»: emergencias y lo que te piden con plazo (por defecto), también lo importante, o nada;
  - vuelve sola a la velocidad de antes a los 20 s;
  - en pausa, ⏯ late.
- **Hojas en tres alturas que se arrastran:**
  - asomada, media y completa; deslizar hacia abajo cierra;
  - la completa respeta el notch y no tapa la barra;
  - la cámara vuelve al cerrar;
  - en horizontal, el dock es un riel lateral.
- **Campana por partida:**
  - pestañas «Te piden» (con plazo y botón) y «Ha pasado» (agrupado);
  - los avisos abren su tarjeta;
  - fuera las rutas de texto del motor.
- **«Hoy en Bitópolis»**, en vez de «Mientras no estabas»: una tarjeta con cómo va el pueblo, lo que te piden, la cara del día y «▶ Seguir».
- **Panel «Pueblo» 2.0:** 4 tarjetas de resumen, «Lo urgente» y una lista con iconos (17 nuevos).
- **Fichas** con cabecera, estado («Lleno 113 %»), botón principal y detalle plegado. Turismo tiene hoja propia.
- **Construir:**
  - bandeja con chips y 3 columnas;
  - el coste al mes como gasto («−1050 €/mes»);
  - aviso de caja tras cada obra;
  - gasto corriente separado de las obras (`cash.ts`; arregla `monthlyCostEstimate`);
  - «?» pone el dinero primero;
  - aviso de calle suelta y casilla inválida en rojo.
- **Accesibilidad:**
  - contraste de 4,5:1 o más y nada por debajo de 12 px;
  - diálogos con el fondo `inert`, `h1` oculto, dock como `toolbar`;
  - Ajustes con la accesibilidad primero y el tamaño del texto también en el inicio;
  - «Cargando» visible desde el primer momento;
  - tutorial que no tapa el mapa.
- **e2e:** `movil2.spec.ts` (medidas en 320, 360, 390, 740×360 y 768×1024, al 100 y al 200 %, también a x10) y `campana.spec.ts`.

## Agentes de la ronda 23 (revisión tras la unión)

1. **Código:**
   - el paso de IA del CI fallaba por los textos nuevos del motor (hay que volver a grabar);
   - los plegables guardaban como elección del jugador lo que se abría por defecto («Su bolsillo» quedaba abierto para todos los vecinos);
   - «Te piden» se quedaba viejo en pausa;
   - el panel y «Hoy» contaban las obras en la caja;
   - con «Hoy» abierta, Atrás preguntaba si salir y el teclado actuaba por debajo;
   - otros: tutorial al repetirlo, campana guardada sin validar, `fitTopbar` en cada estado, «⋯» repetido, vuelta de velocidad con un diálogo abierto.
2. **Jugador habitual (iPhone y horizontal), de un 4 a un 7:**
   - x10 sin frenazos, horizontal y Gestión bajo el notch resueltos;
   - grave: con una hoja abierta los avisos tapaban sus filas y se quedaban con el toque;
   - ampliar el ayuntamiento por 70.000 € de un toque;
   - los botones del mapa robaban toques al construir;
   - avisos fijos poco urgentes amontonados a x10.
3. **Jugador casual con una mano y accesibilidad:**
   - «Hoy», «Te piden», el panel y el horizontal, muy bien;
   - grave: a x10 el calendario sacaba la campana de la barra;
   - lo que pide respuesta con plazo caducaba en segundos;
   - la franja medía menos de 44 px.
4. **Novato a 360 px, «a 100 % es otro juego»:**
   - grave: con el texto al 150 y al 200 % la columna del juego se ensanchaba y «Construir» quedaba fuera de la pantalla;
   - la etiqueta de «Solo emergencias» no decía lo que hacía;
   - avalancha de sistemas a los 30 vecinos.

## Cambios aceptados (5)

1. **Código (unión):**
   - plegables solo con la elección del jugador y por vecino o edificio;
   - «Te piden» al responder;
   - «Hoy» con Atrás y teclado;
   - la caja del panel y de «Hoy» con el gasto corriente;
   - tutorial y campana robustos;
   - barra que no se mide en cada estado;
   - nueva grabación en vivo de la IA.
2. **Avisos que no estorban:**
   - con una hoja abierta, lo que trae una acción va a la campana y el resto se lee pero no se toca;
   - a x10 los fijos poco urgentes se van solos.
3. **Gastos grandes y toques al construir:**
   - ampliar el ayuntamiento pide confirmar si se lleva más del 20 % de la caja (ampliar edificios ya lo hacía);
   - al construir solo «Capas» queda en la pila del mapa;
   - miles con punto también en el mensaje del motor.
4. **x10 para quien juega a ratos:**
   - el calendario encaja la barra (y se quita antes que la campana);
   - lo que te piden con plazo baja a x1 al llegar (salvo con «Nada»);
   - la franja de 44 px.
5. **Texto grande:** la columna del juego no se ensancha (`minmax(0, 1fr)`) y la etiqueta de «Frenar el tiempo» dice lo que hace.

## Aplazados

- **Construir a distancia:** que el borde desplace el mapa al arrastrar y que se pueda construir alejado sin que el primer toque acerque.
- **Hojas:** arrastrarlas desde el cuerpo (hoy solo el asa y la cabecera), con umbral más corto.
- **Tiempo con la gestión abierta:** pausa opcional al abrir hojas de gestión, y el efecto en el voto antes de subir el IBI.
- **Lista de vecinos:** retratos en vez de emojis y orden por «quién me necesita».
- **Bocadillo en «Hablar».**
- **Al entrar, el mapa encuadra el pueblo.**
- **Incoherencias de vecinos:** «jubilada de 41 años que trabaja en una tienda».
- **Avalancha de sistemas a los 30 vecinos:** escalonarlos.
- **«?» que avisa si una obra pasaría el mes a pérdidas.**
- **Al 200 %:** la franja y las barras R/C/I crecen; la hoja «Capas» en 320.
- **Al volver:** saltar la pantalla de inicio («Continuar»); «Hoy» durante el tutorial.
