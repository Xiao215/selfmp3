import type { SongSortField } from './schemas/common.js'
import type { Song } from './schemas/song.js'

/**
 * The order a list of songs goes in.
 *
 * Here rather than in either client because both need it and, kept apart, the
 * two drifted: sorting by artist broke ties by title in one and by album in
 * the other, and "descending" was a direction in one and a `reverse()` of the
 * finished list in the other — which flips the order *within* every tied run,
 * so the same library read differently on the phone than on the Mac.
 *
 * Three rules, which between them are what the shape of this function is for:
 *
 *  - Only the field being sorted on answers to the direction. The tie-break
 *    does not, so turning the arrow round leaves songs that are equal on that
 *    field exactly where they were rather than reversing them among themselves.
 *  - Every comparison ends in the id, so the order is total: sorting the same
 *    list twice never moves anything.
 *  - A song that has never been played sorts last under "recently played"
 *    whichever way the arrow points. Flipping the direction should not promote
 *    the songs there is nothing to say about.
 */
export function sortSongs(
  songs: readonly Song[],
  field: SongSortField,
  descending = false,
): Song[] {
  const direction = descending ? -1 : 1
  const sorted = [...songs]

  sorted.sort((a, b) => {
    // Settled here rather than in `compare`, because "last" has to mean last
    // in both directions and anything `compare` returns answers to the arrow.
    if (field === 'lastPlayedAt' && !(a.lastPlayedAt && b.lastPlayedAt)) {
      if (a.lastPlayedAt) return -1
      if (b.lastPlayedAt) return 1
      return a.id - b.id
    }

    const primary = compare(a, b, field)
    return primary === 0 ? a.id - b.id : direction * primary
  })

  return sorted
}

/** Songs by one field, before the direction is applied. */
function compare(a: Song, b: Song, field: SongSortField): number {
  switch (field) {
    case 'title':
      return a.title.localeCompare(b.title)
    case 'artist':
      return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
    case 'album':
      return a.album.localeCompare(b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0)
    case 'duration':
      return a.duration - b.duration
    case 'playCount':
      return a.playCount - b.playCount
    case 'lastPlayedAt':
      // Both are set: the other case never reaches here.
      return (a.lastPlayedAt ?? '').localeCompare(b.lastPlayedAt ?? '')
    case 'random':
      /*
       * By id, not at random.
       *
       * `random` is only ever asked for by a smart playlist, which the Mac has
       * already ordered; re-rolling it here would reshuffle the list on every
       * render. A comparator that answers differently each time it is asked is
       * not a comparator anyway — sorts are entitled to assume otherwise, and
       * misbehave when it does not hold.
       */
      return 0
    case 'addedAt':
    default:
      return a.addedAt.localeCompare(b.addedAt)
  }
}
