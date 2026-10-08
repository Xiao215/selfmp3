import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import type { View } from 'react-native'
import { plural } from '@selfmp3/shared'

/**
 * The browser's drag and drop, for dragging songs onto a sidebar playlist.
 *
 * react-native-web hands a ref the DOM element itself, so the page's own
 * `draggable` and drag events do the work: the browser carries the drag image,
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
 * The songs the drag under way carries, for a list that reorders by it
 * (`useDragToReorder`). A drop target cannot read the drag's data until the
 * drop, and a list has to know which of its rows is travelling as it goes.
 */
let carrying: readonly number[] | null = null

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

/**
 * What follows the pointer: a pill naming what is carried — the song, or how
 * many songs — rather than the browser's picture of the row. Several ticked
 * songs travel together, and a picture of the one row under the pointer said
 * otherwise; and a row is the width of the page, so its picture covered the
 * sidebar it was being dragged to.
 *
 * In the page for the moment the browser takes its picture, which it does as
 * the `dragstart` handler returns, and gone straight after.
 */
function showDragImage(event: DragEvent, label: string): void {
  if (!event.dataTransfer) return
  const pill = document.createElement('div')
  pill.textContent = label
  Object.assign(pill.style, {
    position: 'fixed',
    top: '-1000px',
    left: '0',
    maxWidth: '280px',
    padding: '6px 12px',
    borderRadius: '999px',
    // Neutral in both themes, as the platform's own drag badges are.
    background: 'rgba(28, 30, 38, 0.94)',
    color: '#fff',
    font: '600 13px system-ui, -apple-system, sans-serif',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  })
  document.body.appendChild(pill)
  event.dataTransfer.setDragImage(pill, 14, 16)
  setTimeout(() => pill.remove(), 0)
}

export function useSongDragSource(
  ref: RefObject<View | null>,
  {
    songIds,
    title,
    enabled = true,
    onStart,
  }: {
    songIds: () => readonly number[]
    title: string
    enabled?: boolean
    onStart?: () => void
  },
): void {
  // The latest songs and start, read when the drag starts rather than bound once.
  const ids = useRef(songIds)
  const named = useRef(title)
  const started = useRef(onStart)
  useEffect(() => {
    ids.current = songIds
    named.current = title
    started.current = onStart
  }, [songIds, title, onStart])

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
      // Before anything else: a row held a moment before the pointer moved is
      // still pressed in, and goes back to its size as the drag begins.
      started.current?.()
      const carried = ids.current()
      if (!event.dataTransfer || carried.length === 0) return
      const many = plural(carried.length, 'song', 'songs')
      event.dataTransfer.setData(TYPE, JSON.stringify(carried))
      event.dataTransfer.setData('text/plain', many)
      // Copied onto a playlist; moved, within a list you order.
      event.dataTransfer.effectAllowed = 'copyMove'
      showDragImage(event, carried.length === 1 ? named.current : many)
      carrying = carried
      setDragging(true)
    }
    const end = (): void => {
      carrying = null
      setDragging(false)
    }
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
 * The scrolling box a row sits in, between the row and the list's frame: how
 * far it scrolls during a drag is travel the pointer did not make.
 */
function scrollerOf(from: EventTarget | null, frame: HTMLElement): HTMLElement | null {
  for (let at = from instanceof HTMLElement ? from : null; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight)
      return at
    if (at === frame) return null
  }
  return null
}

/**
 * A list whose order is yours, reordered by the browser's own drag: a plain
 * click-drag on a row moves it, with no hold first (small fix 5, 2026-10-08).
 *
 * The row is already draggable — it drags onto a playlist in the sidebar —
 * and one gesture cannot be two, since a drag the browser has begun cannot be
 * turned into a pointer capture or back. So reordering rides the same drag:
 * while it is over the list, the row it started from follows the pointer up
 * and down and the rows around it make room, and a drop in the list is the
 * new order. Carried out of the list, towards the sidebar, the row goes back
 * to its place and the drag is the add-to-playlist drag it always was; a drop
 * on a playlist adds the song there, and the order is left alone.
 *
 * Only a drag of one song from this list reorders: several ticked songs
 * travel to a playlist together, and have no one place to land.
 *
 * Travel is measured from where the drag began, plus however far the list has
 * scrolled since — the browser scrolls it when the pointer nears its edge.
 */
export function useDragToReorder(
  ref: RefObject<View | null>,
  move: {
    enabled: boolean
    onStart: (songId: number) => void
    onMove: (songId: number, dy: number) => void
    /** Let go: the travel it ended at, and 0 when it ended anywhere but the list. */
    onEnd: (songId: number, dy: number) => void
  },
): void {
  const latest = useRef(move)
  useEffect(() => {
    latest.current = move
  })

  const { enabled } = move
  useEffect(() => {
    const node = element(ref)
    if (!node || !enabled) return undefined
    let moving: {
      songId: number
      fromY: number
      scroller: HTMLElement | null
      fromScroll: number
    } | null = null
    const travel = (event: DragEvent): number =>
      moving
        ? event.clientY -
          moving.fromY +
          (moving.scroller ? moving.scroller.scrollTop - moving.fromScroll : 0)
        : 0

    // After the row's own `dragstart`, which says what it carries: the row is
    // where the event starts, and this frame is above it.
    const start = (event: DragEvent): void => {
      const [songId, ...more] = carrying ?? []
      if (songId === undefined || more.length > 0) return
      const scroller = scrollerOf(event.target, node)
      moving = { songId, fromY: event.clientY, scroller, fromScroll: scroller?.scrollTop ?? 0 }
      latest.current.onStart(songId)
    }
    const over = (event: DragEvent): void => {
      if (!moving) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      latest.current.onMove(moving.songId, travel(event))
    }
    const leave = (event: DragEvent): void => {
      if (!moving) return
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return
      // Out of the list: the row goes home while the drag goes on elsewhere.
      latest.current.onMove(moving.songId, 0)
    }
    const drop = (event: DragEvent): void => {
      if (!moving) return
      event.preventDefault()
      const { songId } = moving
      const dy = travel(event)
      moving = null
      latest.current.onEnd(songId, dy)
    }
    // Ended anywhere but the list — on a playlist, outside the window, or
    // called off with Escape. A drop in the list has already been told.
    const end = (): void => {
      if (!moving) return
      const { songId } = moving
      moving = null
      latest.current.onEnd(songId, 0)
    }
    node.addEventListener('dragstart', start)
    node.addEventListener('dragenter', over)
    node.addEventListener('dragover', over)
    node.addEventListener('dragleave', leave)
    node.addEventListener('drop', drop)
    node.addEventListener('dragend', end)
    return () => {
      node.removeEventListener('dragstart', start)
      node.removeEventListener('dragenter', over)
      node.removeEventListener('dragover', over)
      node.removeEventListener('dragleave', leave)
      node.removeEventListener('drop', drop)
      node.removeEventListener('dragend', end)
    }
  }, [ref, enabled])
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
