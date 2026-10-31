# Ronda 11 — cierre de la v1.5 (ciclo vital, presupuesto, fiestas y subvenciones)

## Qué trae la v1.5 (pedido por el creador)

- **Ciclo vital** (`lifecycle.ts`):
  - cumpleaños cada 1 de enero;
  - bebés de las parejas que viven juntas (los dos con 20–45 años y 18 meses entre uno y otro) y, en general, de adultos jóvenes;
  - los niños cuentan para el colegio y se independizan a los 6 años de juego;
  - los mayores pueden fallecer: un día del año para cada uno y como mucho una despedida por semana;
  - herencia a la pareja, con la plusvalía municipal; si no hay pareja, a la familia de fuera.
- **Presupuesto anual** (`civic.ts`): en enero, austero, equilibrado o inversor; el pleno lo vota por facciones y, si no se presenta, se prorroga.
- **Fiestas del pueblo:** los vecinos les ponen nombre («Fiestas de Santa Farola»); pequeñas o grandes, o las montan ellos en septiembre.
- **Subvenciones de la Diputación:** anticipo del 30 %, resto si se termina en plazo y reintegro con recargo si no.
- **Hoja «Ayuntamiento»** (☰), con avisos que llevan a su sección. Formato de partida 9, con migración y test.

## Métricas

20 semillas, 4 años:

| Perfil | Quiebras v1.4 | Quiebras v1.5 | Población mediana | Niños (total en las 20) |
|---|---|---|---|---|
| casual | 0/20 | 0/20 | 44 | 64 |
| constructor | 3/20 | 3/20 | 114 | 100 |
| derrochador | 10/20 | 12/20 | 75 | 62 |

- El derrochador sube algo, dentro del ruido de 20 semillas.
- Simular 4 años tarda 2,6 s (antes 1,7 s): hay más vecinos y más cosas que calcular.
- **Pruebas:** 161 tests unitarios (14 nuevos en `civic.test.ts`) y 54 e2e (nuevo: `e2e/v15.spec.ts`).

## Agentes

1. **Economista y min-maxer** (420 partidas): el dinero se conserva. Pero:
   - el austero ganaba siempre (+49 % de caja) y el inversor hundía al derrochador (20 de 20 quiebras);
   - sin facciones, el pleno aprobaba todo por unanimidad;
   - se ofrecían comisarías aún no construibles;
   - la subvención pagaba casi el 90 % del coste real;
   - la herencia cobraba dos veces la plusvalía;
   - las fiestas grandes nunca compensaban;
   - los niños tardaban 36 horas reales en independizarse.
2. **Narrativa:**
   - todas las muertes el 1 de enero y con un texto frío;
   - bebés a los 49 y 50 años y tres en 10 meses;
   - heredaban amistades;
   - hijos con el mismo nombre completo que su madre;
   - el diario agrupaba los nacimientos con las llegadas;
   - frases de pérdida repetidas.
3. **Jugador nuevo en el móvil** (6/10):
   - el tutorial tapaba «Construir» y decía «Arrastra»;
   - empezaba el tutorial en pueblos importados;
   - los avisos de la 1.5 se perdían a x10 y decían «☰ › Presupuesto»;
   - la hoja no llevaba a la sección;
   - salía «Censo: Censo:»;
   - los planes solo venían en porcentajes.

## Fallos arreglados (fuera del cupo)

- **Narrativa:**
  - «Nos ha dejado X, a los N años. El pueblo le despide en la plaza. Su casa queda con Y»;
  - despedidas repartidas por el año;
  - «¡Llega un bebé a casa de A y B!», con límites de edad y de espera;
  - herencia solo a la pareja;
  - nombres sin repetir;
  - nacimientos con su línea en el diario;
  - fuera los santos que sonaban a chiste («San Tributo», «San Pleno»).
- **Economía:**
  - presupuestos rebalanceados: austero con mantenimiento al 0,92, sueldos al 0,95 y servicios al 0,8; inversor con mantenimiento al 1,05;
  - sin facciones, vota cada vecino según lo contento que esté;
  - subvenciones solo de lo construible y sobre el coste real;
  - plusvalía de la herencia sin doble cobro y con el tope de la vivienda municipal;
  - hijos que se independizan a los 6 años de juego.
- **Móvil:**
  - el tutorial sube cuando aparece la barra de obra y en táctil explica los dos toques;
  - los pueblos ya hechos no empiezan el tutorial;
  - los avisos con plazo bajan a x1, se quedan fijos y dicen la fecha;
  - la hoja va a la sección del aviso y muestra el año actual;
  - un solo motivo con fecha y euros para las fiestas;
  - si una obra no se puede hacer, no se ofrece «Construir».

## Cambios aceptados (5)

1. **Efecto en euros al mes** de cada plan de presupuesto.
2. **Fiestas grandes:** 3 000 € (antes 5 000), 60 días y más ventas.
3. **Frases de pérdida y de bebé variadas** según la relación.
4. **Tras aceptar una subvención,** el aviso dice qué construir y hasta cuándo.
5. **Nombres de fiestas** nuevos: «San Botijo», «la Vendimia».

## Aplazados (al rediseño grande de la interfaz que viene después)

- **Pausar el juego mientras haya una hoja abierta:** con el dock siempre visible ya se puede pausar a mano.
- **Seleccionar la herramienta al aceptar una subvención:** necesita un puente entre la hoja y el juego.
- **Bebés con nombre** que aparezcan después en las fiestas o en el diario.
- **Herederos entre los hijos ya independizados:** no se guarda el vínculo familiar.
