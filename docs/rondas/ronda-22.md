# Ronda 22 — cierre de la v2.6 («Lo básico»)

## Por qué esta versión

Un jugador mandó un audio con tres quejas:
- al tocar el parque, el colegio o los bomberos no se ve su zona, ni a cuántas casas da servicio, ni su máximo, así que no hay manera de saber dónde poner otro;
- en la capa «Qué falta» no se puede tocar para ver qué casas son;
- el juego añade mecánicas en vez de mejorar las básicas.

Tres agentes investigaron y confirmaron las quejas. El creador aprobó aplicar todas las propuestas, que son las seis siguientes.

## Qué trae la v2.6

- **Cobertura visible** (`reach.ts`, `service-reach.ts`, `reach-ui.ts`):
  - un solo predicado de «este servicio llega a esta casa», compartido por la felicidad, la carga, «Qué falta» y el dibujo;
  - al tocar un servicio, rombo de alcance, ✓ y ✗ en las casas, «N viviendas · X de Y» y «Ver zona»;
  - al colocar, «+N casas» y el aviso de solape;
  - «Qué falta» se filtra por servicio y lleva un botón «Construir».
- **El núcleo explicado** (`nucleo.ts`):
  - por qué no crece cada solar (sin agua ni luz en la calle, poca demanda, casas libres);
  - la carga de la bomba y de la central;
  - «Qué pide el pueblo»;
  - el coste al mes antes de construir;
  - «Deshacer» durante 5 s, que devuelve lo pagado.
- **No abrumar** (`gates.ts`, `progress.ts`):
  - el panel «Pueblo» y la bandeja se abren poco a poco, con la marca «Nuevo»;
  - dilemas, cartas, ofertas de los pueblos vecinos, gran empresa, encargos y El Eco salen desde 30 vecinos o el ayuntamiento 3;
  - «Pueblo sencillo» opcional (formato 19).
- **Licitaciones** solo en obras grandes: desde el nivel 3 y 6.000 €.
- **Dinero que no se dispara** (`upkeep.ts`):
  - gasto corriente por vecinos según el nivel, por carreteras y por casas municipales;
  - con rampa, también para las partidas viejas (`upkeepFrom`).
- **IA**: cada vecino sabe qué le falta en su casa (`en_su_casa`); el turno recibe `servicios_llenos` y `gasto_fijo`. TURN_PROMPT_VERSION 16.

## Agentes de la ronda 22

1. **Móvil (360, 390, 768 y 1280)**:
   - al colocar un servicio en el móvil no se veía su zona;
   - el borde del rombo no se apreciaba (y en la nieve, nada);
   - con texto al 200 %, la ficha tapaba «Ver zona»;
   - la barra «Construir / ✕» medía hasta 157 px;
   - la bandeja abría «Vivienda» y «Zonas» en el nivel 1 y sus cabeceras medían 32 px;
   - la ficha de la bomba repetía su cifra;
   - la leyenda abierta tapaba el mapa.
2. **Código**:
   - cancelar devolvía los materiales al precio de hoy: +750 € por obra con otro plan del presupuesto;
   - en Modo IA con key propia se perdían «Pueblo sencillo», el escenario y el terreno;
   - la propuesta de cancelar podía acabar en un derribo sin devolver nada;
   - `mayorText` llamaba «cancela» a cualquier derribo de algo sin terminar;
   - en pausa, la zona dibujada no se renovaba;
   - los avisos de la red se compartían entre partidas;
   - por lo demás, migración 18→19, determinismo, «Pueblo sencillo» y deriva de dinero 0, todo bien.
3. **Jugador de pruebas (el que se quejó)**:
   - las tres quejas están resueltas («54 de 60 alumnos» con el rombo es justo lo que pedía);
   - el filtro de «Qué falta» enseñaba la zona de otro servicio si antes se había tocado uno;
   - la ficha no marcaba con ✗ las casas sin servicio fuera del radio;
   - el mapa se alejaba hasta unos 9 px por casilla;
   - no había aviso al colocar en una calle sin agua ni luz;
   - «+18 casas» contaba solares;
   - «Configurar» quedaba abierta encima del juego;
   - «Deshacer» seguía en la franja con otra herramienta.
4. **Equilibrio y dinero (semillas 1–8, 8 años)**:
   - el nivel 4 era una trampa: de 4 a 30 € por vecino (el casual cerraba un año en −37k y el constructor perdía vecinos y no llegaba al 5);
   - el jugador no veía venir el gasto al ampliar (se quedaba corto unas 20 veces);
   - el agresivo y el campo acumulan 200–270k con impuestos altos;
   - los dilemas casi no salen;
   - «Pueblo sencillo» queda más fácil porque también apaga la competencia y las ayudas de la Diputación.

