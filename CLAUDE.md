# Bitópolis — guía para Claude

Spec completa: `docs/SPEC.md` (fuente de verdad). Rondas de agentes: `docs/rondas/`.
Responde y escribe la UI en español. Commits pequeños y claros.

## Arquitectura
Monorepo pnpm + TypeScript:
- `packages/shared` — tiempo de juego, comandos (zod), tipos de API. Puro.
- `packages/sim` — motor determinista. **Sin DOM, red, Node ni temporizadores.** PRNG sfc32 en `state.rng`; prohibidos `Math.random`, `Date.now`, `new Date` (lo impone ESLint). 1 tick = 1 hora; 1 día = 20 s a x1. Estado = JSON plano con `formatVersion` y migraciones en `migrations.ts` (cada una con test). El dinero solo se mueve con `transfer()` (money.ts); lo externo pasa por la cuenta `OUTSIDE` y queda en `ledger`. CLI en `packages/sim/cli`.
- `packages/server` — Fastify 5 + SQLite (better-sqlite3, WAL) con Kysely; migraciones en código (`src/db/migrations.ts`). Sirve el cliente compilado, `/healthz`, CSP estricta, rate limit, copias diarias en `/data/backups` (se guardan 7). Bundle con esbuild (`build.mjs`); deps npm externas.
- `packages/client` — Vite + Canvas 2D; la simulación corre en un Web Worker (`sim.worker.ts`), que al cerrar cada día emite un lote `{fromTick,toTick,commands,hash}`. `game.ts` (pantalla de juego, entrada táctil/ratón/teclado), `start.ts` (inicio, Configurar), `sprites.ts` (sprites modulares por código), `render.ts`, `tools.ts`, `tutorial.ts`, `hints.ts`. `window.__bitopolis` es un gancho de solo lectura para Playwright. Paleta cerrada de 32 colores en `palette.ts`; `scripts/check-palette.ts` hace fallar el build si aparece otro color.

## API (packages/server/src/games.ts)
- `GET /` → 302 a `/p/<token>` nuevo (22 base62). La partida solo se crea con `POST /api/games/:token` (Jugar).
- `POST /api/games/:token/claim` (423 si otra sesión la tiene; `force` la toma), `/release`.
- `PUT /api/games/:token/save`: el servidor **reproduce** los comandos sobre su estado y compara el hash; si no coincide, 409 con el estado bueno.
- `POST /api/games/:token/regenerate`, `GET /api/games/:token/export` (.bitopolis = JSON gzip sin API key), `POST /api/import`.
- Acceso con contraseña opcional (`auth.ts`), activable en `/admin` (solo contraseña, sin usuario: decisión del creador).

## Panel /admin (v1.2) — sin variables de entorno (decisión del creador)
- `server/src/settings.ts`: `SettingsStore` (una fila JSON en la tabla `settings`, en memoria; los cambios valen al momento), scrypt, `loadSecret` (`/data/secret.key`, cifra keys y firma cookies), `resetAdminIfAsked` (`/data/reset-admin`).
- `server/src/admin.ts`: `/api/admin/*` (login con bloqueo, `admin`/`admin` con cambio obligatorio, ajustes, probar IA, partidas, copias). Cliente: `admin.html` + `client/src/admin.ts`.
- `config.ts` solo tiene lo interno de la imagen (PORT, DATA_DIR, CLIENT_DIR, VERSION). No añadas variables de entorno: añade el ajuste a `ServerSettings` y al panel.
- e2e: `e2e/admin.spec.ts` usa su propio servidor (puerto 8091) porque cambia ajustes globales.
- Equilibrio del juego: todos los números en `packages/sim/src/balance.ts`.

