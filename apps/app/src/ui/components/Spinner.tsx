import type { ReactNode } from 'react'
import { ActivityIndicator } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { useInk, type IconTone } from './Icons'

/**
 * A wait drawn in place: on a button (`Button` `busy`), over a cover, at the
 * end of a line of words. A whole page's wait is `PageLoading`, which draws
 * this.
 *
 * Its colour is chosen as an icon's is, by tone, and by the same rule: the
 * ink of whatever it stands beside or in for — quiet (`textMuted`, the
 * default) at the end of quiet words, the button's ink on a button, white
 * over a cover. A tone is read here rather than passed in as a colour, so a
 * screen showing one is not re-rendered on every step of the accent picker.
 */
export function Spinner({
  tone = 'textMuted',
  style,
}: {
  tone?: IconTone
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const color = useInk(undefined, tone)
  return <ActivityIndicator size="small" color={color} style={style} />
}
