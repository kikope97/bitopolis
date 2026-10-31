# Ronda 16 — cierre de la v2.0 (la superIA del pueblo)

## Qué trae la v2.0 (pedido por el creador)

«Que el Modo IA tenga muchísima más IA y menos reglas»; un % de vecinos con IA (no 20); peticiones agrupadas; que la IA decida también lo que pasa en el pueblo y las decisiones económicas, con su porqué; modelos desde la API key con «Recargar». Norma nueva: en cada versión, meter con IA todo lo posible. Plan: `docs/propuestas/v2.0-superia.md`.

- **Turnos semanales del pueblo** (`turns.ts`, `turn-prompt.ts`): todos los vecinos con IA deciden a la vez, por lotes de 15 con un bloque común cacheado: acción de su menú (también trabajo, mudarse, negocio, contratar, despedir, cerrar, asociaciones, tener hijos, robar si está desesperado), gesto social, actitud hacia el alcalde (mueve el voto), dónde gasta, ultimátum, pensamiento y una nota de su semana que lee la semana siguiente. Reacción rápida a las medidas gordas. Ritmo 7/14/28 días a x1/x3/x10.
- **Director del pueblo** (`director.ts`): menú de sucesos reales (robos, asociaciones, manifestaciones, peleas, reconciliaciones, amistades, ayudas, gratitud, rumores, mitin de la oposición, historias); presupuesto de drama; lo malo siempre avisado antes («Se está cociendo»); foco y crónica. Con director, las reglas dejan de tirar dados (y vuelven si no responde).
- **Contagio**: los vecinos por reglas copian a medias la actitud de sus amigos con IA o de su barrio.
- **Servidor**: lotes y director en paralelo, segunda pregunta a los que falten, escalera de gasto (Calidad → modelo barato al 70 % de un tope → reglas), modelos desde la API (desplegable con «Recargar»), % de vecinos con IA y «Turnos del pueblo» en `/admin`.
- **Cliente**: el reloj espera al turno (barra de 45 s en la franja); aviso semanal; «✦ Qué está pasando»; «Lo que piensa» en la ficha; ✦ en la lista de vecinos.
- **Pendientes de las rondas 14 y 15** resueltos (aviso de caja en «Construir», tutorial, ayuntamiento en Pueblo, inicio al 200 %, leyenda en horizontal, frases repetidas, rencor por no contestar, tabla de servicios).

## Mediciones en vivo (`pnpm ai-eval --live`, Anthropic)

| Prueba | Respondidas | Válidas | Pensamientos distintos | Latencia p50 / p95 | Coste por turno |
|---|---|---|---|---|---|
| Haiku, 240 días (antes de la ronda) | 94,9 % | 99,9 % | 89 % | 7,2 / 20 s | 0,003 € |
| Sonnet, 90 días | 90 % | 100 % | 100 % | 11 / 20 s | 0,044 € (≈1,1 €/h a x1) |
| Haiku + director Sonnet, 180 días | 99,8 % | 99,7 % | 79 % | 10,6 / 13,7 s | 0,003 € + 0,006 € el director |
| Igual, con el prompt de la ronda (PROMPT 8) | 95,4 % | 99,8 % | 81 % | 11,7 / 21,9 s | 0,004 € + 0,006 € |

Director: 100 % de respuestas válidas. Con el pueblo contento solo eligió sucesos buenos (gratitud, encuentros, rumores) y avisó de lo malo. Con el prompt nuevo, «pedir» baja de 241 a 96 (ya no se repite) y la actitud negativa del 45 % al 29 %.

`pnpm sim` (365 días, semilla 42): casual 37 vecinos, felicidad 69, caja 24.104 €; constructor 104 vecinos, felicidad 69, caja 25.211 €; sin errores de invariantes.

## Agentes de la ronda 16

