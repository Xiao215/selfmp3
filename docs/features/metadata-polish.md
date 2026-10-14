# Metadata polish

Correct a song's title, artist, album, year and track number — and find missing cover art —
from free public databases. No API keys, nothing to configure.

The lookups are the server's own HTTP calls, rate limiter and cover cache, so a device
reading its library from the bucket asks the server directly for them
(`features/metadata/FixMetadata.tsx`), and the names are saved on the device. The model's
Suggested card on the same dialog is in [ai.md](ai.md), "Fix song info · Suggested".

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

Corrections are an ordinary edit of the song's names, like one typed by hand: the audio
file is never rewritten, so nothing undoes them and a wrong pick is one more edit away
from fixed. Artwork is downloaded by the server through its cover cache and goes up to the
bucket with its next sync.

## Using it

**One song.** Open a song's `⋯` menu, choose **Song details**, and on the song's own page
(or Now Playing's About tab) press **Fix song info…**. The left column shows
what the library has; the right lists candidates with artwork thumbnails, a source badge
and a match percentage. Pick a candidate, and the diff below it lists only the fields that
would change — untick anything you do not want, then **Apply**.

**Whole library.** In *Settings → Advanced → Library → Cover art*, **Find missing art** starts a
background pass over every song without artwork. That panel is drawn only for a device
talking to a server by its address (development builds); otherwise start it with
`POST /api/library/fix-covers`. It stores art only from candidates scoring at least
0.85 — a missing cover is a placeholder gradient, a wrong one is misleading. Progress is
shown live and covers fill in as they land; **Stop looking** cancels. The pass is safe to
re-run: it only ever looks at songs that still lack art.

**What is missing, as a review.** Ask's "Fill in what's missing" (or Tidy up's checkup, which
counts the songs lacking an album, a year or a cover) looks the songs up through these same
lookups and 网易云, and offers each missing album, year and cover as a change to tick rather
than storing anything: [ai.md](ai.md), "Filling in what's missing".

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/songs/:id/lookup` | `{ candidates: MetadataCandidate[] }`, best first |
| `POST` | `/api/songs/:id/apply-metadata` | Partial `{ title, artist, album, albumArtist, year, trackNo, artworkUrl }`; returns `{ ok, artworkSaved }` |
| `POST` | `/api/library/fix-covers` | Start the cover-art pass (idempotent while running) |
| `GET` | `/api/library/fix-covers` | `FixCoversStatus` — `idle | running | done | cancelled`, counts, current title |
| `POST` | `/api/library/fix-covers/cancel` | Stop after the current song |

Schemas live in `packages/shared/src/schemas/metadata.ts`.

## Where it works

Everywhere. The lookup runs on the server — it is what holds the day-long cache, obeys
MusicBrainz's one-request-a-second rule, and downloads the artwork — so a device signed in
to the cloud reaches its server by the addresses in the last snapshot and asks it there
(docs/SYNC.md). The two libraries number songs differently, so the song is named to the
server by *its* id, translated through the uid both know it by.

With no server in reach the button is still there, and opening it says the server is not
answering; a song the server has not taken down from the bucket yet says it is not ready
to look up. The corrected names are this device's own edit and show the moment the dialog
closes. A new cover arrives with the server's next sync, not at once.

## Where the code is

- `apps/server/src/services/lookup.ts` — providers, HTTP, cache (`MetadataLookupService`)
- `apps/server/src/services/lookupParsers.ts` — pure JSON → candidate parsers
- `apps/server/src/services/lookupScore.ts` — pure normalisation and scoring
- `apps/server/src/services/rateLimiter.ts` — the 1 req/s gate for MusicBrainz
- `apps/server/src/services/fixCovers.ts` — the background pass
- `apps/server/src/routes/metadata.ts` — the routes above
- `apps/app/src/features/metadata/` — the UI: `FixMetadata.tsx` (which library answers),
  `MetadataDialog.tsx`, `metadataSource.ts`, `metadata.model.ts`; and the cover-fixing
  controls in `apps/app/src/features/settings/LibraryPanel.tsx` (`useFixCovers`,
  `useFixCoversStatus`)

Tests cover scoring, the rate limiter, the parsers (against fixture JSON in
`services/fixtures/`) and the service's failure modes with a fake `fetch`. A live iTunes
check exists but is skipped unless `SELFMP3_LIVE_TESTS=1`, so `npm test` stays offline.
