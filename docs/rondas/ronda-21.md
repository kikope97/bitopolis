# Ronda 21 — cierre de la v2.5 «Comarca»

## Qué trae la v2.5 (plan aprobado por el creador: `docs/propuestas/v2.4-vida-comarca.md`, sección 2.5)

Hecha con tres agentes del motor en paralelo (cada uno con su parte del cliente) y el coordinador (bloque 0 y fusiones).

- **Densidad y vivienda protegida** (`density.ts`): densidad baja, media o alta en las zonas R (`SetZoneDensity`); los bloques crecen a 4/8/12 viviendas con suelo y demanda; más ruido. Vivienda protegida (`vpo`): 6 pisos a 120 €, sorteo determinista entre quienes los piden y los que menos ganan, dilema `ultima_vpo`.
- **Cooperativa agraria** (`coop.ts`): socios con finca, sobreprecio de la cosecha, cuota, reparto en diciembre, presidente votado, almazara o bodega en el nivel 2.
- **Correos** (`post.ts`, `letter-prompt.ts`): oficina de correos, plazo de las subvenciones según haya correos, cartas de los que se fueron (IA o plantilla, fuera del estado) y alguno que vuelve.
- **La comarca** (`comarca.ts`, `neighbor-prompt.ts`): tres pueblos vecinos simulados como resumen, competencia por vecinos, bolsa de la Diputación, acuerdos de agua/luz/autobús/cosecha (`AnswerNeighbor`), el río que enfada al de abajo y feria comarcal en septiembre. Alcaldes con IA una vez al mes (`NeighborTurn`), con reglas por personalidad de respaldo.
- **Más IA**: `pedir_vpo`, `hacerse_socio`, `darse_de_baja`; pueblos vecinos en el prompt de los vecinos. TURN_PROMPT_VERSION 15, NEIGHBOR_PROMPT_VERSION 2, formato de partida 18.

## Métricas (antes de la ronda)
- Constructor a 4 años con densidad y VPO: población +6 %, caja media −6 %, VPO llena y sin deuda; casual sin cambios.
- Alcaldes: unos 1.000 tokens de entrada y 110 de salida por mes (≈0,005 € con Sonnet).
- vitest 521/521; invariantes y deriva de dinero 0; migración 17→18 probada con 4 partidas reales.

## Agentes de la ronda 21

1. **Equilibrio y diversión**:
   - Las cartas no llegaban nunca (los que se van son anónimos sin familia: no quedaba su ficha).
   - La feria la ganaba siempre el jugador (40 de 40) y su premio no se notaba.
   - La competencia por vecinos no se activaba nunca (diferencia de atractivo mediana −12).
   - Aceptar acuerdos siempre ganaba, rechazar era igual que ignorar y casi siempre era la misma oferta de agua.
   - Cooperativa: un chollo para 3 socios y unos 24.000 € al año para el ayuntamiento; su excedente no llegaba a la comarca.
   - Pueblos en relación «mala» para siempre: el competidor criticaba a todo buen alcalde.
2. **Móvil**:
   - La capa «Densidad» no se rehacía al marcar; en táctil no se veía cómo trazar.
   - La ficha del bloque no explicaba bien por qué no crecía.
   - No se entendía por qué se iban vecinos a otro pueblo.
   - «vive de el turismo», «alcalde» para alcaldesas, «10 %» partido, vosotros y tú mezclados; botones del panel Pueblo fuera de la pantalla al 200 %.
3. **Código**:
   - Una VPO se podía ocupar sin sorteo (cuidar en casa).
   - La cuota impagada de la cooperativa acababa como deuda con el banco, con intereses.
   - Recortar las ofertas podía borrar un acuerdo en vigor.
   - En la oposición caducaban ofertas que no se podían contestar.
   - La densidad pedida volvía al repintar zona R.
4. **IA**:
   - Relaciones atascadas en −2 y la misma oferta en bucle.
   - Las declaraciones dejaban pasar cifras y sitios inventados; «alcalde» para alcaldesas.
   - Los alcaldes elegían casi a ciegas (sin saber qué pasó con su oferta).
   - La comarca no llegaba a los vecinos con IA ni al director; la VPO la podía pedir cualquiera.

## Cambios aceptados (5)

1. **Móvil**: la capa de densidad se rehace al marcar; en táctil la ayuda empieza por el gesto y es más corta; la ficha del bloque dice lo que tiene, lo pedido y cada condición con ✓/✗; la comarca enseña la comparación de atractivo y el resumen de «Pueblo» cuántos se van; el aviso de salida lleva a la Comarca (también a x10); textos corregidos; rejillas que no se salen con texto al 200 %.
2. **La comarca con decisiones de verdad**: base de atractivo de los vecinos (`attractBase`), ofertas según la especialidad y sin repetirse en 6 meses tras un no, rechazar no resta y caducar resta 2, relaciones que vuelven hacia normal cada 6 meses, el competidor solo critica con mucha ventaja, feria con puntuaciones comparables y premio de 2.000 €, acuerdos de agua y luz a 6 y 8 € por edificio.
3. **Cartas y cooperativa**: se guarda la ficha de quien se va con amistades (y le pueden escribir); cooperativa sin plantilla, 80 € de mantenimiento y sobreprecio del 10/18 %; el vecino con acuerdo de cosecha compra también su excedente.
4. **IA**: declaraciones sin cifras ni nombres propios que no estén en los datos, «alcaldesa», guía por personalidad, `su_ultima_oferta` y `dijo_el_mes_pasado` (NEIGHBOR_PROMPT_VERSION 2); `pueblos_vecinos` en el bloque común de los vecinos; la VPO solo para quien gana menos de 1.400 € al mes. Grabación nueva en vivo.
5. **Código**: la VPO solo por sorteo; la cuota de la cooperativa sin deuda con el banco; el recorte de ofertas respeta los acuerdos en vigor; sin ofertas cuando gobierna el rival; la densidad se olvida al cambiar de zona; nivel de la densidad baja igual en motor y cliente.

## Aplazados

- El excedente de la cooperativa sale de la nada (se suma al stock sin restarlo de la venta de la finca); su venta de fin de año a la mitad.
- Dos alcaldes con IA que eligen la misma oferta: el segundo decide por reglas y pierde su declaración.
- Quien vuelve por carta decide si tiene nombre por el id nuevo y no por el suyo.
- `ai-eval --replay` no falla si faltan grabaciones de alcaldes; el coste usa siempre el proveedor Anthropic; el simulador de alcaldes elige casi siempre ofrecer acuerdo.
- Sucesos del director de la comarca (`visita_alcalde`, `tentado_por_vecino`, `pique_feria`) y «irse a {pueblo}» en el menú de los vecinos.
- Recordatorio a 3 días de que caduque una oferta; barra de arriba con texto grande; el aviso de pausa de 40 px.
- Que los perfiles del simulador construyan cooperativa y correos y contesten ofertas (las métricas aún no los cubren).
