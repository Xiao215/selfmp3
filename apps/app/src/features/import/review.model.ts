import type { ImportEnqueue, ImportPreviewItem } from '@selfmp3/shared'
import { enqueueRequest, type Review } from '@selfmp3/client'

/**
 * The review of a link, without the screen (docs/ui-mock `P30`, `C14`).
 *
 * Every song is coming in unless it is left out: there are no checkboxes. The
 * client's `Review` already holds the songs coming in as `chosen`, so leaving
 * one out takes it from there and bringing it back puts it back; the words
 * change, the shape does not. A song the library already has is never coming
 * in and cannot be brought back — it is "Yours already", and skipped.
 */

/** What a row says at its end: its length, "Yours already", or "Left out". */
export type RowState = 'in' | 'yours' | 'out'

export function rowState(review: Review, index: number): RowState {
  if (review.items[index]?.alreadyHave) return 'yours'
  return review.chosen.has(index) ? 'in' : 'out'
}

/**
 * Leave a song out, or bring a left-out one back: a swipe on a phone, the
 * row's "Leave out" on a computer. A song that is yours already stays as it
 * is, since there is nothing to bring back.
 */
export function toggleLeftOut(review: Review, index: number): Review {
  const item = review.items[index]
  if (!item || item.alreadyHave) return review
  const chosen = new Set(review.chosen)
  if (chosen.has(index)) chosen.delete(index)
  else chosen.add(index)
  return { ...review, chosen }
}

/** What a song can be renamed to. There is no album field (`S3`, Import). */
export type Rename = Partial<Pick<ImportPreviewItem, 'title' | 'artist'>>

/** Correct one song's title or artist; the url, which is what plays and downloads, stays. */
export function renameSong(review: Review, index: number, rename: Rename): Review {
  const patch: Rename = {}
  if (rename.title !== undefined) patch.title = rename.title
  if (rename.artist !== undefined) patch.artist = rename.artist
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

const songs = (count: number): string => `${count} ${count === 1 ? 'song' : 'songs'}`

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
