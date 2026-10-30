# Ronda 01 — cierre de la v0.1 (pueblo jugable)

## Métricas antes de la ronda (`pnpm sim`, 8 semillas, 360 días)

| Perfil | Pob. media a 1 año | Quiebras | Caja media | Mes en que llega a 10 vecinos (mediana) |
|---|---|---|---|---|
| pasivo | 1.0 | 0 % | 19236 | 99 |
| casual | 40.5 | 0 % | 39540 | 2 |
| ahorrador | 20.9 | 0 % | 11001 | 2 |
| agresivo | 18.9 | 0 % | 40050 | 2 |
| derrochador | 48.6 | 13 % | -2206 | 1 |
| constructor | 42.0 | 0 % | 2170 | 1 |

Mejor/peor (sin pasivo): 2.58x

Otras mediciones:
- Playwright, móvil y escritorio: partida completa (tutorial → obras → vecinos → guardar → continuar) sin errores de consola.
- Partida automatizada de 4 min reales a x10 en móvil (≈4 meses de juego): sin bloqueos ni errores, con guardados correctos cada día.
- 365 días simulados: ~100 ms. Coste de IA: no aplica (sin IA en v0.1).

## Agentes

1. **Veterano**: tiendas mal dimensionadas (1 cada 9 vecinos y quiebran), servicios caros, impuestos sin decisión real, sin sumideros de dinero, contaminación poco notable, arranque de una sola ruta.
2. **Min-maxer**: casas municipales demasiado rentables (amortización en 4 meses), agresivo y ahorrador atascados por la demanda R, colchón de commuter, obreros de fuera baratos, demoler gratis.
3. **Casual de móvil**: tutorial que tapa el mapa, flecha poco fiable, avisos apilados, coste poco visible, carrusel que esconde herramientas, hueco en la pantalla de inicio, sin "mientras no estabas", pausa inicial confusa.
4. **Mayor / accesibilidad**: faltan tamaños de texto, contraste del texto secundario y de lo bloqueado (opacidad), color como única señal en avisos, lector de pantalla, teclado sin cursor de casilla, botones de 32–40 px, cierre automático del tutorial, panel de accesibilidad.
5. **IA e historias**: eventos estructurados, `validActions` y `CitizenAct`, petición anticipada enganchada al guardado diario, fallback con la misma firma, `ReplayProvider`, medición del 98 %, coste por mes, "wow" del 3.er vecino.
6. **Reseña** (★★★☆☆ "un SimCity sin personalidad"): poner cara y voz a los vecinos, avisos con acción, objetivos visibles, equilibrio.

## Decisión del creador (fuera del cupo de la ronda)

- **Arte en alta definición**: el creador pide un pixel art mucho más definido. Se pasa de casillas de 16 px a **32 px** y edificios de **32×48** en vista 3/4, con texturas, sombras, aceras y obras por fases. La paleta cerrada de 32 colores se mantiene. Spec §8.1 actualizada.

## Decisión de la ronda (5 cambios)

1. **Paquete de equilibrio** (min-maxer 1–3, veterano 1–3): alquiler municipal 250 → 180, commuter 28 → 22 €/día, tiendas 1 por cada 14 vecinos y caja inicial de 3.500, sueldo de servicios 700, suelo de demanda R 30 → 40, impuestos altos −14 → −10 de felicidad. Resultado (10 semillas):

| Perfil | Pob. media a 1 año | Quiebras | Caja media | Mes en que llega a 10 vecinos (mediana) |
|---|---|---|---|---|
| pasivo | 1.0 | 0 % | 19236 | 99 |
| casual | 36.0 | 0 % | 22520 | 2 |
| ahorrador | 27.3 | 0 % | 5456 | 1 |
| agresivo | 20.8 | 0 % | 31837 | 2 |
| derrochador | 41.2 | 10 % | -4650 | 1 |
| constructor | 40.1 | 0 % | 2814 | 1 |

Mejor/peor (sin pasivo): 1.98x

2. **Avisos agrupados y con icono** (casual 3, accesibilidad 3): como mucho 2 a la vista, "N obras terminadas", prefijo ✔/⚠/ℹ, botón de cierre de 48 px y el aviso de caja con una acción sugerida (reseña 2).
3. **Tutorial compacto y sin prisa** (casual 1 y 8, accesibilidad 7): "Saltar" a la derecha, texto que dice dónde está cada botón y que el tiempo está parado, y sin cierre automático (botón «Entendido»).
4. **Pantalla de inicio** (casual 6): «Jugar» justo debajo del modo, y el enlace en un desplegable.
5. **Legibilidad** (accesibilidad 1–2): etiquetas de herramientas a 14 px y texto de ayuda a 16 px, botones más anchos, y lo bloqueado se marca con candado y gris (no con opacidad).

## Aplazado o rechazado

- *Para la v0.2 (es su alcance)*: eventos estructurados, `CitizenAct`, `validActions`, fallback, `ReplayProvider`, medición del 98 % y del coste, y el "wow" del 3.er vecino (IA 1–8, reseña 1).
- *Aplazado a v0.4*: objetivos visibles (reseña 3) y "mientras no estabas" (casual 7), que son de la v0.4 en la hoja de ruta.
- *Aplazado a v0.5*: texto al 150/200 %, panel de accesibilidad, modo daltónico, cursor de casilla con teclado y carretera "toca inicio / toca fin" (accesibilidad 1, 3, 5, 6, 8).
- *Rechazado*: desbloqueo a 12 vecinos (veterano 6), porque contradice la tabla de §5.7; demoler con coste y obreros de fuera a 130 (min-maxer 4–5), porque con el equilibrio nuevo ya se cumple el 2x y no hay métrica que lo pida.
