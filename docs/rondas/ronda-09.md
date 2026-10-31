# Ronda 09 — cierre de la v1.3

## Qué trae la v1.3

- **Historias:**
  - los ganchos acaban con un desenlace en el diario y un recuerdo: salir adelante, pasar página, hacer las paces o volver a confiar;
  - amistades de barrio cerca de la plaza, el mercado o el parque;
  - «¿Cómo estás?» menciona lo último importante que ha vivido el vecino.
- **Política:**
  - registro de lo que hace el gobierno rival (formato de partida 8, con migración);
  - cuenta atrás en el indicador en los últimos 3 meses;
  - pregunta de la oposición en el pleno;
  - servicios con capacidad: colegio 60, centro de salud 80 y comisaría 120 vecinos. Saturados rinden menos y se pide otro.
- **IA:**
  - tono por vecino;
  - se descartan los textos que nombran a personas inventadas;
  - estimación de coste con reintentos y crónica, que `/admin` muestra junto a los topes.
- **Interfaz:**
  - farolas con halo de noche y skyline animado;
  - llave de píxeles en lugar de 🔑;
  - avisos agrupados («×2»);
  - tecla O para Ajustes;
  - `/admin` plegable;
  - nota cuando el enlace oficial no coincide con la barra del navegador.

## Métricas

6 semillas, mediana:

| Perfil | Pob. 1 año | Pob. 4 años | Quiebras 4 años | Caja mediana 4 años | Elecciones: gana / pierde / sin rival | Amistades por vecino con nombre |
|---|---|---|---|---|---|---|
| casual | 75 | 85 | 0 % | 192.080 | 3 / 0 / 3 | 4,5 |
| ahorrador | 52 | 52 | 0 % | 141.615 | 3 / 0 / 3 | 4,6 |
| agresivo | 44 | 44 | 0 % | 184.336 | 1 / 1 / 4 | 4,7 |
| derrochador | 63 | 63 | 50 % | −5.539 | 2 / 1 / 3 | 4,9 |
| constructor | 77 | 74 | 50 % | 99 | 2 / 1 / 3 | 4,3 |

Con 6 semillas, las quiebras bailan mucho. Medidas con 20 semillas, la v1.3 queda igual que la v1.2:

| Perfil | v1.2 | v1.3 |
|---|---|---|
| constructor | 4/20 | 4/20 |
| derrochador | 11/20 | 10/20 |

**IA en vivo** (Claude Haiku, 3 semillas × 360 días, regrabado en `e2e/fixtures/ia-replay.json`):
- 1.223 decisiones, el 100 % válidas a la primera y el 99,5 % de los motivos distintos;
- unos 0,006 € por mes de juego.

**Pruebas:** 146 tests unitarios y 40 e2e (nuevo: `e2e/v13.spec.ts`).

## Agentes

1. **Diseño narrativo.**
   - **Fallo grave:** las amistades de barrio llenaban entre el 55 % y el 70 % del diario. Una misma pareja se hacía amiga hasta 150 veces: con 5 relaciones se expulsaba a una y al día siguiente se rehacía.
   - «Se han hecho amigos» con dos mujeres, y «Julia y Julia».
   - El gancho del paro se reabría en bucle.
   - Rivalidades sin gancho.
   - Frases que chocaban con el ánimo del vecino.
2. **Estrategia política (min-maxer):**
   - aceptar la pregunta de la oposición daba campaña gratis hasta 6;
   - incumplirla no costaba nada;
   - una sola obra cumplía varias promesas;
   - la saturación era un salto brusco y no contaba las obras en curso;
   - los impuestos del rival subían y bajaban cada mes.
3. **Calidad de la IA:**
   - el filtro de nombres tiraba respuestas buenas («Lunes», «Don», «Comisaría», «Ávila») y dejaba pasar nombres a principio de frase o metidos en otras palabras;
   - una crónica fallida se volvía a pedir cada vez que se abría el diario;
   - la estimación se quedaba corta con pocos vecinos;
   - algunos tonos empujaban a dar cifras.
4. **UX y accesibilidad:**
   - el «×2» se anunciaba suelto;
   - el aviso repetido caducaba antes de tiempo;
   - la tecla O se activaba con Ctrl y no se podía desactivar (WCAG 2.1.4);
   - las copias de seguridad quedaban escondidas;
   - el skyline consultaba cada 500 ms durante toda la partida.

## Fallos arreglados (fuera del cupo)

- **Amistades:** una amistad nueva ya no expulsa a otra. Como mucho un suceso de barrio al día, con texto neutro y el nombre completo si coincide el de pila. Resultado: de más de 2.300 a 14–19 sucesos en 900 días.
- **Pleno:**
  - la pregunta de la oposición cuenta como campaña: tope de 3 y solo en el último año;
  - incumplirla resta 2;
  - lo ya prometido no se vuelve a pedir;
  - su pregunta se reserva antes que las de los vecinos.
- **Historias:**
  - rivalidad solo si arranca la historia, y nunca entre pareja ni tras hacer las paces;
  - recuerdo `sigue_en_paro` para que el gancho no se reabra en bucle;
  - los recuerdos guardan el nombre de quien se fue.
- **Saturación:** solo por debajo del 90 %, y nada si hay otro de ese tipo en obras.
- **Rival:** impuestos con margen; solo baja con superávit claro y caja holgada.
- **Filtro de nombres:** solo nombres y apellidos reales (`names.ts`), palabras enteras, sin tildes y también al principio de la frase.
- **Crónica:** si no es válida, no se repite la llamada en el mes. Si falló por tope o por red, sí.
- **Avisos y teclado:**
  - el contador se anuncia con el texto completo y reinicia el tiempo;
  - atajos de una tecla desactivables en Ajustes y nunca con Ctrl, Alt o Cmd;
  - sin atajos en los campos de texto.
- **Skyline:** se para durante la partida y se relanza al volver al inicio o al cambiar las preferencias.
- **Copias de seguridad:** la tarjeta se abre sola si no hay copia reciente.
- **Accesibilidad:** las flechas decorativas de las hojas ya no forman parte del nombre accesible.

## Cambios aceptados (5)

1. **«¿Cómo estás?» enlaza el recuerdo con el ánimo:** «Eso sí, echo de menos a…» o «Al menos, con mi negocio en marcha…».
2. **Estimación con el prompt real:** base de unos 780 tokens, 230 por vecino y como mínimo media decisión al día.
3. **Tono sin cantidades** y la regla «el tono cambia cómo habla, no lo que sabe».
4. **Saturación con margen del 90 %** (con 61 vecinos y un colegio no hace falta otro).
5. **Retoques de texto:** «se disputa con alguien del pueblo el único local libre», «han hecho las paces: al final nadie se ha quedado el local», «Estoy pensando en irme».

## Quitados o aplazados

- **Aplazado: saturación por radio** (contar solo a los vecinos que alcanza cada edificio). Es más justo, pero cambia mucho el equilibrio; se mirará con métricas.
- **Aplazado: resumen en el título de las tarjetas plegadas** («Copias · última: ayer»). De momento se abre sola cuando hace falta.
- **Rechazado: lista de unos 300 nombres del INE.** Con los del juego y unos 100 habituales basta, y una lista más larga aumenta los falsos positivos al principio de frase.
- **Aplazado: quitar la etiqueta de la ficha del vecino** cuando el gancho ya se resolvió (ya desaparece al resolverse).
