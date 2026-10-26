# Lyrics+

Romanization and search inside lyrics. Both build on the lyrics the server already
resolves (`apps/server/src/services/lyrics.ts`: a sidecar file → a tag embedded in the
audio → the bucket's copy of the words → the network, where the place the song was
downloaded from comes first — YouTube Music's timed lyrics or 网易云's — then lrclib), and
every derived form comes back **aligned 1:1** with the original lines — same order, same
count, same timestamps — so the lyrics view just renders "line N, then its extras". The
lyrics themselves are shown on Now Playing; see [now-playing.md](now-playing.md).

## Romanization (offline)

On Now Playing, the **Romaji** / **Pinyin** pill beside the words (on a phone and a
computer alike, `LyricsTools.tsx`) draws the romanization under each line. Chinese lines
get pinyin with tone marks; Japanese lines get Hepburn romaji. It is generated on the
server with pure-JS libraries — nothing leaves your library:

- Chinese → [`pinyin-pro`](https://www.npmjs.com/package/pinyin-pro)
- Japanese → [`kuroshiro`](https://www.npmjs.com/package/kuroshiro) +
  `kuroshiro-analyzer-kuromoji` (the dictionary ships with the package, is
  loaded once at boot in the background, and stays warm)

Which engine a song goes through is decided per song by script: any kana
anywhere means the song is Japanese and *every* Han/kana line — kanji-only ones
included — goes through kuroshiro; Han with no kana is Chinese and goes through
pinyin. Latin-only lines are left alone. Detection is in
`packages/shared/src/script.ts`.

Romaji is part of the lyrics (`services/romanizedLines.ts`): it is worked out when the
words are first seen — an import, a fetch, a hand edit, and a pass over the whole library
after start — and kept in the server's cache at `lyrics/<songId>/romanized.<hash>.json`
under the library's data folder, keyed by a hash of the lyric text, so an edited lyric
gets fresh romaji and an unchanged one is never romanized twice. The cloud pass uploads
the lines in one file with the words (`lyrics/<sha256>.words`, `CloudWordsSchema`), so a
device reading the bucket has them, with one read, without asking the server.
A server answers them inside the lyrics response itself, as its `romanized` field
(`GET /api/songs/:id/lyrics`); there is no separate route.

Whether they are shown is switched only by that pill beside the words: off until it is
pressed, then on for every song in that language until it is pressed again. Pinyin and
romaji are remembered apart, each a preference of the device rather than a synced setting
(`apps/app/src/features/nowPlaying/romanizationPref.ts`).

## Search by name

Search, the palette and Library's own search find a song by its title, artist and album
(`songSearchNames` in `packages/shared/src/searchNames.ts`): on a word start, a run of
letters, the initials ("md" for Midnight Drive), a phrase running from one into the next
("drive kav"), or the whole name with a typo. A name in Chinese or Japanese is also found by
its pinyin or romaji spelling, spaced or run together and by its initials ("zjl" for
周杰伦), and an artist by the names they also go by ("ikura" for 幾田りら). Letters scattered
through a song in order are not a match (X2, 2026-10-25): "calm" had found eight songs whose
title, artist and album held c…a…l…m, one of them right. That loose match is kept for pickers
of short names (a tag picker, the sidebar's tag suggestions), where it is a quick way to one
(`scattered` in `packages/shared/src/fuzzy.ts`).

## Search by lyric

Type at least three characters (two if they are Chinese or Japanese) into Search — the
Search page, or the command palette (the sidebar's Search row; ⌘K in the installed app)
— and a **Lyrics** section appears with one line per song, the match highlighted: the first
line that matches, so a chorus is shown where it is first sung, and the songs ordered by their
best match. Two copies of one song (the single and the album's: the same title, artist and
line) are one hit (X3, 2026-10-25). Choosing a hit plays the song (`useLibrarySearch.ts`).

```
GET /api/lyrics/search?q=夜空&limit=20
→ { hits: [{ songId, title, artist, hasArt, line, before, match, after }] }
```

The index is the server's: a device's copy of the library refuses the route
(`SERVER_ONLY_ROUTES`). So a signed-in device — whose library is the bucket — asks the
server behind it directly, the way Stats does (`useVia`, [SYNC.md](../SYNC.md) "Reaching the
server for what only it can do"). Its answer names songs by the server's ids, so each hit is
renumbered as this device numbers that song, by the uid both libraries share
(`useServerSongIds`, `lyricHitsHere` in `search.model.ts`); a hit on a song this device's copy
does not have yet is left out, since it could neither play nor show its cover. While the
server is out of reach nothing is asked and nothing is said: Search has no Lyrics section and
the palette's "nothing matches" stops suggesting part of a lyric, while songs, artists and tags
are still found on the device.

On the shared server each account's library is a workspace with its own database
([shared-server.md](shared-server.md)), so the index is per workspace: a search answers from
the library behind the token it carries, never another account's.

Backed by an FTS5 table `lyrics_fts` (one row per line). Because SQLite's
unicode61 tokenizer treats a run of CJK characters as one token, the indexed
column stores the line with every CJK character space-separated, and a query is
turned into a phrase of single characters — so `夜空` matches anywhere inside a
line. Latin words get the usual prefix match. Songs are indexed whenever their
lyrics are resolved, refreshed or saved, and a backfill runs after start (and after
any manual rescan) for songs whose lyrics have not been indexed yet. `lyrics_index`
remembers the hash each song was indexed from, so re-indexing an unchanged song is one
row lookup.

## Songs with no words

lrclib answers `instrumental: true` for tracks with no words. The server
remembers that on the song as `Song.instrumental` (the `songs.instrumental`
column), so the app can say the song has no lyrics rather than look again every time
it plays (and a computer shows a visual in their place, see
[now-playing.md](now-playing.md)). It is a flag of its own rather than a `lyricsKind`
value: `lyricsKind: 'none'` only means nothing was found, the sweep rewrites
`lyrics_kind` from the files, and live playlists read `lyrics_kind != 'none'` as
"has lyrics".

```
GET /api/songs/:id/lyrics
404 instrumental   no lyrics of its own, and the song is flagged or lrclib just said so
```

- Lyrics of its own (a sidecar, an embedded tag, the bucket's copy) always win and are
  returned as usual; the flag is left alone.
- A flagged song with none answers `404 instrumental` without touching the network.
  When lrclib is the one saying so, the flag is set first.
- Only lrclib's exact match is believed about a track having no words. The
  fuzzy search fallback readily returns the karaoke version of a song with
  words, and a wrong flag would stop the song from ever being looked up again.
- **Find lyrics** beside the words asks again and clears the flag.
- `PATCH /api/songs/:id { instrumental: true | false }` sets or clears it by hand.

## Files

| Area | Where |
|---|---|
| Contract | `packages/shared/src/schemas/lyrics.ts` |
| Script detection, LRC writer | `packages/shared/src/script.ts`, `lrcBuild.ts` (+ tests; used for YouTube Music's lyrics) |
| Migration | `apps/server/src/db/migrate.ts` — v2: `lyrics_fts`, `lyrics_index` (its `secrets` table belonged to a since-removed translation feature and is unused); later `songs.instrumental` |
| Server | `services/lyrics.ts` (sources, instrumental), `romanization.ts`, `romanizedLines.ts`, `lyricsCache.ts`, `lyricsIndex.ts`; `repositories/lyricsSearch.ts`; `routes/lyrics.ts`, `routes/songs.ts` |
| App | `apps/app/src/features/nowPlaying/` (`LyricsTools.tsx`, `romanizationPref.ts`, `useSongWords.ts`); `features/search/useLibrarySearch.ts`, `SearchScreen.tsx`, `features/commandPalette/CommandPalette.tsx` |
