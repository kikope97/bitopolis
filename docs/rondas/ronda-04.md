# Ronda 04 — cierre de la v0.4 (Social)

## Métricas antes de la ronda (10 semillas, 360 días)

Primera medición, recién cerrada la v0.4:

| Perfil | Pob. a 1 año | Quiebras | Felicidad | Relaciones | Objetivos cumplidos |
|---|---|---|---|---|---|
| pasivo | 1.0 | 0 % | 25 | 0.0 | 0.0 |
| casual | 61.1 | 0 % | 69 | 34.0 | 7.8 |
| ahorrador | 65.6 | 0 % | 70 | 33.0 | 7.8 |
| agresivo | 61.6 | 0 % | 62 | 33.8 | 7.9 |
| derrochador | 37.0 | 80 % | 76 | 32.2 | 5.8 |
| constructor | 39.1 | 70 % | 65 | 32.5 | 4.7 |

**Regresión detectada antes de lanzar los agentes.** Con las recompensas de los objetivos se podían levantar colegio y centro de salud con solo 10 vecinos. Sus sueldos fijos dejaban la caja en negativo sin base fiscal que los pagara. Con la caja en negativo no se podían pintar zonas, así que el pueblo dejaba de crecer y acababa en quiebra.

Corrección (commit `b8488a9`):
- Colegio y salud se desbloquean con 25 vecinos (§5.7: «primeros servicios» entre 10 y 50).
- Pintar zonas se permite con deuda hasta el límite de deuda.
- El bot no añade servicios en un mes con pérdidas.

Resultado tras la corrección: constructor 99 vecinos y 0 % de quiebras; derrochador 61 vecinos y 10 % de quiebras; mejor/peor 1,65x.

IA (LLM simulado, 3 × 360 días): 6,8 llamadas por mes de juego. El 100 % de las respuestas son válidas sin pasar a reglas, pero solo el 45 % a la primera: el 55 % repetía motivo y forzaba un reintento. Unos 8.300 tokens de entrada al mes.

## Agentes

1. **Veterano.**
   - Los plenos castigan y no compensa repetirlos.
   - Las relaciones son decoración.
   - El director de historias no se ve en Modo normal.
   - Los objetivos dan dinero gratis: `sin_deuda` es trivial.
2. **Min-maxer** (fallos verificados con simulaciones).
   - Se pide «bajar las tasas» aunque ya estén en bajo, y es imposible de cumplir.
   - El pleno puede quedarse abierto para siempre.
   - Se puede prometer bajar las tasas, bajarlas un día y volver a subirlas, y cobrar igual el objetivo.
   - Prometer lo que ya está en obra cuenta como cumplido.
   - `/talk` no tiene caché.
3. **Casual (móvil).**
   - La cita del pleno no tiene que ver con la petición.
   - Prometer no dice ni plazo ni coste.
   - El objetivo «pleno» no dice dónde está.
   - En el móvil no se ve la recompensa de los objetivos.
   - Fallos de texto: «:» doble, «amigo» en masculino, fechas distintas del HUD.
   - Convocar el pleno cobra 300 € sin avisar.
4. **Accesibilidad.**
   - Los toasts que se pueden tocar no funcionan con teclado.
   - Responder en el pleno rehace la hoja y se pierde el foco.
   - Con una hoja abierta, el teclado sigue moviendo el mapa.
   - Los toasts se anuncian dos veces.
   - Al cumplirse un objetivo no se anuncia.
   - Objetivos táctiles de 40 px; «★» se lee en voz alta.
5. **IA e historias.**
   - La lista blanca de cifras compara subcadenas (fallo): «20» se acepta porque aparece dentro de «220».
   - La reserva de gasto no es atómica (fallo).
   - Reintentar por motivo repetido casi duplica los tokens sin mejorar nada.
   - Los ganchos no tienen desenlace.
6. **Reseña.**
   - La ficha y las promesas con nombre son lo mejor.
   - Las frases por reglas suenan a plantilla.
   - El diario cuenta hechos sin consecuencias.
   - En el móvil, la hoja tapa el pueblo.

## Decisión (5 cambios)

1. **Plenos justos** (min-maxer 1–3 y 5, veterano 1, casual 1–2 y 6).
   - No se pide bajar un tributo que ya está en bajo.
   - El pleno se cierra solo a los 2 días; lo no respondido solo suma +1 de rencor, sin recuerdo.
   - Rechazar pesa menos: −2 en vez de −3.
   - Responder peticiones da +1 de felicidad por respuesta a los vecinos con nombre.
   - Las promesas fiscales exigen mantener la bajada 60 días; si se vuelve a subir, la promesa se rompe.
   - Las obras en curso cuentan para la referencia de la promesa.
   - El objetivo «promesa» respeta el orden de los objetivos.
   - Cada tarjeta dice el plazo y cuántos vecinos se enfadan si no se cumple.
   - Se quita la cita que no venía a cuento.
   - Aviso «Pleno convocado: −300 €».
2. **IA segura y más barata** (IA 1–3, min-maxer 4).
   - Lista blanca de cifras con valores exactos y solo de los datos, no de las reglas.
   - Reserva de gasto antes del primer `await`.
   - Caché de «Hablar» por vecino, pregunta y día, y una conversación a la vez por partida.
   - Un motivo repetido se acepta sin reintentar.
   - Resultado: −32 % de tokens de entrada y 100 % válidas a la primera (simulador).
