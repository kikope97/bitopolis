# Ronda 00 — cierre de la v0.0 (esqueleto)

## Métricas (`pnpm invariants`, `pnpm sim`, 365 días)

| Perfil | Pob. a 1 año | Quiebra (día) | Caja final | Felicidad |
|---|---|---|---|---|
| pasivo | 1 | – | 6.428 | 45 |
| casual | 2 | 300 | −18.633 | 72 |
| ahorrador | 1 | – | −6.336 | 65 |
| agresivo | 2 | 330 | −16.425 | 58 |
| constructor | 3 | 210 | −32.496 | 72 |

- Invariantes: 25/25 ejecuciones sin dinero descuadrado; misma semilla → mismo hash.
- 365 días simulados: ~25 ms (objetivo < 10 s).
- Coste de IA: no aplica (sin IA en v0.0).
- Diagnóstico: todo el empleo es municipal, así que crecer = quebrar. No hay estrategia que crezca.

## Agentes (4–6 perfiles)

1. **Veterano de city builders**: empleo privado en C/I; tres barras de demanda; redes reales de agua y luz; servicios por radio; obras con obreros; parte mensual con desglose; tutorial; legibilidad móvil.
2. **Min-maxer**: exploit de casas sin empleo; exploit de subir/bajar impuestos justo antes de fin de mes; el pasivo es la mejor estrategia; la quiebra no tiene consecuencias; casas sin techo de rentabilidad; obreros de fuera como grifo; demoler gratis; perfiles de abuso en el CLI.
3. **Casual de móvil**: equilibrar la economía; inicio de una sola decisión; barra inferior de herramientas con etiqueta; tutorial como objetivos; autopausa y autoguardado; HUD legible ("1 vecinos", "2/1"); obras con progreso y "avísame"; demanda como semáforo.
4. **Mayor / accesibilidad**: texto 100/150/200 %; objetivos táctiles grandes; lector de pantalla (canvas con descripción, `aria-live`); nada solo con color; modo tranquilo; fuente legible; confirmaciones; teclado.
5. **Interesado en la IA**: ficha de vecino extensible; eventos estructurados; detonantes como función; acciones `CitizenAct`; `motivo` por plantillas; diario por reglas; nombres únicos; log de decisiones.
6. **Reseña de público** (★★☆☆☆ "Un pueblo muy bonito en el que no puedo hacer nada"): herramientas visibles, objetivo con flecha, equilibrar la economía, plurales y avisos con causa.

## Decisión (máx. 5 cambios, al menos uno fuera)

Aceptados para la v0.1:
1. **Empleo privado en C e I** (veterano 1, min-maxer 3): las empresas pagan las nóminas y el ayuntamiento solo paga los servicios. Antes de las zonas, los vecinos sin empleo local trabajan fuera con un sueldo menor (son *commuters*). *Métrica:* hoy todo empleo cuesta −731 €/mes a la caja.
2. **Llegadas limitadas por la demanda R** (min-maxer 1 y 5): la demanda baja con vivienda vacía y paro, y las llegadas dependen de ella. Así se cierra el exploit de llenar el mapa de casas.
3. **Impuesto efectivo = media diaria del mes** (min-maxer 2): subirlo el último día no rinde.
4. **La deuda tiene consecuencias** (min-maxer 4, mayor 7): por encima del límite de deuda no se empiezan obras (salvo carreteras). Hay un aviso "te quedan N meses" y la quiebra queda registrada. No hay game over.
5. **HUD legible y accesible** (casual 6, mayor 3, reseña 4): "Feb · Año 1", plurales correctos, `role="status"` y `aria-live` para los avisos.

Aplazados o rechazados:
- *Aplazado a v0.2*: eventos estructurados, `CitizenAct`, `decisionLog` y `motivo` (IA 2–5, 8). Pertenecen al diseño de detonantes de la v0.2; adelantarlos rompe el alcance congelado.
- *Aplazado a v0.5*: texto al 150/200 %, modos de daltonismo y alto contraste (mayor 1, 4). En la v0.1 la fuente es legible y nada depende solo del color.
- *Rechazado*: PIE condicionado a casas por vecino y subvención fraccionada (min-maxer 3). Contradice la spec (§5.4: el PIE depende de la población).
- *Rechazado*: coste de demoler y tope del 50 % de obreros de fuera (min-maxer 6, 7). No hay métricas que lo respalden todavía; se medirá en la ronda 01.
