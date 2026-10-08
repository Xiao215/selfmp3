# Audio intelligence

Every song is analysed once, locally, and the results power five things: live playlist rules
over tempo, key, energy and loudness; an auto-mix mode that orders the queue into a smooth
path and picks a crossfade per transition; the visuals a song with no lyrics is given
([now-playing.md](now-playing.md#songs-with-no-words)); and, from a listening model that
hears each song ([How songs sound](#how-songs-sound)), "Sounds like" and Ask finding music
by how it sounds.

Nothing leaves the machine. The measurements are `ffmpeg` and plain TypeScript; the
listening model runs on the server too, from files it downloads once.

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

The queue is the database itself (`song_audio_features` rows), so a restart loses nothing.

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
auto-mix is ordering by it, and on the song's own page (**Song details** in its ⋯ menu),
which spells out tempo, energy and key in words alongside download state, play history and the
file, and names the tempo and energy beside "Sounds like".

**Live playlists** gain an "Audio" group in the rule builder: BPM, Key (exactly this
Camelot code, or "mixes with" — same number in the other letter, or ±1 in the same
letter), Energy (0–1) and Loudness (LUFS). Songs that have not been analysed never match
these rules.

**Similar songs**: the song menu has "Play similar songs", the song's own page shows them
under "Sounds like", and Now Playing shows a "Similar" strip. They are the songs the
listening model hears as closest ([How songs sound](#how-songs-sound)). For a song it has not
heard yet, and to fill the list past the ones it has, they are nearest neighbours by a
weighted distance over tempo (±8 %, with double/half time counted as a match), energy,
loudness and distance around the Camelot wheel, with a bonus for shared tags and a milder
one for the same artist. The offline replica (packages/replica) has no listening model and
always uses the second.

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

## How songs sound

Tempo, energy and key say how fast and how loud, not what the music is: a battle theme and a
lively tavern tune have the same energy, and nothing in those numbers knows a guzheng from a
piano. So each song is also heard by **CLaMP 3** (a music–text model, ACL 2025), which turns
it into 768 numbers. A sentence goes into the same space, so "calm orchestral music with
strings and flute" and a song can be compared, and so can two songs.

**What it hears.** Three ten-second windows, a fifth, just under half and seven tenths of the
way in (a song of 30 s or less, whole), decoded to 24 kHz mono, back to back. CLaMP 3 hears
them through MERT (a model trained only on music) in 5 s chunks, then its own audio encoder.

**Why this model.** Four were tried on 585 of the library's songs (337 Genshin), with the
library's own tags as the answers (2026-10-07):

| | Today's measures | CLAP | MuQ-MuLan | **CLaMP 3** | EmbeddingGemma 2 |
|---|---|---|---|---|---|
| "Sounds like": 5 nearest share an album or artist (8 % by chance) | 29 % | 48 % | 47 % | **51 %** | 38 % |
| "Traditional Chinese… guzheng, erhu" finds 璃月 among the Genshin songs (AUC) | – | 0.60 | 0.83 | 0.81 | 0.53 |
| "Solo classical piano" (AUC) | – | 0.99 | 0.99 | **1.00** | 0.85 |
| "Instrumental music" (AUC) | – | 0.97 | 0.62 | 0.96 | 0.93 |

CLaMP 3 was the best all-round, and small enough for a Pi once made 8-bit. EmbeddingGemma 2
hears the language of the words well and instruments hardly at all; it was trained on speech
and sounds, not music.

**How it runs.** The model is three ONNX graphs on onnxruntime-node, exported and made 8-bit by
`scripts/sound-models/export.py`, checked against CLaMP 3's own Python code: in full precision
every song and description matched exactly; the 8-bit set the server downloads keeps the scores
above to the decimal. The files (about 750 MB) are a release of this repository,
`sound-models-v1`, downloaded into `data/models/` the first time they are wanted and checked
against hashes written in `sound/models.ts`. A failed download is tried again an hour later.
The model runs in a worker thread (`sound/clamp3Worker.ts`): a pass on onnxruntime-node
blocks the thread it runs on, and on the event loop each one froze the server for seconds
on a Pi.

| Setting | |
|---|---|
| `SELFMP3_SOUND` | `false` turns it off. On by default |
| `SELFMP3_SOUND_MODELS` | The release's address by default, or a folder already holding the files |
| `SELFMP3_SOUND_THREADS` | CPU threads it may use; 2 by default, so a Pi keeps cores for the rest |

**When it runs.** In the same background loop as the measurements, after them: a new song is
heard while its file is open for the measurements anyway, and every song already measured
once nothing else waits. On the Pi every song's audio is in the bucket, so hearing the
existing library downloads each song once; those downloads are capped at 1,000 a day, which
keeps a day's free Backblaze downloads for playing music, and a 1,500-song library is heard
over two days. About 3 s a song on two cores of an M1; an estimated 15–25 s on a Pi 4.
A song that cannot be heard is recorded so and not tried again; a changed file is heard
again. The vectors go to the bucket as one file (docs/SYNC.md, "Sound vectors"), so a server
starting again from the bucket takes them back instead of hearing every song again. The listening half of the model (about 210 MB) and the text half (about 535 MB) each
load when first wanted and are let go after ten idle minutes.

**What uses it.**

- **"Sounds like"** (above): the songs it hears as closest, nudged a little by shared tags
  (+0.015 each, for two) and the same artist (+0.02). Neighbours sit close together (the 1st
  nearest is about 0.86 apart from the 20th at about 0.77), so a nudge moves a song a few
  places and no more.
- **Ask** ([ai.md](ai.md)): the plan has a `sound` part, the description's sound in English
  ("intense epic battle music"), written by the model in English whatever the request's
  language, in positive words only (the model does not understand "no vocals"; that is the
  words filter). Of the songs the other parts let in, it keeps the ones that sound like it,
  best first: within 0.06 of the best match, a line drawn from the top because the scores
  only mean something against each other. A sound few songs have keeps few and a broad one
  many: on 585 songs, "solo classical piano" kept 20 against the 18 piano pieces (three in
  four right), "Japanese pop" 86 (nineteen in twenty right), "intense epic battle music" 26 of
  337 Genshin tracks. Songs not heard yet stay out. When nothing else is wanted, the kept
  songs are the answer, with no second model call; otherwise the model picks from the
  best-sounding 300 of them, with a `sound` column (0–100). The app shows the part as a chip,
  "Sounds like calm orchestral…", that can be taken away.
- **"More like this"** in Ask, with a song playing: when the router says they want music like
  it (`like`), the songs that fit are ordered by how close they sound to it, with no cutoff.

The listening model is used only for those. A request with no sound in it, and no `like`,
never loads the text half of the model; the songs' vectors are made in the background either
way.

**Settings › Library** shows it under "How songs sound": waiting (while songs still need their
tempo and key), downloading, how many songs are heard and how many are to go, or why the model
could not be had.

`npx tsx apps/server/src/sound/eval.ts <models> <folder of songs> "calm orchestral" …` hears a
folder of songs and prints what each description finds, for a person to judge.

## Data

`GET /api/library` includes `audioFeatures` on every song (null until analysed). The
`song_audio_features` table: `song_id`, `bpm`, `energy`, `loudness_lufs`, `key`, `camelot`,
`danceability`, `analyzed_at`, `version`. The `song_sound_vectors` table: `song_id`, `model`
(the model that heard it, `clamp3-saas-1`; a new one hears every song again), `vector` (768
little-endian float32s of unit length, null for a song that could not be heard), `made_at`.
It is this server's copy of the bucket's `lyrics/<sha256>.vec`; `cloud_sound` says which file
that is and which vectors it holds.
Bump `ANALYSIS_VERSION` in
`packages/shared/src/audioFeatures.ts` when the algorithm changes and old rows are redone on
the next run.

## Where the code is

- `packages/shared/src/audioFeatures.ts` — Camelot wheel, distances, crossfade length (tested)
- `apps/server/src/services/dsp.ts` — FFT, onsets, tempo, chroma, key (tested with
  synthesised click tracks and chords)
- `apps/server/src/services/analysis.ts` — ffmpeg decode, `ebur128`, the background loop
  (measuring, then hearing)
- `packages/shared/src/audioFeatures.ts` (`similarSongs`) — nearest neighbours by the measures
- `apps/server/src/sound/` — the listening model: `vectors.ts` (windows, chunks, the
  arithmetic, tested), `models.ts` (downloading and checking the files), `clamp3.ts`
  (onnxruntime), `clamp3Worker.ts` and `clamp3.worker.ts` (the model on a thread of its
  own), `pack.ts` (the vectors as one file for the bucket), `sound.ts` (hearing, "sounds
  like", matching words), `eval.ts`
- `apps/server/src/ai/describe.ts` (`soundOrder`, not exported) — Ask's songs in the order they sound
- `scripts/sound-models/` — the export, its requirements and the model's licences
- `packages/client/src/queue/autoMix.ts` — queue ordering and per-transition crossfade (tested)