## IA de los vecinos (v0.2)
- Motor: `sim/src/decisions.ts` (detonantes, acciones válidas, `CitizenAct`, reglas de fallback con motivos) y `sim/src/prompt.ts` (prompt con prefijo fijo, esquema con enums, validación zod). Una decisión pendiente vence a mediodía del día siguiente: si no ha llegado la de la IA, deciden las reglas.
- Proveedor deducido de la key (`providerFromKey`: `sk-ant-…` Anthropic, resto OpenAI; con endpoint propio, compatible con OpenAI). No hay selector de proveedor (decisión del creador). La IA del servidor se configura en `/admin`.
- Servidor: `server/src/ai/` — `crypto.ts` (AES-256-GCM), `catalog.ts` (proveedores, modelos y precios orientativos), `providers.ts` (OpenAI-compatible, Anthropic con el SDK oficial `@anthropic-ai/sdk` y `output_config` (salida estructurada, esfuerzo bajo; sin `tool_choice` forzado ni `temperature`), `ReplayProvider`), `service.ts` (petición anticipada al guardar, reintento, topes y reserva), `routes.ts`.
- `pnpm ai-eval` mide coste por mes de juego y % de válidas (simulador, `--replay` o `--live` con `BITOPOLIS_API_KEY`, solo herramienta de desarrollo). El CI lo ejecuta con `e2e/fixtures/ia-replay.json`; si cambia el prompt, regenera con `--record`.
- Playwright usa `e2e/fake-llm.mjs` (LLM falso compatible con OpenAI) para el Modo IA.

## Economía (v0.3)
- `sim/src/economy.ts`: IBI, tasas y plusvalía con el nivel medio del mes (un solo control hasta `TAX_SPLIT_POP` vecinos), memoria fiscal (`grudge`) por grupo, vivienda en propiedad con hipoteca, venta de vivienda municipal en cuotas al ayuntamiento, empresas fundadas por vecinos.
- `sim/src/fields.ts`: campos de contaminación, ruido, delincuencia (la policía la baja) y valor del suelo; el cliente los dibuja como capas (`client/src/layers.ts`).
- Cliente: `economy-ui.ts` (tributos con glosario y «a quién afecta», parte mensual, lista de vecinos).

## Vida social (v0.4)
- `sim/src/social.ts`: relaciones simétricas (máx. 5), memoria en 3 capas (recuerdos como datos, resumen narrativo, rasgos), director de historias (ganchos, máx. 3), plenos con peticiones y promesas (`PLENO_COST`, uno al mes), «Hablar» por reglas, `OBJECTIVES` con recompensas e hitos (Plaza Mayor a 50, Mercado a 200).
- `sim/src/narrative.ts`: consejero y diario por reglas (Modo normal). En `prompt.ts`, `buildTalkRequest`, `buildAdvisorRequest`, `buildChronicleRequest` y `parseText` (solo admite números que estén en los datos).
- Servidor: `POST /api/games/:token/talk`, `/advisor` y `/chronicle` (crónica en caché), con reserva de gasto en `service.text()`.
- Cliente: `social-ui.ts` (ficha con «Hablar», pleno, consejero, diario, objetivos, «Desde tu última visita»).

## Elecciones (v1.0)
- `sim/src/politics.ts` (+ `politics-core.ts`, sin dependencias, para evitar ciclos con `state.ts`): facciones (`factionOf`) con exigencias medidas en el pueblo, intención de voto determinista (`tally`, sin azar), avisos a 12/6/3/1 meses, oposición emergente (`OPPOSITION_APPROVAL`), elecciones cada `ELECTION_MONTHS`, gobierno rival (`rivalGovern` vía `governmentCommand`) y la oposición del jugador (solo `TalkTo`, `Campaign`, `NotifyProject` y `CitizenAct`). Luna de miel de 12 meses. Activa desde `OPPOSITION_POP` vecinos.
- Detonante `elecciones` en `decisions.ts`: los vecinos con nombre eligen `votar_gobierno`, `votar_oposicion` o `abstenerse` (IA o reglas); el prompt recibe la política como datos.
- Cliente: `politics-ui.ts` (indicador 🗳, hoja de política, noche electoral).

## Historias, política e interfaz (v1.3)
- `social.ts`: `resolveHooks` (desenlaces), `meetingPlace` (amistades de barrio), `memoryLine` (frases que recuerdan). Una amistad nueva no expulsa a otra.
- `politics.ts`: `rivalAct` y `politics.log` (formato 8), impuestos del rival con margen; pregunta de la oposición en `convenePleno` (cuenta como campaña).
- `economy.ts`: `serviceSaturation` y `saturated` (`SERVICE_CAPACITY`, margen del 90 %, las obras cuentan).
- `prompt.ts`: `toneOf` e `inventedName` (lista de nombres en `names.ts`, palabras enteras sin tildes). PROMPT_VERSION 3.
- Cliente: farolas en `render.ts`, `skyline.ts` animado, `icons.ts` (iconos de píxeles), avisos agrupados, atajos de una tecla desactivables (`prefs.shortcuts`).

