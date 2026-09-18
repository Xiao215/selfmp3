import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { oklchToHexAlpha } from '@selfmp3/client'
import { Check, Minus } from './Icons'

/* The tick on a danger box: near-white, and the same in either theme. */
const DANGER_TICK = oklchToHexAlpha(0.99, 0, 0, 1)

/**
 * A round 18-point mark (docs/ui-mock `C04`) that fills with the accent when on, with a dim fill and a
 * dash when only some of what it stands for is on.
 *
 * Only the mark. The thing you press, and what it is called, belong to the
 * caller — a row's checkbox, the selection bar's select-all and the delete
 * confirmation's "also delete the files" are three different controls that
 * happen to draw the same square.
 *
 * `danger` is the confirmation's: ticking the box that deletes files turns it
 * red rather than accent.
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
  if (checked) {
    return (
      <View style={[styles.box, tone === 'danger' ? styles.boxDanger : styles.boxAccent]}>
        {tone === 'danger' ? (
          <Check size={12} color={DANGER_TICK} />
        ) : (
          <Check size={12} tone="onAccent" />
        )}
      </View>
    )
  }
  if (mixed) {
    return (
      <View style={[styles.box, styles.boxMixed]}>
        <Minus size={12} tone="textPrimary" />
      </View>
    )
  }
  return <View style={styles.box} />
}

const styles = StyleSheet.create(theme => ({
  box: {
    width: 18,
    height: 18,
    borderRadius: 9,
    // The ring is the mark itself, not a hairline between two things.
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Ticked, in the accent or in red, and the half-ticked box between them —
  // all three from the palette, so a list of checkboxes is recoloured by the
  // accent picker without any of them being re-rendered.
  boxAccent: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  boxDanger: { backgroundColor: theme.colors.danger, borderColor: theme.colors.danger },
  boxMixed: { backgroundColor: theme.colors.accentDim, borderColor: theme.colors.accent },
}))
