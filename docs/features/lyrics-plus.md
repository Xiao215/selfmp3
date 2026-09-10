# Lyrics+

Romanization, translation, a timing editor, and search inside lyrics. Everything
builds on the lyrics the app already resolves (sidecar → embedded tag → lrclib),
and every derived form comes back **aligned 1:1** with the original lines —
same order, same count, same timestamps — so the panel just renders "line N,
then its extras".

## Romanization (offline)

Open the lyrics panel (`L`, or the mic button) and press the **Aa** button.
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

## Translation (optional, needs an API key)

Press the **translate** button in the panel. With no provider configured the
panel shows a quiet hint pointing to Settings. To enable it, in Settings →
Lyrics:

1. Set **Translate lyrics into** to a language code (`en`, `zh`, `ja`,
   `pt-BR`…). Setting: `lyricsTranslationLang`, default `en`.
2. Pick a **Translation provider**: Anthropic or OpenAI. Setting:
   `lyricsTranslationProvider` (`'none' | 'anthropic' | 'openai'`, default
   `none`).
3. Paste that provider's API key and Save.

Keys are stored server-side in their own `secrets` table and are **never
returned** to the client — `GET /api/settings` does not include them, and
`GET /api/settings/secrets` only reports `{ anthropic: { hasKey }, openai: { hasKey } }`.
`PUT /api/settings/secrets { provider, key }` sets one; `key: null` removes it.

The whole song is translated in **one request**: non-blank lines are numbered,
the model is asked for the same numbered list back, the reply is validated for
count and coverage, and the request is retried once if it does not line up.
Results are cached per song and language at
`data/lyrics/<songId>/translation.<lang>.<hash>.json`, so each song costs one
call per language, ever.

```
GET /api/songs/:id/lyrics/translation?lang=en
→ { lang, provider, synced, lines: [{ time, text, translation }] }
409 no_provider   provider is 'none'
409 no_key        provider set but no key saved
424 provider_failed / bad_response
```

Models are fixed constants in `apps/server/src/services/translation.ts`
(`claude-sonnet-4-5`, `gpt-4o-mini`). Whether the translation line is shown is
a per-device toggle (localStorage), since it is about the screen, not the library.

## Lyric timing editor

For songs with plain (unsynced) lyrics or none at all, press the **clock**
button in the panel (or the "type and sync them yourself" link in the empty
state). It works in two steps and is built for a thumb as much as a keyboard:

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

## Files

| Area | Where |
|---|---|
| Contract | `packages/shared/src/schemas/lyrics.ts`, settings keys in `schemas/settings.ts` |
| Script detection, LRC writer | `packages/shared/src/script.ts`, `lrcBuild.ts` (+ tests) |
| Migration | `apps/server/src/db/migrate.ts` — v2: `lyrics_fts`, `lyrics_index`, `secrets` |
| Server | `services/romanization.ts`, `translation.ts`, `lyricsCache.ts`, `lyricsIndex.ts`; `repositories/lyricsSearch.ts`, `secrets.ts`; `routes/lyrics.ts` |
| Web | `components/LyricsPanel.tsx`, `LyricsSyncEditor.tsx`, `LyricsSettings.tsx`; Lyrics group in `CommandPalette.tsx` |
