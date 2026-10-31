# Ronda 13 — cierre de la v1.7 (geografía y vida)

## Qué trae la v1.7 (pedido por el creador)

- **Geografía** (`terrain.ts`, formato de partida 10):
  - Río que serpentea, a veces hasta el mar; costa en algunos pueblos; colinas.
  - El centro queda siempre en llano.
  - Puentes a 600 €/casilla; en la colina, materiales ×1,5.
  - El suelo junto al agua y en alto vale más; la bomba junto al río rinde más.
- **Estaciones y tiempo** (`weather.ts`):
  - Nieve: obras a la mitad, la central rinde menos y hay que pagar el quitanieves.
  - Calor: la bomba da para menos casas; quien no tiene sombra cerca lo nota.
  - Tormentas que pueden desbordar el río.
  - Un mes de gracia al empezar.
  - En pantalla: suelo, tejados y árboles nevados, lluvia y nieve cayendo (sin destellos) y el icono del tiempo junto a la fecha.
- **Lugares de vida social:** bar (amistades), ermita (fiestas con procesión), cementerio (duelo), biblioteca (prosperar) y polideportivo (salud de los mayores).
- **Asociaciones vecinales** (`associations.ts`):
  - Nacen de quejas compartidas.
  - Si se las ignora, convocan manifestaciones: el líder y los primeros socios deciden si van, con IA o por reglas (detonante `protesta`, PROMPT_VERSION 4).
  - Reunirse con ellas promete una solución en 3 meses.
- **Álbum del pueblo y árbol genealógico** (`album.ts`, `family.ts`, `album-ui.ts`): momentos con foto tomada en el momento y postales; familias con padres, hijos y nietos, incluidos los que se fueron.
- **Capa «Qué falta» (propuesta del creador)** (`coverage.ts`): en cada vivienda y solar R, lo que le falta (agua, luz, colegio, salud, policía, ocio), con leyenda, avisos en la ficha y consejo del «?».
- **Arte nuevo** (agente de arte en paralelo): agua y mar animados con orillas, colinas, puentes, nieve, los 5 edificios y 16 iconos.

### Peticiones del creador durante la versión

- **1.6.1 (publicada):** se puede alejar el mapa como antes; muy alejado, el primer toque acerca.
- **Al volver a la partida,** sigue a la velocidad en que se dejó (solo cuentan las decisiones del jugador, no las pausas automáticas).
- **Al marcar zonas,** la barra de confirmar enseña solo lo que se cobra (`zoneChanges`): no cuentan carreteras, edificios, agua ni lo ya marcado. Los árboles sí cuentan, porque se talan al construir.

## Agentes de la ronda 13

1. **Jugadora nueva (iPhone 17):**
   - Lo que funciona: tutorial completo con el dedo, el desbloqueo de zonas y un tiempo que «se ve y se nota»; el álbum tiene encanto y reunirse con una asociación cuesta un toque.
   - Problemas:
     - la geografía no se presenta al empezar;
     - «Qué falta», con 2–3 iconos por casa, no se lee de un vistazo;
     - la barra de arriba está apretada;
     - quedaba texto desfasado tras marcar una zona.
2. **Equilibrio (80 semillas × 4 años, con pruebas que desactivan cada efecto por separado):**
   - Las quiebras nuevas vienen del tiempo: el calor obliga a construir una bomba permanente por algo pasajero.
   - Las riadas eran demasiado frecuentes (unas 2,7 al año por edificio de la orilla).
   - La contaminación no bajaba nunca (ya pasaba antes de la 1.7): asociaciones perpetuas y pueblos estancados.
   - Lugares descompensados: la ermita, demasiado barata; el bar y el cementerio no compensan.
3. **Narrativa:**
   - El diario se ahogaba en «decide ahorrar» (12.216 en 12 años).
   - Las riadas llenaban el álbum.
   - Árbol casi vacío: el viudo perdía a su pareja, quien se iba a estudiar no quedaba y los hijos llevaban un solo apellido.
   - Las manifestaciones no salían en el diario.
4. **Pantallas pequeñas y accesibilidad:**
   - El precio se cortaba al 200 % y sin dinero no se decía.
   - Los iconos de «Qué falta» eran ilegibles con el mapa alejado y la raya apenas se distinguía.
   - La leyenda no se podía plegar y se releía cada día con lector de pantalla.
   - Nombres accesibles que faltaban.

