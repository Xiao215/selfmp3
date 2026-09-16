# Metadata polish

Correct a song's title, artist, album, year and track number — and find missing cover art —
from free public databases. No API keys, nothing to configure.

**Server-only, and therefore out of reach today.** The lookups are the server's own HTTP
calls, rate limiter and cover cache, so the app hides them when its library is the bucket's
— which every surface's now is. Nothing here has been removed or broken; there is simply
no screen asking for it. See [SYNC.md](../SYNC.md), "What this gives up".

## What it does

Two sources are asked, in parallel, for every lookup:

| Source | What it is good for | Notes |
|---|---|---|
| **iTunes Search** | Fast, clean tags, 600×600 artwork for almost everything commercial | No rate limit to speak of |
| **MusicBrainz** | The deeper catalogue, split artist credits, release dates | Strictly one request per second (enforced client-side); cover art comes from the Cover Art Archive per release |

Results are normalised into one candidate shape and scored 0–1 against the song's current
title, artist and duration. Bracketed noise ("(Official Video)", "- Remastered 2011",
"feat. …") is ignored when comparing, so a YouTube rip still matches the studio entry.

Lookups are cached in memory for 24 hours (10 minutes for empty/failed ones), so opening
the dialog twice is free. Every failure — timeout (8 s), DNS, an HTML error page instead of
JSON, a 503 from MusicBrainz — produces an empty candidate list and a `WARN` line in the
server log, never an error in the UI.

Corrections are written to the **database only**, exactly like a manual edit. The audio
file is never rewritten, so a rescan cannot undo them and a wrong pick is one more edit
away from fixed. Artwork is downloaded by the server into `data/covers/<id>` through the
existing cover cache.

## Using it

**One song.** Open a song's `⋯` menu and choose **Fix metadata…**. The left column shows
what the library has; the right lists candidates with artwork thumbnails, a source badge
and a match percentage. Pick a candidate, and the diff below it lists only the fields that
would change — untick anything you do not want, then **Apply**.

**Whole library.** In *Settings → Library*, **Find missing cover art** starts a background
pass over every song without artwork. It stores art only from candidates scoring at least
0.85 — a missing cover is a placeholder gradient, a wrong one is misleading. Progress is
shown live and covers fill in as they land; **Stop looking** cancels. The pass is safe to
re-run: it only ever looks at songs that still lack art.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/songs/:id/lookup` | `{ candidates: MetadataCandidate[] }`, best first |
| `POST` | `/api/songs/:id/apply-metadata` | Partial `{ title, artist, album, albumArtist, year, trackNo, artworkUrl }`; returns `{ ok, artworkSaved }` |
| `POST` | `/api/library/fix-covers` | Start the cover-art pass (idempotent while running) |
| `GET` | `/api/library/fix-covers` | `FixCoversStatus` — `idle | running | done | cancelled`, counts, current title |
| `POST` | `/api/library/fix-covers/cancel` | Stop after the current song |

Schemas live in `packages/shared/src/schemas/metadata.ts`.

## Where the code is

- `apps/server/src/services/lookup.ts` — providers, HTTP, cache (`MetadataLookupService`)
- `apps/server/src/services/lookupParsers.ts` — pure JSON → candidate parsers
- `apps/server/src/services/lookupScore.ts` — pure normalisation and scoring
- `apps/server/src/services/rateLimiter.ts` — the 1 req/s gate for MusicBrainz
- `apps/server/src/services/fixCovers.ts` — the background pass
- `apps/server/src/routes/metadata.ts` — the routes above
- `apps/app/src/ui/components/MetadataDialog.tsx`, `apps/app/src/features/metadata/metadata.model.ts`,
  and `FixCoversPanel` in `apps/app/src/features/settings/SettingsScreen.tsx` — the UI

Tests cover scoring, the rate limiter, the parsers (against fixture JSON in
`services/fixtures/`) and the service's failure modes with a fake `fetch`. A live iTunes
check exists but is skipped unless `SELFMP3_LIVE_TESTS=1`, so `npm test` stays offline.
