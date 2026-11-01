# Ronda 19 — cierre de la v2.3 (metas grandes)

## Qué trae la v2.3 (plan aprobado por el creador: `docs/propuestas/v2.3-metas-grandes.md`)

Hecha con cinco agentes en paralelo (cada uno en su copia del repo), uno de equilibrio y el coordinador.

- **Grandes obras** (`landmarks.ts`): puente, estación, feria, estadio y catedral, de 2×2 casillas, por fases que se pagan cuando se quiere; cofinanciación de la Diputación y fondos FEDER; los vecinos donan.
- **La comarca** (`region.ts`): bonanzas y crisis que cambian lo que venden las fábricas, el empleo de fuera y el valor del suelo; la gran empresa que quiere instalarse (suelo gratis o IBI bonificado), contrata y, en crisis, hace un ERE.
- **Turismo** (`tourism.ts`): patrimonio según el terreno, atractivo, visitantes, tasa turística, casas rurales, turistificación, ruido y entorno protegido.
- **Escenarios** (`scenarios.ts`): pueblo en quiebra, pueblo vaciado y después de la riada, con meta y plazo; y terrenos para elegir al empezar.
- **Historia y medallas** (`achievements.ts`): gráficas por meses y años, récords y 36 medallas en bronce, plata y oro.
- **Compartir** (`view.ts`, `share.ts`): enlace de solo lectura `/v/<token>` y postal del pueblo. Por decisión del creador, la vista no pide la contraseña de acceso: ya lleva su propio token secreto.
- **Más IA**: los vecinos donan, abren casas rurales, se quejan de los turistas y aceptan trabajo en la fábrica; el director narra voluntarios, polémicas por el coste, reportajes de la tele, ruido de turistas, EREs y contrataciones. TURN_PROMPT_VERSION 12, formato de partida 16.

## Métricas (tras el equilibrio, semillas 1–8)
- Casual a 4 años: primera gran obra empezada hacia el mes 19 y terminada hacia el 33 (7 de 8 semillas), caja mediana 41.000 €.
- Escenarios con casual: quiebra, vaciado y riada se ganan 4–6 de 6; el pasivo no gana ninguno.
- Gran empresa: ofrecida en las 8 partidas del constructor; 0–2 crisis de comarca cada 10 años.
- Casas rurales por debajo del 15 % de las viviendas; invariantes bien y deriva de dinero 0 en todos los perfiles y escenarios.
- e2e 130/132 antes de la ronda (las dos caídas, por un error real del quitanieves con nieve).

## Agentes de la ronda 19

1. **Equilibrio y diversión**:
   - «Pueblo en quiebra» castigaba construir: la racha de superávit volvía a 0 con cualquier obra (el constructor perdía 6 de 6).
   - Turismo sin dilema: la tasa alta siempre ganaba y la turistificación no aparecía nunca (como mucho 2 casas rurales).
   - Cofinanciación y FEDER: un «sí» obligado cuyo aviso se perdía; la oferta de la gran empresa caducaba sin verse a x10 y el IBI bonificado nunca convenía.
   - Medallas imposibles (500 visitantes, 10 parejas) o regaladas (crisis sin cierres).
   - La medalla del escenario salía dos veces.
2. **Móvil**:
   - La capa «Casas rurales» quedaba tapada por los tejados.
   - Gráficas con bandas a 1,4:1, texto fijo de 11 px y sin el valor de abajo de la escala.
   - El mismo récord con fechas distintas en la historia y en la postal.
   - Requisitos cumplidos a 4,2:1; «0 visitantes» con el patrimonio recién abierto parecía un fallo; «Solo lectura · Haz tu pueblo» mezclaba estado y acción.
3. **Código**:
   - `toLocaleString` en textos que entran en el estado (el hash podía cambiar entre navegador y servidor).
   - El menú del director podía quedarse sin `contrata_vecinos` ni ERE con varias obras en marcha.
   - Entorno protegido con huecos (fábricas 2×2 y solar de la gran empresa).
   - Una obra destrozada seguía atrayendo turistas; «Dejar de compartir» daba 500 con un cuerpo roto.
4. **IA**:
   - La grabación era del prompt 11 (el CI fallaría).
   - `abrir_casa_rural` se ofrecía sin demanda (94–97 % de las veces) y `quejarse_turistas` sin ruido.
   - Con la IA caída nadie donaba a las obras en Modo IA.
   - Ni los vecinos ni el gobierno se enteraban de las decisiones grandes de la 2.3; ninguna foto al terminar una obra.

## Cambios aceptados (5)

1. **Código**: cifras con `fmt()` en todo texto del estado; medalla del escenario solo en `achievementsMonth`; la comarca y la gran empresa van antes que las obras en el menú del director; entorno protegido con `buildingAt` y sin solar de gran empresa dentro; una obra destrozada no atrae; JSON roto en «Dejar de compartir» da 400.
2. **IA**: casa rural solo con demanda; quejas de turistas solo con ruido o alquileres disparados; donaciones por felicidad si la IA no responde; `mayorText` cuenta obras, fases, gran empresa, tasa turística, entorno protegido y préstamos; foto en el álbum al terminar una gran obra; la fase en obra bien contada en el prompt. Grabación nueva en vivo.
3. **Móvil**: la capa de casas rurales se marca sobre los tejados (cuadro azul con tejado para la rural, rayas naranjas para el alquiler caro); gráficas con bandas de 3:1 o más, texto que crece con `--ui` y el valor de abajo rotulado; la postal usa el mismo mes que los récords; requisitos en verde claro (8:1); textos de turismo, vista compartida, quiebra y Diputación más claros; el quitanieves ya no rompe el dibujo con un recorrido de una casilla.
4. **Equilibrio del turismo y la gran empresa**: casas rurales desde 20 visitantes por casa (aparece la turistificación), la tasa resta un 20 % de visitantes por nivel, IBI bonificado a 2 años; la gran empresa, el FEDER y la cofinanciación avisan fijo y frenan el tiempo.
5. **Escenarios y medallas**: el superávit de la quiebra no cuenta las obras; medallas de 250 visitantes, 6 parejas y crisis sin cierres con 15 empresas.

## Aplazados

- Gasto de los visitantes en las tiendas (`TOURISM.shopSpend`) para que la tasa le cueste algo al comercio.
- Que la cofinanciación tenga contrapartida (devolver con recargo si no se termina en plazo) y que la oferta no caduque en la fase 0.
- El rival gobernando no toca las metas grandes (`rivalMenu` sin obras, tasa ni gran empresa).
- Medallas agrupadas por tipo con etiqueta visible; `money()` con espacio fijo antes del «€»; caja de 5 cifras en la barra a 360 px.
- Álbum de la vista compartida con nombres de vecinos (fotos de bebés y despedidas, pies de foto y calles): decidir si se enseñan o se quitan.
- Regla de ruido de turistas sin director (Modo normal); momento del álbum al abrir el patrimonio y al llegar la gran empresa; `contrata_vecinos` empezando por los vecinos sin IA.
- Perfil casual que corta su calle mayor en Modo IA; caja enorme a 8–10 años; el rival casi nunca gana.
