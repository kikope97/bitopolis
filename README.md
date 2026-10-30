# Bitópolis

Simulador de alcalde en pixel art donde los vecinos son agentes de IA. Se juega en el navegador (móvil primero).

## Instalación (5 líneas)

1. Copia [`docker-compose.yml`](docker-compose.yml) en Portainer (Stacks) o en una carpeta de tu servidor.
2. Cambia `BITOPOLIS_MASTER_KEY` por una clave larga y aleatoria (`openssl rand -base64 32`).
3. Pon en `BITOPOLIS_PUBLIC_URL` la URL con la que entrarás (idealmente detrás de un proxy con HTTPS).
4. Arranca: `docker compose up -d` (o "Deploy the stack" en Portainer).
5. Abre la URL. Los datos y las copias diarias quedan en el volumen `/data`.

Imágenes: `ghcr.io/kikope97/bitopolis:latest` (última versión publicada), `:X.Y.Z` (cada versión) y `:test` (último `main`). Las versiones se publican solas al fusionar en `main` un cambio de `version` en `package.json`.

## Variables de entorno

Todas son opcionales salvo las dos primeras. Lo que se define por variable **manda**: en el juego aparece en solo lectura («definido por el servidor») y no se puede cambiar desde Configurar.

### Básicas

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `BITOPOLIS_MASTER_KEY` | — (**obligatoria**) | Cifra (AES-256-GCM) las API keys que se guardan desde el juego. Si la pierdes o la cambias, las keys guardadas dejan de valer y hay que volver a ponerlas. Genera una con `openssl rand -base64 32`. |
| `BITOPOLIS_PUBLIC_URL` | `http://localhost:8080` | URL con la que se entra al juego; se usa para los enlaces de las partidas. |
| `PORT` | `8080` | Puerto del servidor dentro del contenedor. |
| `BITOPOLIS_PASSWORD` | — | Si la pones, todo el servidor pide esta contraseña al entrar; solo la contraseña, sin usuario. Sirve para que solo jueguen tus amigos y nadie más gaste tu API key si abres el juego a internet. Tras 5 fallos se bloquea 15 minutos y la sesión dura 30 días. Si la cambias, se cierran todas las sesiones. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error`. Las API keys no salen nunca en los logs. |

### IA de los vecinos

Solo hace falta una **API key de Anthropic o de OpenAI**. No hay que elegir proveedor: se deduce de la key.

- `sk-ant-…` → **Anthropic** (Claude). Se crea en [console.anthropic.com](https://console.anthropic.com) › API keys y gasta el crédito de tu cuenta de Anthropic.
- `sk-…` → **OpenAI**. Se crea en [platform.openai.com](https://platform.openai.com) › API keys.

Hay dos maneras de dar la key. Sin key se juega en Modo normal.

1. **Desde el juego (sin tocar el Docker).** Si `BITOPOLIS_API_KEY` no está definida, en **Configurar → Modo IA** hay un campo «API key». Debajo pone que se acepta key de Anthropic o de OpenAI, y al escribirla indica cuál ha detectado. La key se guarda cifrada en el servidor y nunca vuelve al navegador; solo se ve enmascarada, por ejemplo `sk-ant-…abcd`.
2. **Para todo el servidor, en el `docker-compose.yml`.** Con `BITOPOLIS_API_KEY` todas las partidas usan esa key, y en Configurar solo hay que aceptar el aviso de gasto.

| Variable | Valores | Para qué sirve |
|---|---|---|
| `BITOPOLIS_API_KEY` | `sk-ant-…` o `sk-…` | API key para todo el servidor. El proveedor sale de la key. |
| `BITOPOLIS_AI_MODEL` | ver tabla | Opcional. Modelo para las decisiones diarias de los vecinos (muchas llamadas pequeñas). Si falta, el de serie del proveedor. |
| `BITOPOLIS_AI_MODEL_PREMIUM` | ver tabla | Opcional. Modelo para el consejero, la crónica del diario y los plenos (pocas llamadas). Si falta, se usa `BITOPOLIS_AI_MODEL` y, si tampoco está, el premium de serie. |
| `BITOPOLIS_AI_BASE_URL` | URL | Solo para un modelo local compatible con OpenAI (Ollama, LM Studio). Con esta variable no hace falta key. |
| `BITOPOLIS_AI_MAX_CITIZENS` | `1`–`20` (por defecto `20`) | Cuántos vecinos con nombre deciden con IA. |

Modelos (se puede poner cualquier otro que admita tu cuenta; los modelos también se pueden cambiar por partida en Configurar → Opciones avanzadas):

| Key | Decisiones (por defecto) | Premium (por defecto) | Otros |
|---|---|---|---|
| Anthropic | `claude-haiku-5-5` | `claude-sonnet-5-5` | `claude-opus-5-5` |
| OpenAI | `gpt-5.4-nano` | `gpt-5.4-mini` | — |

Con Anthropic se usa el SDK oficial con salida estructurada (JSON validado con el esquema), caché de prompt y esfuerzo de razonamiento bajo, para gastar lo mínimo.

### Topes de gasto

Se comprueban **en el servidor antes de cada llamada**: el gasto previsto se reserva primero y, si no cabe, no se llama y deciden las reglas del juego. Las cantidades son en euros y se calculan con la tabla de precios orientativos.

| Variable | Ejemplo | Para qué sirve |
|---|---|---|
| `BITOPOLIS_BUDGET_SERVER_MONTHLY_EUR` | `10` | Tope mensual de todo el servidor (todas las partidas juntas). |
| `BITOPOLIS_BUDGET_GAME_MONTHLY_EUR` | `5` | Tope mensual por partida. Si no lo pones, cada partida elige el suyo en Configurar. |
| `BITOPOLIS_BUDGET_GAME_DAILY_EUR` | `0.5` | Tope diario por partida. |
| `BITOPOLIS_AI_PRICES_JSON` | `{"claude-haiku-5-5": {"in": 0.092, "cachedIn": 0.0092, "out": 0.46}}` | Sustituye precios de la tabla incluida (€ por millón de tokens de entrada, de entrada en caché y de salida). Úsalo si cambian los precios o usas un modelo que no está en la tabla. |

Pon también un límite de gasto en el panel de tu proveedor: es la última barrera si algo falla.

### Ejemplo: key de Anthropic para todo el servidor

```yaml
    environment:
      BITOPOLIS_MASTER_KEY: "una-clave-larga-y-aleatoria"
      BITOPOLIS_PUBLIC_URL: "https://bitopolis.example.com"
      BITOPOLIS_API_KEY: "sk-ant-..."
      BITOPOLIS_AI_MODEL: "claude-haiku-5-5"
      BITOPOLIS_BUDGET_SERVER_MONTHLY_EUR: "10"
```

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
