import type { RefObject } from 'react'
import type { View } from 'react-native'

/**
 * Keeps the keys with a guide while it is up (`guideKeys.web.ts`). A phone has
 * no Tab to walk past it; an iPad's keyboard reaches the page only through key
 * commands, and Escape, the one a guide answers, is its own (`useEscape`).
 */
export function useGuideKeys(_active: boolean, _press: RefObject<View | null>): void {}
