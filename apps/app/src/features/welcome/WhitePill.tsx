import type { ReactNode } from 'react'
import { Text } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Svg, { Path } from 'react-native-svg'
import { radius, type } from '@selfmp3/client'
import { Press } from '../../ui/components/Press'
import { OPACITY } from '../../ui/motion.model'
import { Spinner } from '../../ui/components/Spinner'

/**
 * The one button on each page on the way in — Welcome, Where it lives and
 * First sync: a white pill, 54 high, as `P01` and `P03` draw it.
 *
 * White rather than the accent, as the round Play is: it is the only thing on
 * the page to press, and on the way in the accent has not been chosen yet.
 * On a computer it keeps a width of its own instead of the page's (`C01`).
 *
 * On `Press`, so it lets go when the tap lands as every button does. `busy`
 * puts a spinner before the label and stops a second press while the first
 * is still being answered: "Connecting…" could be pressed again, and was.
 */
export function WhitePill({
  label,
  onPress,
  google = false,
  busy = false,
  disabled = false,
  width,
  testID,
}: {
  label: string
  onPress: () => void
  /** Google's G before the label, for the button that opens Google. */
  google?: boolean
  busy?: boolean
  disabled?: boolean
  width?: number
  testID?: string
}): ReactNode {
  const inactive = disabled || busy
  return (
    <Press
      depth="control"
      wrap={width === undefined ? styles.fill : { width }}
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      style={[styles.pill, disabled && styles.disabled]}
    >
      {busy ? <Spinner tone="onPrimary" /> : google ? <GoogleMark /> : null}
      <Text style={styles.label}>{label}</Text>
    </Press>
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
  disabled: { opacity: OPACITY.disabled },
  label: { color: theme.colors.onPrimary, fontSize: type.body, fontWeight: '600' },
}))
