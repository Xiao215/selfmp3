import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { Circle, ClipPath, Defs, G, Polygon, Rect, Svg } from 'react-native-svg'
import { radius, space, withAlpha } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { bodyText, pageFrame, pageTitle } from '../../ui/surfaces'
import { BackButton } from '../../ui/components/BackButton'
import { BrandMark } from '../../ui/components/BrandMark'
import { SafeAreaView } from '../../ui/components/SafeAreaView'

/**
 * A share link the page cannot show (A1, B1 and D of the gone-link proposal):
 * forgotten ninety days after it ended, or cut short when it was copied.
 * Nothing about the link is left to draw, so it keeps the shape of an ended
 * link's page — a cover, then its name, then what to do — with an empty
 * sleeve where the cover was, its record half out; a link cut short has a
 * torn one. In the middle of the page, as the link's own column is.
 */
export function GoneLink({ torn, signedIn }: { torn: boolean; signedIn: boolean }): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={[styles.page, pageFrame(wide)]} testID="share-missing">
        {/* No sidebar here, even on a computer: Back is the way into your own library. */}
        {signedIn ? <BackButton to="/" always /> : null}
        <View style={styles.middle}>
          <Sleeve size={wide ? 200 : 160} torn={torn} />
          <View style={styles.words}>
            <Text style={styles.title} accessibilityRole="header">
              {torn ? 'That link isn’t all there' : 'This link is gone'}
            </Text>
            <Text style={styles.line}>
              {torn
                ? 'Check it was copied whole, or ask for it again.'
                : 'Shared links are cleared ninety days after they end. Ask whoever sent it to share it again.'}
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

/** Where the torn sleeve's two pieces part, as fractions of its side: the top piece's edge, then the bottom's. */
const TEAR_TOP = [
  [1, 0.62],
  [0.84, 0.7],
  [0.7, 0.6],
  [0.52, 0.74],
  [0.36, 0.63],
  [0.18, 0.72],
  [0, 0.64],
]
const TEAR_BOTTOM = [
  [0, 0.7],
  [0.18, 0.78],
  [0.36, 0.69],
  [0.52, 0.8],
  [0.7, 0.66],
  [0.84, 0.76],
  [1, 0.68],
]

/**
 * The empty sleeve, with the record half out of it and faded; or, torn, in
 * two pieces with no record. The app's mark sits faint on the sleeve, as a
 * cover-less song's does.
 */
function Sleeve({ size, torn }: { size: number; torn: boolean }): ReactNode {
  const { theme } = useUnistyles()
  const c = theme.colors
  const disc = size * 0.46
  const at = (points: number[][]): string =>
    points.map(([x, y]) => `${x! * size},${y! * size}`).join(' ')
  const sleeve = (clip?: string): ReactNode => (
    <Rect
      width={size}
      height={size}
      rx={radius.card}
      fill={c.surface1}
      clipPath={clip ? `url(#${clip})` : undefined}
    />
  )
  // The sleeve stands over the words; the record sticks out past them.
  const box = torn
    ? { width: size + 8, height: size + 8 }
    : { width: size + disc, height: size, transform: [{ translateX: disc / 2 }] }
  return (
    <View style={box}>
      <Svg width="100%" height="100%">
        {torn ? (
          <>
            <Defs>
              <ClipPath id="tornTop">
                <Polygon points={`0,0 ${size},0 ${at(TEAR_TOP)}`} />
              </ClipPath>
              <ClipPath id="tornBottom">
                <Polygon points={`${at(TEAR_BOTTOM)} ${size},${size} 0,${size}`} />
              </ClipPath>
            </Defs>
            {sleeve('tornTop')}
            <G opacity={0.7} transform={`translate(4 7) rotate(3 ${size / 2} ${size})`}>
              {sleeve('tornBottom')}
            </G>
          </>
        ) : (
          <>
            <G opacity={0.85}>
              <Circle cx={size} cy={size / 2} r={disc} fill={c.surface2} />
              <Circle
                cx={size}
                cy={size / 2}
                r={disc * 0.7}
                fill="none"
                stroke={c.surface1}
                strokeWidth={1.5}
              />
              <Circle cx={size} cy={size / 2} r={disc * 0.3} fill={c.surface1} />
              <Circle cx={size} cy={size / 2} r={disc * 0.09} fill={c.surface0} />
            </G>
            {sleeve()}
          </>
        )}
      </Svg>
      <View style={[styles.mark, { width: size, height: size }]}>
        <BrandMark size={size * 0.42} color={withAlpha(c.textMuted, 0.33)} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flex: 1 },
  middle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
    paddingBottom: space.xl,
  },
  words: { alignItems: 'center', gap: space.sm, maxWidth: 400 },
  title: { ...pageTitle(theme.colors), textAlign: 'center' },
  line: { ...bodyText(theme.colors), textAlign: 'center' },
  mark: { position: 'absolute', top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
}))
