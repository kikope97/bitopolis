# Bitópolis

Simulador de alcalde en pixel art donde los vecinos son agentes de IA. Se juega en el navegador (móvil primero).

## Instalación (5 líneas)

1. Copia [`docker-compose.yml`](docker-compose.yml) en Portainer (Stacks) o en una carpeta de tu servidor.
2. Cambia `BITOPOLIS_MASTER_KEY` por una clave larga y aleatoria (`openssl rand -base64 32`).
3. Pon en `BITOPOLIS_PUBLIC_URL` la URL con la que entrarás (idealmente detrás de un proxy con HTTPS).
4. Arranca: `docker compose up -d` (o "Deploy the stack" en Portainer).
5. Abre la URL. Los datos y las copias diarias quedan en el volumen `/data`.

Imágenes: `ghcr.io/kikope97/bitopolis:latest` (versiones publicadas) y `:test` (último `main`).

## Desarrollo

```bash
pnpm install
pnpm dev          # servidor (8080) + cliente Vite (5173)
pnpm test         # Vitest
pnpm invariants   # 365 días × semillas × perfiles
pnpm sim --seed 42 --days 365 --profile casual --out report.json
pnpm e2e          # Playwright (móvil y escritorio)
```

La especificación completa está en [`docs/SPEC.md`](docs/SPEC.md).
