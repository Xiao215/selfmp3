import { useSyncExternalStore } from 'react'

import { createValueStore } from '../state/valueStore.model'

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

interface PanelState {
  readonly open: boolean
  readonly section: PracticeSection | null
}

const panel = createValueStore<PanelState>(
  { open: false, section: null },
  (a, b) => a.open === b.open && a.section === b.section,
)

/** Read outside a render — the application menu's toggle, which is not one. */
export function practiceOpen(): boolean {
  return panel.get().open
}

/** `at`: the group to open and scroll to; none opens the panel as it last was. */
export function setPracticeOpen(next: boolean, at: PracticeSection | null = null): void {
  panel.set({ open: next, section: next ? at : null })
}

const readOpen = (): boolean => panel.get().open
const readSection = (): PracticeSection | null => panel.get().section

export function usePracticeOpen(): boolean {
  return useSyncExternalStore(panel.subscribe, readOpen, readOpen)
}

/** The group the open panel was asked to show, if any. */
export function usePracticeSection(): PracticeSection | null {
  return useSyncExternalStore(panel.subscribe, readSection, readSection)
}
