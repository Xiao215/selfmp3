import { useMemo } from 'react'
import { detectLyricsLanguage, parseLyrics, type LyricsLanguage, type Song } from '@selfmp3/shared'
import { ApiError, useLibrary, useLyrics } from '@selfmp3/client'
import { useConnection } from '../../server/ConnectionProvider'
import { resolveSongWords, type SongWords } from './nowPlaying.model'
import { setRomanizationOn, useRomanizationOn } from './romanizationPref'

/** A tag called "instrumental" counts, since that is how many people already say it. */
const INSTRUMENTAL_TAG = 'instrumental'

/**
 * A song's words, and the romanization switch: the web's `useSongLyrics`.
 *
 * Romanization is worked out on the Mac and is a synced setting, since it is
 * about the library rather than the device. A library read from the cloud has
 * no Mac to ask, so there it is simply not offered.
 */
export function useSongWords(song: Song): {
  words: SongWords
  language: LyricsLanguage
  romanizationOn: boolean
  setRomanization: (on: boolean) => void
} {
  const { fromCloud } = useConnection()
  const library = useLibrary()
  const lyrics = useLyrics(song.id)

  const parsed = useMemo(() => (lyrics.data ? parseLyrics(lyrics.data.text) : null), [lyrics.data])
  const language: LyricsLanguage = useMemo(() => {
    if (!parsed || fromCloud) return 'none'
    return detectLyricsLanguage(parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines)
  }, [parsed, fromCloud])

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
