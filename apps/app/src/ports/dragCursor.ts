import type { ViewStyle } from 'react-native'

/**
 * The pointer over something that drags. Nothing on a phone: there is no
 * pointer to change, and iOS knows no cursor but the default and the
 * pointing hand. The browser's answer is `dragCursor.web.ts`.
 */
export function dragCursor(_dragging: boolean): ViewStyle | undefined {
  return undefined
}
