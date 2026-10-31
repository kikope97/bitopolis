# Ronda 15 — cierre de la v1.9 (economía de cada vecino)

## Qué trae la v1.9 (pedido por el creador)

«Que cada persona tenga un balance económico. Que si no le llega para pagar impuestos tenga deuda y esté mal. Porque le han robado y no le llega. El ladrón nunca podrá robar más que ese dinero.» Y: «Que yo pueda obligar a las empresas a tener un sueldo mínimo». «Añade todo, no dejes nada para más adelante.» Diseño: `docs/propuestas/v1.9-economia-personal.md`.

- **Balance de cada vecino** (`household.ts`): lo que entra y sale cada mes; estado holgado / va justo / no llega / endeudado; ficha «Su bolsillo».
- **Sin pobreza de base:** gasto básico (300 €) y ocio solo con colchón (150 €); sueldo de quien trabaja fuera 22 → 25 €/día.
- **Deuda:** lo que no puede pagar (impuestos, tasas, alquiler, hipoteca, multas) queda como deuda con el ayuntamiento o con el banco o casero; se devuelve hasta el 30 % de lo que entra; recargo único del 10 % del ayuntamiento e interés del 1 % del banco; conservación de la deuda como invariante. Felicidad «Debe dinero» y «Llega justo».
- **Consecuencias:** desahucio del alquiler privado, embargo de la hipoteca (el banco vende y sigue de alquiler), irse del pueblo con deudas (incobrables), herencia que paga primero las deudas. El alcalde puede **aplazar** o **perdonar** la deuda con el ayuntamiento y dar **microcréditos**.
- **Decisión «deudas»** de los vecinos con nombre (apretarse, pedir aplazamiento, irse, aceptar un empleo); la IA recibe la deuda por tramos (PROMPT_VERSION 5).
- **Paro real** con prestación del Estado.
- **Sueldo mínimo** (sin mínimo / bajo / medio / alto) con «a quién afecta»: los trabajadores de las empresas del pueblo cobran más y están más contentos; los empresarios pagan más, ganan menos, se enfadan y lo recuerdan; las empresas suben precios y se abren menos. **Salud de las empresas**: cuentas de cada tienda, margen medio, cuántas pierden dinero, cierres y despidos.
- **Delincuencia:** robos en casas (nunca más de lo que tiene la víctima), «intento de robo» con la caja vacía, ladrones del propio pueblo (endeudados, sin dinero ni trabajo) con antecedentes, pérdida del empleo y multas que se vuelven deuda; la pobreza sube la delincuencia del mapa.
- **Interfaz:** filtro «Con deudas», capa «Bolsillo de los vecinos», «Vecinos y empresas» en el parte y en «Gestión del pueblo», avisos agrupados de impagos y cierres.

## Agentes de la ronda 15

1. **Jugador de la economía (iPhone 17):** se entiende el sueldo mínimo y las cuentas de cada tienda. Problemas: con el sueldo alto, las tiendas abrían y cerraban en bucle (7–9 cierres al mes en un pueblo de 181 vecinos); los cierres no se avisaban a x10 ni decían la causa; el enfado del empresario casi no se notaba; los robos con el ladrón escapado paraban el juego a menudo; el bolsillo tras un microcrédito decía «Aplazado».
2. **Equilibrio (5 perfiles × 30 semillas × 4 años):** impagos, Gini, deuda máxima y quiebras de perfiles prudentes dentro de objetivo; con el sueldo alto (1.250 €) cerraba el 12–20 % de las empresas al año y había quiebras en pueblos pequeños (las fábricas ingresaban por trabajador lo mismo que pagaban); desahucios algo por encima en el derrochador; con «dos nóminas» de caja inicial casi no se fundaban empresas.
3. **Narrativa:** al desahuciado lo volvían a meter en la misma casa (desahucios en bucle) y podía hipotecarse con deudas; «apretarse» ganaba el 94 % y se repetía sin fin, con coletillas que desentonaban; aplazamientos por 24 €; el paro no dejaba rastro; los recuerdos nuevos no salían en la voz del vecino; textos con el género mal.
4. **Pantallas y accesibilidad:** «Su bolsillo» bien en todos los tamaños. Problemas: la capa Bolsillo hacía la media y escondía a los endeudados; la lista «Con deudas» se descolocaba; tocar un botón desactivado no explicaba nada en el móvil; lo preocupante solo iba en rojo; cifras que se partían a 360 px.

