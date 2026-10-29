import type { ReactNode, RefObject } from 'react'
import type { View } from 'react-native'

/**
 * The browser's "Skip to the page"; a phone has no Tab to skip with
 * (`SkipToPage.web.tsx`).
 */
export function SkipToPage(_props: { pageRef: RefObject<View | null> }): ReactNode {
  return null
}