## Móvil y táctil (v1.4) — la norma principal: se juega bien en el móvil
- `game.ts`: `ResizeObserver` en el canvas; en táctil toda obra pasa por `proposePlace` y la barra `#confirm-bar` («Construir / ✕», ignora sus primeros 350 ms; el canvas cancela `touchend` para evitar el clic fantasma). Con carretera o zona, un dedo mueve el mapa (se traza con dos toques o arrastrando desde el inicio). `pickTile` (tejados), inercia. Zoom: se aleja hasta `minZoom` (≈11 px por casilla en iPhone, v1.6.1); para obras con el dedo hace falta `touchZoom` (24 px CSS): por debajo, el primer toque acerca.
- `#play-pause` y `#speed` (x1→x3→x10) están en la barra de arriba (v1.6). En los e2e, usa `setSpeed(page, n)` de `e2e/helpers.ts`.
- Hojas (`ui.ts`): solo se refresca la que está abierta (`currentSheet()`); atrás cierra la hoja (`history`).
- A x10 no hay burbujas ni avisos menores. Los toques reales se prueban por CDP en `e2e/tactil.spec.ts`.

## Ayuntamiento y ciclo vital (v1.5)
- `sim/src/lifecycle.ts`: `lifeYear` (cumpleaños, hijos que se independizan a los `KID_YEARS`), `lifeDay` (despedidas repartidas por el año, una por semana como mucho), `lifeMonth` (nacimientos), `dies` y `heirOf` (herencia a la pareja con plusvalía; si no, a la familia de fuera). `Citizen.kids` son ticks de nacimiento; cuentan para el colegio.
- `sim/src/civic.ts`: presupuesto anual (`ProposeBudget`, votado por facciones o, sin ellas, por felicidad; `BUDGET` en balance.ts), fiestas (`HoldFestival`, `FESTIVAL`) y subvenciones (`AnswerGrant`; anticipo, resto en plazo, reintegro). Formato de partida 9.
- Cliente: `civic-ui.ts` (hoja «Ayuntamiento»; `openTownHall(ctx, sección)`).

## Rediseño de la interfaz (v1.6) — ronda 12, revisada en 5 dispositivos
- Pantalla: `.topbar` (⏯, velocidad, 💰, 👥, ☺, 🔔; cada dato se toca), mapa sin nada fijo encima (solo el chip de capas y «?»; el zoom +/− solo con ratón), `#strip` (franja de contexto con `data-mode` info/tool/confirm: fecha y R/C/I o progreso a las zonas, ayuda de la herramienta, barra «Construir / ✕»; el derribo también se confirma ahí, en rojo) y `#dock` con 5 pestañas (`#tab-inspect`, `#tab-road`, `#tab-build`, `#tab-demolish`, `#menu` = Pueblo).
- `#tray`: bandeja «Construir» por categorías (`TRAY` en tools.ts) con precio; lo bloqueado explica qué falta. En los e2e, `pickTool(page, id)`.
- Panel «Pueblo» (`openHub`): Dinero, Ayuntamiento, Gente, Objetivos, Ajustes. Las hojas abiertas desde ahí llevan «‹» (`withBack` en ui.ts). Hojas `.half` para fichas; `revealTile` deja el edificio a la vista. En tableta (≥720×540) y en horizontal, las hojas son un panel lateral.
- Avisos: uno a la vez bajo la barra de arriba; todos quedan en la campana (`toastLog`, `openLog`).
- Iconos de píxeles 12×12 en `icons.ts` (`pixelIcon`). Escala de la interfaz con `--ui` (texto 150/200 %).
- La sesión es del dispositivo (`localStorage`), no de la pestaña.

