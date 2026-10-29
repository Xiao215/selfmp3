import { useState, type ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import MaskedView from '@react-native-masked-view/masked-view'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

/** How far the words fade in at the top and out at the bottom of their box. */
const FADE_TOP = 48
const FADE_BOTTOM = 64

/**
 * A box whose content fades out at its top and bottom edges instead of being
 * sliced there: the lyrics, which scroll under the stage's head and the
 * player bar (P5 A). The fade is a mask, so it shows whatever is behind the
 * page — the cover's light — rather than painting a colour over the words.
 *
 * Here a native mask drawn as a gradient; a browser uses CSS
 * (`FadeEdges.web.tsx`).
 */
export function FadeEdges({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>
  children: ReactNode
}): ReactNode {
  const [height, setHeight] = useState(0)
  const top = height > 0 ? Math.min(0.4, FADE_TOP / height) : 0
  const bottom = height > 0 ? Math.max(0.6, 1 - FADE_BOTTOM / height) : 1
  return (
    <View style={style} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
      <MaskedView
        style={FILL}
        maskElement={
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="fade-edges" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000" stopOpacity={0} />
                <Stop offset={top} stopColor="#000" stopOpacity={1} />
                <Stop offset={bottom} stopColor="#000" stopOpacity={1} />
                <Stop offset="1" stopColor="#000" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade-edges)" />
          </Svg>
        }
      >
        {children}
      </MaskedView>
    </View>
  )
}

const FILL = { flex: 1 } as const
