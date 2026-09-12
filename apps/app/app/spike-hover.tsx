/**
 * Spike harness for check 2's web half: a component with a `:hover` variant and
 * the 820-point breakpoint, rendered by Unistyles 3.
 *
 * Both claims matter for the plan. Hover is the thing a phone-first styling
 * library usually gives up, and docs/UNIVERSAL.md's foundation 6 says hover
 * reveals exist wherever there is a pointer — the desktop library row depends
 * on it. The breakpoint is foundation 5: one component with variants, not a
 * phone version and a desktop version.
 *
 * The native half of check 2 — Unistyles and track-player in one dev client —
 * needs a Mac, and is left to .maestro/spike-unistyles.yaml beside this.
 */
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'

import '../src/spike/unistyles'

export default function SpikeHover() {
  return (
    <View style={styles.page}>
      <View style={styles.card} testID="spike-card">
        <Text style={styles.label} testID="spike-label">
          hover me
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create((theme) => ({
  page: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    padding: theme.gap(4),
  },
  card: {
    backgroundColor: theme.colors.raised,
    padding: theme.gap(4),
    // The hover variant. On native this key is simply not applied; on web it
    // has to come out as a real CSS `:hover` rule, not a JS listener.
    _web: {
      _hover: {
        backgroundColor: theme.colors.hover,
      },
    },
    // The breakpoint, as a style variant rather than two components. Width is
    // what the test reads: unlike a colour, nothing but the breakpoint explains
    // it, so a pass cannot be a coincidence.
    flexDirection: {
      phone: 'column',
      desktop: 'row',
    },
    maxWidth: {
      phone: 320,
      desktop: 640,
    },
  },
  label: {
    color: theme.colors.text,
  },
}))