## Cambios aceptados (5)

1. **Móvil**:
   - al colocar en táctil se encuadra la zona;
   - el borde del rombo tiene al menos 2 px y un trazo oscuro debajo;
   - la barra es más corta (sin «X aquí» ni «hasta» cuando se puede construir);
   - la ficha va al grano («14 viviendas · 54 de 60 alumnos (90 %)»), con «Ver zona» justo debajo y sin la cifra repetida en las plantas;
   - la bandeja no abre categorías que solo sirven con zonas (`ZONE_HELPERS`);
   - las cabeceras miden 44 px y la leyenda ocupa como mucho medio mapa en el móvil.
2. **Código**:
   - `Project.paid`: cancelar devuelve lo pagado;
   - `Demolish.cancelOnly`, que el motor rechaza si la obra ya empezó (la propuesta de cancelar y «Deshacer» lo usan);
   - `PUT /ai-config` acepta escenario, terreno y «Pueblo sencillo»;
   - `mayorText` usa `cancelRefund`;
   - la clave de la zona incluye el gasto del mes (una carretera puesta en pausa se ve);
   - los avisos de la red van por semilla.
3. **Lo que vio el jugador de pruebas**:
   - el filtro de «Qué falta» manda sobre la selección, la quita y lleva el mapa a las casas;
   - la ficha marca con ✗ las casas sin ese servicio de todo el pueblo;
   - `revealArea` no baja de ~14 px CSS por casilla;
   - `siteNetworkWarn`: «⚠ Sin agua aquí: esta calle no está unida…» al colocar;
   - «+N casas» cuenta solo viviendas (los solares van aparte) y, en ámbar, cuando es 0;
   - «Configurar» se cierra al jugar;
   - otra herramienta quita «Deshacer».
4. **IA**: `en_su_casa`, `servicios_llenos` y `gasto_fijo` (en palabras, sin cifras). Nueva grabación en vivo.
5. **Equilibrio**:
   - `UPKEEP.perCitizen` pasa a `[0,0,0,8,16,24]`;
   - en alto, `IBI_RATE` 0,085 y `TASA_BASURAS` 24;
   - al ampliar el ayuntamiento se dice cuánto sube el gasto corriente (`upkeepJump`) y se suma a «a fin de mes pagas»;
   - `DILEMMA.minPop` 30, como `EARLY`.

## Métricas (tras los cambios, semillas 1–3, 4 años)

| perfil | caja (k€) y vecinos | quiebras |
|---|---|---|
| casual | 20·72, 3·69, 17·72 | 0 |
| constructor | 14·196, −4·61, 33·169 | 0 |
| agresivo | 154·47, 72·35, 93·44 | 0 |
| campo | 95·40, 40·90, 108·48 | 0 |
| endeudado | 257·198, −43·82, 44·193 | 1 |

- Deriva de dinero 0 en todos los casos, invariantes bien.
- Respecto a main, las partidas se separan en los meses 2–5. El motivo son los umbrales `EARLY` y las licitaciones desde el nivel 3, no `reaches()`: con eso apagado, la rama da exactamente las mismas cifras mensuales que main.

## Aplazados

- «Pueblo sencillo» que mantenga la competencia por vecinos y la bolsa de la Diputación (y apague solo las ofertas y los alcaldes). También decidir si la comarca de la 2.3 y la gran empresa salen en ese modo.
- En el parte, «Gasto corriente: X € ahora, Y € con la rampa entera», y que `loanCapacity` cuente el gasto que viene.
- `TAX_HAPPINESS`, que no se usa: borrarlo o conectarlo. La caja del perfil campo con impuestos medios.
- Más dilemas posibles (`prisoner.minDays` 5, `factory.pollution` 30) y un perfil que construya correos para medir las cartas.
- En la felicidad, «lleno» solo si lo está el que atiende (`servingOf`), igual que en «Qué falta»: cambia el equilibrio y hay que medirlo.
- Que el director reciba `el_eco_sale` y `townFacts` con cobertura, solares parados, carga y gasto.
- Varias comisarías (o colegios) a la vez en el mapa, y «llévame a la casa sin servicio más cercana».
- Tutorial: el resaltado se queda en ⏯ con el juego ya en marcha, y la flecha tapa «Guardado».
- El jugador de pruebas pedía «Pueblo sencillo» en la pantalla de inicio. No se cambia: está en Configurar por decisión del creador.
