import { artistOr, formatDuration, fromSqliteTime, plural } from '@selfmp3/shared'
import type { Song, SongSortField } from '@selfmp3/shared'

/**
 * A long song list's scrollbar on a computer, as numbers (`ports/listScrollbar`):
 * where the thumb sits, which song a scroll position is at, and what the bubble
 * beside a dragged thumb says about it (Xiao chose B, C and E of the scrollbar
 * mock, 2026-10-02).
 */

/** What the bubble says about the song at the top of the list. */
export type ScrollLabel = (song: Song, index: number, count: number) => string

/** "12 of 88": a list in its own order, a playlist's or a search's. */
export const positionLabel: ScrollLabel = (_song, index, count) =>
  `${(index + 1).toLocaleString('en')} of ${count.toLocaleString('en')}`

/**
 * The first letter, without its accent and in capitals; the first kana or
 * kanji as it is; # for a digit or a sign. What a list sorted by name is at.
 */
export function initialOf(text: string): string {
  const first = [...text.trim().normalize('NFKC')][0]
  if (!first) return '#'
  // A Latin letter without its accent; a kana keeps its voicing mark (が, not か).
  const base = [...first.normalize('NFD')][0] ?? first
  if (/^[a-z]$/i.test(base)) return base.toUpperCase()
  if (/^\p{L}$/u.test(first)) return first.toLocaleUpperCase('en')
  return '#'
}

/** "Sep 25", or "Sep 25, 2024" for a day in another year than `now`'s. */
export function dayLabel(time: string, now: Date): string {
  const day = new Date(fromSqliteTime(time))
  if (Number.isNaN(day.getTime())) return ''
  return day.toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/** What the bubble says in a list sorted by `field`: the part of the sort the song is in. */
export function sortLabel(field: SongSortField, now: Date = new Date()): ScrollLabel {
  switch (field) {
    case 'title':
      return song => initialOf(song.title)
    case 'artist':
      return song => artistOr(song.artist)
    case 'album':
      return song => song.album || 'No album'
    case 'addedAt':
      return song => dayLabel(song.addedAt, now)
    case 'lastPlayedAt':
      return song => (song.lastPlayedAt ? dayLabel(song.lastPlayedAt, now) : 'Not played yet')
    case 'duration':
      return song => formatDuration(song.duration)
    case 'playCount':
      return song =>
        song.playCount > 0 ? plural(song.playCount, 'play', 'plays') : 'Not played yet'
    case 'random':
      return positionLabel
  }
}

/** A list's scroll, in points: what shows, how much there is, and the track's length. */
export interface ScrollMetrics {
  readonly viewport: number
  readonly content: number
  readonly track: number
}

/** The shortest a thumb gets, so that one in a list of thousands can still be held. */
export const MIN_THUMB = 36

/** The thumb's length: the share of the list on screen, never shorter than `MIN_THUMB`. */
export function thumbLength({ viewport, content, track }: ScrollMetrics): number {
  if (content <= 0) return track
  return Math.max(MIN_THUMB, Math.min(track, (track * viewport) / content))
}

/** How far down the list can scroll. */
function scrollRange({ viewport, content }: ScrollMetrics): number {
  return Math.max(0, content - viewport)
}

/** Where the thumb's top is on the track at a scroll position. */
export function thumbOffset(scrollTop: number, metrics: ScrollMetrics): number {
  const range = scrollRange(metrics)
  if (range === 0) return 0
  const room = metrics.track - thumbLength(metrics)
  return (Math.max(0, Math.min(range, scrollTop)) / range) * room
}

/** The scroll position that puts the thumb's top at `offset`: a drag, or a click on the track. */
export function scrollForThumb(offset: number, metrics: ScrollMetrics): number {
  const room = metrics.track - thumbLength(metrics)
  if (room <= 0) return 0
  return (Math.max(0, Math.min(room, offset)) / room) * scrollRange(metrics)
}

/**
 * A list's rows, for finding one without measuring it: they start under the
 * header, end where the footer begins (`content`), and share that run evenly.
 * Exact for the Library, whose rows are all one height; near enough on a page
 * whose rows have album headings among them.
 */
export interface RowSpan {
  readonly header: number
  readonly content: number
  readonly count: number
}

function rowHeight({ header, content, count }: RowSpan): number {
  return count > 0 ? Math.max(0, content - header) / count : 0
}

/** Where row `index` starts, from the top of the list's content. */
export function rowTop(index: number, span: RowSpan): number {
  return span.header + index * rowHeight(span)
}

/** The row at the top of the list at a scroll position. */
export function rowAt(scrollTop: number, span: RowSpan): number {
  const height = rowHeight(span)
  if (span.count === 0 || height === 0) return 0
  const index = Math.floor((scrollTop - span.header) / height)
  return Math.max(0, Math.min(span.count - 1, index))
}

/** Whether row `index` is anywhere in the window at a scroll position. */
export function rowOnScreen(
  index: number,
  scrollTop: number,
  viewport: number,
  span: RowSpan,
): boolean {
  const top = rowTop(index, span)
  return top + rowHeight(span) > scrollTop && top < scrollTop + viewport
}

/**
 * Where a row sits on the track: the middle of where the thumb would be with
 * the row in the middle of the window, which is also where `scrollToRow`
 * takes the list.
 */
export function rowMark(index: number, metrics: ScrollMetrics, span: RowSpan): number {
  return thumbOffset(scrollToRow(index, metrics, span), metrics) + thumbLength(metrics) / 2
}

/** The scroll position with row `index` in the middle of the window. */
export function scrollToRow(index: number, metrics: ScrollMetrics, span: RowSpan): number {
  const middle = rowTop(index, span) + rowHeight(span) / 2 - metrics.viewport / 2
  return Math.max(0, Math.min(scrollRange(metrics), middle))
}
