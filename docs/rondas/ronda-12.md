# Ronda 12 — cierre de la v1.6 (rediseño de la interfaz)

## Cómo se hizo (pedido por el creador)

Tras la 1.5, cinco agentes jugaron en dispositivos emulados con toques reales (CDP) y criticaron la interfaz sin piedad:

- arquitecto de interfaz en iPad;
- iPhone mini (375×812);
- iPhone 17 Pro Max (440×956);
- jugadora casual en iPhone 17 (402×874);
- Android pequeño (360×640) y en horizontal (640×360).

Coincidieron en lo esencial:

- el mapa casi nunca estaba despejado (57–63 % libre en Android, 30 % con texto al 200 %);
- 16 herramientas en una fila con scroll (solo se veían 3 o 4);
- avisos apilados que tapaban el juego a x10;
- menú ☰ plano;
- hojas que tapaban lo consultado;
- bloqueos mudos;
- R/C/I sin explicar;
- horizontal mal aprovechado.

## Qué trae la v1.6

- **Barra de arriba única:**
  - ⏯ y velocidad, dinero con tendencia, habitantes, felicidad y 🔔;
  - cada dato se toca: cuentas, vecinos, «Felicidad» (causas medias y los menos contentos) y avisos.
- **Mapa sin nada fijo encima:**
  - solo el chip de capas (abre una lista; antes cambiaba a ciegas) y «?»;
  - el zoom con botones, solo con ratón;
  - la cámara inicial encuadra el pueblo.
- **Franja de contexto (`#strip`):**
  - fecha y R/C/I, o «Zonas: 6/10 vecinos» antes del desbloqueo;
  - la ayuda y el precio de la herramienta;
  - la barra «Construir / ✕»;
  - el derribo se confirma ahí, en rojo, sin ventana modal;
  - «?» deja su consejo en la franja.
- **Cinco pestañas:**
  - Mirar, Carretera, Construir, Derribar y Pueblo;
  - «Construir» abre una bandeja por categorías con precio;
  - lo bloqueado explica qué falta.
- **Panel «Pueblo»:**
  - secciones Dinero, Ayuntamiento, Gente, Objetivos (ya no flotan sobre el mapa), IA y Ajustes;
  - las hojas abiertas desde él llevan «‹».
- **Avisos:** uno a la vez, bajo la barra de arriba; todos quedan en la campana con fecha y enlace.
- **Hojas:**
  - fichas a media pantalla;
  - el mapa se mueve para que el edificio se vea;
  - vecinos en filas con retrato;
  - recuerdos sin repetir.
- **Tableta y horizontal:** las hojas son un panel lateral no modal, y el mapa sigue a la vista y se puede usar.
- **Iconos y escala:**
  - iconos de píxeles 12×12 (`icons.ts`) en vez de emojis;
  - escala `--ui` para el texto al 150 % y al 200 %.
- **Fallos al volver a entrar:**
  - la sesión es del dispositivo (`localStorage`), así que ya no sale «otro dispositivo» en el mismo móvil;
  - el tutorial salta los pasos ya hechos.
- **Consejero:** ya no pide subir los impuestos si ya están en «Alto».
- **Textos del motor:** «☰ ›» pasa a «Pueblo ›».

## Métricas

20 semillas, 4 años. El motor no cambia; solo cambian textos:

| Perfil | Quiebras v1.5 | Quiebras v1.6 | Invariantes |
|---|---|---|---|
| casual | 0/20 | 0/20 | 0 |
| constructor | 3/20 | 3/20 | 0 |
| derrochador | 12/20 | 12/20 | 0 |

- **Pruebas:** 161 unitarias y 54 e2e. Los e2e usan `pickTool` (bandeja), `data-paused` y la lista de capas.
- **Capturas:** 9 pantallas × 6 tamaños (mini, 17, Pro Max, Android, horizontal e iPad).

## Agentes de verificación (sobre la v1.6)

1. **Pantallas pequeñas** (mini, Android vertical y horizontal; al 200 % y con fuente pixel):
   - mapa libre del 70–77 % en el mini y del 64–73 % en Android;
   - dock y confirmación grandes; bandeja y panel claros; x10 sin ruido.
   - Fallos:
     - «Saltar» del tutorial recibía toques destinados al mapa;
     - una hoja abierta tapaba la barra de confirmar;
     - se cortaba «No se puede deshacer»;
     - cifras cortadas arriba al 200 %.
2. **Jugadora nueva** (iPhone 17):
   - «ahora sí se entiende»: 10 vecinos sin atascarse;
   - al volver, ni «otro dispositivo» ni tutorial desde cero;
   - el último paso del tutorial no se iba y tapaba «?» y «Capas»;
   - no había un momento de desbloqueo.
3. **Pantallas grandes** (Pro Max, iPad, escritorio):
   - barra y pestañas con nombres accesibles completos; teclado correcto.
   - Fallos:
     - la barra de arriba era una región viva con botones;
     - ⏯ estaba «pulsado» en pausa;
     - el panel lateral era modal y tapaba avisos;
     - no se veía qué sección estaba abierta;
     - el foco se recortaba en la barra.

## Cambios aceptados (5)

1. **Barra de arriba accesible:**
   - sin `role="status"`;
   - ⏯ dice la acción («Pausar» / «Poner en marcha a x3»), con el estado en `data-paused`;
   - foco visible dentro de la barra.
2. **Panel lateral (tableta y horizontal):**
   - no modal (sin trampa de foco);
   - centra el edificio en lo que queda a la vista;
   - la franja y los avisos dejan sitio al panel.
3. **Sección activa:**
   - con el panel «Pueblo» o la bandeja abiertos, solo se resalta esa pestaña (`#menu` con `aria-expanded`);
   - el botón de la tarjeta Ayuntamiento pasa a «Presupuesto y fiestas».
4. **Tutorial:**
   - el paso de ▶ pide x3;
   - el paso de «10 vecinos» se cierra solo y le sigue «¡Zonas desbloqueadas! Construir › Zona R»;
   - los botones y la leyenda del mapa suben por encima de la caja (`--tut-h`);
   - «Saltar» pide confirmación.
5. **Momento de desbloqueo:** al llegar a 10 vecinos, sonido, aviso «¡Zonas desbloqueadas!» que abre la bandeja y la pestaña «Construir» parpadeando.

## Fallos corregidos (no son cambios nuevos)

- Elegir herramienta o proponer una obra cierra la hoja abierta: nunca queda la barra de confirmar debajo.
- El texto de derribo pone primero «No se puede deshacer» y admite 3 líneas.
- Las cifras de la barra de arriba no se cortan: sin iconos ni flecha al 150/200 % y con fuente pixel en pantallas estrechas. `#speed` mide 44 px.

## Aplazados o quitados

- **Ritmo a x1** (aplazado): la jugadora casual lo nota lento al empezar y propone una velocidad mayor que x10. El ritmo de 20 s por día es de la spec; se mira con métricas en otra ronda.
- **Capa de felicidad de noche** (aplazado): se distingue poco.
- **Volver a «Construir» tras cada obra** (quitado): la jugadora dudó un momento cuando la pestaña pasó a llamarse «Casa». Se queda como está porque así se ve qué herramienta está en la mano; la duda fue breve.
- **Horizontal 640×360** (aplazado): «Jugar» queda bajo el pliegue en la pantalla de inicio, y la bandeja abierta con tutorial tapa la primera fila.
- **Escritorio ancho** (aplazado): hueco central en la barra y barras R/C/I muy largas; tope de ancho y etiquetas más grandes.
- **Mezcla de tipografías** (aplazado): títulos en monoespaciada y cuerpo en sans.
