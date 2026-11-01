# Ronda 18 — cierre de la v2.2 (economía y política)

## Qué trae la v2.2 (plan aprobado por el creador: `docs/propuestas/v2.2-economia-politica.md`)

Hecha con cuatro agentes en paralelo (cada uno en su copia del repo) y el coordinador.

- **Préstamos municipales** (`loans.ts`): nota de las cuentas A–D por la carga de las cuotas, el superávit y los apuros; préstamos a 12/24/48 meses con su TAE; amortizar antes con comisión; el préstamo de tesorería sustituye al descubierto gratis. Hoja «Préstamos» en Pueblo › Dinero y el 💰 en ámbar con la carga alta.
- **Licitaciones** (`tenders.ts`): desde el ayuntamiento 2, cada obra grande tiene tres ofertas: la local (empleo del pueblo), la barata de fuera (cuadrilla de fuera, puede salir más cara) y la del primo del concejal (comisión a su negocio, rumor en el bar y escándalo). «Revisar el contrato» durante el rumor.
- **Calles con nombre** (`streets.ts`): en el pleno se dedica una calle a un vecino querido o a quien ya no está; placa, rótulo en el mapa, alegría de los suyos y rencor de quien se llevaba mal.
- **El campo** (`farm.ts`): zona agraria, fincas con cultivo según el terreno (regadío junto al río, secano, viñas en la colina), cosecha anual que depende del tiempo del año, temporeros y granizo.
- **Política**: el rival tiene estilo (populista, técnico, conservador, verde) y promesas medibles; hasta tres candidaturas de vecinos que se presentan; noche electoral con varias listas.
- **Más IA**: biografía mensual de cada vecino, pies de foto del álbum escritos por el director y el gobierno del rival con IA (elige de un menú cerrado y da un discurso). TURN_PROMPT_VERSION 11, formato de partida 15.

## Métricas
- Perfiles casual, constructor, campo y endeudado, semillas 1–6, de 4 a 8 años: deriva de dinero 0 y sin errores de invariantes (también con fuzz en Modo IA y migrando partidas reales v14).
- El campo aporta del 4 al 14 % de lo que entra; la cosecha va de 31.000 a 64.000 € con las mismas fincas.
- Elecciones con 2 o más candidaturas: del 0 % al 33 % (6 elecciones por perfil, 3 perfiles) tras la ronda.
- e2e 114/116 antes de la ronda (las dos caídas, de rangos, eran de la prueba).

## Agentes de la ronda 18

1. **Equilibrio y diversión**:
   - No llegaba ninguna candidatura (0 % frente al 30–50 % buscado).
   - La oferta del primo salía gratis: revisar el contrato costaba lo mismo que ahorraba y el escándalo no se notaba.
   - La barata de fuera ganaba siempre.
   - El rival hacía un colegio cada mes.
   - El banco prestaba a 12 meses lo que llevaba a la nota D en el acto.
   - Con D, la caja en negativo no pagaba intereses.
   - Avisos A↔B sin préstamos.
2. **Móvil**:
   - La barra de arriba se montaba a 360 px con elecciones.
   - El escándalo salía como buena noticia (✔ verde) y repetía el nombre del dueño.
   - El pie de foto tenía un contraste de 1,5:1.
   - Hacían falta 61 toques para pedir 66.000 €.
   - En la licitación, la tercera tarjeta quedaba bajo el pliegue; «Recomendada» solo se veía por el color.
   - Rótulos de calle pequeños.
3. **Código**:
   - Los préstamos contaban como ingreso del mes y tapaban el déficit (objetivo de superávit, promesas del rival, aviso de la caja, parte).
   - Mi primer arreglo del doble gobierno hacía que el rival gobernara un mes sí y otro no (deshecho).
   - Por lo demás, merges, conservación del dinero, replay y migración bien.
4. **IA**:
   - La alcaldesa rival era un vecino más: podía irse (y disolver su gobierno), pedirse cosas a sí misma o manifestarse, y el prompt decía que el alcalde era siempre el jugador.
   - El turno mensual (biografías) no cabía en el plazo de 40 s con lotes de 15.
   - Un campo extra mal hecho (un pie de foto largo) anulaba todo el director.
   - El rival podía saltar dos niveles de impuestos contra su promesa.
   - Con OpenAI, el razonamiento no tenía margen de tokens.

## Cambios aceptados (5)

1. **La IA sabe quién gobierna**:
   - Quien gobierna no se va, ni se pide nada, ni se manifiesta; lleva `es_alcalde` y el prompt habla de «quien gobierna» (`lo_que_ha_hecho_el_gobierno`).
   - El rival con IA gobierna una vez al mes, con impuestos de un paso, sin romper sus promesas, con la reserva comprobada antes de cada obra y con su discurso aunque no elija nada.
   - El director recorta las listas largas y descarta solo el campo extra que esté mal.
   - Turno mensual en lotes de 8; margen de razonamiento también con OpenAI.
2. **Móvil**:
   - En pantallas estrechas, el 🗳 solo con su % (la cuenta atrás y «Oposición» van en el nombre accesible).
   - Escándalo como aviso fijo en ámbar con atención y sin repetir el dueño.
   - Pie de foto con el color de la postal.
   - «(recomendada)» en el nombre accesible y más contraste en «Sin sorpresas».
3. **Un préstamo no es superávit** (`ownIncome` en money.ts) en todos los sitios que miran el saldo del mes.
4. **Préstamos y licitaciones con riesgo de verdad**:
   - Tope por plazo: cuotas por debajo del 35 % de lo que entra, con botones de ±5.000 €.
   - Intereses de demora con nota D y caja en negativo; sin avisos A↔B si no hay préstamos.
   - Revisar el contrato al 20 %, la barata de fuera con un 40 % de sobrecoste del 25 % y el escándalo con −8 de ánimo y −3 de campaña.
5. **Política viva**:
   - Candidaturas con la facción por debajo de 60 de satisfacción.
   - Si la IA no respondió el último turno, también se presentan por reglas los vecinos con IA.
   - El rival (con reglas o con IA) no repite la misma obra en 6 meses.

## Aplazados

- **El rival no gana nunca unas elecciones** (el jugador gana por unos 5 a 1) y, sin IA, los cuatro estilos gobiernan igual; sus promesas «crear empleo» y «no subir impuestos» se cumplen solas. Revisar `tally` y `rivalGovern` con `STYLE_BUILD` en la 2.3.
- El préstamo del rival (`pedir_prestamo:24`), que falta en su menú.
- Hoja de licitación compacta (tercera tarjeta bajo el pliegue, la obra a la vista con `revealTile`, aviso «Obra cancelada» al cerrar con ✕).
- Rótulos de calle a 11 px × texto y resaltado de la calle al dedicarla; «Su vida» recortada a 3 líneas; candidaturas ordenadas por votos y con colores distintos en la noche electoral.
- Biografías fuera del camino crítico (petición barata aparte) si el turno mensual sigue lento en vivo; pies de foto pendientes si falla el director de ese mes.
- Tope de fincas y cooperativa (2.4); perfiles que dediquen calles y elijan oferta; el perfil `campo` que pinta zona agraria sobre sus calles planificadas.
- `trimTenders` con un sobrecoste pendiente y `validateAsGovernment` que no restaura `governing` (frágiles, sin fallo hoy).
