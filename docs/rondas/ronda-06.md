# Ronda 06 — cierre de la v1.0 (Elecciones)

## Qué trae la v1.0

- **Elecciones cada 4 años.**
  - Facciones (jubilados, jóvenes, empresarios y ecologistas) con exigencias opuestas que se miden en el pueblo.
  - Intención de voto determinista: por esperanza, sin azar.
  - Avisos de popularidad a 12, 6, 3 y 1 meses.
- **Oposición emergente:** un vecino influyente funda un partido.
- **Si pierdes:** gobierna el rival según su facción y tú pasas a la oposición. No hay game over.
- **Voto de los vecinos con nombre:** IA o reglas, con opciones cerradas.
- **Campaña** por facción.
- **Interfaz:**
  - indicador 🗳 en el HUD;
  - hoja «Política y elecciones»;
  - noche electoral con recuento animado;
  - modo oposición;
  - objetivos plegables (aplazado de la ronda 05).
- **Decisión de equilibrio:** facciones y oposición desde 50 vecinos en lugar de 200 (§5.7). A 4 años, casi ningún pueblo llegaba a 200 (máximo 165).
- **Prueba en vivo con Anthropic (`claude-haiku-5-5`):** 6 de 6 votos válidos, con motivos como «Ya no me creo a ninguno… las campañas son puro ruido».

## Métricas antes de la ronda (6 semillas, 1.500 días)

| Perfil | Pob. a 4 años | Quiebras | Intención de voto final | Elecciones: gana / pierde / sin rival |
|---|---|---|---|---|
| casual | 72 | 33 % | 64 % | 2 / 2 / 2 |
| ahorrador | 76 | 33 % | 87 % | 3 / 0 / 3 |
| agresivo | 62 | 17 % | 48 % | 0 / 3 / 3 |
| derrochador | 54 | 100 % | 89 % | 1 / 0 / 5 |
| constructor | 120 | 17 % | 84 % | 3 / 0 / 3 |

**Hallazgo previo:** las quiebras a largo plazo ya existían antes de la v1.0, con los mismos días de quiebra. Nunca se habían medido más allá del primer año.

## Agentes

1. **Economista.**
   - La causa de las quiebras eran plantas de agua y luz sin servir: hasta 15 centrales para 41 edificios, con unos 1.100 €/mes cada una. La capacidad se agotaba y la planta nueva caía en una red de calles desconectada.
   - Propuesta: capacidad 45/60 y que el bot no construya plantas de más.
   - La deuda crece sin freno.
   - El derrochador está hecho para quebrar.
2. **Min-maxer de la política.**
   - La campaña gratis decidía las elecciones: 5 de 5.
   - Bajar impuestos 15 días antes de votar también: 5 de 5.
   - Por debajo de 50 vecinos nunca hay rival.
   - El gobierno rival arruinaba la caja: no subía impuestos y construía parques sin límite.
   - En empate ganaba el jugador incluso desde la oposición.
3. **Casual.**
   - La oposición es una espera de 3 años sin nada que hacer.
   - La encuesta y el resultado no cuadran (34 % frente a 29 %) y los porcentajes sumaban 101.
   - En la oposición, los impuestos parecían tocables.
   - No se explicaba qué hace la campaña.
   - Los bocadillos tapaban la noche electoral.
4. **Accesibilidad.**
   - FALLO: el resultado no se anunciaba al lector de pantalla.
   - FALLO: la aria-label decía «0 meses».
   - Bordes de las barras del rival y de la abstención poco claros.
   - Los botones de campaña deshabilitados seguían activos.
5. **IA e historias.**
   - El líder del partido apenas tenía historia.
   - El recuerdo `voto` no se usaba nunca.
   - «Hablar» seguía llamando «alcalde» al jugador en la oposición.
   - El prompt es seguro: entra solo texto del motor.
6. **Reseña.** «Un pequeño alcalde con alma… pero perder te deja años mirando y el rival es un nombre sin cara». Nota estimada: 7,5/10.

## Decisión (5 cambios)

