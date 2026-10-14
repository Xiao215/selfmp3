import { useRouter } from 'expo-router'
import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'
import { useLayoutValue } from './useLayout'

/**
 * Whether the command palette is open.
 *
 * Two things open it and neither draws it: the sidebar's Search row, and the
 * installed app's View › Search (⌘K), which arrives as a menu command. The
 * shell draws the palette, so the choice lives here rather than in any of the
 * three.
 */
const open = createValueStore(false)

export const setPaletteOpen = open.set

export function usePaletteOpen(): boolean {
  return useValueStore(open)
}

/**
 * The one Search: the page on a phone, the palette over the page on a computer
 * (docs/ui-mock `P18`, `P19`, `C05`). For the doors into it on Home, Library
 * and Tags, which all open the same search.
 */
export function useOpenSearch(): () => void {
  const wide = useLayoutValue(layout => layout.wide)
  const router = useRouter()
  return () => {
    if (wide) setPaletteOpen(true)
    else router.navigate('/search')
  }
}

/** Words the palette opens with, once: Ask's question already begun. */
let startWith = ''

/** The palette's first words, taken as it opens. */
export function takePaletteStart(): string {
  const words = startWith
  startWith = ''
  return words
}

/**
 * The one Search opened with words already typed, for a door that begins a
 * question for you — an empty room's Ask for songs: the page with `?q=` on a
 * phone, the palette over the page on a computer.
 */
export function useOpenAsk(): (words: string) => void {
  const wide = useLayoutValue(layout => layout.wide)
  const router = useRouter()
  return words => {
    if (wide) {
      startWith = words
      setPaletteOpen(true)
    } else router.navigate({ pathname: '/search', params: { q: words } })
  }
}
