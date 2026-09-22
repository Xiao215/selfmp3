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

/** Make this view draggable, carrying the songs `songIds` returns when the drag starts. */
export function useSongDragSource(
  _ref: RefObject<View | null>,
  _songIds: () => readonly number[],
  _enabled = true,
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

/** True while songs are being dragged anywhere, so drop targets can say so. */
export function useSongDragActive(): boolean {
  return false
}

/**
 * Stand every row's own drag down while one is held to be moved. Nothing on a
 * phone, where no row is draggable to begin with.
 */
export function setReorderHold(_active: boolean): void {}
