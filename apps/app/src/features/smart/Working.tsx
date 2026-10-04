import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { space, withAlpha } from '@selfmp3/client'
import { Check } from '../../ui/components/Icons'

/** One step of a wait: what it says while it runs, once it is done, and from when. */
interface WorkingStep {
  readonly doing: string
  readonly done?: string
  /** How long after the ask this step is taken to have begun, in ms. */
  readonly after?: number
}

/**
 * A smart answer on its way (A1): the steps it goes through, the one running
 * now with a seconds count, over a faint outline of the list to come. The
 * server answers once, so a step's start is when it usually begins, not a
 * report from the server; the steps are kept to ones that are always true.
 */
export function Working({
  steps,
  testID,
}: {
  steps: readonly WorkingStep[]
  testID?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => setMs(Date.now() - start), 250)
    return () => clearInterval(timer)
  }, [])
  const at = steps.reduce((now, step, index) => (ms >= (step.after ?? 0) ? index : now), 0)
  const seconds = Math.floor(ms / 1000)

  return (
    <View style={styles.body} accessibilityLiveRegion="polite" testID={testID}>
      {steps.slice(0, at + 1).map((step, index) => {
        const done = index < at
        return (
          <View key={step.doing} style={styles.step}>
            {done ? (
              <View style={[styles.mark, { backgroundColor: withAlpha(theme.colors.good, 0.18) }]}>
                <Check size={11} tone="good" />
              </View>
            ) : (
              <View style={styles.mark}>
                <ActivityIndicator size="small" color={theme.colors.textMuted} />
              </View>
            )}
            <Text style={[styles.label, !done && styles.now]} numberOfLines={1}>
              {done ? (step.done ?? step.doing) : step.doing}
            </Text>
            {!done && seconds > 0 ? <Text style={styles.seconds}>{seconds} s</Text> : null}
          </View>
        )
      })}
      <View style={styles.outline}>
        {OUTLINE.map(({ opacity, name, meta }) => (
          <View key={opacity} style={[styles.row, { opacity }]}>
            <View style={styles.ring} />
            <View style={styles.lines}>
              <View style={[styles.bar, { width: name }]} />
              <View style={[styles.bar, styles.thin, { width: meta }]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

/** The faint rows under the steps, fading down: a name and its line under it. */
const OUTLINE = [
  { opacity: 0.9, name: '46%', meta: '22%' },
  { opacity: 0.6, name: '62%', meta: '18%' },
  { opacity: 0.35, name: '38%', meta: '24%' },
] as const

const styles = StyleSheet.create(theme => ({
  body: { gap: 10, paddingVertical: space.xs },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flexShrink: 1, color: theme.colors.textSecondary, fontSize: 13.5 },
  now: { color: theme.colors.textPrimary },
  seconds: {
    marginLeft: 'auto',
    color: theme.colors.textMuted,
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
  },
  outline: { gap: 4, marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingLeft: 28 },
  ring: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
  },
  lines: { flex: 1, gap: 6 },
  bar: { height: 12, borderRadius: 6, backgroundColor: theme.colors.surface3 },
  thin: { height: 9 },
}))
