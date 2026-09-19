import type { ReactNode } from 'react'
import { View } from 'react-native'

/**
 * A design drawn at its own size and shown at another, the way an image is.
 *
 * The look inside is laid out once at `width` × `height` and scaled as a whole
 * to `display` wide, so its type, its dots and its covers keep their
 * proportions at every size. The box around it takes the scaled size, because
 * a transform moves what is drawn and not the room it is given.
 */
export function Scaled({
  width,
  height,
  display,
  children,
}: {
  width: number
  height: number
  display: number
  children: ReactNode
}): ReactNode {
  const scale = display / width
  return (
    <View style={{ width: display, height: height * scale, overflow: 'hidden' }}>
      <View style={{ width, height, transform: [{ scale }], transformOrigin: 'top left' }}>
        {children}
      </View>
    </View>
  )
}