## Geografía, tiempo y vida social (v1.7) — formato de partida 10
- `sim/src/terrain.ts`: `map.terrain` (0 llano, 1 río, 2 mar, 3 colina); `generateTerrain` deja el centro en llano. En el río solo puentes (`roadCost`, `TERRAIN.bridgePerTile`); en el mar nada; colina con materiales ×1,5 (`buildCostAt`, `materialsCost(state, kind, x, y)`). Suelo junto al agua y en alto vale más; bomba junto al río +25 % (ronda 13). Contaminación: `FIELDS.pollutionDecay` en balance.ts.
- `sim/src/weather.ts`: `state.weather` por estación (`seasonOf`); nieve (obras a la mitad, central −15 %, quitanieves), calor (bomba −10 %, sin sombra resta), tormenta (`flood`: riadas en la orilla, las paga el ayuntamiento). Un mes de gracia al empezar (`WEATHER.graceDays`).
- Lugares de vida social: `bar`, `chapel`, `cemetery`, `library`, `sports` (`SOCIAL_PLACES` en balance.ts): amistades en el bar, fiestas con ermita, duelo con cementerio, biblioteca para prosperar, polideportivo y salud de los mayores.
- `sim/src/associations.ts`: asociaciones vecinales por queja compartida (`grievanceOf`), manifestación si se les ignora (detonante `protesta`, decide el líder y hasta 5 socios), `MeetAssociation` promete en 3 meses. PROMPT_VERSION 4.
- `sim/src/coverage.ts` (propuesta del creador): `missingServices`/`coverageSummary`; capa «Qué falta» (`layers.ts`, iconos sobre cada vivienda), avisos en la ficha y en el «?».
- `sim/src/album.ts` (momentos del pueblo) y `family.ts` (`parents`, `departed`, `familyOf`). Cliente: `album-ui.ts` (álbum con fotos guardadas en el navegador y postales; árbol familiar desde la ficha).
- Arte: `waterTile`, `seaTile`, `hillTile`, `bridgeTile`, `snowGrass`, `snowify` y los 5 edificios en `sprites.ts`; iconos del tiempo y de servicios en `icons.ts`. El render dibuja lluvia y nieve sin destellos y la manifestación ante el ayuntamiento.

## Comandos
```
pnpm install | pnpm dev | pnpm build | pnpm lint | pnpm typecheck | pnpm test
pnpm invariants                     # CI: conservación del dinero, hash determinista
pnpm sim --seed 42 --days 365 --profile casual --out report.json
pnpm e2e                            # Playwright, viewport móvil y escritorio; capturas en test-results/capturas
```

## Reglas
- Toda acción es un `Command` serializable validado por el motor. La IA elige entre acciones válidas; nunca toca números.
- Nunca pasar texto libre del jugador al LLM. La API key nunca vuelve al cliente ni sale en logs/exportaciones.
- Decisiones del creador (spec §2, §10, §11, §12) no se cambian.
- Al cerrar cada versión: métricas con `pnpm sim`, capturas Playwright, ronda de 4–6 agentes, máx. 5 cambios aceptados y al menos uno quitado/aplazado; registrar en `docs/rondas/ronda-XX.md`.
- CI: en ramas, checks + build de imagen amd64; en `main`, publica `ghcr.io/<owner>/bitopolis:test` y `:sha-*` (amd64+arm64); en tags `vX.Y.Z`, `:X.Y.Z` y `:latest`.
- **Publicar una versión**: subir `version` en el `package.json` raíz y fusionar en `main`. Si esa versión no tiene etiqueta, el CI publica `:X.Y.Z` y `:latest` y crea la release `vX.Y.Z` en la misma ejecución (`scripts/release-check.sh`).

## Ayuntamiento, delincuencia y animaciones (v1.8) — formato de partida 11
- `sim/src/townhall.ts`: `state.townhallLevel` (1–5, `TOWNHALL_LEVELS`), `UpgradeTownhall`. Cada obra pide nivel (`BUILD_LEVEL`) **y** sus vecinos (`unlockPop`); zonas y plenos desde el nivel 2. Mantenimiento del ayuntamiento × nivel; el 5 da +2 de felicidad y más subvenciones.
- `sim/src/crime.ts`: robos en tiendas según la delincuencia, `tryArrest` con calabozos por comisaría (`CRIME.cellsPerStation`), cárcel (`jail`), puntos calientes. `barrio.ts` (`barrioOf`) nombra las asociaciones; las manifestaciones crecen y, tras `riotAfter`, hay disturbios que destrozan tiendas (`damaged`, `RepairBuilding`).
- Cliente: `manage-ui.ts` (al tocar el ayuntamiento, panel «Gestión del pueblo» a pantalla completa, `.sheet.full`), calendario `#calendar` a x3/x10, `attention()` en game.ts (destello, temblor y vuelta a x1, como mucho cada 45 s), animaciones en `render.ts` (`drawProtest`, `drawPolice`, `drawThief`, `drawHighlight`) con sprites `marcherSprite`, `policeSprite`, `thiefSprite`, `damagedSprite`, `townhallSprite(nivel)`.
- Herramientas bloqueadas: `lockShort`/`lockLong` en tools.ts explican el nivel o los vecinos que faltan.
- `sim/src/levels.ts` (ronda 14, petición del creador): servicios por niveles (`UPGRADABLE`, `UpgradeBuilding`, `Building.level`/`upgradeUntil`). Usa siempre `radiusOf`, `serviceCapacityOf`, `plantCapacityOf`, `cellsOf`, `jailPlacesOf`, `jobsOf`, `maintenanceOf` en vez de leer `SERVICE`/`PLANT_CAPACITY` directamente. Números en `SERVICE_LEVELS` (balance.ts). Ficha: `levelBox` en game.ts; dibujo: `serviceSprite(kind, id, nivel)`.