3. **Las historias se ven** (veterano 3, reseña 3, casual 5).
   - Cada gancho del director sale en el diario y en la ficha («Ahora mismo: …»).
   - Perder el trabajo por un cierre deja el recuerdo `perdio_trabajo`.
   - Textos: «Hizo amistad con…», «pide al alcalde un parque», nombre completo en las promesas y fechas del diario como en el HUD.
4. **Accesibilidad sin fallos** (accesibilidad 1–5).
   - Los toasts que se pueden tocar son un `<button>`.
   - Prometer y Rechazar solo actualizan su tarjeta y llevan el foco a la siguiente petición o a «Cerrar el pleno».
   - Con una hoja abierta el teclado no mueve el mapa.
   - Los toasts no llevan `role` propio, así que no se anuncian dos veces.
   - «Objetivo cumplido» se anuncia en `#sr-live`.
   - Mínimo de 44 px en los botones pequeños.
   - «★» con `aria-hidden`.
5. **Objetivos que guían** (veterano 4, casual 3–4).
   - `diez` pasa de 2.000 € a 1.000 €.
   - `sin_deuda` pasa a ser «6 meses seguidos con superávit con 30 vecinos o más».
   - El objetivo del pleno dice dónde está (☰ › Pleno municipal).
   - La recompensa se ve también en el móvil.

## Métricas después (10 semillas, 360 días)

| Perfil | Pob. a 1 año | Quiebras | Felicidad | Relaciones | Objetivos cumplidos |
|---|---|---|---|---|---|
| pasivo | 1.0 | 0 % | 25 | 0.0 | 0.0 |
| casual | 68.0 | 0 % | 64 | 34.8 | 7.8 |
| ahorrador | 72.3 | 0 % | 68 | 34.5 | 7.9 |
| agresivo | 58.9 | 0 % | 56 | 34.2 | 8.0 |
| derrochador | 60.8 | 20 % | 77 | 32.3 | 7.3 |
| constructor | 89.7 | 0 % | 67 | 35.7 | 7.8 |

Mejor/peor (perfiles activos): 1,52x.

IA (simulador): 202.591 tokens de entrada frente a 298.772 antes. Coste por mes de juego: ≈0,0014 € con gpt-5.4-nano y ≈0,0064 € con claude-haiku-5-5. Sigue pendiente la medición con un modelo real.

## Aplazado o rechazado

- **Aplazado a v0.5 (arte y pulido):**
  - Vecinos caminando y bocadillo sobre la casa cuando hay un gancho (reseña 5).
  - Centrar la cámara en el vecino y hoja a media altura (reseña 4).
  - «Desde tu última visita» como lista con botón al diario.
  - Trampa de foco, contraste de bordes al 3:1 y toasts sin caducar en modo calma.
- **Aplazado (backlog):**
  - Amistades que nacen cerca de plazas y parques (veterano 2).
  - Ganchos con desenlace (IA 5).
  - 3–4 plantillas por detonante que usen recuerdos (reseña 2).
  - Enum de «registro» para variar el tono de la IA.
  - Comprobación de nombres inventados en los textos de la IA.
  - Marca `fromLLM` en los eventos.
  - Estimación de coste que incluya reintentos y textos premium.
- **Rechazado:**
  - Opción «estudiarlo» en el pleno: el cierre automático ya ofrece una salida suave.
  - Que «Hablar» espere a la IA sin mostrar antes la respuesta por reglas: preferimos respuesta inmediata. Con la caché por día la incoherencia es rara.

## Medición en vivo con Anthropic (30/10/2026)

Después de la ronda se añadió la integración con el SDK oficial de Anthropic: el proveedor se deduce de la key, hay salida estructurada y el esfuerzo de razonamiento es bajo. Se midió con una key real de pruebas.

**Decisiones** (`pnpm ai-eval --live`, `claude-haiku-5-5`, 90 días, 1 semilla):
- 55 de 55 decisiones válidas a la primera: 100 %, sin reintentos ni reglas. Cumple el criterio de la v0.2 (≥98 %).
- 100 % de motivos distintos y con personalidad. Por ejemplo: «Llevo un año currando en el ayuntamiento y aquí nadie escucha. Pienso decírselo al alcalde a la cara, que para algo es mi jefe.»
- 16 llamadas por mes de juego (como mucho 18), con unos 27.000 tokens de entrada y 1.700 de salida al mes. Coste: ≈0,0033 € por mes de juego.

**Textos** (todos pasan la lista blanca de cifras y la de longitud):

| Texto | Modelo | Tiempo |
|---|---|---|
| Hablar (dos preguntas) | `claude-haiku-5-5` | 1,4–1,9 s |
| Consejero | `claude-sonnet-5-5` | 6,1 s |
| Crónica | `claude-sonnet-5-5` | 3,3 s |

**Observación:** en la crónica sale «Gonzalo y Gonzalo». Los eventos de pareja usan solo el nombre de pila y había dos Gonzalo. Se corrige en la v0.5 (nombre completo cuando el de pila se repite).
