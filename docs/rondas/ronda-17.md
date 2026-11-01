# Ronda 17 — cierre de la v2.1 (emergencias y encargos)

## Qué trae la v2.1 (pedido por el creador: «bomberos, incendios, más servicios, más mejoras… añádelo todo»)

Sale de cuatro agentes de ideas y de la hoja de ruta aprobada (`docs/propuestas/hoja-de-ruta-2.x.md`). Se hizo con tres agentes en paralelo (cada uno en su copia del repo) y el coordinador; los planes detallados de la 2.2, 2.3 y 2.4/2.5 los escribieron otros tres agentes (`docs/propuestas/v2.2-*`, `v2.3-*`, `v2.4-*`).

- **Bomberos e incendios** (`fire.ts`): riesgo con aviso previo (más en fábricas, con calor y con las estufas del invierno), fuego que dura horas y puede saltar al lado, parque de bomberos con niveles (cisterna para las colinas, apoyo en riadas), edificio destrozado que se repara y nunca se pierde, camión animado. **Protección civil** (riadas −60 %, quitanieves a mitad, diques en la orilla, voluntarios) y **ambulancia** (nivel 2 del centro de salud). En Modo IA, el director elige el incendio entre los avisados y los vecinos ayudan, acogen o se hacen voluntarios.
- **Basura y punto limpio** (`trash.ts`): basura por edificio, bolsas y ratas, suciedad que resta felicidad y sube la delincuencia, camión que recorre la red de calles, reciclaje y compostaje; la tasa la paga quien tiene camión. Asociaciones por la basura, «tirar al monte» y plaga de ratas del director.
- **Encargos del pueblo** (`errands.ts`): retos que salen del estado real (un servicio junto a la casa de un vecino, parados, delincuencia en su calle, felicidad, deudas), con Prometer / Más adelante / No, plazo, recompensa y medalla. En Modo IA, el director elige uno y escribe la carta.
- **El Eco de Bitópolis** (`press.ts`): periódico semanal con titulares de lo que ha pasado (en Modo IA los escribe el director) y una respuesta del alcalde por edición.
- **De aldea a capital comarcal** (`rank.ts`): rangos con cartel, escudo por código, tejados y fanfarria; en Modo IA los vecinos votan el lema y la pieza del escudo en su turno. **«Mientras no estabas»** y **diario sin repeticiones**.
- Formato de partida 14, TURN_PROMPT_VERSION 9.

## Métricas
`pnpm sim` (3 años): casual 28–80 vecinos, constructor 80–135, ninguna quiebra; todos los incendios con aviso previo; e2e 100/100 antes de la ronda.

## Agentes de la ronda 17

1. **Equilibrio y diversión** (3 perfiles × 5 semillas × 4 años): el punto limpio frenaba todo el crecimiento (con 20 vecinos y 20 días de aviso, justo cuando se ahorra para el ayuntamiento 3); el aviso de incendio de 24 h no dejaba hacer nada (2 s a x10); encargos monótonos («quiere un colegio» cada semana con otro nombre) y casi imposibles; periódico por reglas repetitivo (86 % «Semana tranquila»); el rango copiaba el nivel del ayuntamiento (Villa nunca en 6 de 20 partidas). Los incendios no arrasan barrios; las recompensas no rompen la economía.
2. **Móvil** (4 tamaños, 100–200 %): los botones de «Mientras no estabas» quedaban bajo el pliegue; el fuego apenas se veía con el zoom del móvil; tocar el Dique bloqueado no explicaba nada a la vista; las respuestas de El Eco solo se explicaban en `title`; nombres accesibles que no contenían el texto visible.
3. **Código** (fuzz con escudo, titulares y encargos; replay; migración de partidas reales v13; rendimiento 4,0 ms/día): lo destrozado por el fuego seguía funcionando (comisaría que detiene, policía que baja la delincuencia, colegio que atiende); las casas quemadas seguían pagando alquiler; en la oposición se perdían los turnos de la IA; la ayuda «?» no conocía bomberos ni basura.
4. **IA del director**: un campo largo de la IA (pieza del escudo, acción, gasto) tumbaba el turno entero; titulares inventados o de sucesos que el motor no ejecuta; «ayudar en el incendio» sin tope (todo el pueblo a la vez); el director podía salir cortado sin enterarse; la votación del escudo vencía antes del turno a x3/x10.

## Cambios aceptados (5)

1. **La IA nunca tumba el turno**: cada campo dentro de los límites del comando (si no, se descarta ese campo); el voto del escudo solo con ids de la votación enviada; titulares solo de noticias reales o de sucesos que de verdad pasan; ayudas por incendio solo de quien tiene relación, vive cerca o tiene medios, y como mucho 4; director con 1.400 tokens y estado «cortado»; la votación del escudo dura al menos un turno y solo la cierra un turno semanal.
2. **Equilibrio**: punto limpio con 30 vecinos y 45 días de aviso; 72 h de aviso de incendio; encargos de servicio sin repetirse con otro nombre y de uno en uno; periódico con relleno variado y sin repetir lo de las dos ediciones anteriores; rangos un nivel de ayuntamiento antes (Villa con el 2, Ciudad con el 3, Capital con el 4).
3. **Lo destrozado no actúa**: comisaría, cárcel, colegio, salud, biblioteca y fábrica destrozados dejan de contar (campos, saturación, detenciones); una casa quemada no paga alquiler ni tributos hasta repararla.
4. **La IA también en la oposición** (el turno del pueblo y los votos no son órdenes del alcalde) y **«?» con bomberos y punto limpio**.
5. **Móvil**: botones de «Mientras no estabas» siempre a la vista (barra fija, momentos alineados arriba, los ocultos inertes, nombres accesibles con el texto visible); llamas más grandes con el zoom lejano; el motivo de un bloqueo también como aviso; ayuda visible bajo las respuestas de El Eco; textos («no se le cobra la tasa», días en vez de 400 horas).

## Aplazados

- **Perfil «constructor» que entra en déficit** en 2 de 6 semillas (amplía el ayuntamiento y monta los bomberos pronto) y se queda en 35 vecinos: es del perfil del simulador; ajustar sus prioridades en la 2.2 con los préstamos.
- Que los encargos ataquen la caja ociosa (recompensas que no sean dinero): con la 2.2/2.3.
- Lotes más pequeños con el modelo de calidad y una lista de acciones compacta (latencia de Sonnet con 15 vecinos por lote): medir en vivo.
- Introducción de Encargos y Escudo plegada en horizontal; contraste de `.p-mood.good` en tableta; barra de arriba en horizontal al 200 %.
- La nieve corta la recogida pero no la tasa (intencionado, revisar); podar `emergencies.scares`.
