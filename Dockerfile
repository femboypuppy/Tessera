# syntax=docker/dockerfile:1.7
#
# Tessera server image: the sync and API server (apps/server) serving the web app (apps/web).
# One container is the whole product. Owner: Agent 07 (Desktop & self-host).
#
#   docker build -t tessera .
#   docker run -d -p 8787:8787 -v tessera-data:/data tessera
#
# Multi-arch: docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/<owner>/tessera .

ARG NODE_VERSION=24.15.0
ARG ALPINE_VERSION=3.22
ARG PNPM_VERSION=11.9.0

# ---------------------------------------------------------------------------------------------
# 1. Dependencies: download by lockfile (cached until pnpm-lock.yaml changes), then install.
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    # No browsers for Playwright, no telemetry.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_update_notifier=false
# Toolchain for native modules (better-sqlite3, argon2) when no prebuilt binary matches.
RUN apk add --no-cache python3 make g++ \
 && npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile --offline

# ---------------------------------------------------------------------------------------------
# 2. Build the web app and the server, then a production-only copy of the server.
# ---------------------------------------------------------------------------------------------
FROM deps AS build
RUN pnpm --filter @tessera/web build \
 && pnpm --filter @tessera/server build
# `pnpm deploy` writes the server with only its production dependencies (native modules
# included). Workspace packages are bundled into dist/ by tsdown, so they aren't needed at runtime.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm --filter @tessera/server deploy --prod --legacy /out/apps/server \
 && rm -rf /out/apps/server/src /out/apps/server/*.config.ts /out/apps/server/tsconfig.json \
 && mkdir -p /out/apps/web \
 && cp -r apps/web/dist /out/apps/web/dist \
 && find /out -name '*.map' -delete
# Slim the native modules: prebuilt binaries for other platforms, and the C/C++ sources and
# build intermediates of addons (a compiled addon keeps only build/Release/*.node). Then check
# that both native modules still load.
COPY <<'EOF' /tmp/prune.mjs
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const keepPrebuild = (name) => name.includes('linux') && name.includes(`-${process.arch}`);
const hasJs = (dir) =>
  readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory() ? hasJs(path.join(dir, entry.name)) : /\.[cm]?js$/.test(entry.name),
  );
const remove = (target) => rmSync(target, { recursive: true, force: true });

function prune(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some((entry) => entry.name === 'binding.gyp')) {
    for (const sources of ['deps', 'src']) {
      const target = path.join(dir, sources);
      if (existsSync(target) && !hasJs(target)) remove(target);
    }
    const build = path.join(dir, 'build');
    if (existsSync(build)) {
      for (const name of readdirSync(build)) if (name !== 'Release') remove(path.join(build, name));
      const release = path.join(build, 'Release');
      if (existsSync(release))
        for (const name of readdirSync(release)) if (!name.endsWith('.node')) remove(path.join(release, name));
    }
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && entry.name === 'prebuilds') {
      for (const name of readdirSync(full)) if (!keepPrebuild(name)) remove(path.join(full, name));
    } else if (entry.isDirectory()) {
      prune(full);
    } else if (/\.d\.[cm]?ts$/.test(entry.name)) {
      remove(full);
    }
  }
}

prune(process.argv[2]);
EOF
RUN node /tmp/prune.mjs /out \
 && cd /out/apps/server \
 && node -e "require('better-sqlite3')(':memory:').prepare('select 1').get(); require('argon2')"

# ---------------------------------------------------------------------------------------------
# 3. Runtime: plain Alpine with only the node binary (no npm, corepack or yarn: 22 MB less),
#    a non-root user, and the data in /data.
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS node

FROM alpine:${ALPINE_VERSION} AS runtime
LABEL org.opencontainers.image.title="Tessera" \
      org.opencontainers.image.description="Local-first knowledge app: sync server and web app" \
      org.opencontainers.image.source="https://github.com/femboypuppy/Tessera" \
      org.opencontainers.image.licenses="MIT"
# libstdc++/libgcc: what the node binary links against. tini forwards signals (a graceful
# shutdown flushes the database) and reaps zombies.
RUN apk add --no-cache libstdc++ libgcc tini su-exec \
 && addgroup -g 1000 node \
 && adduser -u 1000 -G node -s /bin/sh -D node \
 && mkdir -p /data \
 && chown node:node /data
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
# Same layout as the repository: apps/server/dist/../../web/dist is the web build.
COPY --from=build --chown=node:node /out/apps /app/apps
COPY --chmod=755 <<'EOF' /usr/local/bin/tessera-server
#!/bin/sh
# The server CLI: `tessera-server` starts it; subcommands (create-owner, backup, restore) are the
# server's (apps/server/README.md).
exec node /app/apps/server/dist/main.js "$@"
EOF
COPY --chmod=755 <<'EOF' /usr/local/bin/docker-entrypoint
#!/bin/sh
# By default the container starts as `node` and runs the command directly. Some platforms mount
# volumes owned by root (Fly.io, Railway, Render); started as root there, the entrypoint gives
# the data folder to `node` once, then drops privileges. The server never runs as root.
set -e
if [ "$(id -u)" = "0" ]; then
  data="${DATA_DIR:-/data}"
  mkdir -p "$data"
  if [ "$(stat -c %u "$data")" != "1000" ]; then
    chown -R node:node "$data"
  fi
  exec su-exec node "$@"
fi
exec "$@"
EOF
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint"]
CMD ["tessera-server"]
