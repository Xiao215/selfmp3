import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { detectLyricsLanguage, parseLyrics, type LyricsLanguage, type Song } from '@selfmp3/shared'
import {
  ApiError,
  clientApi,
  queryKeys,
  useLibrary,
  useLyrics,
  useSettings,
  useUpdateSettings,
} from '@selfmp3/client'
import { useConnection } from '../../server/ConnectionProvider'
import { resolveSongWords, type SongWords } from './nowPlaying.model'

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
  const settings = useSettings()
  const updateSettings = useUpdateSettings()
  const lyrics = useLyrics(song.id)

  const parsed = useMemo(() => (lyrics.data ? parseLyrics(lyrics.data.text) : null), [lyrics.data])
  const language: LyricsLanguage = useMemo(() => {
    if (!parsed || fromCloud) return 'none'
    return detectLyricsLanguage(parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines)
  }, [parsed, fromCloud])

  const romanizationOn = settings.data?.lyricsRomanization === 'on'
  const romanized = useQuery({
    queryKey: [...queryKeys.lyrics(song.id), 'romanized', lyrics.data?.text ?? ''],
    queryFn: () => clientApi().romanizedLyrics(song.id),
    enabled: romanizationOn && language !== 'none' && !!lyrics.data,
    retry: false,
    staleTime: 60 * 60_000,
  })

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
    romanized: romanized.data ? romanized.data.lines.map(line => line.romanized) : null,
    offline: error instanceof ApiError && error.isOffline,
    instrumental,
  })

  return {
    words,
    language,
    romanizationOn,
    setRomanization: on => updateSettings.mutate({ lyricsRomanization: on ? 'on' : 'off' }),
  }
}
