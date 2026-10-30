# Bitópolis — guía para Claude

Spec completa: `docs/SPEC.md` (fuente de verdad). Rondas de agentes: `docs/rondas/`.
Responde y escribe la UI en español. Commits pequeños y claros.

## Arquitectura
Monorepo pnpm + TypeScript:
- `packages/shared` — tiempo de juego, comandos (zod), tipos de API. Puro.
- `packages/sim` — motor determinista. **Sin DOM, red, Node ni temporizadores.** PRNG sfc32 en `state.rng`; prohibidos `Math.random`, `Date.now`, `new Date` (lo impone ESLint). 1 tick = 1 hora; 1 día = 20 s a x1. Estado = JSON plano con `formatVersion` y migraciones en `migrations.ts` (cada una con test). El dinero solo se mueve con `transfer()` (money.ts); lo externo pasa por la cuenta `OUTSIDE` y queda en `ledger`. CLI en `packages/sim/cli`.
- `packages/server` — Fastify 5 + SQLite (better-sqlite3, WAL) con Kysely; migraciones en código (`src/db/migrations.ts`). Sirve el cliente compilado, `/healthz`, CSP estricta, rate limit, copias diarias en `/data/backups` (se guardan 7). Bundle con esbuild (`build.mjs`); deps npm externas.
- `packages/client` — Vite + Canvas 2D; la simulación corre en un Web Worker (`sim.worker.ts`). Paleta cerrada de 32 colores en `palette.ts`; `scripts/check-palette.ts` hace fallar el build si aparece otro color.

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
