import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { hitSlopFor, leading, textStyle } from '@selfmp3/client'
import { Press } from './Press'

/**
 * "Why?", and the rest of a status card's explanation once it is pressed.
 *
 * A card that something stopped says what and what still works in two short
 * lines; the why — what the storage's allowance is, which computer is away and
 * how to wake it — is for whoever wants it, and is opened in place rather than
 * taking a page. Nothing is lost by the card being short: every word it used to
 * say is still one press away.
 */
export function Why({
  text,
  style,
  testID,
}: {
  text: string
  /** The card's own body style, so the explanation reads as the card's. */
  style: StyleProp<TextStyle>
  testID?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  if (open) {
    return (
      <Text style={style} testID={testID ? `${testID}-text` : undefined}>
        {text}
      </Text>
    )
  }
  return (
    <Press
      feedback="dim"
      onPress={() => setOpen(true)}
      accessibilityRole="button"
      accessibilityState={{ expanded: false }}
      hitSlop={hitSlopFor(leading.sub)}
      style={styles.button}
      testID={testID}
    >
      <Text style={styles.label}>Why?</Text>
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  button: { alignSelf: 'flex-start' },
  label: { color: theme.colors.accent, fontWeight: '600', ...textStyle('sub') },
}))
