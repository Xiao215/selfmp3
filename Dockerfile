# self.mp3 — for a small always-on box (Raspberry Pi, NAS, VPS).
#
#   docker compose up -d                         # pulls ghcr.io/xiao215/selfmp3
#   docker build -t selfmp3 .                    # or build it yourself
#
# Three stages:
#   web      the app's web build: static files, made once on the builder's own
#            CPU, so an arm64 image is not built under emulation.
#   server   the server and its production dependencies, on Alpine, where
#            better-sqlite3 is compiled for the runtime's C library.
#   runtime  those two, plus ffmpeg, yt-dlp and tini, running as an ordinary user.

# --- web --------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web

WORKDIR /app

# Every workspace's manifest, so `npm ci` finds the lockfile's workspaces.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/replica/package.json packages/replica/
COPY packages/client/package.json packages/client/
COPY packages/desktop-bridge/package.json packages/desktop-bridge/
COPY apps/server/package.json apps/server/
COPY apps/doorman/package.json apps/doorman/
COPY apps/app/package.json apps/app/
# No install scripts: the web export needs none of them (the Pages build does
# the same), and the native modules are the server's and the phone's.
RUN npm ci --ignore-scripts --no-audit --no-fund

# desktop-bridge too: the app's web shell imports it to talk to the Electron
# shell, and does nothing with it in a plain browser.
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared packages/shared
COPY packages/replica packages/replica
COPY packages/client packages/client
COPY packages/desktop-bridge packages/desktop-bridge
COPY apps/app apps/app
RUN npm run build --workspace @selfmp3/shared \
 && npm run build --workspace @selfmp3/replica \
 && npm run build --workspace @selfmp3/client \
 && npm run build --workspace @selfmp3/desktop-bridge \
 && npm run export:web --workspace @selfmp3/app

# --- server -----------------------------------------------------------------
FROM node:22-alpine AS server

# better-sqlite3 compiles from source when no prebuilt binary matches the
# platform (musl on arm64, for one).
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/replica/package.json packages/replica/
COPY packages/client/package.json packages/client/
COPY packages/desktop-bridge/package.json packages/desktop-bridge/
COPY apps/server/package.json apps/server/
COPY apps/doorman/package.json apps/doorman/
COPY apps/app/package.json apps/app/
# Only the server's workspaces, plus the root's tooling (TypeScript) to build
# them: Expo and React Native never enter this stage.
RUN npm ci --workspace @selfmp3/shared --workspace @selfmp3/server --include-workspace-root \
      --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build --workspace @selfmp3/shared && npm run build --workspace @selfmp3/server

# Production dependencies alone, freshly installed. The S3 SDK is optional and
# large; `npm install` it into the image yourself if you use the s3 driver.
RUN rm -rf node_modules packages/shared/node_modules apps/server/node_modules \
 && npm ci --workspace @selfmp3/shared --workspace @selfmp3/server \
      --omit=dev --omit=optional --no-audit --no-fund

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine

RUN apk add --no-cache ffmpeg yt-dlp tini

ENV NODE_ENV=production \
    SELFMP3_HOST=0.0.0.0 \
    SELFMP3_PORT=4600 \
    SELFMP3_LIBRARY_DIR=/app/library \
    SELFMP3_DATA_DIR=/app/data

WORKDIR /app

# The layout mirrors the repo so config.ts finds the web build and the
# workspace symlinks in node_modules keep resolving.
COPY --from=server --chown=node:node /app/package.json ./
COPY --from=server --chown=node:node /app/node_modules ./node_modules
COPY --from=server --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=server --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=server --chown=node:node /app/apps/server/package.json ./apps/server/
COPY --from=server --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=web --chown=node:node /app/apps/app/dist ./apps/app/dist

# Music and database live outside the image. Owned by the runtime user so a
# fresh bind mount is writable without any chown on the host.
RUN mkdir -p /app/library /app/data && chown -R node:node /app/library /app/data
VOLUME ["/app/library", "/app/data"]

USER node
EXPOSE 4600

# The health route is unauthenticated on purpose, so this works with a token set.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${SELFMP3_PORT}/api/health" >/dev/null || exit 1

# tini reaps zombies from yt-dlp/ffmpeg and forwards SIGTERM for a clean shutdown.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/server/dist/main.js"]