## Cambios aceptados (5)

1. **Diario sin ruido:**
   - Las decisiones rutinarias (ahorrar, capricho, seguir igual) quedan en la ficha, no en el diario ni en burbujas.
   - Las manifestaciones entran en el diario.
   - La coletilla del bar, solo si hay bar.
2. **Árbol familiar vivo:**
   - El viudo conserva a su pareja.
   - Quien se va a estudiar queda con nombre.
   - Dos apellidos (uno de cada progenitor).
3. **Precio siempre visible:** en la barra de confirmar, el precio va en su propia línea, que no se corta, también cuando no se puede construir.
4. **«Qué falta» con una prioridad:**
   - Un icono por casa (lo que más falta en el pueblo) con marco rojo, o amarillo a trazos si está lleno, y «+N».
   - Un punto cuando el mapa está alejado.
   - Leyenda ordenada, con «Construir» en cada línea, plegable y sin `role="status"`.
5. **Equilibrio:**

   | Ajuste | Antes | Ahora |
   |---|---|---|
   | Contaminación (`FIELDS.pollutionDecay`, ahora en balance.ts) | 0,985 | 0,85 |
   | Efecto del calor en la bomba | −25 % | −10 % |
   | Probabilidad de riada por edificio de la orilla | 0,3 | 0,12 |
   | Bomba junto al río | +50 % | +25 % |

   Lugares sociales:
   - **Ermita:** mantenimiento de 200 €/mes.
   - **Bar:** 1 empleo y +5 de felicidad.
   - **Cementerio:** sin empleo, 150 €/mes; sin cementerio, el duelo resta 4.

   Prueba con 20 semillas × 4 años, comparando la contaminación anterior (0,985) con la nueva (0,85):

   | Perfil | Quiebras | Población media | Asociaciones contra la contaminación |
   |---|---|---|---|
   | Casual | 2 → 0 | 45 → 71 | 14 → 0 |
   | Constructor | 3 → 2 | 106 → 108 | 20 → 0 |

### Fallos corregidos (no son cambios nuevos)

- Bandeja al 200 % (palabras largas).
- Botones del árbol de 44 px.
- La franja anuncia la fecha y el tiempo.
- Fotos y postales del álbum con nombre accesible.
- La franja vuelve a la ayuda tras confirmar una carretera o zona.
- Riadas en el álbum, una al mes como mucho.
- Choque de nombres `NEED_TEXT` (ahora `NEED_LABEL`).

## Métricas finales

20 semillas × 4 años, con el código de cierre:

| Perfil | Quiebras v1.6 | Quiebras v1.7 | Población mediana v1.7 | Errores de invariantes |
|---|---|---|---|---|
| casual | 0/20 | 0/20 | 76 | 0 |
| constructor | 3/20 | 2/20 | 113 | 0 |
| derrochador | 12/20 | 11/20 | 72 | 0 |

- **IA en vivo:** 1.151 decisiones; el 99,83 % válidas a la primera, 1 con reintento, 1 decidida por reglas y 0 errores. Grabadas de nuevo en `e2e/fixtures/ia-replay.json` (PROMPT_VERSION 4); el replay da lo mismo.
- **Pruebas:** 184 tests unitarios y 61 e2e en verde (5 omitidos a propósito). Nuevos: `geo`, `places`, `associations`, `album`, `coverage` y `e2e/v17.spec.ts`.
- **Capturas** en tres tamaños (iPhone 17, Android 360 e iPad).

## Aplazados o quitados

- **Presentar la geografía al empezar** (aplazado a la 1.8): un recorrido de cámara hasta el río, con dos frases.
- **Caja más alta con la contaminación nueva** (aplazado): la caja mediana sube; hay que reajustar ingresos con métricas en otra ronda.
- **Manifestaciones con escena** (aplazado): lema en la pancarta, barrio y consecuencia; nombres de asociación por el barrio («Asociación Vecinal del Río»).
- **Álbum por categorías** (aplazado): agrupar repetidos con «×N» y recortar por categoría, no por antigüedad.
- **x10 en pueblos grandes** (aplazado): hay que medir si va más lento de lo prometido.
- **Etiqueta del 🗳 en la barra de arriba** (aplazado).
- **Procesión de la ermita como suceso** (quitado): la procesión ya se nota en la felicidad de las fiestas, y un suceso más llenaría el diario.