## Economía de cada vecino (v1.9) — formato de partida 12
- `sim/src/household.ts` (petición del creador): cada vecino tiene su balance (`flow` lo anota `transfer`, `last` el mes pasado) y su deuda (`debt.town` con el ayuntamiento, `debt.bank` con banco o casero). Todo cobro obligatorio pasa por `charge()`: lo que no puede pagar queda como deuda. La deuda se conserva (`state.debtLedger`, invariante en `invariants.ts`). Orden de fin de mes en `tick.ts`: sueldos (municipales y `businessPayroll`) → paro (`outsideJobsMonth`) → gasto básico → vivienda y tributos (`monthlyHousing`) → devoluciones, recargo, intereses y ocio (`settleMonth`) → desahucios y embargos (`housingTroubles`) → dividendos y cierres.
- Números en `balance.ts`: `DEBT`, `LIVING_BASIC`/`LIVING_EXTRA`/`LIVING_CUSHION`, `MIN_WAGE` (sueldo mínimo, `SetMinimumWage`), `MIN_WAGE_FX`, `JOBS_OUTSIDE` (paro real con prestación), `MICROCREDIT`, `CRIME.home*`/`local*`.
- Comandos: `SetMinimumWage`, `SettleDebt` (aplazar/perdonar), `GrantMicrocredit`. Decisión `deudas` (apretarse, pedir_aplazamiento, irse, aceptar_trabajo); el prompt recibe la deuda por tramos (`debtBand`), nunca la cifra. PROMPT_VERSION 5.
- Empresas: `b.books` (ventas, sueldos, impuestos del mes pasado), `b.staff` (recortan plantilla antes de cerrar), `foundSeed` (caja para una nómina al sueldo vigente). Delincuencia: robos en casas y ladrones del pueblo (`crime.ts`, antecedentes, multas como deuda, cárcel con presos identificados).
- Cliente: `money-ui.ts` (bloque «Su bolsillo» con Aplazar/Perdonar/Microcrédito, `economyLines` para el parte y «Gestión del pueblo»), sueldo mínimo en `economy-ui.ts`, filtro «Con deudas», capa `pocket` en `layers.ts`.

