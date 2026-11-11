# Ronda 24 — diez jugadores y tres desarrolladores (plan de la v2.8)

## Cómo se hizo

El creador pidió diez agentes que jugaran con perfiles distintos y pasaran sus informes a tres desarrolladores de perfil distinto, para quedarse con las mejores sugerencias.

- **Jugadores:**
  - un novato;
  - un veterano de los juegos de ciudades;
  - un jugador casual que entra en ratos;
  - una persona mayor;
  - un adolescente con prisa;
  - alguien que juega por las historias;
  - un optimizador;
  - una revisión de accesibilidad;
  - un jugador de escritorio con ratón y teclado;
  - alguien que juega a los retos (escenarios).
- **Desarrolladores:** diseño de juego, interfaz y motor.

## Lo que más se repitió

1. **x10 que frena a x1 sin parar.** Desde la 2.7, todo lo que pedía respuesta con plazo bajaba a x1 al llegar. Además, el aviso no decía qué era ni llevaba allí.
2. **El dinero decía cosas distintas en cada pantalla:**
   - el parte, «Hoy», el panel «Pueblo» y Gestión calculaban el neto de distinta forma;
   - el préstamo contaba como ingreso;
   - la estimación del IBI no cuadraba con lo cobrado.
3. **El banco tenía un agujero.** Pedir el máximo que ofrecía dejaba la nota en D.
4. **Al 150/200 % y en horizontal**, las barras (confirmar, deshacer, tutorial) se comían el mapa y los avisos tapaban la cabecera de las hojas.
5. **La avalancha de los 30 vecinos:** encargos, El Eco, ofertas, cartas, dilemas y gran empresa llegaban a la vez.
6. **La riada se ganaba derribando** lo destrozado.
7. **No se celebraba nada:** ni subir de nivel ni cumplir un escenario.
8. **Vecinos incoherentes:**
   - «jubilada de 41 años»;
   - asociaciones que celebraban un logro que no era suyo;
   - «Hablar» en tercera persona;
   - género mal puesto, «Bar de Celia de Celia».
9. **En escritorio:** al alejar el mapa se veía borroso, no había tooltip, la rueda no iba hacia el puntero y faltaban atajos.

## Qué se aplicó (v2.8, seis partes en paralelo)

- **A · Ritmo y avisos:**
  - lo que te piden solo frena si vence pronto (10 días al llegar, o 2 si llegó con más);
  - una sola espera de 60 s entre frenazos (`SLOW_GAP_MS`);
  - «Bajo a x1: … · Ver ›»;
  - el modo tranquilo dice por qué pausa (`calmPause`);
  - `wording.ts` (los nombres de las pestañas que se ven, «toca»/«haz clic»);
  - lo visto se recuerda por partida (`bitopolis.once.<token>`);
  - el tutorial explica R/C/I;
  - «?» pone el dinero primero.
- **B · Dinero:**
  - un solo neto del mes (`monthNet`);
  - el préstamo aparte en el parte;
  - la nota del banco: `capLoad` 0,18 (lo máximo que presta deja la nota en B), la caja que cubre la deuda da B y `ratingAfter` en el formulario;
  - `ibiForecast`.
- **C · Pantalla:**
  - barras apiladas con tope al 150/200 % y en horizontal;
  - `placeToasts` (los avisos no tapan la cabecera de la hoja);
  - ✗ en las casillas inválidas y en las zonas sin carretera;
  - rampa rojo-verde real;
  - capas «Ruido» y «Delincuencia»;
  - punto de guardado con forma (●/◐/✕).
- **D · Progreso:**
  - `EARLY` escalonado (encargos 30, El Eco 40, ofertas 45, cartas 50, dilemas 60, gran empresa 70);
  - la riada se gana reparando (`goal.sites`, derribo bloqueado mientras dura);
  - `celebrate-ui.ts`: tarjeta de nivel, barra de meta en la franja y tarjeta de resultado con «Reintentar».
- **E · Vecinos:**
  - oficio según la edad (`professionForAge`);
  - recuerdos ancla que no se olvidan;
  - asociaciones honestas que cambian de bandera;
  - «Hablar» en primera persona;
  - género y textos corregidos.
- **F · Escritorio:**
  - al alejar, ×2 nítido a 16 px por casilla;
  - rueda hacia el puntero;
  - tooltip `#hover-tip`;
  - atajos (Mayús+P, Mayús+A, ?, < y >, Mayús+1/2/3, Inicio) y chuleta (`keys-ui.ts`);
  - clic derecho para cancelar.

## Aplazados en la ronda 24

- **Reequilibrar los impuestos:** los desarrolladores no se pusieron de acuerdo.
- **Lo que descartaron los tres desarrolladores:**
  - financiar cada servicio entre el 80 y el 120 %;
  - dinero por las medallas;
  - zoom fraccionario en el móvil;
  - «Pueblo sencillo» encendido por defecto (decisión del creador: está en Configurar y viene apagado).
