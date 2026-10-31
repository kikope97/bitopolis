# Bitópolis

Simulador de alcalde en pixel art donde los vecinos son agentes de IA. Se juega en el navegador (móvil primero).

## Instalación (5 líneas)

1. Copia [`docker-compose.yml`](docker-compose.yml) en Portainer (Stacks) o en una carpeta de tu servidor. No hay que rellenar nada.
2. Arranca: `docker compose up -d` (o "Deploy the stack" en Portainer).
3. Abre `http://tu-servidor:8080/admin` y entra con usuario **`admin`** y contraseña **`admin`**.
4. El panel te obliga a cambiar la contraseña la primera vez; después configura lo que quieras (IA, contraseña para jugar, URL…).
5. Abre `http://tu-servidor:8080/` y juega. Los datos y las copias diarias quedan en el volumen `/data`.

Imágenes: `ghcr.io/kikope97/bitopolis:latest` (última versión publicada), `:X.Y.Z` (cada versión) y `:test` (último `main`). Las versiones se publican solas al fusionar en `main` un cambio de `version` en `package.json`.

Lo ideal es ponerlo detrás de un proxy inverso con HTTPS: el enlace de cada partida funciona como su contraseña.

## Panel de administración (`/admin`)

La imagen **no usa variables de entorno**: todo se configura en `/admin` y los cambios valen al momento, sin reiniciar.

| Apartado | Qué se configura |
|---|---|
| **Partidas y acceso** | URL pública de los enlaces (en blanco, la del navegador) · permitir o no **partidas nuevas** (las que ya existen siguen funcionando; tampoco se puede importar) · **pedir contraseña para jugar**: una sola para todos, sin usuario, para que solo jueguen tus amigos y nadie más gaste tu API key. Tras 5 fallos se bloquea 15 minutos; la sesión dura 30 días; cambiarla cierra las sesiones abiertas. |
| **IA** | API key del servidor · modelos · vecinos con IA por partida (1–20) · topes de gasto (servidor al mes, partida al mes, partida al día) · si cada partida puede poner su propia key · endpoint propio y precios (avanzado) · botón **Probar la IA**. |
| **Partidas** | Lista con población, fecha y gasto de IA del mes; exportar o borrar. |
| **Copias de seguridad** | Cuántas se guardan (7 por defecto), hacer una ahora y descargarlas. |
| **Cuenta del administrador** | Usuario y contraseña del panel. |

El panel tiene su propio inicio de sesión (independiente de la contraseña para jugar), bloqueo tras 5 fallos y sesión de 12 horas. Las contraseñas se guardan con scrypt.

**Si olvidas la contraseña del panel:** crea un archivo vacío `reset-admin` en el volumen (por ejemplo `docker exec <contenedor> touch /data/reset-admin`, o desde la consola del contenedor en Portainer) y reinicia el contenedor. La cuenta vuelve a `admin`/`admin` con cambio obligatorio; el resto de ajustes, las partidas y las keys no se tocan.

**Mover el servidor:** copia la carpeta `/data` entera. Incluye `secret.key`, la clave que se genera sola la primera vez y cifra las API keys (AES-256-GCM). Sin ella, las keys guardadas dejan de valer y hay que volver a ponerlas.

### IA de los vecinos

Solo hace falta una **API key de Anthropic o de OpenAI**. No hay que elegir proveedor: se deduce de la key.

- `sk-ant-…` → **Anthropic** (Claude). Se crea en [console.anthropic.com](https://console.anthropic.com) › API keys y gasta el crédito de tu cuenta de Anthropic.
- `sk-…` → **OpenAI**. Se crea en [platform.openai.com](https://platform.openai.com) › API keys.

Hay dos maneras de dar la key. Sin key se juega en Modo normal.

1. **Para todo el servidor, en `/admin` → IA.** Todas las partidas pasan a Modo IA con esa key; en el juego solo hay que aceptar el aviso de gasto, y lo que fijes en el panel aparece en el juego como «definido por el servidor».
2. **Por partida, desde el juego.** Sin key del servidor (y si el panel lo permite), en **Configurar → Modo IA** hay un campo «API key». Debajo pone que se acepta key de Anthropic o de OpenAI, y al escribirla indica cuál ha detectado.

En los dos casos la key se guarda cifrada en el servidor y nunca vuelve al navegador; solo se ve enmascarada, por ejemplo `sk-ant-…abcd`. Tampoco sale en logs ni exportaciones.

Modelos (se puede poner cualquier otro que admita tu cuenta):

| Key | Decisiones (por defecto) | Premium: plenos, consejero y diario | Otros |
|---|---|---|---|
| Anthropic | `claude-haiku-5-5` | `claude-sonnet-5-5` | `claude-opus-5-5` |
| OpenAI | `gpt-5.4-nano` | `gpt-5.4-mini` | — |

Con Anthropic se usa el SDK oficial con salida estructurada (JSON validado con el esquema), caché de prompt y esfuerzo de razonamiento bajo, para gastar lo mínimo. Para un modelo local (Ollama, LM Studio), pon su endpoint compatible con OpenAI en «Avanzado»; no hace falta key.

**Topes de gasto.** Se comprueban en el servidor antes de cada llamada: el gasto previsto se reserva primero y, si no cabe, no se llama y deciden las reglas del juego. Se calculan en euros con una tabla de precios orientativos, que puedes corregir en «Avanzado» (€ por millón de tokens, por ejemplo `{"claude-haiku-5-5": {"in": 0.092, "cachedIn": 0.0092, "out": 0.46}}`). Pon también un límite de gasto en el panel de tu proveedor: es la última barrera si algo falla.

### Ajustes internos de la imagen

Vienen fijados en la imagen y no hace falta tocarlos: `PORT` (8080), `BITOPOLIS_DATA_DIR` (`/data`), `BITOPOLIS_CLIENT_DIR` y `BITOPOLIS_VERSION`. `LOG_LEVEL` (`info` por defecto) solo sirve para depurar.

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
