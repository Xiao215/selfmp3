import { plural } from '@selfmp3/shared'
import type { ImportEnqueue, ImportPreviewItem } from '@selfmp3/shared'
import { enqueueRequest, notFound, stillLooking, taken, type Review } from '@selfmp3/client'

/**
 * The review of a link, without the screen (docs/ui-mock `P30`, `C14`).
 *
 * Every song starts ticked, and only ticked songs are imported. The client's
 * `Review` already holds the songs coming in as `chosen`, so a row's checkbox
 * takes one from there and puts it back. A song the library already has, or
 * one a job is already queued for, is never coming in and has no box — it is
 * "In library" or "In the queue", and skipped.
 */

/**
 * Whether a row is ticked, unticked, "In library" with no box at all, or
 * "Not found": looked for on YouTube by its name, with nothing to download.
 * A song not found has no box either, but still opens, to fix its name and
 * look again.
 */
export type RowState = 'in' | 'yours' | 'out' | 'missing'

export function rowState(review: Review, index: number): RowState {
  const item = review.items[index]
  if (item && taken(item)) return 'yours'
  if (item && notFound(item)) return 'missing'
  return review.chosen.has(index) ? 'in' : 'out'
}

/** A song that can be ticked: neither yours already nor not found. */
const tickable = (item: ImportPreviewItem): boolean => !taken(item) && !notFound(item)

/**
 * Tick a song's box, or untick it. A song that is yours already stays as it
 * is, since there is nothing to tick, as does one not found.
 */
export function toggleChosen(review: Review, index: number): Review {
  const item = review.items[index]
  if (!item || !tickable(item)) return review
  const chosen = new Set(review.chosen)
  if (chosen.has(index)) chosen.delete(index)
  else chosen.add(index)
  return { ...review, chosen }
}

/** The head's box: tick every song that can be ticked, or untick them all. */
export function chooseAll(review: Review, on: boolean): Review {
  return {
    ...review,
    chosen: new Set(
      on ? review.items.flatMap((item, index) => (tickable(item) ? [index] : [])) : [],
    ),
  }
}

/** What the head's box shows: every song ticked, some of them, or none. */
export function chosenState(review: Review): 'all' | 'some' | 'none' {
  const coming = comingIn(review)
  if (coming === 0) return 'none'
  return coming === review.items.filter(tickable).length ? 'all' : 'some'
}

/** What a song can be renamed to: its title, artist and album. The url is not a name. */
export type Rename = Partial<Pick<ImportPreviewItem, 'title' | 'artist' | 'album'>>

/** Correct one song's title, artist or album; the url, which is what plays and downloads, stays. */
export function renameSong(review: Review, index: number, rename: Rename): Review {
  const patch: Rename = {}
  if (rename.title !== undefined) patch.title = rename.title
  if (rename.artist !== undefined) patch.artist = rename.artist
  if (rename.album !== undefined) patch.album = rename.album
  return {
    ...review,
    items: review.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
  }
}

/** How many songs the import button would bring in, counting those still being looked for. */
export function comingIn(review: Review): number {
  return review.items.filter((item, index) => tickable(item) && review.chosen.has(index)).length
}

/** How many ticked songs are still being looked for on YouTube: the import waits for them. */
export function stillFinding(review: Review): number {
  return review.items.filter((item, index) => review.chosen.has(index) && stillLooking(item)).length
}

/** The head's count: "5 of 7 coming in" on a computer, "5 of 7 in" where a phone has less room. */
export function countLabel(review: Review, wide: boolean): string {
  return `${comingIn(review)} of ${review.items.length} ${wide ? 'coming in' : 'in'}`
}

const songs = (count: number): string => `${plural(count, 'song', 'songs')}`

/** The commit pill: "Import 5 songs", or what it is waiting for. */
export function importLabel(count: number, finding = 0): string {
  return finding > 0 ? `Finding ${finding} on YouTube…` : `Import ${songs(count)}`
}

/**
 * Where a row's song comes from, said at its end when the review mixes
 * places: a 网易云 list, whose VIP songs come from YouTube. "Not sure" when
 * the song was found on YouTube by its name and the match is weak, so it is
 * worth a listen; "Looking…" while it is being found. Null when there is
 * nothing to say: every song from where it was linked.
 */
export function sourceWords(
  review: Pick<Review, 'from'>,
  item: ImportPreviewItem,
): { words: string; tone: 'quiet' | 'warn' } | null {
  if (stillLooking(item) && item.source === 'youtube') return { words: 'Looking…', tone: 'quiet' }
  if (notFound(item)) return { words: 'Not found', tone: 'quiet' }
  const mixed = review.from === 'netease'
  const unsure = item.source === 'youtube' && item.youtube?.match === 'unsure'
  if (item.source === 'netease') return mixed ? { words: '网易云', tone: 'quiet' } : null
  if (unsure) return { words: mixed ? 'YouTube · not sure' : 'Not sure', tone: 'warn' }
  return mixed ? { words: 'YouTube', tone: 'warn' } : null
}

/** What the place a review's songs were listed by is called. */
const PLACES = { youtube: 'this link', netease: '网易云', spotify: 'Spotify', list: 'your list' }

/**
 * What the review is called: the playlist's own name when the link was one,
 * the song's when it was one song, and a count when several links were pasted.
 */
export function reviewName(review: Review): string {
  if (review.playlistTitle) return review.playlistTitle
  const only = review.items.length === 1 ? review.items[0] : undefined
  if (only) return only.title || 'Untitled'
  return songs(review.items.length)
}

/** The small line over the name on a computer: where these songs came from. */
export function reviewKicker(review: Review): string {
  const place = PLACES[review.from]
  if (review.from === 'list') return `From ${place}`
  if (review.playlistTitle) return `From ${place} · playlist`
  if (review.items.length === 1) return `From ${place} · song`
  return review.from === 'youtube' ? 'From these links' : `From ${place}`
}

/** Up to four different covers for the head's mosaic, in the list's order. */
export function mosaicCovers(review: Review): readonly string[] {
  const covers: string[] = []
  for (const item of review.items) {
    if (item.thumbnail && !covers.includes(item.thumbnail)) covers.push(item.thumbnail)
    if (covers.length === 4) break
  }
  return covers
}

/**
 * What goes to the server. An import only ever tags (`S3`); it never offers a
 * playlist, so none is asked for and none is made.
 */
export function importRequest(review: Review, tagIds: ReadonlySet<number>): ImportEnqueue {
  const coming: Review = {
    ...review,
    chosen: new Set(
      [...review.chosen].filter(index => {
        const item = review.items[index]
        return item !== undefined && tickable(item)
      }),
    ),
  }
  return enqueueRequest(coming, { tagIds, playlistId: null, createPlaylist: false })
}
