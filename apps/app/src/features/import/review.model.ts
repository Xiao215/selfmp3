import { plural } from '@selfmp3/shared'
import type { ImportEnqueue, ImportPreviewItem } from '@selfmp3/shared'
import { enqueueRequest, type Review } from '@selfmp3/client'

/**
 * The review of a link, without the screen (docs/ui-mock `P30`, `C14`).
 *
 * Every song starts ticked, and only ticked songs are imported. The client's
 * `Review` already holds the songs coming in as `chosen`, so a row's checkbox
 * takes one from there and puts it back. A song the library already has is
 * never coming in and has no box — it is "In library", and skipped.
 */

/** Whether a row is ticked, unticked, or "In library" with no box at all. */
export type RowState = 'in' | 'yours' | 'out'

export function rowState(review: Review, index: number): RowState {
  if (review.items[index]?.alreadyHave) return 'yours'
  return review.chosen.has(index) ? 'in' : 'out'
}

/**
 * Tick a song's box, or untick it. A song that is yours already stays as it
 * is, since there is nothing to tick.
 */
export function toggleChosen(review: Review, index: number): Review {
  const item = review.items[index]
  if (!item || item.alreadyHave) return review
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
      on ? review.items.flatMap((item, index) => (item.alreadyHave ? [] : [index])) : [],
    ),
  }
}

/** What the head's box shows: every song ticked, some of them, or none. */
export function chosenState(review: Review): 'all' | 'some' | 'none' {
  const coming = comingIn(review)
  if (coming === 0) return 'none'
  return coming === review.items.filter(item => !item.alreadyHave).length ? 'all' : 'some'
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

/** How many songs the import button would bring in. */
export function comingIn(review: Review): number {
  return review.items.filter((item, index) => !item.alreadyHave && review.chosen.has(index)).length
}

/** The head's count: "5 of 7 coming in" on a computer, "5 of 7 in" where a phone has less room. */
export function countLabel(review: Review, wide: boolean): string {
  return `${comingIn(review)} of ${review.items.length} ${wide ? 'coming in' : 'in'}`
}

const songs = (count: number): string => `${plural(count, 'song', 'songs')}`

/** The commit pill: "Import 5 songs". */
export function importLabel(count: number): string {
  return `Import ${songs(count)}`
}

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
  if (review.playlistTitle) return 'From this link · playlist'
  return review.items.length === 1 ? 'From this link · song' : 'From these links'
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
    chosen: new Set([...review.chosen].filter(index => !review.items[index]?.alreadyHave)),
  }
  return enqueueRequest(coming, { tagIds, playlistId: null, createPlaylist: false })
}
