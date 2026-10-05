import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { Stop } from '../../ui/components/Icons'

/**
 * Stops an Ask while it is worked on: a round button with a square in it,
 * where the send button or the count was. The server stops asking the model
 * once nobody is waiting, so a stopped question costs no more calls.
 */
export function StopButton({
  onPress,
  size = 28,
  testID,
}: {
  onPress: () => void
  size?: number
  testID?: string
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Stop"
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Stop size={Math.round(size * 0.62)} tone="onPrimary" />
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.textPrimary,
  },
  pressed: { opacity: 0.6 },
}))
