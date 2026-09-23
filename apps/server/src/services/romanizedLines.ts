import type { RomanizedLyrics, Song } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { LyricsCache } from './lyricsCache.js'
import type { RomanizationService } from './romanization.js'

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
export async function romanizedLines(
  deps: { readonly lyricsCache: LyricsCache; readonly romanization: RomanizationService },
  songId: number,
  text: string,
): Promise<string[] | null> {
  const hash = LyricsCache.hash(text)
  const cached = await deps.lyricsCache.read<RomanizedLyrics>(songId, 'romanized', hash)
  if (cached) return linesOf(cached)

  const { lyrics, complete } = await deps.romanization.romanize(text)
  if (!complete) return null
  await deps.lyricsCache.write(songId, 'romanized', hash, lyrics)
  return linesOf(lyrics)
}

/**
 * Romaji for every song in the library that has words on disk, made once.
 *
 * Runs after boot, behind the lyrics index, so a library imported before
 * romaji travelled with the lyrics has it ready before a phone asks. A
 * song's cache hit is a file check, so a second run is quick; the network is
 * never asked here — words a song does not have yet get their romaji when
 * they arrive.
 */
export async function romanizeLibrary(deps: {
  readonly songs: { all(): readonly Song[] }
  readonly lyrics: { stored(songId: number, audioKey: string): Promise<{ text: string } | null> }
  readonly metadata: { read(path: string): Promise<{ embeddedLyrics: string | null }> }
  readonly lyricsCache: LyricsCache
  readonly romanization: RomanizationService
  readonly logger: Logger
}): Promise<number> {
  let made = 0
  for (const song of deps.songs.all()) {
    if (song.lyricsKind === 'none') continue
    try {
      const stored = await deps.lyrics.stored(song.id, song.path)
      const text =
        stored?.text ??
        (await deps.metadata.read(song.path).catch(() => null))?.embeddedLyrics?.trim()
      if (!text) continue
      const hash = LyricsCache.hash(text)
      if (await deps.lyricsCache.read<RomanizedLyrics>(song.id, 'romanized', hash)) continue
      if ((await romanizedLines(deps, song.id, text)) !== null) made++
    } catch (error) {
      deps.logger.warn('could not romanize a song', {
        songId: song.id,
        message: error instanceof Error ? error.message : String(error),
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
