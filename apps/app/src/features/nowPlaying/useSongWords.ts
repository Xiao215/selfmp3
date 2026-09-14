import { useMemo } from 'react'
import { detectLyricsLanguage, parseLyrics, type LyricsLanguage, type Song } from '@selfmp3/shared'
import { ApiError, useLibrary, useLyrics } from '@selfmp3/client'
import { resolveSongWords, type SongWords } from './nowPlaying.model'
import { setRomanizationOn, useRomanizationOn } from './romanizationPref'

/** A tag called "instrumental" counts, since that is how many people already say it. */
const INSTRUMENTAL_TAG = 'instrumental'

/**
 * A song's words, and the romanization switch: the web's `useSongLyrics`.
 *
 * The romanized lines are made on the server, which has the dictionaries, and
 * come with the words from wherever the words come from: the server's own lyrics
 * answer, or the bucket, where they are uploaded beside the lyrics. The switch
 * is this device's, and only decides whether they are drawn.
 */
export function useSongWords(song: Song): {
  words: SongWords
  language: LyricsLanguage
  romanizationOn: boolean
  setRomanization: (on: boolean) => void
} {
  const library = useLibrary()
  const lyrics = useLyrics(song.id)

  const parsed = useMemo(() => (lyrics.data ? parseLyrics(lyrics.data.text) : null), [lyrics.data])
  const language: LyricsLanguage = useMemo(() => {
    if (!parsed) return 'none'
    return detectLyricsLanguage(parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines)
  }, [parsed])

  const romanizationOn = useRomanizationOn()
  // The romaji comes with the words (LyricsResponse.romanized): nothing more
  // to ask for, and it is there wherever the words are kept.
  const romanized = lyrics.data?.romanized ?? null

  const error = lyrics.error
  const instrumental =
    (error instanceof ApiError && error.code === 'instrumental') ||
    song.instrumental ||
    (library.data?.tags ?? []).some(
      tag => song.tagIds.includes(tag.id) && tag.name.trim().toLowerCase() === INSTRUMENTAL_TAG,
    )

  const words = resolveSongWords({
    loading: lyrics.isLoading,
    parsed,
    romanizationOn,
    romanized,
    offline: error instanceof ApiError && error.isOffline,
    instrumental,
  })

  return {
    words,
    language,
    romanizationOn,
    setRomanization: setRomanizationOn,
  }
}
