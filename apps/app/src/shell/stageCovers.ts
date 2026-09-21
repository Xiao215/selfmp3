import { useSyncExternalStore } from 'react'

/**
 * Whether Now Playing has finished rising and now covers the window.
 *
 * On a computer the page covers the sidebar, and it does that by the shell
 * taking the sidebar out of the layout — which makes the page underneath
 * reflow to the full width. Done the moment the address changes, that reflow
 * happens while the page is still rising and in plain view: Home's greeting
 * jumps left, its tiles widen, and the whole page looks as though it has
 * redrawn itself (Xiao's recording, 2026-09-21).
 *
 * So the page says when it has the window, and the shell waits for that. The
 * reflow still happens; it happens behind a page that covers it. On the way
 * out the page says so before it starts down, so what is uncovered is a page
 * already laid out as it will stay.
 */

let covers = false
const listeners = new Set<() => void>()

export function setStageCovers(next: boolean): void {
  if (next === covers) return
  covers = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = (): boolean => covers

export function useStageCovers(): boolean {
  return useSyncExternalStore(subscribe, read, read)
}
