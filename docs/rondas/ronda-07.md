# Ronda 07 — cierre de la v1.1

## Qué trae la v1.1

- **Publicado automático:** al fusionar en `main` una versión nueva de `package.json`, el CI publica `:X.Y.Z` y `:latest` y crea la release. Lo autorizó el creador.
- **Economía a largo plazo:** PIE de 40 a 30 € por vecino. Los intereses de la deuda no pasan del 25 % de lo ingresado en el mes.
- **Oposición jugable:**
  - el rival nace con una promesa a su facción;
  - mociones desde la oposición;
  - hasta 2 exigencias por facción;
  - formato de partida 7, con migración.
- **Fuente bitmap propia** como opción (Ajustes › Letra › Pixel). Era de la spec (§8.4) y estaba pendiente.
- **Audio** (ideas de la lista de skills que trajo el creador):
  - volumen en dB por bus;
  - ambiente en su propio bus;
  - ducking.
- **Áreas seguras laterales y sacudida de cámara** sobria.

## Métricas (6 semillas)

| Perfil | Pob. 1 año | Pob. 4 años | Quiebras 4 años | Caja mediana 4 años | Elecciones: gana / pierde / sin rival |
|---|---|---|---|---|---|
| casual | 57 | 59 | 0 % | 226.750 | 3 / 0 / 3 |
| ahorrador | 66 | 67 | 0 % | 268.807 | 4 / 0 / 2 |
| agresivo | 47 | 47 | 0 % | 92.043 | 1 / 1 / 4 |
| derrochador | 74 | 86 | 50 % | 2.105 | 5 / 0 / 1 |
| constructor | 84 | 109 | 17 % | 205.752 | 5 / 0 / 1 |

## Agentes

1. **Min-maxer de la oposición.**
   - Las mociones no cambiaban ninguna elección: compartían el tope de 3 con la campaña, que ya lo llenaba.
   - Recuperar la alcaldía era casi imposible con el rival popular.
   - Se podía repetir la misma moción cada mes, y las imposibles se rompían siempre.
   - Algunas promesas se daban por cumplidas sin estarlo: se comprobaban después de gobernar y solo contra las 2 primeras exigencias.
2. **Economista.**
   - PIE 30 y el tope del 25 % están en un punto razonable.
   - Las cajas crecen porque los bots no gastan, no por un fallo de diseño.
   - De la deuda solo se sale derribando, y nadie lo explica.
   - Un rival con deuda no se recupera.
   - Ajustes probados y rechazados: empleos de 3 a 2 e IBI más bajo.
3. **Accesibilidad.**
   - FALLO: la fuente pixel con tamaños sin rejilla exacta, y 13 letras por línea al 200 %.
   - FALLO: el nombre del control de volumen cambiaba con su valor.
   - FALLO: el resultado de la moción no se anunciaba dentro del diálogo.
   - Botones deshabilitados con poco contraste.
4. **Diseñador de audio.**
   - El ducking se pisaba consigo mismo.
   - Ráfagas sin límite y sin compresor.
   - Los grillos sonaban a siseo.
   - El ambiente quedaba alto.
   - A x10 alternaba pájaros y grillos.
5. **Casual y reseña.**
   - No se entiende qué hace una moción.
   - «Solo una al mes» salía repetido en cada facción.
   - En la oposición hay poco que hacer.
   - Nota: 7/10.

## Decisión (5 cambios)

1. **Mociones que importan** (min-maxer 1–4; economista 5).
   - Las mociones rechazadas y las promesas rotas suben hasta 6; la campaña, hasta 3.
   - En la oposición, cada punto pesa el doble (0,06).
   - La misma exigencia no se lleva al pleno dos veces en 6 meses.
   - El gobierno rechaza lo que no puede hacer (ni obra ni impuesto), salvo si es de su facción.
   - Cumple las promesas fiscales bajando ese impuesto.
   - Las promesas se comprueban antes de gobernar y contra todas las exigencias.
   - Un rival con deuda seria derriba un parque o una casa municipal.
   - Medido: el jugador recupera la alcaldía en 3 de 7 pueblos sin hacer nada, y en 5 de 7 con campaña y mociones.
2. **Mociones explicadas y anunciadas** (casual 1–3; accesibilidad 3 y 5).
   - Explicación de qué hace una moción.
   - Una sola línea con la fecha de la próxima.
   - El resultado de la última dentro de la hoja.
   - Anuncio en `#sr-live`.
   - Botones deshabilitados con color atenuado y borde discontinuo, sin opacidad.
3. **Audio sin pisarse** (audio 1–5; accesibilidad 2).
   - El ducking dura hasta el final más lejano, con `cancelAndHoldAtTime`.
   - Todo efecto tiene su límite de repetición.
   - Compresor en la salida.
   - Grillos con paso banda (Q 8), inicio aleatorio y silencios.
   - Ambiente a −28 dB.
   - Histéresis de 3 s entre día y noche.
   - El `<output>` del volumen se oculta al lector y el control se deshabilita con el bus apagado.
4. **Fuente pixel en rejilla exacta** (accesibilidad 1). Solo 1rem (22 px, píxeles de 2 px), 0,5rem y 3rem para el logo. Al 150 % y al 200 % se usa 33 px. Una prueba de Playwright comprueba que no hay tamaños intermedios.
5. **Salir de la deuda** (economista 2–3). Con deuda, el consejero propone derribar lo que sobra: «tienes 6 parques y con 3 llega».

## Aplazado o rechazado

- *Aplazado a la v1.2* (encaja con su contenido):
  - registro de lo que hace el gobierno rival;
  - cuenta atrás de las elecciones;
  - preguntas en el pleno desde la oposición;
  - servicios que escalan con la población.
- *Aplazado:* que el rencor heredado no cuente contra el rival durante su luna de miel. Con el cambio 1 ya se recupera la alcaldía.
- *Rechazado* (medido por el economista):
  - empleos de 3 a 2: no salva a nadie de la quiebra y engorda las cajas;
  - IBI más bajo: dos pueblos más en quiebra.
