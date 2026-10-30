# Ronda 03 — cierre de la v0.3 (Economía)

## Métricas antes de la ronda (10 semillas, 360 días)

| Perfil | Pob. a 1 año | Quiebras | Caja | Felicidad | Propietarios | Empresas de vecinos |
|---|---|---|---|---|---|---|
| pasivo | 1.0 | 0 % | 18313 | 39 | 0.0 | 0.0 |
| casual | 43.5 | 0 % | 37103 | 82 | 3.7 | 0.1 |
| ahorrador | 32.3 | 0 % | 15976 | 76 | 5.4 | 0.2 |
| agresivo | 24.6 | 0 % | 35517 | 61 | 6.1 | 0.0 |
| derrochador | 40.2 | 10 % | -557 | 90 | 2.7 | 0.1 |
| constructor | 45.9 | 0 % | 3280 | 86 | 4.9 | 0.1 |

Mejor/peor (perfiles activos): 1.87x

IA con 20 vecinos con nombre (LLM simulado, 3 × 360 días): 18 llamadas por mes de juego (máx. 25), ~17.000 tokens de entrada; ≈0,004 €/mes con gpt-5.4-nano y ≈0,02 € con claude-haiku-5-5. Sigue pendiente la medición con un modelo real.

## Agentes

1. **Veterano**: felicidad saturada (76–90), hipoteca sin interés (comprar domina), tributos sin coste cruzado, sin sumideros de dinero, empresas de vecinos casi invisibles.
2. **Min-maxer**: la venta de vivienda municipal crea dinero (el «banco» adelantaba el 80 %), arbitraje del precio máximo al revender, las viviendas vendidas nunca vuelven al ayuntamiento (fallo), IBI de viviendas vacías pagado desde fuera, cambios de impuesto en ráfaga, dividendos sin tributar.
3. **Casual**: «afecta a vecinos y 9 más» sin nombres (fallo), los tributos no dicen cuánto dinero suponen, el parte no responde a «¿voy bien?», formato de importes, la venta de vivienda queda lejos, nada enlaza con el siguiente paso.
4. **Accesibilidad**: botón de capas sin texto, «muy alto» sin trama, parejas de colores, selección marcada solo por color, emojis sin texto, anuncios al lector de pantalla.
5. **IA e historias** (para la v0.4): relaciones como datos, memoria en 3 capas sin texto libre, no reinyectar los `motivo` del LLM, director de historias con ganchos como datos, plenos y promesas como datos, modelo premium con reserva y validación.
6. **Reseña**: «me siento espectador; falta un hilo para volver mañana».

## Decisión (5 cambios)

1. **Vivienda municipal sin dinero gratis** (min-maxer M1–M3): el ayuntamiento cobra la entrada y los gastos al vender y el resto en cuotas, sin banco; la vivienda que fue municipal mantiene el precio máximo al revenderse y vuelve al ayuntamiento cuando su dueño se va (corrige el fallo).
2. **Felicidad no saturada** (veterano V1): base 50 → 38, servicios con tope 10, ruido desde 25, delincuencia desde 20, marcha desde 35.
3. **Hipotecas con interés** (veterano V2): 0,4 % mensual sobre lo pendiente y 120 cuotas.
4. **Empresas de vecinos alcanzables** (veterano V5): capital mínimo 3.000 €, probabilidad 35 %, sin exigir parados y orden al azar entre comprar y emprender.
5. **Legibilidad de la economía** (casual 1–3, accesibilidad 1, 2, 4, 5): nombres reales en «a quién afecta», estimación en €/mes de cada nivel, «✓ (actual)» en la opción elegida, parte con «Entra / Sale» y una frase de conclusión, botón «Capas» con texto y `aria-pressed`, tramas en todos los niveles de la leyenda y estado de ánimo con texto.

Ajustes de equilibrio derivados (medidos): la demanda de vivienda castiga menos las casas vacías y las zonas residenciales dejan de crecer si sobran viviendas (había pueblos atascados con 28 viviendas vacías); tasas altas −6 → −4 y el IBI alto en inquilinos −3 → −2. Los perfiles «agresivo» (ahora construye un parque) y «ahorrador» (reserva 4.000 €) se ajustaron para jugar como un jugador razonable.

## Métricas después (10 semillas, 360 días)

| Perfil | Pob. a 1 año | Quiebras | Caja | Felicidad | Propietarios | Empresas de vecinos |
|---|---|---|---|---|---|---|
| pasivo | 1.0 | 0 % | 18288 | 25 | 0.0 | 0.0 |
| casual | 57.3 | 0 % | 25666 | 65 | 7.4 | 1.8 |
| ahorrador | 44.0 | 0 % | 19900 | 69 | 3.1 | 1.0 |
| agresivo | 39.5 | 0 % | 31547 | 58 | 5.1 | 1.3 |
| derrochador | 49.0 | 10 % | -726 | 75 | 2.8 | 1.1 |
| constructor | 72.4 | 0 % | 3896 | 67 | 9.5 | 1.9 |

Mejor/peor (perfiles activos): 1.83x

## Aplazado o rechazado

- *Aplazado (backlog, §15)*: mantenimiento por antigüedad y nuevos sumideros de dinero (V4), coste cruzado entre tributos (V3), IBI de viviendas vacías con caja finita (M4), impuesto a los dividendos (M6).
- *Rechazado*: enfriamiento de 14 días entre cambios de tipo (M5): el tipo medio del mes y la memoria fiscal ya quitan el beneficio de subir el último día.
- *Aplazado a v0.5*: modo daltónico con tramas gruesas, patrón completo de radiogroup con flechas y validación de contraste en el CI.
- *Para la v0.4 (su alcance)*: todo lo de IA e historias y la reseña.
