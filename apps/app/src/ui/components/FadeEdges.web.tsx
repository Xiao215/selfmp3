import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'

/** How far the words fade in at the top and out at the bottom of their box. */
const FADE_TOP = 48
const FADE_BOTTOM = 64

const MASK = `linear-gradient(to bottom, transparent, #000 ${FADE_TOP}px, #000 calc(100% - ${FADE_BOTTOM}px), transparent)`

/** The fading box (`FadeEdges.tsx`), in a browser as a CSS mask. */
export function FadeEdges({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>
  children: ReactNode
}): ReactNode {
  return <View style={[style, styles.mask]}>{children}</View>
}

const styles = StyleSheet.create({
  mask: { _web: { maskImage: MASK, WebkitMaskImage: MASK } },
})
