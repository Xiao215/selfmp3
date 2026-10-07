import { useRouter } from 'expo-router'
import type { SearchScope } from '../features/search/search.model'
import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'
import { useLayout } from './useLayout'

/**
 * Whether the command palette is open.
 *
 * Two things open it and neither draws it: the sidebar's Search row, and the
 * installed app's View › Search (⌘K), which arrives as a menu command. The
 * shell draws the palette, so the choice lives here rather than in any of the
 * three — the same arrangement as `practicePanel.ts`.
 */
const open = createValueStore(false)

export const setPaletteOpen = open.set

export function usePaletteOpen(): boolean {
  return useValueStore(open)
}

/**
 * The one Search, starting on `scope`: the page on a phone, the palette over
 * the page on a computer (docs/ui-mock `P18`, `P19`, `C05`). For the doors
 * into it on Home, Library and Tags.
 */
export function useOpenSearch(scope: SearchScope): () => void {
  const { wide } = useLayout()
  const router = useRouter()
  return () => {
    if (wide) setPaletteOpen(true)
    else router.navigate({ pathname: '/search', params: { scope } })
  }
}
