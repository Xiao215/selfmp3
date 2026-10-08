import {
  clamp,
  plural,
  formatLongDuration,
  playNext,
  queueSections,
  withoutSongs,
  type QueueEntry,
  type QueueState,
  type Song,
} from '@selfmp3/shared'

/**
 * Up next, the parts that are decisions rather than drawing (docs/ui-mock
 * `P25`, `C11`, `C12`): which rows it shows and in what order, when a swipe or
 * a drag means "remove", and how an Undo puts a song back where it was. The
 * sheet and the rail both draw from here, so a phone and a computer cannot
 * disagree about what a gesture did.
 */

/** A row of Up next: the song, and where it sits in the queue. */
export interface QueueRow {
  readonly song: Song
  /** Its index in the queue's `items`: what a jump, a move or a removal is addressed by. */
  readonly index: number
}

/**
 * The queue as rows: playing, next, played (`queueSections`), each resolved
 * to its song. A song that has gone from the library since it was queued is
 * left out rather than drawn as a blank, and the rows that remain keep their
 * real indexes, so the gap costs nothing.
 */
export function queueRows(
  state: QueueState,
  byId: ReadonlyMap<number, Song>,
): { playing: QueueRow | null; next: QueueRow[]; played: QueueRow[] } {
  const sections = queueSections(state)
  const resolve = (entries: readonly QueueEntry[]): QueueRow[] =>
    entries.flatMap(entry => {
      const song = byId.get(entry.id)
      return song ? [{ song, index: entry.index }] : []
    })
  const playing = sections.playing ? (resolve([sections.playing])[0] ?? null) : null
  return { playing, next: resolve(sections.next), played: resolve(sections.played) }
}

/** "6 songs" and "24 min": how many are still to come, and for how long. */
function nextTotals(next: readonly QueueRow[]): { songs: string; time: string } {
  const seconds = next.reduce((sum, row) => sum + row.song.duration, 0)
  return { songs: plural(next.length, 'song', 'songs'), time: formatLongDuration(seconds) }
}

/** "6 songs · 24 min": what is still to come, under the rail's title. */
export function nextSummary(next: readonly QueueRow[]): string {
  if (next.length === 0) return 'Nothing after this one'
  const { songs, time } = nextTotals(next)
  return `${songs} · ${time}`
}

/** "Next · 6 songs, 24 min": the label over the sheet's next rows. */
export function nextLabel(next: readonly QueueRow[]): string {
  if (next.length === 0) return 'Nothing next'
  const { songs, time } = nextTotals(next)
  return `Next · ${songs}, ${time}`
}

/**
 * What auto-mix will do next, beside its switch in Up next. A phone's player
 * cannot crossfade, so there it only orders.
 */
export function autoMixLine({
  autoMix,
  canCrossfade,
  upcoming,
  nextCrossfadeSeconds,
}: {
  autoMix: boolean
  canCrossfade: boolean
  upcoming: number
  nextCrossfadeSeconds: number
}): string {
  if (!autoMix) return 'plays in order'
  if (upcoming === 0) return 'nothing to mix yet'
  return canCrossfade
    ? `next crossfade ${nextCrossfadeSeconds}s`
    : 'ordered by tempo, key and energy'
}

// --- the swipe (phone) --------------------------------------------------------

/**
 * How far along its own width a row must be swiped left to be removed
 * (docs/UI-MIGRATION.md, Risks: "a horizontal start within the row and a 30 %
 * threshold"). Less than that and it springs back: a swipe that was really
 * the start of a scroll, or a thumb that changed its mind, removes nothing.
 */
const SWIPE_REMOVE_FRACTION = 0.3

/**
 * How far a finger must travel sideways, and how little up or down, before the
 * row is the swipe's and not the list's. The list scrolls on anything that
 * starts vertical, and the system's back gesture starts from the left edge
 * moving right, which this never answers: it is left only.
 */
export const SWIPE_START = 14
export const SWIPE_VERTICAL_SLOP = 10

/** Where a row sits while it is swiped: only ever to the left, never past its own width. */
export function swipeOffset(dx: number, width: number): number {
  if (dx >= 0) return 0
  return width > 0 ? Math.max(-width, dx) : dx
}

/** Whether a swipe that ended at `dx` removes the row. */
export function swipeRemoves(dx: number, width: number): boolean {
  if (width <= 0) return false
  return -dx >= width * SWIPE_REMOVE_FRACTION
}

// --- the drag (computer) -----------------------------------------------------

/**
 * Past this far beyond the rail's edge a dragged row stops meaning "move" and
 * starts meaning "remove" (`C12`). A few points, so a drag that only grazes
 * the edge while reordering does not threaten the song.
 */
const DRAG_OUT_MARGIN = 8

/** Whether the pointer, at `x`, has left a rail that spans `left` to `right`. */
export function draggedOut(x: number, rail: { left: number; right: number }): boolean {
  return x < rail.left - DRAG_OUT_MARGIN || x > rail.right + DRAG_OUT_MARGIN
}

/**
 * What a finished drag in the rail means. Out past the edge, the row goes;
 * brought back in, it is an ordinary move, or nothing when it came back to
 * its own place ("drag it back in and nothing happens").
 */
export function dragOutcome({
  out,
  from,
  to,
}: {
  out: boolean
  from: number
  to: number
}): { kind: 'remove' } | { kind: 'move'; to: number } | { kind: 'none' } {
  if (out) return { kind: 'remove' }
  if (to === from) return { kind: 'none' }
  return { kind: 'move', to }
}

