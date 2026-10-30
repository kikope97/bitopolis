# syntax=docker/dockerfile:1
# ---- build: compila el cliente (Vite) y empaqueta el servidor (esbuild) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/sim/package.json packages/sim/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
# Sin scripts: aquí no hace falta compilar better-sqlite3.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

# ---- deps: dependencias de producción del servidor (con módulo nativo) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/packages/server/dist/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM node:22-bookworm-slim
ARG VERSION=dev
ENV NODE_ENV=production \
    PORT=8080 \
    BITOPOLIS_DATA_DIR=/data \
    BITOPOLIS_CLIENT_DIR=/app/client \
    BITOPOLIS_VERSION=$VERSION
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/server/dist ./
COPY --from=build /app/packages/client/dist ./client
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "index.js"]
