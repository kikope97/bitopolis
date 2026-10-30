# Ronda 02 — cierre de la v0.2 (prueba de la IA)

## Métricas

Simulación (10 semillas, 360 días):

| Perfil | Pob. a 1 año | Quiebras | Caja | Decisiones/año |
|---|---|---|---|---|
| pasivo | 1.0 | 0 % | 19236 | 90 |
| casual | 33.3 | 0 % | 14594 | 181 |
| ahorrador | 22.7 | 0 % | 4122 | 194 |
| agresivo | 23.0 | 0 % | 31372 | 185 |
| derrochador | 48.0 | 0 % | -950 | 197 |
| constructor | 43.1 | 0 % | 2837 | 187 |

Mejor/peor: 2.11x

IA (`pnpm ai-eval`, 3 semillas × 360 días, **LLM simulado**; no hay key de pruebas en el entorno):
- 537 peticiones, ~15 llamadas por mes de juego (máximo 17 en un mes), ~530 tokens de entrada y ~35 de salida por llamada.
- Coste por mes de juego con 5 vecinos (precios orientativos): de 0,001 € (gemini-2.5-flash-lite) a 0,03 € (claude-sonnet-5-5); 0,002 € con gpt-5.4-nano.
- Validez: el simulador repite frases a propósito y la nueva comprobación de calidad rechaza el 25 % por motivo repetido. Esto demuestra el filtro, no la calidad de un modelo real.
- **Pendiente**: medir con un modelo real `válidas sin fallback ≥98 %` (`pnpm ai-eval --live`). Sin esa medición, el criterio de la v0.2 queda abierto y se revisará en cuanto haya key.

## Agentes

1. **Veterano**: la quiebra sin consecuencias, tributos con grupos afectados e inercia asimétrica, precio dinámico de la vivienda, empresas con capital del fundador, rendimientos decrecientes de servicios, 20 vecinos con tope de llamadas.
2. **Min-maxer**: dinero gratis de fuera (PIE e impuesto de inmuebles), impuestos altos dominantes, compraventa pública en bucle, obras como empleo, el 2x medido con el pasivo, ráfagas de decisiones de IA.
3. **Casual**: configuración de IA demasiado técnica, formato del coste, burbuja breve sin rastro, sin indicador de estado de la IA, panel de gasto con aspecto de factura, aviso de x10.
4. **Accesibilidad**: burbujas con límite de tiempo, lectores de pantalla, contraste de "Guardado" y textos pequeños, lenguaje técnico, foco.
5. **IA e historias**: el 98 % no mide nada (el fallback cuenta como válido), motivos repetidos, enum global en el esquema, prefijo cacheable corto y sin el estado del pueblo, inyección de segundo orden en la v0.4, preparar la v0.3/v0.4.
6. **Reseña**: "simpático pero sin consecuencias visibles; las frases de reglas suenan a plantilla".

## Decisión (5 cambios)

1. **Medición honesta de la IA** (IA 1): `ai-eval` separa válidas a la primera, tras reintento y fallback por causa (JSON, esquema, acción no permitida, motivo vacío, con cifras, repetido, error del proveedor) y el máximo de llamadas en un mes. El criterio pasa a ser "válidas sin fallback ≥98 %".
2. **Calidad de los motivos** (IA 2): ejemplos de tono en el prefijo, últimos motivos de cada vecino en el prompt con la orden de no repetirlos, y rechazo de motivos repetidos o con cifras.
3. **Prompt y esquema** (IA 3–4): esquema por vecino (cada uno solo puede elegir sus acciones), estado del pueblo en el prefijo fijo (§9.2) y la nota del reintento al final para no romper el caché.
4. **Estado de la IA visible** (casual 4, §9.5): chip «IA ●» / «IA en pausa» en el HUD que abre el gasto.
5. **Configuración y burbujas** (casual 1, 2, 5; accesibilidad 1, 2; reseña 1): configuración simple (proveedor, key, gasto máximo al mes) con avanzadas plegadas y botón fijo; formato único de euros; gasto con barra y detalle técnico plegado; burbujas que se pueden tocar (abren la ficha), sin límite de tiempo con movimiento reducido y anunciadas al lector de pantalla.

## Aplazado o rechazado

- *A la v0.3 (su alcance)*: todo lo de economía del veterano y del min-maxer (quiebra con consecuencias, tributos por grupo con memoria, vivienda con precio dinámico y compraventa, empresas con capital del fundador, PIE, servicios con rendimiento decreciente, 2x solo entre perfiles activos).
- *A la v0.4*: inyección de segundo orden en la memoria, `gancho` del director de historias, compactar el log, modelo premium para plenos y diario (IA 5–6).
- *A la v0.5*: auditoría de foco y textos al 150/200 % (accesibilidad 4–6).
- *Rechazado*: IA de demostración sin coste (casual 6), porque necesitaría una key del servidor que el creador no ha definido.
