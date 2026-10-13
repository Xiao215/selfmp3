import type { ReactNode } from 'react'
import { IconButton } from '../../ui/components/IconButton'
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
    <IconButton label="Stop" filled="primary" size={size} onPress={onPress} testID={testID}>
      <Stop size={Math.round(size * 0.62)} tone="onPrimary" />
    </IconButton>
  )
}
