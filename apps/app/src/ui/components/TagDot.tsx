import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { tagColors } from '@selfmp3/client'
import { useShownScheme } from '../theme/unistyles'

/**
 * A tag's hue as a dot: beside its name in the sidebar, a search result, a
 * picker, a place's head. One size unless the place asks for another, and
 * worked out for the scheme on screen, so it follows light and dark by asking
 * rather than waiting for something else to redraw it.
 *
 * Without a hue — a tag the library no longer has — it is the muted ink.
 */
export function TagDot({
  hue,
  size = 8,
  style,
}: {
  hue: number | undefined
  size?: number
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const scheme = useShownScheme()
  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2 },
        hue === undefined ? null : { backgroundColor: tagColors(hue, scheme).dot },
        style,
      ]}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  dot: { backgroundColor: theme.colors.textMuted },
}))
