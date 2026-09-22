import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import type { View } from 'react-native'

/**
 * The browser's drag and drop, for dragging songs onto a sidebar playlist.
 *
 * react-native-web hands a ref the DOM element itself, so the page's own
 * `draggable` and drag events do the work: the browser draws the drag image,
 * scrolls the page near its edges and knows when a drag has left the window,
 * none of which a pan responder would.
 *
 * What is carried is a list of song ids under a type of our own, so a drop
 * target ignores a file, a link or text dragged in from elsewhere.
 */

const TYPE = 'application/x-selfmp3-songs'

let dragging = false
const listeners = new Set<() => void>()

/**
 * While a row is being held to be moved, no row is draggable.
 *
 * The row is the handle for reordering now, and the row is also what drags
 * onto a playlist in the sidebar — one element, two gestures. The hold wins
 * when it activates, which is before the pointer has moved at all, so there
 * is still time to take the attribute away; a `dragstart` that has already
 * fired cannot be taken back (see `useSongDragSource`). Restored on release.
 */
let held = false
const draggables = new Set<(draggable: boolean) => void>()

export function setReorderHold(active: boolean): void {
  if (held === active) return
  held = active
  for (const set of draggables) set(!active)
}

function setDragging(next: boolean): void {
  if (dragging === next) return
  dragging = next
  for (const listener of listeners) listener()
}

function element(ref: RefObject<View | null>): HTMLElement | null {
  return (ref.current as unknown as HTMLElement | null) ?? null
}

export function useSongDragSource(
  ref: RefObject<View | null>,
  songIds: () => readonly number[],
  enabled = true,
): void {
  // The latest songs, read when the drag starts rather than bound once.
  const ids = useRef(songIds)
  useEffect(() => {
    ids.current = songIds
  }, [songIds])

  useEffect(() => {
    const node = element(ref)
    if (!node || !enabled) return undefined
    /*
     * Cancelling a drag once it has started is too late: react-native-web ends
     * whatever gesture is in progress the moment a `dragstart` is dispatched,
     * whether or not anything then prevents it. The only way to keep a gesture
     * is for the browser never to begin a drag, and the only thing it reads
     * for that is the attribute — so a row held to be moved has it taken away
     * before the pointer has travelled at all (`setReorderHold`).
     */
    const setDraggable = (next: boolean): void => {
      node.draggable = next
    }
    const start = (event: DragEvent): void => {
      const carried = ids.current()
      if (!event.dataTransfer || carried.length === 0) return
      event.dataTransfer.setData(TYPE, JSON.stringify(carried))
      event.dataTransfer.setData(
        'text/plain',
        `${carried.length} song${carried.length === 1 ? '' : 's'}`,
      )
      event.dataTransfer.effectAllowed = 'copy'
      setDragging(true)
    }
    const end = (): void => setDragging(false)
    node.draggable = !held
    draggables.add(setDraggable)
    node.addEventListener('dragstart', start)
    node.addEventListener('dragend', end)
    return () => {
      node.draggable = false
      draggables.delete(setDraggable)
      node.removeEventListener('dragstart', start)
      node.removeEventListener('dragend', end)
    }
  }, [ref, enabled])
}

export function useSongDropTarget(
  ref: RefObject<View | null>,
  options: {
    enabled: boolean
    onDrop: (songIds: number[], y: number) => void
    /** Where the pointer is inside this target, in its own points, while over it. */
    onOver?: (y: number) => void
  },
): boolean {
  const [over, setOver] = useState(false)
  const onDrop = useRef(options.onDrop)
  const onOver = useRef(options.onOver)
  useEffect(() => {
    onDrop.current = options.onDrop
    onOver.current = options.onOver
  }, [options.onDrop, options.onOver])

  const { enabled } = options
  useEffect(() => {
    const node = element(ref)
    if (!node || !enabled) return undefined
    const carriesSongs = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes(TYPE) === true
    const hover = (event: DragEvent): void => {
      if (!carriesSongs(event)) return
      // Without this the browser refuses the drop.
      event.preventDefault()
      // Targets nest — a queue row inside the rail — and the innermost one
      // owns the drop, or a song would be added twice (Xiao, 2026-09-22).
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setOver(true)
      onOver.current?.(event.clientY - node.getBoundingClientRect().top)
    }
    const leave = (event: DragEvent): void => {
      // Moving onto a child of the target fires a leave on the target itself.
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return
      setOver(false)
    }
    const drop = (event: DragEvent): void => {
      if (!carriesSongs(event)) return
      event.preventDefault()
      event.stopPropagation()
      setOver(false)
      setDragging(false)
      try {
        const parsed: unknown = JSON.parse(event.dataTransfer?.getData(TYPE) ?? '[]')
        const songIds = Array.isArray(parsed)
          ? parsed.filter((id): id is number => Number.isInteger(id))
          : []
        if (songIds.length > 0)
          onDrop.current(songIds, event.clientY - node.getBoundingClientRect().top)
      } catch {
        // Not ours after all.
      }
    }
    node.addEventListener('dragenter', hover)
    node.addEventListener('dragover', hover)
    node.addEventListener('dragleave', leave)
    node.addEventListener('drop', drop)
    return () => {
      node.removeEventListener('dragenter', hover)
      node.removeEventListener('dragover', hover)
      node.removeEventListener('dragleave', leave)
      node.removeEventListener('drop', drop)
      setOver(false)
    }
  }, [ref, enabled])

  return over
}

/**
 * A control inside a draggable row that has a drag of its own.
 *
 * A song row is a drag source, so it carries the page's `draggable`, and a
 * press anywhere inside it that then moves starts the browser's own drag —
 * which cancels the pointer stream, so a playlist's grip got one move event
 * and then nothing. `draggable="false"` on the control is not enough: the
 * browser keeps looking up the tree for something that *is* draggable and
 * finds the row. So the control marks itself, and the row's own drag stands
 * down when the press began inside a mark.
 */

export function useSongDragActive(): boolean {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => dragging,
    () => false,
  )
}