/**
 * Which queue index a drag has reached: the row it started on moved by the
 * whole rows travelled, kept inside the rows a move may land among. Up next
 * moves only what is still to come, so `first` and `last` are the next rows'
 * indexes; the playing song and the played ones stay put.
 */
export function dragTarget(
  from: number,
  dy: number,
  rowHeight: number,
  { first, last }: { first: number; last: number },
): number {
  const rows = rowHeight > 0 ? Math.round(dy / rowHeight) : 0
  return clamp(from + rows, first, last)
}

// --- Drawing only what is in view -----------------------------------------------

/**
 * Rows drawn either side of what is in view, so a scroll that outruns a render
 * still finds rows there rather than a blank stretch.
 */
export const RAIL_OVERSCAN = 10

/**
 * Which rows of one run of the rail to draw: those a viewport of `span` points
 * starting at `scrollTop` can show, and `RAIL_OVERSCAN` either side. A run is
 * the songs still to come or the songs played, `count` rows of `rowHeight`
 * starting `runTop` points into the list. `end` is exclusive; an empty window
 * is `start === end`.
 *
 * The rail is the whole queue — a shuffled library is thousands of rows — and
 * drawing every one of them took seconds to open (3,000 rows, ~30,000 nodes).
 * A drag never needs a row out of view: the list does not scroll while a row is
 * carried, so the rows a move can land among are already drawn.
 */
export function railWindow({
  count,
  runTop,
  scrollTop,
  span,
  rowHeight,
}: {
  count: number
  runTop: number
  scrollTop: number
  span: number
  rowHeight: number
}): { start: number; end: number } {
  if (count === 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const from = Math.floor((scrollTop - runTop) / rowHeight) - RAIL_OVERSCAN
  const to = Math.ceil((scrollTop + span - runTop) / rowHeight) + RAIL_OVERSCAN
  const start = clamp(from, 0, count)
  const end = clamp(to, start, count)
  return { start, end }
}

// --- Undo ---------------------------------------------------------------------

/**
 * A removed song, remembered by its neighbours rather than by its index. The
 * queue moves on while the Undo waits — a song ends, another is removed — so
 * "put it back at 7" can be the wrong place five seconds later; "put it back
 * before the song that followed it" is still right.
 */
interface Removal {
  readonly id: number
  readonly index: number
  /** The song after it when it went, or null at the end. */
  readonly before: number | null
  /** The song before it when it went, or null at the start. */
  readonly after: number | null
}

export function removalOf(items: readonly number[], index: number): Removal | null {
  const id = items[index]
  if (id === undefined) return null
  return { id, index, before: items[index + 1] ?? null, after: items[index - 1] ?? null }
}

/** Where a removed song goes back into `items` (which does not hold it). */
export function restoreIndex(items: readonly number[], removal: Removal): number {
  if (removal.before !== null) {
    const at = items.indexOf(removal.before)
    if (at >= 0) return at
  }
  if (removal.after !== null) {
    const at = items.indexOf(removal.after)
    if (at >= 0) return at + 1
  }
  return Math.min(removal.index, items.length)
}

/**
 * How Undo puts the song back, in the player's two moves: `playNext` puts it
 * straight after the playing song, and a move from there to where it was. The
 * player has no "insert at", and the queue's rules are not to change for one
 * button; these two already keep the playing song and the shuffle order right.
 *
 * Null when there is nothing to do: the song is playing again already.
 */
export function restoreMoves(
  state: QueueState,
  removal: Removal,
): { from: number; to: number } | null {
  const after = playNext(state, [removal.id])
  if (after === state) return null
  const from = after.items.indexOf(removal.id)
  if (from < 0) return null
  const rest = after.items.filter(id => id !== removal.id)
  return { from, to: restoreIndex(rest, removal) }
}

// --- Clear the rest -------------------------------------------------------------

/**
 * Up next with only the playing song left in it: the phone sheet's "Clear the
 * rest". The songs played go too, and the song playing carries on; with
 * nothing playing there is nothing to keep, and nothing changes.
 */
export function withOnlyPlaying(state: QueueState): QueueState {
  const playing = state.items[state.index]
  if (playing === undefined) return state
  const rest = state.items.filter(id => id !== playing)
  return withoutSongs(state, rest)
}

/**
 * The Undo for "Clear the rest": Up next as it was before, while the song that
 * was playing then still is. Songs added since stay, after the ones put back.
 * Null once another song has started, since "back in their places" then has
 * no place to mean.
 */
export function withRestRestored(now: QueueState, before: QueueState): QueueState | null {
  const playing = before.items[before.index]
  if (playing === undefined || now.items[now.index] !== playing) return null
  const known = new Set(before.items)
  const added = now.items.filter(id => !known.has(id))
  const original = new Set(before.original)
  return {
    ...before,
    // Repeat is a mode, not a part of the list: whatever it is now stays.
    repeat: now.repeat,
    items: [...before.items, ...added],
    original: [...before.original, ...added.filter(id => !original.has(id))],
  }
}

// --- A song played on its own, ended ----------------------------------------------

/**
 * Whether Up next should say "That was the only song" and offer what could
 * come next: one song picked out of Library or the palette played alone
 * (`playAlone`, no source), and it has run out. A list that ran out keeps its
 * plain end; it was asked for whole.
 */
export function onlySongEnded(player: {
  readonly ranOut: boolean
  readonly queue: QueueState
  readonly source: unknown
}): boolean {
  return player.ranOut && player.queue.items.length === 1 && player.source === null
}