1. **Economía a largo plazo** (economista 1–2; min-maxer 4).
   - `PLANT_CAPACITY` pasa de 30/40 a 45/60.
   - Los bots no construyen plantas de más.
   - Los bots suben un nivel de impuestos si el mes cierra en negativo y la caja baja de 10.000 €.
   - El gobierno rival sube impuestos con déficit, no construye en déficit y tiene un tope de 1 parque por cada 25 vecinos y 1 casa por cada 15.
2. **Campaña equilibrada y reglas electorales** (min-maxer 1, 5, 6; casual 1).
   - Efecto 0,06 → 0,03.
   - Gobernando: el último año y 300 € por acto.
   - En la oposición: gratis y durante todo el mandato, así que hay algo que hacer.
   - El empate lo gana quien gobierna.
   - Umbral de oposición 72 % → 90 %: con la economía sana, sin él casi nunca había rival.
3. **Las bajadas de impuestos se notan despacio** (min-maxer 2).
   - Cada vecino tiene un nivel notado que sube al momento y baja en 90 días. Afecta a la felicidad y a las exigencias de las facciones.
   - Bajar justo antes de votar ya no sirve.
4. **Claridad y accesibilidad de la política** (casual 2–5; accesibilidad 1–4).
   - La encuesta indica «sin contar la abstención».
   - El resultado da votos y porcentajes que suman 100.
   - El resultado se anuncia en `#sr-live`.
   - La aria-label dice los días que faltan.
   - Borde visible al final de cada barra y abstención con fondo.
   - Campaña deshabilitada con estilo y `aria-describedby`.
   - Texto que explica qué da votos.
   - En la oposición, los impuestos se ven pero no se tocan.
   - Sin bocadillos durante la noche electoral.
5. **La oposición con historias** (IA 1–3).
   - Recuerdos `gano_elecciones` y `perdio_elecciones` para el líder.
   - El recuerdo `voto` se usa.
   - Gancho del director `rival_politico` al fundar el partido.
   - En la oposición, «Hablar» te llama concejal, y el alcalde rival responde como alcalde.
   - El prompt recibe lo que pide la facción del vecino (`faccion_pide`).

## Métricas después

A 4 años (6 semillas, 1.500 días):

| Perfil | Pob. a 4 años | Quiebras | Intención de voto final | Elecciones: gana / pierde / sin rival |
|---|---|---|---|---|
| casual | 59 | 0 % | 87 % | 3 / 0 / 3 |
| ahorrador | 67 | 0 % | 87 % | 4 / 0 / 2 |
| agresivo | 47 | 0 % | 64 % | 1 / 1 / 4 |
| derrochador | 95 | 50 % | 87 % | 5 / 0 / 1 |
| constructor | 111 | 17 % | 87 % | 5 / 0 / 1 |

- Las elecciones sin rival son ahora casi siempre de pueblos con menos de 50 vecinos.
- El perfil agresivo (impuestos altos) se juega la alcaldía voto a voto: 21–22 y 33–31.
- Gobernar bien da la victoria.

A 1 año (10 semillas, 360 días):

| Perfil | Pob. a 1 año | Quiebras |
|---|---|---|
| casual | 51.7 | 0 % |
| ahorrador | 58.6 | 0 % |
| agresivo | 53.5 | 0 % |
| derrochador | 69.1 | 0 % |
| constructor | 81.3 | 0 % |

Mejor/peor: 1,57x. La población baja algo porque los bots ya suben impuestos con déficit; a cambio, se acaban las quiebras.

## Aplazado o rechazado

- *Aplazado a la v1.1:*
  - repasar los ingresos: sin la fuga de las plantas, a 8 años las cajas son muy holgadas;
  - tope a los intereses de la deuda;
  - rival con promesas propias que se le puedan echar en cara en el pleno;
  - «Proponer en el pleno» desde la oposición;
  - hasta 2 exigencias por facción.
- *Rechazado:*
  - Bajar `OPPOSITION_POP` a 25: los pueblos de menos de 50 vecinos aún aprenden lo básico; el rival llega con la Plaza Mayor.
  - Tocar el perfil derrochador: está hecho para quebrar, y con la v1.0 ya no quiebra el primer año.
