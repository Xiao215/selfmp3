import type { ViewStyle } from 'react-native'

/** An open hand over something that drags, and a closed one while it is held. */
export function dragCursor(dragging: boolean): ViewStyle | undefined {
  return { cursor: dragging ? 'grabbing' : 'grab' } as unknown as ViewStyle
}
