import { taken, type Review } from '@selfmp3/client'
import type { ImportNames, ImportPreviewItem } from '@selfmp3/shared'

/**
 * A9 · the model's part, as Import's review draws it (docs/features/ai.md):
 * the rows the model is asked about, and its answer turned into a
 * suggestion per row.
 */

/** The most rows one review asks about: as many as the server reads in one request. */
const MOST_ROWS = 300

type Names = Pick<ImportPreviewItem, 'title' | 'artist' | 'album'>

/** A row asked about: where it is in the review, and its names and length then. */
export interface AskedRow extends Names {
  readonly index: number
  readonly duration: number
}

/** The model's names for one row, and the names it read, which it only fits while they last. */
export interface NameSuggestion extends Names {
  readonly why: string
  readonly from: Names
}

/** The rows worth asking about: a song coming in, with a name. One the library has is not. */
export function rowsToAsk(review: Review): AskedRow[] {
  return review.items
    .flatMap((item, index) =>
      taken(item) || item.title.trim() === ''
        ? []
        : [
            {
              index,
              title: item.title,
              artist: item.artist,
              album: item.album,
              duration: item.duration,
            },
          ],
    )
    .slice(0, MOST_ROWS)
}

/** The answer, by each row's place in the review. */
export function suggestionsByRow(
  asked: readonly AskedRow[],
  answer: ImportNames,
): ReadonlyMap<number, NameSuggestion> {
  const out = new Map<number, NameSuggestion>()
  for (const each of answer.suggestions) {
    const row = asked[each.row]
    if (!row) continue
    out.set(row.index, {
      title: each.title,
      artist: each.artist,
      album: each.album,
      why: each.why,
      from: { title: row.title, artist: row.artist, album: row.album },
    })
  }
  return out
}

/**
 * A row's suggestion while its names are still the ones the model read: once
 * they are fixed by hand, or the suggestion taken, there is nothing to offer.
 */
export function suggestionFor(
  item: Names,
  suggestion: NameSuggestion | undefined,
): NameSuggestion | undefined {
  if (!suggestion) return undefined
  const { from } = suggestion
  const same = item.title === from.title && item.artist === from.artist && item.album === from.album
  return same ? suggestion : undefined
}

/** A suggestion in a line: the names it gives, the album only when there is one. */
export function suggestionWords(suggestion: Names): string {
  return [suggestion.title, suggestion.artist || 'Unknown artist', suggestion.album]
    .filter(Boolean)
    .join(' · ')
}
