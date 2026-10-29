import { useEffect, useRef, type RefObject } from 'react'
import type { View, ViewProps } from 'react-native'

/**
 * A click anywhere on the page, heard without taking it (`pageTap.ts`). Heard
 * on the way down, before a row's own press stops it on the way up. A browser
 * sends no click after a drag, so dragging a song into the rail does not
 * count.
 */
export function usePageTap(
  page: RefObject<View | null>,
  active: boolean,
  onTap: () => void,
): Partial<ViewProps> {
  const tap = useRef(onTap)
  useEffect(() => {
    tap.current = onTap
  }, [onTap])
  useEffect(() => {
    const node = page.current as unknown as HTMLElement | null
    if (!active || !node) return undefined
    const heard = (): void => tap.current()
    node.addEventListener('click', heard, true)
    return () => node.removeEventListener('click', heard, true)
  }, [active, page])
  return {}
}
