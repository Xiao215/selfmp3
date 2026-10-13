import { useDeferredValue, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LyricsSearchHit } from '@selfmp3/shared'
import { clientApi, queryKeys, STALE } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useDebounced } from '../../ui/useDebounced'
import { asksOnEnter } from '../smart/smart.model'
import { useSmartSwitches } from '../smart/useSmartSwitches'
import { lyricsQueryFor } from './search.model'

const NO_HITS: readonly LyricsSearchHit[] = []

/**
 * How many lines of lyrics are asked for: Search's whole section. The palette
 * shows the first few. One number, because both are kept under the one query
 * key, and a palette's six cached there were what Search's "See all" showed.
 */
const LYRICS_ASKED = 20

interface LibrarySearch<Found> {
  /** The words the results are for: the field's, a beat behind it. */
  readonly shown: string
  /** What those words found. */
  readonly found: Found
  /** Lines of lyrics that match, from the server's index; none from the cloud. */
  readonly lyricHits: readonly LyricsSearchHit[]
  /** What the words in the field now find, for a key that cannot wait for the results. */
  readonly foundNow: () => Found
  /**
   * Whether these words, having found this, are a question for Ask (I1): Ask
   * is on, they are long enough to ask, and nothing on the device matches.
   * The palette puts its Ask row first then, so Enter takes it.
   */
  readonly asks: (found: Found, text: string) => boolean
  /**
   * Whether Enter asks: `asks` for the words as they are now — not as the
   * results last caught up with them, since a paste then Enter lands in that
   * beat, finds "nothing" and asks about a song it had.
   */
  readonly enterAsks: () => boolean
}

/**
 * The search under Search and the command palette: the same words find the
 * same things in both, a beat behind the field, and Enter decides on what is
 * typed now. Each surface groups what is found its own way (`search`) and
 * says how many results that is (`matches`).
 *
 * The two had been written apart and fixed apart: Enter counting the words
 * as they are reached the palette first and Search a week later, and the
 * Chinese input method's fix the same.
 */
export function useLibrarySearch<Found>(
  query: string,
  {
    search,
    matches,
  }: {
    /** What a query finds. Kept the same function while the library is the same, so the results are not worked out again. */
    search: (text: string) => Found
    /** How many results a find is, with this many lines of lyrics. */
    matches: (found: Found, lyricHits: number) => number
  },
): LibrarySearch<Found> {
  const { fromCloud } = useConnection()
  const switches = useSmartSwitches()
  // The field keeps up with the fingers; the results, a search of the whole
  // library, follow when there is time, and are skipped for letters typed
  // faster than they can be drawn.
  const shown = useDeferredValue(query)
  const found = useMemo(() => search(shown), [search, shown])

  const lyricsQuery = lyricsQueryFor(useDebounced(query, 180))
  const lyrics = useQuery({
    queryKey: queryKeys.lyricsSearch(lyricsQuery),
    queryFn: () => clientApi().lyricsSearch(lyricsQuery, LYRICS_ASKED),
    // The lyrics index is the server's; a library in the cloud has no words to search.
    enabled: lyricsQuery !== '' && !fromCloud,
    retry: false,
    staleTime: STALE.minute,
    placeholderData: previous => previous,
  })
  const lyricHits = shown.trim() !== '' && lyricsQuery ? (lyrics.data?.hits ?? NO_HITS) : NO_HITS

  const foundNow = (): Found => (shown === query ? found : search(query))
  const asks = (them: Found, text: string): boolean =>
    switches.ask && asksOnEnter(text, matches(them, lyricHits.length))
  return {
    shown,
    found,
    lyricHits,
    foundNow,
    asks,
    enterAsks: () => asks(foundNow(), query),
  }
}
