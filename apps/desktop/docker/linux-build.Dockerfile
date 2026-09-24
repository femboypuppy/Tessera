# syntax=docker/dockerfile:1.7
#
# Builds the Linux desktop bundles (.deb, .rpm, AppImage) in a clean Debian with the Tauri
# prerequisites, from any machine with Docker:
#
#   node apps/desktop/scripts/build-linux-in-docker.mjs      # bundles land in apps/desktop/dist/linux
#
# (docker build -f apps/desktop/docker/linux-build.Dockerfile --target artifacts \
#    --output type=local,dest=apps/desktop/dist/linux .)

ARG NODE_VERSION=24.15.0
ARG RUST_VERSION=1.97.1
ARG PNPM_VERSION=11.9.0

FROM node:${NODE_VERSION}-bookworm AS node

FROM rust:${RUST_VERSION}-bookworm AS build
ARG PNPM_VERSION
# https://v2.tauri.app/start/prerequisites/#linux
RUN apt-get update \
 && apt-get install --yes --no-install-recommends \
      libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
      build-essential curl wget file xdg-utils \
 && rm -rf /var/lib/apt/lists/*
# Node and pnpm for the web build (beforeBuildCommand) and the Tauri CLI.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
ENV CI=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    # linuxdeploy (AppImage) is itself an AppImage: no FUSE in containers.
    APPIMAGE_EXTRACT_AND_RUN=1
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store-linux,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store-linux,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile --offline
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=tessera-linux-target,target=/repo/apps/desktop/src-tauri/target \
    cd apps/desktop \
 && pnpm tauri build --bundles deb,rpm,appimage \
 && mkdir -p /bundles \
 && cp -r src-tauri/target/release/bundle/deb/*.deb src-tauri/target/release/bundle/rpm/*.rpm \
      src-tauri/target/release/bundle/appimage/*.AppImage /bundles/ \
 && cp src-tauri/target/release/tessera-desktop /bundles/tessera-desktop-linux-x86_64 \
 && ls -la /bundles

FROM scratch AS artifacts
COPY --from=build /bundles /