## La superIA del pueblo (2.0) — formato de partida 13, TURN_PROMPT_VERSION 8
- **Norma del creador**: en cada versión, además del motor para el Modo normal, meter con IA todo lo posible (es la gracia del juego). La IA elige quién, qué y cuándo; el motor decide cuánto y si sale bien, y las reglas deciden si la IA no responde.
- `sim/src/turns.ts`: `state.ai` (`TownAi`). Cada semana de juego (`SetTurnPace`: 7/14/28 días a x1/x3/x10) se abre un turno; vence a las `TURN.dueHours` y, sin respuesta, decide `ruleTurn` (decisions.ts). Vecino con IA = Modo IA + con nombre (`SetAiShare` solo sube; `aiByShare` por hash). Menú por vecino (`turnMenu`: trabajo, mudarse, negocio, asociaciones, pedir, tener hijo, robar si está desesperado…), gesto social, actitud (−2…2, mueve el voto), gasto (`spending`, lo usa `household.ts`), plan o ultimátum (`plansDay`), pensamiento y notas (`notes`, 4). Reacción rápida tras una medida gorda (`noteMayor`). Contagio de actitud a los vecinos por reglas (`spreadAttitude`).
- `sim/src/director.ts` (+ `director-core.ts` sin dependencias): menú de sucesos reales (robos, asociaciones, manifestaciones, peleas, reconciliaciones, encuentros, ayudas, gratitud, rumores, mitin de la oposición, historias), `dramaBudget` (descontento, `DIRECTOR` en balance.ts), lo malo solo tras un aviso previo (`brewing`, «Se está cociendo»). Con director, `directorOwns` apaga los dados de robos de fuera, asociaciones nuevas, manifestaciones por impaciencia e historias; sin él vuelven (respaldo).
- `sim/src/turn-prompt.ts`: `TURN_SYSTEM`, `turnShared` (bloque común cacheado, igual en todos los lotes), `buildTurnRequest`, `parseTurn`, `buildDirectorRequest`, `parseDirector`. Todo llega al motor en un único comando `TownTurn` (acts, director, foco, crónica) que el servidor reproduce.
- Servidor (`ai/service.ts`): `onTurn` al guardar → lotes de `TURN_BATCH` y director, todos a la vez; segunda pregunta a los que falten; `GET /api/games/:token/turn/:n`. Escalera de gasto: «Calidad» (Sonnet por defecto para vecinos y director) → al 70 % de un tope, el modelo barato y el director un turno sí y otro no (`SAVING_AT`) → en el tope, reglas. `/admin`: «Turnos del pueblo» (`turnQuality`), «% de vecinos que piensan con IA» (`aiShare`), modelos desde la API.
- Cliente: el worker se para en `turn.due` hasta que llega el turno o pasan 45 s (`release`); chip ✦ pensando; aviso semanal (`turnHeadline`); «Qué está pasando» (`ai-town-ui.ts`) con avisos, planes, crónica y el porqué de cada vecino; «Lo que piensa» en la ficha (`mindBox`).
- Ronda 16: el servidor solo acepta el `TownTurn` que respondió su IA (`games.ts`, si no 409); la key guardada nunca va a otro endpoint; plazo total del turno 40 s (`TURN_DEADLINE_MS`); cupo de drama gradual por mes y sucesos «debidos» (`owed`); ultimátums solo por la necesidad principal (`planAllowed`).
- `pnpm ai-eval` (turnos + director): `--live` con `BITOPOLIS_API_KEY` (y `BITOPOLIS_AI_MODEL`, `BITOPOLIS_AI_DIRECTOR_MODEL`), `--record`/`--replay`. Con `--replay`, falla si el prompt ya no cuadra con la grabación: hay que volver a grabar.
- e2e: `ia-turnos.spec.ts` (turno y director con el LLM falso), `ia-caida.spec.ts` (IA caída: «por costumbre»). Puertos de Playwright configurables (`PW_PORT`, `PW_ADMIN_PORT`).

## Emergencias y encargos (2.1) — formato de partida 14, TURN_PROMPT_VERSION 9
- `sim/src/fire.ts`: riesgo con aviso (`b.risk`, `FIRE.riskHours`), fuego (`b.fire`) que salta, parque de bomberos (`firestation`, niveles en levels.ts), edificio `damaged` con `cause: 'fuego'` (`burntDown`, se repara con `RepairBuilding`); protección civil (`civilprotection`, `BuildDike`, `state.dikes`, voluntarios), ambulancia (nivel 2 de `clinic`). Lo destrozado no actúa (filtra `!b.damaged`).
- `sim/src/trash.ts` (+ `trash-core.ts`): `b.trash`, `fields.dirt`, punto limpio (`cleanpoint`) con camión por la red (`truckRoutes`, `trashServed`), tasa solo a quien tiene recogida, `state.trash.start` (empieza con el punto limpio desbloqueado y `TRASH.warnDays` de aviso).
- `sim/src/errands.ts`: encargos (`errandCandidates`, `AnswerErrand`, `ERRANDS`); `sim/src/press.ts`: El Eco (`weekNews`, `publishEdition`, `AnswerPress`, `PRESS`). El director los escribe en Modo IA (`titulares` ligados a una noticia o a un suceso que pasa, `encargo` con carta).
- `sim/src/rank.ts` (+ `rank-core.ts`): rangos (`RANKS`), escudo por código, votación (`rankCandidates`; en Modo IA los votos van en `acts[].escudo` del `TownTurn`). Cliente: `rank-ui.ts`, `crest.ts`, `away-ui.ts` («Mientras no estabas»), `town-news-ui.ts` (encargos y El Eco).
- Migración 13→14: `migrate14Fire`, `migrate14Errands`, `migrate14Rank`, `migrate14Trash` encadenadas (cada parte en su función).
- e2e: `incendios`, `basura`, `rangos`, `encargos`. Planes de lo siguiente: `docs/propuestas/v2.2-*`, `v2.3-*`, `v2.4-*`.
