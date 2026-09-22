import { useEffect, useMemo, useState } from 'react'
import { detectLyricsLanguage, parseLyrics, type LyricsLanguage, type Song } from '@selfmp3/shared'
import { ApiError, useLyrics, usePatchSong } from '@selfmp3/client'
import { forgetNoWords, rememberNoWords, useNoWords } from './noWords'
import { resolveSongWords, type SongWords } from './nowPlaying.model'
import { setRomanizationOn, useRomanizationOn } from './romanizationPref'

/**
 * A song's words, and the romanization switch.
 *
 * The romanized lines are made on the server, which has the dictionaries, and
 * come with the words from wherever the words come from: the server's own lyrics
 * answer, or the bucket, where they are uploaded beside the lyrics. The switch
 * is this device's, and only decides whether they are drawn.
 *
 * A song with no words is simply that: whether the lookup found nothing or
 * answered before that there is nothing (the song's `instrumental` flag, which
 * keeps it off the network on every play), the page shows its visual.
 */
export function useSongWords(song: Song): {
  words: SongWords
  language: LyricsLanguage
  romanizationOn: boolean
  setRomanization: (on: boolean) => void
  /**
   * Ask the lookup again: "Look for lyrics again" under a song's visual. The
   * saved answer that it has none is cleared first — the server only looks a
   * song like that up again once the flag is off — and the words asked for
   * afresh, showing "Looking for lyrics…" meanwhile.
   */
  lookAgain: () => void
} {
  const lyrics = useLyrics(song.id)
  const patchSong = usePatchSong()
  const [looking, setLooking] = useState(false)
  // Asked once a session, not on every play (`noWords.ts`).
  const askedAndNone = useNoWords(song.id)

  const parsed = useMemo(() => (lyrics.data ? parseLyrics(lyrics.data.text) : null), [lyrics.data])
  const language: LyricsLanguage = useMemo(() => {
    if (!parsed) return 'none'
    return detectLyricsLanguage(parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines)
  }, [parsed])

  const romanizationOn = useRomanizationOn()
  // The romaji comes with the words (LyricsResponse.romanized): nothing more
  // to ask for, and it is there wherever the words are kept. Null only while
  // there are no words yet.
  const romanized = lyrics.data ? lyrics.data.romanized : null

  const error = lyrics.error
  const words = resolveSongWords({
    loading: lyrics.isLoading || looking,
    parsed,
    // Asking again by hand is a fresh question, and it shows as one: the flag
    // is on its way off and "Looking for lyrics…" belongs on screen meanwhile.
    instrumental: (song.instrumental || askedAndNone) && !looking,
    romanizationOn,
    romanized,
    offline: error instanceof ApiError && error.isOffline,
  })

  // A lookup that found nothing is remembered for the session, whether the
  // library wrote it down (`instrumental`) or nobody has published any.
  const none = words.status === 'missing' && !words.offline
  useEffect(() => {
    if (none) rememberNoWords(song.id)
  }, [none, song.id])

  const lookAgain = (): void => {
    forgetNoWords(song.id)
    setLooking(true)
    // A library that cannot take the change (a cloud one) still asks again.
    const cleared = song.instrumental
      ? patchSong
          .mutateAsync({ id: song.id, patch: { instrumental: false } })
          .catch(() => undefined)
      : Promise.resolve(undefined)
    void cleared.then(() => lyrics.refetch()).finally(() => setLooking(false))
  }

  return {
    words,
    language,
    romanizationOn,
    setRomanization: setRomanizationOn,
    lookAgain,
  }
}
