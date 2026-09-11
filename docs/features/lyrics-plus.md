# Lyrics+

Romanization, a timing editor, and search inside lyrics. Everything
builds on the lyrics the app already resolves (sidecar → embedded tag → lrclib),
and every derived form comes back **aligned 1:1** with the original lines —
same order, same count, same timestamps — so the lyrics view just renders
"line N, then its extras". The lyrics themselves are shown on the song's page; see
[now-playing.md](now-playing.md).

## Romanization (offline)

Open the song's page (`L`, the mic button, or the artwork in the player bar) and press
**Romaji** / **Pinyin** — on a phone, the **Aa** button over the lyrics.
Chinese lines get pinyin with tone marks under them; Japanese lines get Hepburn
romaji. It is generated on the server with pure-JS libraries — nothing leaves
your library:

- Chinese → [`pinyin-pro`](https://www.npmjs.com/package/pinyin-pro)
- Japanese → [`kuroshiro`](https://www.npmjs.com/package/kuroshiro) +
  `kuroshiro-analyzer-kuromoji` (the dictionary ships with the package, is
  loaded once at boot in the background, and stays warm)

Which engine a song goes through is decided per song by script: any kana
anywhere means the song is Japanese and *every* Han/kana line — kanji-only ones
included — goes through kuroshiro; Han with no kana is Chinese and goes through
pinyin. Latin-only lines are left alone. Detection is in
`packages/shared/src/script.ts`.

The switch is the `lyricsRomanization` setting (`'off' | 'on'`), synced across
devices, also in Settings → Lyrics. Results are cached on disk at
`data/lyrics/<songId>/romanized.<hash>.json`, keyed by a hash of the lyrics
text — edit the `.lrc` and the cache misses automatically. Like cover art, the
folder is disposable.

```
GET /api/songs/:id/lyrics/romanized
→ { language: 'zh'|'ja'|'none', synced, lines: [{ time, text, romanized }] }
```

## Lyric timing editor

For songs with plain (unsynced) lyrics or none at all, press **Sync** on the
song's page (or **Write them** under a song whose lyrics were not found). It works in two steps and is built for a thumb as much as a keyboard:

1. **Text.** Paste or edit the lyrics, one line per row. If the song already has
   plain lyrics they are pre-filled. Pasting a whole `.lrc` works too — its
   times come along.
2. **Timing.** Play the song and tap **Tap** (or **Space** on a keyboard) as
   each line begins. Each line shows its stamp; **−/+** nudge it by 0.1 s,
   **×** clears it so it can be re-tapped, **●** stamps it right now, and
   tapping the timestamp seeks the player there to check it by ear. Tapping a
   line's text makes it the next one to stamp.

**Save .lrc** writes the file next to the audio through the storage driver
(`PUT /api/songs/:id/lyrics`, the same sidecar the app reads), removes any old
`.txt`, and updates `lyrics_kind`. Untimed lines are left out of the file; if
nothing was timed the button becomes **Save text** and writes a `.txt` instead.
The LRC writer lives in `packages/shared/src/lrcBuild.ts` and round-trips
through the parser in its tests.

## Search by lyric

Type at least three characters (two if they are Chinese or Japanese) into ⌘K
and a **Lyrics** group appears with the best matching line per song, the match
highlighted. Enter plays the song.

```
GET /api/lyrics/search?q=夜空&limit=12
→ { hits: [{ songId, title, artist, hasArt, line, before, match, after }] }
```

Backed by an FTS5 table `lyrics_fts` (one row per line). Because SQLite's
unicode61 tokenizer treats a run of CJK characters as one token, the indexed
column stores the line with every CJK character space-separated, and a query is
turned into a phrase of single characters — so `夜空` matches anywhere inside a
line. Latin words get the usual prefix match. Songs are indexed whenever their
lyrics are resolved, refreshed or saved, and a backfill runs after the boot scan
(and after any manual rescan) for songs the scanner knows have lyrics but that
have not been opened yet. `lyrics_index` remembers the hash each song was
indexed from so re-indexing an unchanged song is one row lookup.

## Instrumental songs

lrclib answers `instrumental: true` for tracks with no words. The server
remembers that on the song as `Song.instrumental` (the `songs.instrumental`
column), so a client can say "instrumental" instead of "no lyrics found", and
the song is not looked up again every time it plays. It is a flag of its own
rather than a `lyricsKind` value: `lyricsKind: 'none'` only means nothing was
found, the scanner rewrites `lyrics_kind` from the files on every rescan, and
smart playlists read `lyrics_kind != 'none'` as "has lyrics".

```
GET /api/songs/:id/lyrics
404 instrumental   no local lyrics, and the song is flagged or lrclib just said so
```

- Local lyrics (a sidecar or an embedded tag) always win and are returned as
  usual; the flag is left alone.
- A flagged song with no local lyrics answers `404 instrumental` without
  touching the network. When lrclib is the one saying so, the flag is set first.
  `GET /api/songs/:id/lyrics/romanized` behaves the same way.
- `?refresh=1` ("look again") always asks lrclib: lyrics found are written as a
  sidecar and clear the flag; an instrumental answer sets it and returns
  `404 instrumental`; nothing at all is the usual `404 not_found`.
- Only lrclib's exact match is believed about a track being instrumental. The
  fuzzy search fallback readily returns the karaoke version of a song with
  words, and a wrong flag would stop the song from ever being looked up again.
- Imports with lyric fetching on set the flag when lrclib says so.
- `PUT /api/songs/:id/lyrics` with non-empty text clears the flag — you wrote
  words for it, so it has some.
- `PATCH /api/songs/:id { instrumental: true | false }` sets or clears it by
  hand.

Older servers do not send the field; the schema defaults it to `false`.

## Files

| Area | Where |
|---|---|
| Contract | `packages/shared/src/schemas/lyrics.ts`, settings keys in `schemas/settings.ts` |
| Script detection, LRC writer | `packages/shared/src/script.ts`, `lrcBuild.ts` (+ tests) |
| Migration | `apps/server/src/db/migrate.ts` — v2: `lyrics_fts`, `lyrics_index` (its `secrets` table belonged to a since-removed translation feature and is unused); later `songs.instrumental` |
| Server | `services/lyrics.ts` (lrclib, instrumental), `romanization.ts`, `lyricsCache.ts`, `lyricsIndex.ts`; `repositories/lyricsSearch.ts`; `routes/lyrics.ts`, `routes/songs.ts` |
| Web | `components/nowplaying/` (see [now-playing.md](now-playing.md)), `LyricsSyncEditor.tsx`, `LyricsSettings.tsx`; Lyrics group in `CommandPalette.tsx` |
