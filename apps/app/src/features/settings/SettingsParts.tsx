import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { oklchToHex, oklchToHexAlpha, radius } from '@selfmp3/client'
import { ChevronDown, ChevronRight } from '../../ui/components/Icons'
import { Slider } from '../../ui/components/Slider'

/**
 * The pieces every Settings section is made of: one row anatomy — name, a
 * quiet line of explanation, the control on the right. On a phone the control
 * drops under the words.
 */

const Stacked = createContext(false)
export const StackedRows = Stacked.Provider

export function Panel({
  title,
  hint,
  anchor,
  children,
}: {
  title: string
  hint?: string
  /**
   * The panel's own view, so the index can ask where it sits when it scrolls
   * there. A view rather than an `onLayout` offset: in a browser a view reports
   * its layout only when its size changes, not when a panel above it grows.
   */
  anchor: (node: View | null) => void
  children: ReactNode
}): ReactNode {
  return (
    <View ref={anchor} style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle} accessibilityRole="header">
          {title}
        </Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  )
}

export function Lead({ children }: { children: ReactNode }): ReactNode {
  return <Text style={styles.lead}>{children}</Text>
}

export function Row({
  label,
  hint,
  last = false,
  children,
}: {
  label: string
  hint?: ReactNode
  last?: boolean
  children?: ReactNode
}): ReactNode {
  const stacked = useContext(Stacked)
  return (
    <View style={[styles.row, stacked && styles.rowStacked, last && styles.rowLast]}>
      <View style={styles.label}>
        <Text style={styles.name}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {children ? (
        <View style={[styles.control, stacked && styles.controlStacked]}>{children}</View>
      ) : null}
    </View>
  )
}

/** A slider with its value beside it, saved once where the drag ends. */
export function SliderSetting({
  value,
  min,
  max,
  step,
  label,
  format,
  onCommit,
}: {
  value: number
  min: number
  max: number
  step: number
  label: string
  format: (value: number) => string
  onCommit: (value: number) => void
}): ReactNode {
  const [live, setLive] = useState<{ value: number; from: number } | null>(null)
  const shown = live && live.from === value ? live.value : value
  return (
    <>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        label={label}
        onChange={next => setLive({ value: next, from: value })}
        onCommit={onCommit}
      />
      <Text style={styles.value}>{format(shown)}</Text>
    </>
  )
}

export function Stats({
  items,
}: {
  items: readonly { value: string; label: string }[]
}): ReactNode {
  return (
    <View style={styles.stats}>
      {items.map(item => (
        <View key={item.label}>
          <Text style={styles.statValue}>{item.value}</Text>
          <Text style={styles.statLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  )
}

export function Meter({ fraction, label }: { fraction: number; label?: string }): ReactNode {
  return (
    <View
      style={styles.meter}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <View style={[styles.meterFill, { width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }]} />
    </View>
  )
}

export function Notice({
  tone,
  children,
}: {
  tone: 'warn' | 'error' | 'good'
  children: ReactNode
}): ReactNode {
  const hue = tone === 'warn' ? 78 : tone === 'error' ? 22 : 155
  return (
    <View
      style={[
        styles.notice,
        {
          borderColor: oklchToHex(0.45, 0.1, hue),
          backgroundColor: oklchToHexAlpha(0.3, 0.06, hue, 0.3),
        },
      ]}
    >
      <Text
        style={[
          styles.noticeText,
          tone === 'error' && styles.noticeError,
          tone === 'good' && styles.noticeGood,
        ]}
      >
        {children}
      </Text>
    </View>
  )
}

export function ButtonRow({ children }: { children: ReactNode }): ReactNode {
  return <View style={styles.buttons}>{children}</View>
}

export function Kbd({ children }: { children: string }): ReactNode {
  return <Text style={styles.kbd}>{children}</Text>
}

/** Rows that are there when asked for: shut until "Details" is pressed. */
export function Details({ children }: { children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <>
      <Pressable
        onPress={() => setOpen(value => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.detailsRow, pressed && styles.detailsRowPressed]}
      >
        <Chevron size={14} tone="textMuted" />
        <Text style={styles.detailsRowText}>Details</Text>
      </Pressable>
      {open ? children : null}
    </>
  )
}

export const partStyles = StyleSheet.create(theme => ({
  progress: { marginVertical: 14, gap: 8 },
  progressText: { color: theme.colors.textSecondary, fontSize: 13 },
  valueText: { color: theme.colors.textPrimary, fontSize: 13 },
  input: {
    minWidth: 220,
    paddingVertical: 7,
    paddingHorizontal: 10,
    fontSize: 13,
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  code: { fontSize: 12, color: theme.colors.textPrimary, backgroundColor: theme.colors.surface2 },
}))

const styles = StyleSheet.create(theme => ({
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingRight: 8,
    borderRadius: radius.sm,
  },
  detailsRowPressed: { opacity: 0.7 },
  detailsRowText: { color: theme.colors.textMuted, fontSize: 13 },
  panel: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
    padding: 18,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  panelTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  hint: { color: theme.colors.textMuted, fontSize: 12 },
  lead: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
    maxWidth: 520,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    minHeight: 46,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  rowLast: { borderBottomWidth: 0 },
  label: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  rowHint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17, maxWidth: 400 },
  control: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 },
  controlStacked: { justifyContent: 'flex-start', flexWrap: 'wrap' },
  value: {
    minWidth: 34,
    textAlign: 'right',
    color: theme.colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  stats: { flexDirection: 'row', gap: 32, marginTop: 16, marginBottom: 12 },
  statValue: { color: theme.colors.textPrimary, fontSize: 24, fontWeight: '700' },
  statLabel: { color: theme.colors.textMuted, fontSize: 12 },
  meter: { height: 6, borderRadius: 3, backgroundColor: theme.colors.surface3, overflow: 'hidden' },
  meterFill: {
    height: '100%',
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  notice: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginVertical: 8,
  },
  noticeText: { color: theme.colors.textPrimary, fontSize: 13, lineHeight: 19 },
  noticeError: { color: theme.colors.danger },
  noticeGood: { color: theme.colors.good },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  kbd: {
    color: theme.colors.textPrimary,
    fontSize: 11,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: 1,
    borderBottomWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    overflow: 'hidden',
  },
}))
