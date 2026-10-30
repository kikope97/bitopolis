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
- Login opcional (`auth.ts`) si hay `BITOPOLIS_USER` y `BITOPOLIS_PASSWORD`.
- Equilibrio del juego: todos los números en `packages/sim/src/balance.ts`.

## IA de los vecinos (v0.2)
- Motor: `sim/src/decisions.ts` (detonantes, acciones válidas, `CitizenAct`, reglas de fallback con motivos) y `sim/src/prompt.ts` (prompt con prefijo fijo, esquema con enums, validación zod). Una decisión pendiente vence a mediodía del día siguiente: si no ha llegado la de la IA, deciden las reglas.
- Servidor: `server/src/ai/` — `crypto.ts` (AES-256-GCM), `catalog.ts` (proveedores, modelos y precios orientativos), `providers.ts` (OpenAI-compatible, Anthropic, `ReplayProvider`), `service.ts` (petición anticipada al guardar, reintento, topes y reserva), `routes.ts`.
- `pnpm ai-eval` mide coste por mes de juego y % de válidas (simulador, `--replay` o `--live` con `BITOPOLIS_API_KEY`). El CI lo ejecuta con `e2e/fixtures/ia-replay.json`; si cambia el prompt, regenera con `--record`.
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
