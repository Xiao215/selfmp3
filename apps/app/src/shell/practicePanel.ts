import { useSyncExternalStore } from 'react'

/**
 * Whether the desktop's practice panel is open, and which of its groups it was
 * opened for.
 *
 * The player bar's metronome opens it and the shell draws it beside the page,
 * so the choice lives here rather than in either. A phone opens the same panel
 * as a sheet from Now Playing, which keeps its own state.
 *
 * The group is how the bar's "1.25×" opens Practice at Speed: speed has no
 * control of its own on the bar any more, so the value that says the speed
 * changed is also the way to change it back.
 */

/** A group the panel can be asked to open on. */
type PracticeSection = 'loop' | 'speed' | 'key'

let open = false
let section: PracticeSection | null = null
const listeners = new Set<() => void>()

/** Read outside a render — the application menu's toggle, which is not one. */
export function practiceOpen(): boolean {
  return open
}

/** `at`: the group to open and scroll to; none opens the panel as it last was. */
export function setPracticeOpen(next: boolean, at: PracticeSection | null = null): void {
  const nextSection = next ? at : null
  if (next === open && nextSection === section) return
  open = next
  section = nextSection
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePracticeOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => open,
  )
}

/** The group the open panel was asked to show, if any. */
export function usePracticeSection(): PracticeSection | null {
  return useSyncExternalStore(
    subscribe,
    () => section,
    () => section,
  )
}
