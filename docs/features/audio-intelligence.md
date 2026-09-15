# Audio intelligence

Every song is analysed once, locally, and the results power three things: smart-playlist
rules over tempo, key, energy and loudness; a "similar songs" list; and an auto-mix mode
that orders the queue into a smooth path and picks a crossfade per transition.

Nothing leaves the machine. The only tool involved is `ffmpeg`, which is already required
for importing.

## What is measured

| Feature | How | Stored as |
|---|---|---|
| **BPM** | Spectral-flux onset envelope → autocorrelation comb filter over 60–200 BPM, log-normal prior around 120, octave-error correction | `bpm` (null when no pulse is found) |
| **Energy** | RMS level on a curve (quiet acoustic ≈ 0.2, brickwalled ≈ 1) blended with onsets per second | `energy` 0–1 |
| **Loudness** | ffmpeg's `ebur128` filter, integrated LUFS | `loudnessLufs` |
| **Key** | Chroma from a 4096-point STFT → Krumhansl-Schmuckler correlation against the 24 key profiles | `key` ("A minor") and `camelot` ("8A") |
| **Danceability** | How regular the gaps between onsets are relative to the beat, blended with beat strength | `danceability` 0–1 |

Analysis looks at up to 120 seconds from 30 seconds in (or the whole file when it is
shorter than 90 s), decoded to mono 22 050 Hz. A typical song takes well under a second.
All of the maths is plain TypeScript in `apps/server/src/services/dsp.ts` — no native
modules, so `npm install` stays clean on a Mac.

## When it runs

The analyser is a low-priority background loop that runs one song at a time and yields
whenever a scan or an import is in progress:

- after every library scan, anything without features is analysed;
- a newly imported song is analysed once it has been ingested;
- a file that changed on disk has its features thrown away and redone.

The queue is the database itself (`song_features` rows), so a restart loses nothing.

## Using it

**Settings → Library** has "Analyse songs without features" and "Re-analyse everything",
with live progress. The same thing over HTTP:

```
POST /api/library/analyze          { "force": false }   start / resume
GET  /api/library/analyze                               progress
```

**Song rows** show the tempo and energy after the artist, muted: `♩ = 130`, the way a score
marks tempo, and a small waveform drawn straight from the 0–1 energy value — taller and
denser as a song gets more intense, with no steps or level names
(`energyWavePath` in `packages/client/src/songs/facts.ts`, drawn by
`apps/app/src/ui/components/EnergyWave.tsx`). The key stays off the row. It shows in the queue while
auto-mix is ordering by it, and in **Song details** (the song's ⋯ menu), which spells out
tempo, energy and key in words alongside download state, play history and the file.

**Live playlists** gain an "Audio" group in the rule builder: BPM, Key (exactly this
Camelot code, or "mixes with" — same number in the other letter, or ±1 in the same
letter), Energy (0–1) and Loudness (LUFS). Songs that have not been analysed never match
these rules.

**Similar songs**: the song menu has "Play similar" and "Add similar to queue", and Now
Playing shows a "Similar" strip. Nearest neighbours by a weighted distance over tempo
(±8 %, with double/half time counted as a match), energy, loudness and distance around
the Camelot wheel, with a bonus for shared tags and a milder one for the same artist.

```
GET /api/songs/:id/similar?limit=20
```

**Auto-mix** is a toggle in the queue panel. When on:

- the *upcoming* queue is reordered greedily, each step to the nearest song by BPM, key
  and energy, starting from what is playing (songs without features go to the end);
- songs added with "Add to queue" are folded into the path; "Play next" is honoured as-is;
- each transition's crossfade is chosen from the two songs: the full length for a close
  tempo and a compatible key, shorter for a clash. The ceiling is the crossfade setting;
  with crossfade set to 0, auto-mix uses 4 seconds.

The toggle is per device and remembered.

## Data

`GET /api/library` includes `features` on every song (null until analysed). The
`song_features` table: `song_id`, `bpm`, `energy`, `loudness_lufs`, `key`, `camelot`,
`danceability`, `analyzed_at`, `version`. Bump `FEATURES_VERSION` in
`packages/shared/src/features.ts` when the algorithm changes and old rows are redone on
the next run.

## Where the code is

- `packages/shared/src/features.ts` — Camelot wheel, distances, crossfade length (tested)
- `apps/server/src/services/dsp.ts` — FFT, onsets, tempo, chroma, key (tested with
  synthesised click tracks and chords)
- `apps/server/src/services/analysis.ts` — ffmpeg decode, `ebur128`, the background loop
- `apps/server/src/services/similar.ts` — nearest neighbours
- `packages/client/src/queue/autoMix.ts` — queue ordering and per-transition crossfade (tested)
