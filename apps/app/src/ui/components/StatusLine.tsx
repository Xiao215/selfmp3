import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, textStyle } from '@selfmp3/client'
import { Button } from './Button'

/**
 * One line saying how something just went, under the form or the button that
 * did it: "Couldn't pick again", "Added. It waits in your library's pending
 * imports". In the tone's ink, at one size.
 *
 * A failure is read out at once (`role="alert"`); anything else is said when
 * the reader is next free. About sixteen of these were written out by hand at
 * three sizes, and one of them said anything to a screen reader.
 *
 * `retry` puts the way to try again at the line's end, for a failure that
 * another go may fix.
 */
export function StatusLine({
  tone = 'error',
  children,
  retry,
  style,
  testID,
}: {
  tone?: 'error' | 'good' | 'plain'
  children: ReactNode
  retry?: { label?: string; onPress: () => void }
  style?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  const error = tone === 'error'
  const words = (
    <Text
      style={[styles.text, error ? styles.error : tone === 'good' ? styles.good : styles.plain]}
      testID={testID}
    >
      {children}
    </Text>
  )
  return (
    <View
      style={[styles.line, style]}
      role={error ? 'alert' : undefined}
      accessibilityLiveRegion={error ? 'assertive' : 'polite'}
    >
      {words}
      {retry ? (
        <Button variant="text" label={retry.label ?? 'Try again'} onPress={retry.onPress} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm },
  text: { flexShrink: 1, ...textStyle('sub') },
  error: { color: theme.colors.danger },
  good: { color: theme.colors.good },
  plain: { color: theme.colors.textSecondary },
}))
