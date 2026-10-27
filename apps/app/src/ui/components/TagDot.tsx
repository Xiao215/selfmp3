import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'
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
  const { theme } = useUnistyles()
  // The colour is worked out here, not left to a themed style with the hue laid
  // over it: on a phone, inside a ScopedTheme (the sound map's), Unistyles laid
  // the themed grey back over the hue, and every tag's dot was grey (2026-10-26).
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: hue === undefined ? theme.colors.textMuted : tagColors(hue, scheme).dot,
        },
        style,
      ]}
    />
  )
}
