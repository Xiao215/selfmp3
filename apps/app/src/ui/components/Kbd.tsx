import type { ReactNode } from 'react'
import { Text } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { type } from '@selfmp3/client'
import { CONTROL_SCALE } from '../textScale'

/**
 * A key on the keyboard, named in a line of text: ⌘K, ↵, Esc. A small raised
 * cap in the tiny size, inline with the words around it — Settings'
 * shortcuts, the palette's foot, a tooltip's shortcut.
 *
 * Its look is `KBD`, which the browser's own tooltip (drawn in the DOM, not
 * by React Native) reads too, so the three caps are one cap.
 */
export function Kbd({ children }: { children: string }): ReactNode {
  return (
    <Text style={styles.kbd} maxFontSizeMultiplier={CONTROL_SCALE}>
      {children}
    </Text>
  )
}

/** The cap's shape, shared with the DOM tooltip (`shell/TooltipHost.web.tsx`). */
export const KBD = { radius: 4, paddingHorizontal: 5 } as const

const styles = StyleSheet.create(theme => ({
  kbd: {
    color: theme.colors.textPrimary,
    fontSize: type.tiny,
    paddingHorizontal: KBD.paddingHorizontal,
    paddingVertical: 1,
    borderRadius: KBD.radius,
    backgroundColor: theme.colors.surface3,
    overflow: 'hidden',
  },
}))
