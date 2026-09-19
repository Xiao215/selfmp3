import { useId } from 'react'
import type { ReactNode } from 'react'
import { Image, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

/**
 * A page lit by its covers (docs/ui-mock `P08`, `P10`, `P15`): the cover's
 * colour washing down from the top into the ground, and, where the page has
 * one cover to show, that cover itself behind the head, fading out.
 *
 * It fills whatever holds it, so the caller decides how far down the light
 * reaches; a tag's page keeps it inside the head, so it never runs on under
 * the rows. `blur` softens the cover into light rather than a picture, as a
 * song's page draws it.
 */
export function CoverLight({
  color,
  art,
  blur = 0,
}: {
  color: string
  art: string | null
  blur?: number
}): ReactNode {
  const { theme } = useUnistyles()
  const id = `coverlight${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <View pointerEvents="none" style={styles.light}>
      {art ? (
        <Image
          source={{ uri: art }}
          style={[styles.art, blur > 0 && styles.artBlurred]}
          resizeMode="cover"
          blurRadius={blur}
        />
      ) : null}
      <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={art ? 0.25 : 0.45} />
            <Stop offset="0.45" stopColor={theme.colors.surface0} stopOpacity={art ? 0.75 : 0.4} />
            <Stop offset="1" stopColor={theme.colors.surface0} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  light: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  art: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.35 },
  // Blurred, the cover is only colour, and can be brighter without being read as a picture.
  artBlurred: { opacity: 0.5 },
})
