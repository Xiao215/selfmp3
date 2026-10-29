import type { RomanizedLyrics, Song } from '@selfmp3/shared'
import { detectLyricsLanguage, messageOf } from '@selfmp3/shared'
import { CloudError } from '../bucket/store.js'
import type { Logger } from '../logger.js'
import { LyricsCache } from './lyricsCache.js'
import { unattendedLyricText } from './lyrics.js'
import { toLyricLines, type RomanizationService } from './romanization.js'

/**
 * The romanized lines that belong to a lyric text, made once per text.
 *
 * Romaji is part of the lyrics: it is worked out when the words are first
 * seen (import, a fetch, a hand edit, the index's backfill after boot) and
 * kept in the lyrics cache under the text's hash, so an edited lyric gets
 * fresh romaji and an unchanged one is never romanized twice. The lyrics
 * response carries the result, and whatever keeps the words keeps it.
 *
 * Null when the words are not Chinese or Japanese — there is nothing to
 * romanize and nothing to store — and when the dictionary failed to load,
 * which is not remembered, so the next request tries again.
 */
interface RomanizeDeps {
  readonly lyricsCache: LyricsCache
  readonly romanization: RomanizationService
}

export async function romanizedLines(
  deps: RomanizeDeps,
  songId: number,
  text: string,
): Promise<string[] | null> {
  const hash = LyricsCache.hash(text)
  const cached = await deps.lyricsCache.read<RomanizedLyrics>(songId, 'romanized', hash)
  if (cached) return linesOf(cached)
  return romanizeAndKeep(deps, songId, text, hash)
}

/** Romanize a text the cache does not have yet, and keep the result under its hash. */
async function romanizeAndKeep(
  deps: RomanizeDeps,
  songId: number,
  text: string,
  hash: string,
): Promise<string[] | null> {
  const { lyrics, complete } = await deps.romanization.romanize(text)
  if (!complete) return null
  await deps.lyricsCache.write(songId, 'romanized', hash, lyrics)
  return linesOf(lyrics)
}

/**
 * Keep the romanized lines a song's words file in the bucket carried
 * (`lyrics/<sha>.words`) as this server's own, for a text it has none for yet.
 *
 * They were made from the same text by the same dictionaries, on whichever
 * server sent the words up; a server rebuilt from the bucket would otherwise
 * make every song's again. The lines line up with the text's as `romanize`
 * splits it, so the timings and the language are worked out here again, which
 * needs no dictionary. Lines that do not line up are left for `romanize`.
 */
export async function keepRomanizedFromBucket(
  deps: { readonly lyricsCache: LyricsCache },
  songId: number,
  text: string,
  romanized: readonly string[],
): Promise<void> {
  const hash = LyricsCache.hash(text)
  if (await deps.lyricsCache.read<RomanizedLyrics>(songId, 'romanized', hash)) return
  const { synced, lines } = toLyricLines(text)
  if (lines.length !== romanized.length) return
  const language = detectLyricsLanguage(lines.map(line => line.text))
  if (language === 'none') return
  const lyrics: RomanizedLyrics = {
    language,
    synced,
    lines: lines.map((line, index) => ({ ...line, romanized: romanized[index] ?? '' })),
  }
  await deps.lyricsCache.write(songId, 'romanized', hash, lyrics)
}

/**
 * Romaji for every song in the library that has words, made once.
 *
 * Runs after boot, behind the lyrics index, so every song's romaji is ready
 * before a phone asks. Words read from the bucket bring their own
 * (`keepRomanizedFromBucket`), so a rebuilt server makes only what they
 * lacked — words sent up while the Japanese dictionary would not load. A
 * song's cache hit is a file check, so a second run is quick; no words are
 * looked up online here — words a song does not have yet get their romaji
 * when they arrive.
 */
export async function romanizeLibrary(deps: {
  readonly songs: { all(): readonly Song[] }
  readonly lyrics: { stored(songId: number, audioKey: string): Promise<{ text: string } | null> }
  readonly metadata: { read(path: string): Promise<{ embeddedLyrics: string | null }> }
  readonly lyricsCache: LyricsCache
  readonly romanization: RomanizationService
  readonly logger: Logger
  /** The library was closed meanwhile (hub/hub.ts reopens one on a new grant): stop quietly. */
  readonly stopped?: () => boolean
}): Promise<number> {
  let made = 0
  for (const song of deps.songs.all()) {
    if (deps.stopped?.()) break
    if (song.lyricsKind === 'none') continue
    try {
      const text = await unattendedLyricText(deps, song)
      if (!text) continue
      const hash = LyricsCache.hash(text)
      if (await deps.lyricsCache.read<RomanizedLyrics>(song.id, 'romanized', hash)) continue
      if ((await romanizeAndKeep(deps, song.id, text, hash)) !== null) made++
    } catch (error) {
      // Words a song keeps only in the bucket are read from there, and a
      // bucket that refuses one read refuses them all: one warning, not one
      // per song saying the same thing.
      if (error instanceof CloudError) {
        deps.logger.warn('romanizing stopped early', { message: error.message })
        break
      }
      deps.logger.warn('could not romanize a song', {
        songId: song.id,
        message: messageOf(error),
      })
    }
  }
  if (made > 0) deps.logger.info('lyrics romanized', { songs: made })
  return made
}

function linesOf(lyrics: RomanizedLyrics): string[] | null {
  if (lyrics.language === 'none') return null
  return lyrics.lines.map(line => line.romanized)
}
