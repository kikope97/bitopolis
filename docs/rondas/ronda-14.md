# Ronda 14 — cierre de la v1.8 (ayuntamiento, delincuencia y animaciones)

## Qué trae la v1.8 (pedido por el creador)

- **Versión en Ajustes**, abajo del todo.
- **Ayuntamiento por niveles** (`townhall.ts`, formato de partida 11):
  - Es el centro del pueblo y sube de nivel 1 a 5 (casa consistorial → palacio municipal), cada uno con su dibujo.
  - Las obras piden nivel **y** vecinos. Zonas y plenos llegan con el nivel 2 (10 vecinos y 3.000 €); la cárcel, con el 4.
  - Al tocarlo, panel **«Gestión del pueblo»** a pantalla completa: nivel y ampliación, cómo va el pueblo, lo que falta, lo que tiene, seguridad y elecciones.
- **Servicios por niveles** (`levels.ts`): bomba, central, colegio, centro de salud, comisaría, cárcel, parque, biblioteca y polideportivo suben a nivel 2 y 3.
  - Más radio, más capacidad (vecinos, casas con agua o luz, calabozos, plazas), algo más de felicidad; más mantenimiento.
  - Subir pide ayuntamiento de nivel 3/4, 40/100 vecinos, que el servicio ya se use (75 %) y dinero (×2 y ×4,5 los materiales); la obra dura 4/7 días y el servicio sigue abierto.
  - Cada nivel tiene su dibujo (depósito elevado → potabilizadora; ala nueva → torre del reloj y pista; hospital con helipuerto…).
- **Delincuencia** (`crime.ts`): robos en tiendas según la delincuencia; la comisaría cercana detiene si le quedan calabozos; la cárcel los vacía; sin sitio, el ladrón escapa.
- **Manifestaciones que escalan y disturbios**: cada manifestación sin respuesta es mayor; tras varias, disturbios que destrozan tiendas, que hay que pagar para reparar. Las asociaciones llevan el nombre de su barrio (`barrio.ts`).
- **Todo animado**: marcha con pancartas por las calles hasta el ayuntamiento, policías que van a la tienda, el ladrón que huye con el saco, tiendas rotas con humo.
- **Calendario a x3/x10** que pasa la hoja cada día, y **vuelta a x1** cuando algo pide atención (robo sin resolver, calabozos llenos, manifestación, disturbios, riada): temblor, la cámara va allí y un destello lo marca. Como mucho una parada cada 45 s.
- **Ficha de casa** con agua, luz, seguridad, colegio, salud, parque y tienda, y resumen de quien vive allí; iconos sobre las casas que llevan días sin agua o luz.
- Aplazados de la 1.7: presentación de la geografía al empezar, álbum agrupado, «Votos» junto al 🗳.

## Agentes de la ronda 14

1. **Jugadora nueva (iPhone 17):** tutorial fluido; el desbloqueo por el ayuntamiento se descubre y el panel se entiende. Problemas: la bandeja dejaba un motivo de bloqueo viejo («ayto. nivel 2» con el nivel 2 ya), el pleno parecía disponible en el nivel 1, el panel no decía cuánto dinero faltaba, el botón desactivado parecía pulsable, el ayuntamiento cuesta de encontrar, el cuadro del tutorial tapa la explicación de la bandeja.
2. **Equilibrio (40 semillas × 4 años):** el nivel 2 es un trámite y el 3 no es un muro; el 4 y el 5 son muros de población. Ningún perfil prudente quiebra. La cárcel costaba ~4.100 €/mes (4 empleos) sin beneficio porque los calabozos casi nunca se llenaban; las marchas llegaban a 4 veces la población.
3. **Animaciones y vuelta a x1:** la marcha y la policía se ven bien de cerca; 3 paradas en 4 minutos a x10. Problemas: al volver a x1 no se veía la animación (zoom lejano), a veces dos paradas seguidas (una oferta con plazo y luego la manifestación), la marcha casi no recorría calles, el ladrón desaparecía antes de llegar la cámara, el aviso tapaba el calendario.
4. **Pantallas pequeñas y accesibilidad:** panel legible al 100–150 %, foco y Esc bien. Problemas: al 200 % el panel y la tabla de la casa se salían; en tableta el panel a pantalla completa no era modal; el calendario y la leyenda chocaban.

## Cambios aceptados (5)

1. **Vuelta a x1 que se ve:** la cámara acerca hasta ver la animación y las animaciones empiezan cuando llega; la marcha sale de una calle a 6–10 casillas del ayuntamiento y va más apiñada; el ladrón corre más despacio y en bucle mientras dura; las ofertas con plazo cuentan como parada (sin segunda parada a los segundos); con movimiento reducido, la cámara va al sitio sin animación.
2. **Texto al 200 % y tableta:** el dibujo del ayuntamiento pasa arriba en pantallas estrechas, la tabla de servicios no se sale, el panel a pantalla completa es modal también en tableta y sin márgenes en horizontal.
3. **Calendario sin tapar:** los avisos y la leyenda le dejan sitio; mes en minúscula como en la franja.
4. **Bloqueos claros:** la bandeja actualiza el motivo; el pleno avisa antes de tocarlo y el objetivo dice que llega con el nivel 2; «Faltan N € en la caja»; botones principales desactivados apagados.
5. **Equilibrio:**

   | Ajuste | Antes | Ahora |
   |---|---|---|
   | Empleos de la cárcel (`JOBS.jail`) | 4 | 1 |
   | Calabozos por comisaría (`CRIME.cellsPerStation`) | 4 | 2 |
   | Días en el calabozo sin cárcel (`CRIME.cellDays`) | 30 | 60 |
   | Crecimiento de cada marcha repetida (`ASSOCIATIONS.growth`) | 0,5 | 0,2 (y nunca más que la población) |
   | Manifestaciones antes de los disturbios (`ASSOCIATIONS.riotAfter`) | 3 | 4 |

## Aplazados

- Leyenda de «Qué falta» muy grande en horizontal (ocupa 2/3 del mapa).
- Tabla de servicios de la casa como lista de definición para lectores de pantalla.
- Cuadro del tutorial encima de la cabecera de la bandeja; resaltar el ayuntamiento en el paso de ampliarlo; botón «Ampliar» en la tarjeta del panel Pueblo.
- Al aceptar obras, contar lo que falta por pagar de las que están en marcha (se puede acabar en deuda siguiendo el tutorial).
- Que los perfiles automáticos mejoren servicios y atiendan asociaciones (cambia la simulación y obliga a regrabar la IA).
- El nivel 5 compensa poco (+2 de felicidad); el dinero sobra a largo plazo en los perfiles prudentes.

## Métricas (20 semillas × 4 años, `.probe/metrics-v18.txt`)

| Perfil | Quiebras | Población mediana | Caja mediana | Robos | Detenciones | Disturbios |
|---|---|---|---|---|---|---|
| casual | 0/20 | 72 | 159.706 € | 281 | 0 | 33 |
| constructor | 2/20 | 131 | 110.566 € | 324 | 187 | 19 |
| derrochador | 11/20 | 27 | −32.820 € | 169 | 7 | 41 |

En la 1.7: casual 0/20 (76 vecinos), constructor 3/20 (122), derrochador 20/20 (15).