## Cambios aceptados (5)

1. **Desahucios y deudas con sentido:** tras un desahucio nadie le alquila en 6 meses (sin dinero, se acaba yendo); sin hipoteca con deudas ni en el año siguiente a un embargo; quien está detenido no busca trabajo; la decisión «deudas» no repite «apretarse», pesa irse tras un desahucio, plantillas propias y sin coletillas; aplazar solo desde 300 €; el paro deja recuerdo y aviso; recuerdos nuevos en la voz del vecino; textos corregidos («del pueblo», «no puede con las deudas», recuerdo propio al perdonar).
2. **Empresas que se adaptan:** si pierden dinero despiden antes de cerrar y vuelven a contratar cuando ganan; caja inicial para una nómina al sueldo vigente; quien cierra tarda 6 meses en reabrir, lo recuerda y se enfada si fue por el sueldo mínimo; «Su negocio pierde dinero» en su felicidad; más gasto en las tiendas del pueblo (`LOCAL_SPEND_SHARE` 0,45 → 0,6).
3. **Avisos que se entienden:** cierres agrupados a fin de mes (también a x10) con la causa; «Empresas que pierden dinero: X de Y», cierres y despidos en el parte; aperturas como buena noticia; robos (en tiendas o casas) sin parar el juego; bolsillo tras un microcrédito explicado y sin acciones que ya no aplican; «no le llegó: debe X € más».
4. **Pantallas:** capa Bolsillo con el peor de cada casa; lista «Con deudas» en su línea; tocar un botón desactivado explica por qué; «⚠» en lo preocupante (no solo color); cifras sin partir y tarjetas que no se salen; leyenda más estrecha.
5. **Equilibrio:**

   | Ajuste | Antes | Ahora |
   |---|---|---|
   | Sueldo mínimo alto (`MIN_WAGE.high`) | 1.250 € | 1.150 € |
   | Ingreso de las fábricas por trabajador | 1.250 € | 1.250 + la mitad de la subida del sueldo |
   | Meses de alquiler impagado hasta el desahucio (`DEBT.evictMonths`) | 3 | 4 |
   | Caja inicial de un negocio (`foundSeed`) | 2.500 € | una nómina al sueldo vigente |

## Aplazados

- Subir la proporción de vecinos con deuda hasta el 3 % (hoy 1–2,5 % en perfiles prudentes): sería artificial; la deuda llega por golpes.
- El derrochador sigue quebrando (ya lo hacía antes de la v1.9).
- (Hecho fuera de la cuenta, por ser un fallo: la caja de 6 cifras en la barra de arriba se muestra en miles.)
- Pantalla de inicio al 200 % en 360 px (título y resumen cortados; «Continuar» tapado).
- Repeticiones antiguas («Se lleva bien con Marcos y Marcos», «Rosa, enfermero»).
- Si el alcalde no responde a un aplazamiento, un pequeño rencor.

## Métricas (10 semillas × 4 años, `.probe/v19/metrics.txt`)

| Perfil | Quiebras | Población mediana | Caja mediana | A 0 € | Con deudas | Paro | Impagos / ingresos |
|---|---|---|---|---|---|---|---|
| casual | 0/10 | 48 | 162.165 € | 1,5 % | 2,5 % | 1,7 % | 0,10 % |
| constructor | 1/10 | 116 | 66.132 € | 1,8 % | 2,1 % | 1,9 % | 0,11 % |
| ahorrador | 0/10 | 72 | 65.817 € | 3,5 % | 2,3 % | 2,3 % | 0,09 % |
| derrochador | 8/10 | 27 | −30.954 € | 12,5 % | 10,5 % | 2,3 % | 0,76 % |

En la 1.8 (mismas semillas): casual 48 vecinos, constructor 89 (1/10 quiebras), ahorrador 44; en la 1.8, el 19 % de los vecinos estaba a 0 € al cuarto año. Sueldo mínimo (4 semillas de constructor, un año tras fijarlo): sin mínimo 8 % de empresas cerradas al año y margen de 1.072 €/mes; alto, 9 % y 620 €/mes.
