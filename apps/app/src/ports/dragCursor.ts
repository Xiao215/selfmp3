import type { ViewStyle } from 'react-native'

/**
 * The pointer over something that drags. Nothing on a phone: there is no
 * pointer to change, and iOS knows no cursor but the default and the
 * pointing hand. The browser's answer is `dragCursor.web.ts`.
 *
 * This port exists for `grab` and `grabbing` alone. React Native's own
 * `cursor` is typed `'auto' | 'pointer'` (StyleSheetTypes), so
 * `cursor: 'pointer'` is a style property like any other and wants no port —
 * the seek bar and the volume slider set it straight.
 */
export function dragCursor(_dragging: boolean): ViewStyle | undefined {
  return undefined
}
