# Ronda 05 — cierre de la v0.5 (Pulido)

## Qué trae la v0.5

**Arte** (decisión del creador: «muchísimo más definido», más colores y animaciones):
- Paleta de 64 colores.
- Recoloreado de día, atardecer y noche con tonos de la propia paleta, y ventanas encendidas de noche.
- Vecinos caminando por las aceras (7×12 px a la escala del mapa).
- Árboles con viento, humo en las chimeneas y agua en las fuentes.
- Retrato de 12×18 en la ficha.
- Horizonte del pueblo en la pantalla de inicio.

**Sonido y feedback:**
- WebAudio sintetizado: efectos con variación de tono y ambiente generativo, con mute separado para cada uno.
- Squash & stretch, polvo y monedas que vuelan al contador.

**Accesibilidad:**
- Texto al 100/150/200 %, alto contraste y dos modos de daltonismo (también en las capas).
- Modo tranquilo y animaciones reducidas.
- Radiogroups con flechas y trampa de foco en las hojas.
- Cursor de casilla por teclado.
- Carretera y zonas con «toque inicio / toque fin».
- WCAG AA validado en el build.

**Rendimiento:** suelo incremental por casilla, hierba en caché y solo se dibuja el trozo visible.

**PWA:** manifest, iconos generados desde el pixel art y service worker para los recursos con hash.

**Interfaz:** relieve de píxel en botones, hojas y avisos.

**Fuera de la hoja de ruta, a petición del creador:**
- Anthropic con el SDK oficial; el proveedor se deduce de la key.
- Acceso solo con contraseña (`BITOPOLIS_PASSWORD`).

## Métricas (10 semillas, 360 días)

La simulación no cambia en esta versión.

| Perfil | Pob. a 1 año | Quiebras | Felicidad | Relaciones | Objetivos cumplidos |
|---|---|---|---|---|---|
| casual | 68.0 | 0 % | 64 | 34.8 | 7.8 |
| ahorrador | 72.3 | 0 % | 68 | 34.5 | 7.9 |
| agresivo | 58.9 | 0 % | 56 | 34.2 | 8.0 |
| derrochador | 60.8 | 20 % | 77 | 32.3 | 7.3 |
| constructor | 89.7 | 0 % | 67 | 35.7 | 7.8 |

Mejor/peor: 1,52x.

Rendimiento (`pnpm perf`, CPU ×4 más lenta, pueblo de 115 vecinos, render por software en headless):
- móvil: 26–32 fps de media y mediana de 16–33 ms;
- escritorio: 39–47 fps.

Antes había tirones de más de 60 ms al aparecer edificios o cambiar la hora.

IA en vivo (Anthropic, ronda 04): 100 % de decisiones válidas a la primera y ≈0,003 € por mes de juego.

## Agentes

1. **Director de arte y sonido.**
   - El atardecer parecía un desierto y la noche aplanaba la hierba.
   - Humo en todas las casas, que se lee como contaminación.
   - Los vecinos aportan.
   - La música repetitiva y sin silencios cansa.
   - Ráfagas de efectos a x10.
2. **Reseña pública.**
   - El inicio con el horizonte es «lo mejor».
   - El panel de objetivos tapa el mapa en el móvil.
   - Cortes de texto al 200 %.
   - Hierba ruidosa.
   - Pide que las elecciones «se vean»: indicador junto al ☺ y noche electoral.
3. **Accesibilidad.**
   - FALLO: la ficha de inspección se recreaba cada 150 ms y robaba el foco.
   - FALLO: el foco se perdía al cerrar una hoja abierta desde un aviso.
   - FALLO: el contraste no se comprobaba en los modos de daltonismo ni en los bordes (2,02:1).
   - FALLO: con el cursor de teclado no se oía el resultado.
   - El modo tranquilo solo pausaba en 3 tipos de evento.
4. **Casual en el móvil.**
   - La carretera con dos toques construía sin enseñar el trazado ni el coste.
   - Los Ajustes cuestan de encontrar.
   - La vibración en cada orden molesta.
   - Los avisos tapan la ayuda de la herramienta.
   - x3 y x10 parecían funcionar en modo tranquilo.

## Decisión (5 cambios)

1. **Foco y lector de pantalla** (accesibilidad 1, 2, 4, 5; casual 6).
   - Refrescar una hoja abierta cambia solo su contenido y conserva el foco y el scroll.
   - Al cerrar, el foco vuelve al mapa si su origen ya no existe.
   - `aria-modal="true"`.
   - `#sr-live` anuncia el resultado de cada orden, la velocidad y la pausa.
   - El cursor describe la zona y si la herramienta se puede usar ahí, con su coste.
   - El mapa explica cómo usarlo con teclado.
   - El modo tranquilo pausa también cuando un vecino se va, cuando abre una empresa y cuando termina una obra con aviso; x3 y x10 aparecen deshabilitados.
2. **Día, atardecer y noche legibles** (arte 1–2, reseña 3–4).
   - Atardecer cálido sin volver marrón la hierba.
   - Noche más clara y más corta: 22–5 h.
   - Hierba con menos manchas.
3. **Menos ruido** (arte 3, 5, 6; casual 3).
   - Humo solo en la industria y la central, y en 1 de cada 5 casas con una sola bocanada.
   - Un mismo efecto no suena dos veces en menos de 400 ms.
   - Monedas con onda triangular.
   - Música por frases de 8 notas con silencios de 4–8 s y volumen 0,08.
   - Ya no vibra con cada orden; solo en hitos y obras con aviso.
4. **Contraste completo** (accesibilidad 3).
   - `check-contrast.ts` comprueba 13 pares en 4 modos: normal, alto contraste, rojo-verde y azul-amarillo.
   - Bordes `#8a8f99` (3,36:1).
   - «Mal» en `#ff8fa3`, o `#eea160` en rojo-verde, siempre ≥4,5:1.
   - La leyenda y los objetivos usan `--line`.
5. **Carretera y zonas en dos toques con confirmación** (casual 1 y 4).
   - Tras marcar el inicio, el primer toque en el final enseña el trazado, las casillas y el coste.
   - Un segundo toque ahí confirma.
   - Mientras se coloca, los avisos suben para no tapar la ayuda.

## Aplazado o rechazado

- *Aplazado a la v1.0* (las elecciones necesitan ese espacio):
  - plegar el panel de objetivos;
  - indicador de popularidad junto al ☺;
  - noche electoral.
- *Aplazado (backlog):*
  - horizonte animado en el inicio;
  - icono pixelado propio en vez de 🔑;
  - halo de las farolas;
  - avisos compactos de una línea al 150–200 %;
  - acceso directo «Aa» a los Ajustes.
- *Rechazado:*
  - Dibujar vecinos solo con zoom ≥2 en móvil: con el zoom por defecto se ven y dan vida.
  - Elegir el tempo de la música por día de juego: con frases y silencios ya no se nota el cambio de tempo.
