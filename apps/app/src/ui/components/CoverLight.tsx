import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Image, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { motion } from '@selfmp3/client'
import { ease, timing } from '../motion'

/**
 * A page lit by its covers (docs/ui-mock `P08`, `P10`, `P15`): the cover's
 * colour washing down from the top into the ground, and, where the page has
 * one cover to show, that cover itself behind the head, fading out.
 *
 * It fills whatever holds it, so the caller decides how far down the light
 * reaches; a tag's page keeps it inside the head, so it never runs on under
 * the rows. `blur` softens the cover into light rather than a picture, as a
 * song's page draws it.
 *
 * A new cover's light crossfades in over the old one's rather than replacing
 * it: colour is the one thing about a song change that cannot go on the native
 * driver, and it was the one thing about a song change that hard-cut while
 * everything else around it was gentle. Two stacked layers can be crossfaded,
 * and opacity is native.
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
  const { layers, fade } = useCrossfade({ color, art }, `${color}|${art ?? ''}`)
  return (
    <View pointerEvents="none" style={styles.light}>
      {layers.map((layer, index) => (
        // The first layer is the ground; the one after it, when there is one, is
        // the light arriving over it.
        <Animated.View key={layer.key} style={[styles.light, index > 0 && { opacity: fade }]}>
          <Light color={layer.value.color} art={layer.value.art} blur={blur} />
        </Animated.View>
      ))}
    </View>
  )
}

/** One cover's light: its colour down the page, and the cover itself behind the head. */
function Light({
  color,
  art,
  blur,
}: {
  color: string
  art: string | null
  blur: number
}): ReactNode {
  const { theme } = useUnistyles()
  const id = `coverlight${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <>
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
    </>
  )
}

/** A layer of something drawn: what it is drawn from, and what marks it as that one. */
interface CrossfadeLayer<T> {
  readonly key: string
  readonly value: T
}

/**
 * Something drawn from colours, kept for one crossfade after it changes.
 *
 * One layer while nothing is changing. When `key` changes there are two: the
 * one that was there, first and at full strength, and the new one over it at
 * `fade`, which goes from 0 to 1 over `motion.slow` and then drops the old one.
 * `fade` is set to 0 before the new layer is asked for, so its first frame is
 * the one the fade starts at and nothing is seen at full strength before it.
 *
 * It lives here because the page light was the first thing to need it; Now
 * Playing's glow is the second (`NowPlayingStage`).
 */
export function useCrossfade<T>(
  value: T,
  key: string,
): { layers: readonly CrossfadeLayer<T>[]; fade: Animated.Value } {
  const [layers, setLayers] = useState<readonly CrossfadeLayer<T>[]>(() => [{ key, value }])
  const [fade] = useState(() => new Animated.Value(1))
  // What was last asked for, so a re-render with the same colours starts nothing.
  // `value` is a new object most renders; the key is what says it is a new one.
  const asked = useRef(key)
  useEffect(() => {
    if (asked.current === key) return
    asked.current = key
    fade.setValue(0)
    // The one that was showing, and the new one over it: whatever was part-way
    // through becomes the ground, which is where the eye already is.
    setLayers(current => [...current.slice(-1), { key, value }])
    timing(fade, 1, motion.slow, () => setLayers(current => current.slice(-1)), {
      easing: ease.out,
    })
  }, [key, value, fade])
  return { layers, fade }
}

const styles = StyleSheet.create({
  light: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  art: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.35 },
  // Blurred, the cover is only colour, and can be brighter without being read as a picture.
  artBlurred: { opacity: 0.5 },
})
