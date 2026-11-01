# Hoja de ruta 2.x (aprobada por el creador)

Sale de cuatro agentes de ideas (emergencias y servicios, economía y urbanismo, IA e historia, progresión y diversión), tras la 2.0. El creador: «Me gusta todo… tanto lo de añadir como lo de más adelante. Añádelo todo». Norma de siempre: Modo normal con reglas y, en Modo IA, todo lo posible con IA; se juega bien en el móvil.

## Problemas que ataca
- **Meseta**: a media partida no hay en qué gastar (casual: 44 vecinos y 81.000 € a los 4 años) ni metas.
- Esperas sin decisiones al principio; el diario repite la misma frase.
- La tasa de basuras se cobra sin servicio (economy.ts).
- El rival gobierna por reglas; el resumen mensual con IA de la 2.0 no está hecho.

## 2.1 — Emergencias y encargos
1. **Bomberos e incendios** (`fire.ts`): riesgo por edificio (fábricas, calor, estufas en invierno), aviso previo, propagación, parque de bomberos con niveles (cisterna, apoyo en riadas), camión animado; edificio dañado y reparable, nunca perdido. IA: el director elige el incendio; vecinos ayudan, acogen o culpan al alcalde.
2. **Basura y punto limpio**: acumulación por edificio, bolsas y ratas, felicidad y delincuencia; recogida por rutas; nivel 2 reciclaje (tasa −20 %, ecologistas). IA: queja de asociación «basuras»; vecinos `quejarse` o `tirar_al_monte`.
3. **Protección civil y ambulancia**: caseta de voluntarios (riadas −60 %, quitanieves a mitad, diques en la orilla); voluntarios entre los parados (acción de la IA). Ambulancia = nivel 2 del centro de salud (urgencias que se salvan; nieve la retrasa). Los incendios y urgencias gastan del mismo cupo de drama del director.
4. **Encargos del pueblo**: 3 retos semanales del estado real (con recompensa y medalla, aplazables) y encargos con historia en boca de un vecino; en Modo IA los elige y escribe el director (menú cerrado del motor).
5. **De aldea a ciudad + El Eco de Bitópolis + Mientras no estabas**: rangos (aldea, lugar, villa, ciudad, capital comarcal) con cartel, escudo por código, tejados y fanfarria (solo título y aspecto); periódico semanal con 3 titulares y respuesta del alcalde con menú cerrado (`AnswerPress`); resumen al volver y diario sin repeticiones.

## 2.2 — Economía y política
- Préstamos municipales con calificación A–D (sustituye al descubierto), invariante de préstamos.
- Licitaciones de obras (local, barata de fuera, «la del primo del concejal»), rumor con aviso previo.
- El campo: zona agraria, regadío junto al río, olivar en colina, cosecha anual con el tiempo (la cooperativa, después).
- Calles y plazas con nombre de vecinos (en el pleno).
- Rival político con IA (mítines, promesas, gobierna con personalidad mediante `governmentCommand`) y vecinos que se presentan a las elecciones.
- Biografía viva de cada vecino y pies de foto del álbum (lo pendiente de la 2.0).

## 2.3 — Metas grandes
- Monumentos y grandes obras por fases (puente de piedra, estación de tren, estadio, feria regional, catedral) para gastar lo ahorrado.
- Turismo y patrimonio (monumento según el terreno, casas rurales, tasa turística, entorno protegido).
- Escenarios y mapas al empezar (Libre, Pueblo en quiebra, El pueblo que se vacía, Tras la riada; terreno a elegir).
- Gráficas históricas y récords; logros y medallas (~30); compartir el pueblo (postal y enlace de solo lectura con otro token).
- La gran empresa y el ciclo económico comarcal (bonanza/crisis, FEDER).

## 2.4 y después — Vida y comarca
- Autobús y estación; guardería y residencia de mayores; depuradora y renovables (placas, molinos); correos.
- Plenos hablados con IA; dilemas morales; fiestas de temporada organizadas por los vecinos (romería, San Juan, Navidad).
- Densidad de vivienda y VPO; cooperativa agraria.
- La comarca: pueblos vecinos con alcalde IA.

Cada versión se cierra como siempre: `pnpm sim`, capturas, ronda de 4–6 agentes, máx. 5 cambios y al menos uno aplazado. Planes detallados: `docs/propuestas/v2.2-*.md`, `v2.3-*.md`, `v2.4-*.md`.
