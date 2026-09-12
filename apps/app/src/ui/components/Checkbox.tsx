import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, oklchToHexAlpha } from '@selfmp3/client'
import { useAccent } from '../accent'
import { Check, Minus } from './Icons'

/**
 * The web's `.checkbox`: a 17-point box that fills with the accent when on,
 * with a dim fill and a dash when only some of what it stands for is on.
 *
 * Only the mark. The thing you press, and what it is called, belong to the
 * caller — a row's checkbox, the selection bar's select-all and the delete
 * confirmation's "also delete the files" are three different controls that
 * happen to draw the same square.
 *
 * `danger` is the confirmation's: ticking the box that deletes files turns it
 * red rather than accent, as the web does.
 */
export function Checkbox({
  checked,
  mixed = false,
  tone = 'accent',
}: {
  checked: boolean
  mixed?: boolean
  tone?: 'accent' | 'danger'
}): ReactNode {
  const accent = useAccent()
  const fill = tone === 'danger' ? colors.danger : accent.accent

  if (checked) {
    return (
      <View style={[styles.box, { backgroundColor: fill, borderColor: fill }]}>
        <Check
          size={12}
          color={tone === 'danger' ? oklchToHexAlpha(0.99, 0, 0, 1) : accent.onAccent}
        />
      </View>
    )
  }
  if (mixed) {
    return (
      <View
        style={[
          styles.box,
          // --accent-dim
          {
            backgroundColor: oklchToHexAlpha(0.42, 0.1, accent.hue, 1),
            borderColor: accent.accent,
          },
        ]}
      >
        <Minus size={12} color={colors.textPrimary} />
      </View>
    )
  }
  return <View style={styles.box} />
}

const styles = StyleSheet.create({
  box: {
    width: 17,
    height: 17,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
