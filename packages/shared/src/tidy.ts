import type { Song } from './schemas/song.js'
import type { TidyField, TidyName } from './schemas/ai.js'

/**
 * A song's field as Tidy up's changes say it (docs/features/ai.md, A4): the
 * names as they are, a year as its digits, and a cover as '' when there is
 * none — the one thing a change to a cover is ever made from. The server
 * proposes from it and a device checks a change still holds with it, so the
 * two can never disagree about what a field is now.
 */
export function tidyValue(
  song: Pick<Song, TidyName | 'year' | 'hasArt'>,
  field: TidyField,
): string {
  switch (field) {
    case 'year':
      return song.year === null ? '' : String(song.year)
    case 'cover':
      return song.hasArt ? 'cover' : ''
    default:
      return song[field]
  }
}
