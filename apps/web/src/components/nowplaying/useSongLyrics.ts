import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  detectLyricsLanguage,
  parseLyrics,
  type LyricsLanguage,
  type LyricsResponse,
  type ParsedLyrics,
  type Song,
} from '@selfmp3/shared'
import { api, ApiError } from '../../lib/api.js'
import { queryKeys, useLibrary, useSettings, useUpdateSettings } from '../../lib/queries.js'

/**
 * What a song has to read, in one of five states.
 *
 * `instrumental` and `missing` are kept apart on purpose: an instrumental is
 * known to have no words and gets its visual without any nudge to add lyrics,
 * while `missing` means we looked and found nothing, and offers to look again
 * or write them.
 */
export type SongWords =
  | { readonly status: 'loading' }
  | {
      readonly status: 'lyrics'
      readonly data: LyricsResponse
      readonly parsed: ParsedLyrics
      /** Pinyin or romaji, one per line; null when off or not lined up. */
      readonly roman: readonly string[] | null
    }
  | { readonly status: 'instrumental' }
  | { readonly status: 'missing'; readonly offline: boolean }

/** A tag called "instrumental" counts, since that is how many people already say it. */
const INSTRUMENTAL_TAG = 'instrumental'

export function lyricsQueryKey(songId: number) {
  return ['lyrics', songId] as const
}

/**
 * The lyrics for a song, resolved the way the server always has: a file next
 * to the audio, the file's own tags, then lrclib.net — cached on disk after the
 * first lookup, so this works offline once a song has been opened.
 *
 * Romanization is the one extra: computed on the server, offline, for Chinese
 * and Japanese. The switch is a synced setting, since it is about the library
 * rather than the device.
 */
export function useSongLyrics(song: Song | null, { enabled = true }: { enabled?: boolean } = {}) {
  const client = useQueryClient()
  const { data: library } = useLibrary()
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const [refreshing, setRefreshing] = useState(false)

  const lyrics = useQuery({
    queryKey: lyricsQueryKey(song?.id ?? 0),
    queryFn: () => (song ? api.lyrics(song.id) : Promise.reject(new Error('no song'))),
    enabled: enabled && song !== null,
    retry: false,
    staleTime: 10 * 60_000,
  })

  const parsed = useMemo(() => (lyrics.data ? parseLyrics(lyrics.data.text) : null), [lyrics.data])
  const language: LyricsLanguage = useMemo(() => {
    if (!parsed) return 'none'
    return detectLyricsLanguage(parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines)
  }, [parsed])

  const romanizationOn = settings?.lyricsRomanization === 'on'
  const romanized = useQuery({
    queryKey: ['lyrics', song?.id ?? 0, 'romanized', lyrics.data?.text ?? ''],
    queryFn: () => (song ? api.romanizedLyrics(song.id) : Promise.reject(new Error('no song'))),
    enabled: enabled && song !== null && romanizationOn && language !== 'none' && !!lyrics.data,
    retry: false,
    staleTime: 60 * 60_000,
  })

  const taggedInstrumental = useMemo(() => {
    if (!song || !library) return false
    return library.tags.some(
      tag => song.tagIds.includes(tag.id) && tag.name.trim().toLowerCase() === INSTRUMENTAL_TAG,
    )
  }, [song, library])

  let words: SongWords
  const error = lyrics.error
  if (!song || lyrics.isLoading) {
    words = { status: 'loading' }
  } else if (lyrics.data && parsed) {
    const count = parsed.lines.length
    // Only trust romanization that lines up exactly; misaligned is worse than none.
    const roman =
      romanizationOn && romanized.data && romanized.data.lines.length === count
        ? romanized.data.lines.map(line => line.romanized)
        : null
    words = { status: 'lyrics', data: lyrics.data, parsed, roman }
  } else if (error instanceof ApiError && error.isOffline) {
    words = { status: 'missing', offline: true }
  } else if (
    (error instanceof ApiError && error.code === 'instrumental') ||
    song.instrumental ||
    taggedInstrumental
  ) {
    words = { status: 'instrumental' }
  } else {
    words = { status: 'missing', offline: false }
  }

  /** Ask lrclib again, skipping whatever is cached. Also how an instrumental is un-marked. */
  const refresh = async (): Promise<void> => {
    if (!song) return
    setRefreshing(true)
    try {
      await api.lyrics(song.id, true)
    } catch {
      // The state below already says what happened.
    } finally {
      await client.invalidateQueries({ queryKey: lyricsQueryKey(song.id) })
      await client.invalidateQueries({ queryKey: queryKeys.library })
      setRefreshing(false)
    }
  }

  return {
    words,
    refresh,
    refreshing,
    /** 'zh' or 'ja' when romanization can do anything for these lyrics. */
    language,
    romanizationOn,
    setRomanization: (on: boolean) =>
      updateSettings.mutate({ lyricsRomanization: on ? 'on' : 'off' }),
  }
}
