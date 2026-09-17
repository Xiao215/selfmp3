# self.mp3 — for a small always-on box (Raspberry Pi, NAS, VPS).
#
#   docker compose up -d                         # pulls ghcr.io/xiao215/selfmp3
#   docker build -t selfmp3 .                    # or build it yourself
#
# Two stages:
#   server   the server and its production dependencies, on Alpine, where
#            better-sqlite3 is compiled for the runtime's C library.
#   runtime  that, plus ffmpeg, yt-dlp and tini, running as an ordinary user.
#
# There used to be a third stage that built the app's web export, because the
# server served it. It serves its own setup page now (apps/server/src/http/admin.ts),
# and that page is three plain files with no build step — so the whole Expo
# toolchain, and the megabytes it produced, have left the image. The app is on
# GitHub Pages, in the desktop app and on your phone.

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
COPY apps/extension/package.json apps/extension/
# Only the server's workspaces, plus the root's tooling (TypeScript) to build
# them: Expo and React Native never enter this stage.
RUN npm ci --workspace @selfmp3/shared --workspace @selfmp3/server --include-workspace-root \
      --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build --workspace @selfmp3/shared && npm run build --workspace @selfmp3/server

# Production dependencies alone, freshly installed — optional ones included:
# sharp's native build for this platform is one, and the server cannot start
# without it (the S3 SDK comes along too).
#
# sharp is the one production module that does not hoist to the root. miniflare
# — a dev dependency, through the doorman's Workers tooling — pins sharp 0.35.4
# and takes the root slot, so the server's ^0.34.5 installs into
# apps/server/node_modules instead. `--omit=dev` then removes the root copy,
# which is why that directory has to reach the runtime stage too.
#
# The two native modules are loaded the way the server itself will load them,
# from its own entry point rather than from /app, and on the image's own
# platform: an image whose server would not start fails to build rather than
# being published. Resolving from /app would have missed exactly this.
RUN rm -rf node_modules packages/shared/node_modules apps/server/node_modules \
 && npm ci --workspace @selfmp3/shared --workspace @selfmp3/server \
      --omit=dev --no-audit --no-fund \
 && mkdir -p apps/server/node_modules \
 && node -e "const need = require('module').createRequire('/app/apps/server/dist/main.js'); \
             need('sharp'); \
             new (need('better-sqlite3'))(':memory:').close()"

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine

# Alpine's yt-dlp package tracks the stable branch and runs many months behind
# — 2025.11.12 at the time of writing, against a tool YouTube breaks on a scale
# of weeks. An out-of-date yt-dlp is the single most common cause of downloads
# failing, so it comes from PyPI instead, which is current.
#
# It goes in a venv rather than over Alpine's own python because pip refuses to
# write into a distro-managed site-packages (PEP 668), and --break-system-packages
# is the wrong side of that argument. yt-dlp is pure Python, so nothing compiles.
#
# The official standalone binaries are deliberately not used: they are built
# against glibc and this image is musl.
#
# YTDLP_REFRESH exists only to be changed. The build cache would otherwise hand
# a scheduled rebuild the same layer, and the whole point of rebuilding weekly
# is to pick up a yt-dlp that did not exist last week. CI passes the ISO week.
ARG YTDLP_REFRESH=0
RUN apk add --no-cache ffmpeg tini python3  && echo "yt-dlp refresh: ${YTDLP_REFRESH}"  && python3 -m venv /opt/ytdlp  && /opt/ytdlp/bin/pip install --no-cache-dir --upgrade pip yt-dlp  && ln -s /opt/ytdlp/bin/yt-dlp /usr/local/bin/yt-dlp  && yt-dlp --version

ENV NODE_ENV=production \
    SELFMP3_HOST=0.0.0.0 \
    SELFMP3_PORT=4600 \
    SELFMP3_LIBRARY_DIR=/app/library \
    SELFMP3_DATA_DIR=/app/data

WORKDIR /app

# The layout mirrors the repo so the workspace symlinks in node_modules keep
# resolving, and so the server's page sits beside its build where it expects.
COPY --from=server --chown=node:node /app/package.json ./
COPY --from=server --chown=node:node /app/node_modules ./node_modules
COPY --from=server --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=server --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=server --chown=node:node /app/apps/server/package.json ./apps/server/
# sharp lives here rather than in the root node_modules; see the server stage.
COPY --from=server --chown=node:node /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=server --chown=node:node /app/apps/server/dist ./apps/server/dist
# The server's own page, read from beside `dist` at runtime.
COPY --from=server --chown=node:node /app/apps/server/public ./apps/server/public

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
