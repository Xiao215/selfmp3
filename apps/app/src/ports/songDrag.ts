import type { RefObject } from 'react'
import type { View } from 'react-native'

/**
 * Dragging songs onto a playlist in the sidebar.
 *
 * A browser only. A phone has no sidebar to drop on and no pointer to drag
 * with — there, pinned playlists come first in "Add to playlist" instead — so
 * every hook here does nothing. The browser's answer, built on the page's own
 * drag and drop, is `songDrag.web.ts`.
 */

/**
 * Make this view draggable, carrying the songs `songIds` returns when the drag
 * starts — named by `title` when it is one song, counted when it is several.
 * `onStart` runs first, as the drag begins.
 */
export function useSongDragSource(
  _ref: RefObject<View | null>,
  _drag: {
    songIds: () => readonly number[]
    title: string
    enabled?: boolean
    onStart?: () => void
  },
): void {}

/** Let songs be dropped here. True while a drag carrying songs is over it. */
export function useSongDropTarget(
  _ref: RefObject<View | null>,
  _options: {
    enabled: boolean
    onDrop: (songIds: number[], y: number) => void
    onOver?: (y: number) => void
  },
): boolean {
  return false
}

/**
 * Reorder a list by the same drag that carries a row to a playlist: a plain
 * drag with a mouse. A phone holds a row to move it instead (`HoldToReorder`).
 */
export function useDragToReorder(
  _ref: RefObject<View | null>,
  _move: {
    enabled: boolean
    onStart: (songId: number) => void
    onMove: (songId: number, dy: number) => void
    onEnd: (songId: number, dy: number) => void
  },
): void {}

/** True while songs are being dragged anywhere, so drop targets can say so. */
export function useSongDragActive(): boolean {
  return false
}

/**
 * Stand every row's own drag down while one is held to be moved. Nothing on a
 * phone, where no row is draggable to begin with.
 */
export function setReorderHold(_active: boolean): void {}
