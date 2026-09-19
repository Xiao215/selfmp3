import type { ReactNode } from 'react'
import { Animated, Pressable, Text } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Svg, { Path } from 'react-native-svg'
import { radius } from '@selfmp3/client'
import { usePressScale } from '../../ui/motion'

/**
 * The one button on Welcome and on First sync: a white pill, 54 high, as `P01`
 * and `P03` draw it.
 *
 * White rather than the accent, as the round Play is: it is the only thing on
 * the page to press, and on the way in the accent has not been chosen yet.
 * On a computer it keeps a width of its own instead of the page's (`C01`).
 */
export function WhitePill({
  label,
  onPress,
  google = false,
  width,
  testID,
}: {
  label: string
  onPress: () => void
  /** Google's G before the label, for the button that opens Google. */
  google?: boolean
  width?: number
  testID?: string
}): ReactNode {
  const press = usePressScale()
  return (
    <Animated.View style={[width === undefined ? styles.fill : { width }, press.style]}>
      <Pressable
        {...press.handlers}
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={styles.pill}
      >
        {google ? <GoogleMark /> : null}
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </Animated.View>
  )
}

/** Google's G in one colour, the ink's: the page is not Google's to colour. */
function GoogleMark(): ReactNode {
  const { theme } = useUnistyles()
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <Path
        fill={theme.colors.onPrimary}
        d="M12 11v2.8h4.6c-.2 1.2-1.4 3.4-4.6 3.4a5.2 5.2 0 0 1 0-10.4c1.5 0 2.5.6 3 1.2l2.1-2A8 8 0 1 0 12 20c4.6 0 7.7-3.2 7.7-7.8 0-.5 0-.9-.1-1.2z"
      />
    </Svg>
  )
}

const styles = StyleSheet.create(theme => ({
  fill: { alignSelf: 'stretch' },
  pill: {
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.textPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  label: { color: theme.colors.onPrimary, fontSize: 16, fontWeight: '600' },
}))
