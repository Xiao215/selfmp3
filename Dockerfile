# self.mp3 — for a small always-on box (VPS, NAS, Raspberry Pi).
#
#   docker compose up -d          # or:
#   docker build -t selfmp3 . && docker run -p 4600:4600 -v ./library:/app/library -v ./data:/app/data selfmp3
#
# Two stages: the first has compilers (better-sqlite3 is native), the second
# has only the built app plus ffmpeg and yt-dlp, and runs as an ordinary user.

# --- build ------------------------------------------------------------------
FROM node:22-alpine AS build

# better-sqlite3 falls back to compiling from source when no prebuilt binary
# matches the platform (musl on arm64, for one).
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Manifests first so dependency installation is cached across source edits.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/cloud/package.json packages/cloud/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared packages/shared
# The web app is built against it, so it has to be here even though nothing
# the server runs imports it and none of it reaches the runtime image.
COPY packages/cloud packages/cloud
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build

# Keep only what the server needs at runtime. The S3 SDK is optional and large;
# `npm install` it into the image yourself if you use the s3 storage driver.
RUN npm prune --omit=dev --omit=optional --no-audit --no-fund

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
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist

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
