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
 * now with a seconds count, over a faint outline of the list to come.
 *
 * Where the server says how it is going (`live`, an Ask's stages with what
 * each found — "349 songs fit", "Choosing 25 that suit it"), those are shown.
 * Until the first of them arrives, or from a server that does not say,
 * `steps` stand in: a step's start is when it usually begins, so they are kept
 * to ones that are always true.
 */
export function Working({
  steps,
  live,
  testID,
}: {
  steps: readonly WorkingStep[]
  live?: readonly { readonly text: string; readonly done: boolean }[] | null
  testID?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => setMs(Date.now() - start), 250)
    return () => clearInterval(timer)
  }, [])
  const timed = steps.reduce((now, step, index) => (ms >= (step.after ?? 0) ? index : now), 0)
  const shown: { key: string; text: string; done: boolean }[] =
    live && live.length > 0
      ? [
          ...live.map((step, index) => ({ key: `${index}`, text: step.text, done: step.done })),
          // Every stage done and the answer not here yet: it is on its way to
          // this device, and the wait says so rather than looking finished.
          ...(live.every(step => step.done)
            ? [{ key: 'arriving', text: 'Getting it ready', done: false }]
            : []),
        ]
      : steps.slice(0, timed + 1).map((step, index) => ({
          key: step.doing,
          text: index < timed ? (step.done ?? step.doing) : step.doing,
          done: index < timed,
        }))
  // The seconds count is the running step's own: it starts again at each stage,
  // not when a stage only says how far it has got ("· 525 done").
  const running = shown.find(step => !step.done)?.key ?? null
  const [since, setSince] = useState<{ key: string | null; at: number }>({ key: null, at: 0 })
  if (running !== since.key) setSince({ key: running, at: ms })
  const seconds = Math.floor((ms - since.at) / 1000)

  return (
    <View style={styles.body} accessibilityLiveRegion="polite" testID={testID}>
      {shown.map(step => {
        const done = step.done
        return (
          <View key={step.key} style={styles.step}>
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
              {step.text}
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