1. **Diseño y justicia** (IA razonable y directores simulados, 3 años × 3 semillas, ramas desde el día 540): pueblo más vivo y tiendas con más margen (+25–60 %) y menos cierres. Pero no era justo: con el pueblo contento la seguridad salía gratis (0 robos ni manifestaciones en 3 años); algo descontento, el tope de golpe y siempre a las mismas tiendas (19 robos al año en una); a x10, un tercio de robos que a x1; ultimátums imposibles que vaciaban el pueblo; el modo ahorro reabría los dados sin aviso.
2. **Prompts y coste**: respuestas cortadas por tokens se perdían enteras; el turno podía tardar más que la espera del cliente (60 s frente a 45 s); el director no podía ir con Sonnet en Ahorro; `relaciones` y `con_quien` repetían a la misma gente; dominan «seguir» y «pedir» sin oportunidades económicas en el prompt; las cifras no se filtraban y el director recibía deudas exactas. Caché bien montada (el 25 % es lo que da el bloque común).
3. **Móvil** (5 tamaños, texto al 150/200 %): el chip «pensando» se iba al centro y tapaba el dinero; la espera no se veía (parecía colgado); chip de 39 px y partido en dos líneas; crónica apagada; etiquetas de lector enormes y con el ✦ leído.
4. **Código** (fuzz de 2.000 días con IA aleatoria: dinero, deuda y hash bien): **fuga de la API key** del jugador a un endpoint ajeno al cargar modelos; el servidor aceptaba un `TownTurn` inventado por el cliente (texto libre que acababa en el LLM); el 403 del % dejaba la partida sin guardar; con el % a 0 el turno no vencía; turnos que no se pedían si el servidor se reiniciaba.

## Cambios aceptados (5)

1. **Seguridad de los turnos**: la key guardada solo va a su endpoint (también en /admin); el servidor solo acepta el turno que respondió su IA (si no, 409 con el estado bueno); 409 en vez de 403 al cambiar el % con la IA del servidor; con el % a 0 el turno vence y vuelven las reglas; si el servidor no conoce un turno abierto, lo pide al consultarlo.
2. **Turnos a tiempo**: lotes y director a la vez, plazo total de 40 s (cabe en la espera de 45 s) con la segunda pregunta incluida; respuestas cortadas detectadas y el lote, partido en dos; el director va siempre con su modelo (Haiku + Sonnet en Ahorro); al saltarse el director cerca del tope, va vacío (no vuelven los dados).
3. **Director y ultimátums justos**: cupo de sucesos malos gradual por mes según el descontento (igual a cualquier velocidad); lo que justifican los datos (delincuencia ≥ 40 sin policía, asociación ignorada más de 2 meses) pasa aunque el pueblo esté contento, uno al mes; lo robado no vuelve al menú en 30 días; avisos que duran 28 días; ultimátum solo por su necesidad principal (empleo solo en paro), con 3 meses como mínimo, irse solo con felicidad < 55 y como mucho una marcha a la semana.
4. **Prompt (PROMPT 8)**: oportunidades del pueblo (puestos libres y dónde, viviendas, local libre, tiendas que ganan), lo que ya pidió cada vecino, una sola lista de gente, «la semana pasada» sin lo que decidió la costumbre, filtro de cifras inventadas en todos los textos y la deuda por tramos también en el director.
5. **Espera y chip en el móvil**: «✦ El pueblo decide la semana…» en la franja con barra de 45 s y ✦ en el botón de velocidad; chip «IA ✦» de 44 px que no se mueve; crónica destacada; etiquetas cortas para el lector de pantalla (el ✦ no se lee); «Piensa con IA: decide cada semana lo que hace».

## Aplazados

- **Lista de acciones compacta** (glosario de verbos en el `system` cacheado, ≈35 % menos entrada) y unir `motivo` con `pensamiento`: cambia el formato de salida y hay que medirlo en vivo.
- **En horizontal, las hojas tapan media barra de arriba** (chip, ☺, 🔔): rediseño del panel lateral.
- **Configurar la IA**: estimación debajo del deslizador y pie de enlace oculto con la hoja abierta; coste en Ajustes al mover el %.
- **Acciones desde «Se está cociendo»** (p. ej. «Construir agua»).
- Unificar el `system` del director con el de los vecinos para compartir caché; caché de 1 hora.
- Que la actitud se olvide poco a poco si la IA no responde; afinar el contagio.
- Al 200 % fuera del Modo IA, la barra de arriba pierde los iconos y las burbujas tapan el mapa.
