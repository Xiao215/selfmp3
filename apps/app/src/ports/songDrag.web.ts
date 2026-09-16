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
    node.draggable = true
    node.addEventListener('dragstart', start)
    node.addEventListener('dragend', end)
    return () => {
      node.draggable = false
      node.removeEventListener('dragstart', start)
      node.removeEventListener('dragend', end)
    }
  }, [ref, enabled])
}

export function useSongDropTarget(
  ref: RefObject<View | null>,
  options: { enabled: boolean; onDrop: (songIds: number[]) => void },
): boolean {
  const [over, setOver] = useState(false)
  const onDrop = useRef(options.onDrop)
  useEffect(() => {
    onDrop.current = options.onDrop
  }, [options.onDrop])

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
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setOver(true)
    }
    const leave = (event: DragEvent): void => {
      // Moving onto a child of the target fires a leave on the target itself.
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return
      setOver(false)
    }
    const drop = (event: DragEvent): void => {
      if (!carriesSongs(event)) return
      event.preventDefault()
      setOver(false)
      setDragging(false)
      try {
        const parsed: unknown = JSON.parse(event.dataTransfer?.getData(TYPE) ?? '[]')
        const songIds = Array.isArray(parsed)
          ? parsed.filter((id): id is number => Number.isInteger(id))
          : []
        if (songIds.length > 0) onDrop.current(songIds)
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
