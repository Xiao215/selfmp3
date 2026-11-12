# Developing self.mp3

Working on the code, on a development machine (a Mac, in Xiao's case) with Node 22 or newer.
How the code is laid out, and why, is in [ARCHITECTURE.md](ARCHITECTURE.md); running the
server for real is [INSTALL.md](INSTALL.md).

```bash
npm install
npm run dev        # the server on :4600 with the dev profile, the app's web dev server on :4601
```

The dev profile keeps its own library and database, and uses a folder as its bucket, so
working on the code never touches a real collection.

---

## Every root script

| Command | What it does |
|---|---|
| `npm run dev` | `dev:api` and `dev:web` together |
| `npm run dev:api` | The server with reload, on the `dev` profile with a folder for a bucket, letting the web dev server's origin (`:4601`) call it |
| `npm run dev:web` | Builds the packages, then the app's web dev server on `:4601` |
| `npm run dev:desktop` | The desktop app against a dev build |
| `npm run build:packages` | The five shared packages, in dependency order — every other build starts here |
| `npm run build` | The packages and the server — what `npm start` runs |
| `npm run build:desktop` | The app's web export, packaged as a `.dmg` in `apps/desktop/release/` |
| `npm run build:extension` | The packages and the browser extension, into `apps/extension/dist/` |
| `npm run zip:extension` | That build, zipped into `apps/extension/release/` |
| `npm start` | Run the built server |
| `npm run cli -- <command>` | The `selfmp3` CLI: `start`, `scan`, `import`, `backup`, `doctor` |
| `npm run typecheck` | TypeScript across the root project |
| `npm run typecheck:clean` | The same, from scratch — for when a stale `tsconfig.tsbuildinfo` makes it lie |
| `npm run typecheck:verify` | The Playwright suites and the ytclient harness, which no other project checks |
| `npm run typecheck:app` | Builds the packages, then type-checks the app and its service worker |
| `npm run lint` / `npm run lint:fix` | ESLint, or ESLint with fixes |
| `npm run lint:app` | ESLint for the app |
| `npm run check:exports` | Exports nothing imports, twin-aware (`scripts/unused-exports.mjs`) |
| `npm run check:comments` | Files, `#member`s and mock boards a comment names but the repo no longer has (`scripts/comment-refs.mjs`) |
| `npm test` / `npm run test:watch` | The Vitest suite, once or watching |
| `npm run test:app` | The app's component tests (Jest) |
| `npm run check:app` | `typecheck:app`, `lint:app` and `test:app` |
| `npm run check` | Every typecheck, lint, format and test above, the app included — what CI runs |
| `npm run format` / `npm run format:check` | Prettier, writing or checking |
| `npm run verify:flows` | Playwright flows at computer and phone width, against `npm run dev` ([verify/README.md](../verify/README.md)) |
| `npm run verify:desktop` | Playwright against the built desktop app |
| `npm run verify:extension` | Playwright against the built browser extension |
| `npm run verify:ytclient` | Playwright for the in-browser YouTube download ([client-download.md](features/client-download.md)) |
| `npm run clean` | Remove every build output |

Inside `apps/app`, `npx expo run:ios` or `npx expo run:android` builds the phone app; see
[MOBILE.md](MOBILE.md). Phone flows run with Maestro
([apps/app/.maestro/README.md](../apps/app/.maestro/README.md)). Checking a build against
the real thing before calling it good is [PREPROD.md](PREPROD.md).

---

## Habits

- Run `npm run check` before you commit. [`check.yml`](../.github/workflows/check.yml) runs
  the same steps on every push and pull request, and the Pages, desktop and extension builds
  will not run without it.
- A schema change is a new migration appended to `apps/server/src/db/migrate.ts`. Never edit
  or renumber an existing one.
- A change to the API starts in `packages/shared`'s zod schemas; the compile errors then lead
  you to every place that needs updating.
- A push to `main` reaches the server within minutes, by way of the Docker image. The
  doorman does not: deploy it by hand after a change to `apps/doorman`.

---

## The GitHub workflows

- [`check.yml`](../.github/workflows/check.yml): typecheck, lint, format and tests on every
  push and pull request, and called by the Pages, desktop, extension, iPhone and Android
  builds below before they run.
- [`e2e.yml`](../.github/workflows/e2e.yml): the extension and desktop Playwright suites, on
  every push to `main` and every pull request.
- [`pages.yml`](../.github/workflows/pages.yml): publishes the web app to GitHub Pages from
  `main`.
- [`docker.yml`](../.github/workflows/docker.yml): publishes `ghcr.io/xiao215/selfmp3` for
  arm64 and amd64 on every push to `main` that touches the server, and weekly.
- [`desktop.yml`](../.github/workflows/desktop.yml): builds the desktop app on a
  `desktop-v*` tag.
- [`extension.yml`](../.github/workflows/extension.yml): zips the extension on an
  `extension-v*` tag.
- [`ios.yml`](../.github/workflows/ios.yml) and
  [`android.yml`](../.github/workflows/android.yml): build and sign the phone app for
  friends and put it on the `ios` and `android` releases, on every push to `main` that
  changes the app, and nightly when it has changed ([MOBILE.md](MOBILE.md)).
- [`autofix.yml`](../.github/workflows/autofix.yml): when a push to `main` goes red in Check,
  End to end, Pages or Docker, Claude looks at why and offers a fix as a pull request.

The doorman is deployed by hand with `npx wrangler deploy` from `apps/doorman`
([apps/doorman/README.md](../apps/doorman/README.md)).
