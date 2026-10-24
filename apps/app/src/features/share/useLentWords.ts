import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  detectLyricsLanguage,
  lyricTextLines,
  parseCloudWords,
  parseLyrics,
  type LyricsLanguage,
  type ShareEntry,
  type ShareLink,
} from '@selfmp3/shared'
import { resolveSongWords } from '../nowPlaying/nowPlaying.model'
import { setRomanizationOn, useRomanizationOn } from '../nowPlaying/romanizationPref'
import type { SongLyrics } from '../nowPlaying/useSongWords'
import { shareApi } from './shareLinks'

async function lentText(url: string): Promise<string> {
  const answer = await fetch(url)
  if (!answer.ok) throw new Error(`the doorman answered ${answer.status}`)
  return answer.text()
}

/**
 * A link's song's words, as Now Playing's words take them (`useSongWords`):
 * read from what the link lends — the words file, with their romanized lines
 * in it — rather than asked of a library, which a friend opening the link may
 * not have. Asked for only once `asked`: as the page opens on a computer, and
 * on a phone once the song is loaded or its words are opened, so a link only
 * glanced at on a phone costs its sender no read. The files are named by
 * their hash, so the answer never goes stale.
 */
export function useLentWords(
  link: ShareLink,
  entry: ShareEntry | undefined,
  asked: boolean,
): SongLyrics {
  const lent = entry?.song.lyrics ?? null
  const query = useQuery({
    queryKey: ['share', 'words', link.id, entry?.id ?? ''],
    enabled: asked && entry !== undefined && lent !== null,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const words = parseCloudWords(
        await lentText(shareApi.fileUrl(link, entry?.id ?? '', 'lyrics')),
      )
      if (!words) throw new Error('the words file would not read')
      return words
    },
  })

  const parsed = useMemo(() => (query.data ? parseLyrics(query.data.text) : null), [query.data])
  const language: LyricsLanguage = useMemo(
    () => (parsed ? detectLyricsLanguage(lyricTextLines(parsed)) : 'none'),
    [parsed],
  )
  const romanizationOn = useRomanizationOn(language)
  const words = resolveSongWords({
    loading: query.isLoading,
    parsed,
    // A song lent without words, or whose words could not be read, has none here.
    instrumental: lent === null || query.isError,
    romanizationOn,
    romanized: query.data?.romanized ?? null,
    offline: false,
  })
  return {
    words,
    language,
    romanizationOn,
    setRomanization: (on: boolean) => {
      if (language !== 'none') setRomanizationOn(language, on)
    },
    // There is nowhere else to look: the link lends what its sender has.
    lookAgain: () => undefined,
  }
}
