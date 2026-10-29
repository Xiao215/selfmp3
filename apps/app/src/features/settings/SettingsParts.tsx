import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { Circle, Svg } from 'react-native-svg'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { radius, type, space, iconSize, textStyle } from '@selfmp3/client'
import { ChevronRight, Copy, Minus, Plus } from '../../ui/components/Icons'
import { card, label, hint } from '../../ui/surfaces'
import { OPACITY } from '../../ui/motion.model'
import { Press } from '../../ui/components/Press'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { useLargeText } from '../../ui/textScale'
import { copyText } from '../../ports/clipboard'
import { showToast } from '../../ui/toast'

/**
 * The pieces every Settings page is made of (redesign B, 2026-10-26): one row
 * anatomy — name, a quiet line of explanation only where it adds something,
 * the control on the right, on a phone as on a computer. Only a control that
 * needs the width drops under the words on a phone (`stack`).
 *
 * An action in a row is words in the accent at its end (`Button`'s `text`
 * variant, C1a), not a pill sitting in the card; a row that opens a page of its
 * own is the whole row (`LinkRow`). A group is a card, with a quiet label over
 * it when it needs one, and its rows are told apart by spacing alone.
 */

const Stacked = createContext(false)
export const StackedRows = Stacked.Provider

/**
 * A group of rows: a card, with its name over it when it has one. The page is
 * cards and the space between them; where a row's control needs no words —
 * the tiles, the accent's swatches — the card has no name either.
 */
export function Card({
  title,
  mark,
  flush = false,
  testID,
  children,
}: {
  title?: string
  /** Drawn before the title: the sparkle that marks a smart feature. */
  mark?: ReactNode
  /** No padding of its own: rows that press edge to edge (`LinkRow`). */
  flush?: boolean
  testID?: string
  children: ReactNode
}): ReactNode {
  return (
    <View style={styles.group} testID={testID}>
      {title ? (
        <View style={styles.groupHead}>
          {mark ? <View style={styles.groupMark}>{mark}</View> : null}
          <Text style={styles.groupLabel} accessibilityRole="header" aria-level={2}>
            {title}
          </Text>
        </View>
      ) : null}
      <View style={[styles.panel, flush && styles.panelFlush]}>{children}</View>
    </View>
  )
}

export function Row({
  label,
  hint,
  last = false,
  stack = false,
  disabled = false,
  children,
}: {
  label: string
  hint?: ReactNode
  last?: boolean
  /** The control needs the row's width, so on a phone it goes under the words. */
  stack?: boolean
  /** Greyed: what it sets does nothing while something above it is off. */
  disabled?: boolean
  children?: ReactNode
}): ReactNode {
  // At the largest text sizes every control goes under its words, which beside
  // it broke "Library" into "Libra / ry" (AM1).
  const large = useLargeText()
  const stacked = (useContext(Stacked) && stack) || large
  return (
    <View style={[styles.row, stacked && styles.rowStacked, last && styles.rowLast]}>
      <View style={[styles.label, disabled && styles.labelDisabled]}>
        <Text style={styles.name}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {children ? (
        <View style={[styles.control, stacked && styles.controlStacked]}>{children}</View>
      ) : null}
    </View>
  )
}

/**
 * A panel's one row while the library's settings it shows have not come: on
 * their way, or not answered. Without it the panel was an empty card under its
 * label, which says nothing about why.
 */
export function SettingsWaiting({
  failed,
  onRetry,
  last = true,
}: {
  failed: boolean
  onRetry: () => void
  last?: boolean
}): ReactNode {
  return failed ? (
    <Row label="Can’t reach your library" last={last}>
      <Button label="Look again" onPress={onRetry} />
    </Row>
  ) : (
    <Row label="Loading…" last={last} />
  )
}

/**
 * A row that opens a page of its own: the whole row presses, its value at the
 * end before the chevron. Edge to edge in a `flush` card.
 */
export function LinkRow({
  label: name,
  hint: line,
  value,
  lead,
  onPress,
  testID,
}: {
  label: string
  hint?: string
  value?: string
  /** Before the words: an avatar, an icon. */
  lead?: ReactNode
  onPress: () => void
  testID?: string
}): ReactNode {
  return (
    <Press
      feedback="wash"
      depth="row"
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={value ? `${name}, ${value}` : name}
      style={styles.link}
      testID={testID}
    >
      {lead}
      <View style={styles.label}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {line ? (
          <Text style={styles.rowHint} numberOfLines={1}>
            {line}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={styles.linkValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <ChevronRight size={iconSize.field} tone="textMuted" />
    </Press>
  )
}

/**
 * One of the quick tiles under the account (B): a setting turned by pressing
 * the tile itself, its state written under its name. A switch to assistive
 * technology when it is on or off; a button when it steps through choices
 * (the theme). `off` with a `reason` says why it cannot be used rather than
 * drawing a switch that does nothing (C2).
 */
export function Tile({
  icon,
  label: name,
  state,
  on,
  role = 'switch',
  disabled = false,
  onPress,
  testID,
}: {
  icon: ReactNode
  label: string
  /** The line under the name: "On", "Dark", "Not set up". */
  state: string
  on: boolean
  role?: 'switch' | 'button'
  disabled?: boolean
  onPress: () => void
  testID?: string
}): ReactNode {
  return (
    // Each tile its own cell: a pressable's style does not reach the box the
    // row lays out, so a tile sized itself to its words.
    <View style={styles.tileCell}>
      <Press
        depth="row"
        onPress={onPress}
        disabled={disabled}
        role={role}
        aria-checked={role === 'switch' ? on : undefined}
        accessibilityState={role === 'switch' ? { checked: on, disabled } : { disabled }}
        accessibilityLabel={`${name}, ${state}`}
        style={[styles.tile, on && styles.tileOn]}
        testID={testID}
      >
        {icon}
        <View>
          <Text style={styles.tileName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.tileState, on && styles.tileStateOn]} numberOfLines={1}>
            {state}
          </Text>
        </View>
      </Press>
    </View>
  )
}

/** The tiles, two across on a phone and four on a wide page. */
export function TileGrid({ wide, children }: { wide: boolean; children: ReactNode }): ReactNode {
  return <View style={[styles.tiles, wide && styles.tilesWide]}>{children}</View>
}

/** How far round a share of something is: what is on this device of the library. */
export function Ring({
  fraction,
  size = 76,
  label: name,
}: {
  fraction: number
  size?: number
  /** What it measures, read out with the share. */
  label: string
}): ReactNode {
  const { theme } = useUnistyles()
  const stroke = 9
  const r = (size - stroke) / 2
  const round = 2 * Math.PI * r
  const share = Math.max(0, Math.min(1, fraction))
  const percent = Math.round(share * 100)
  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={name}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={theme.colors.surface3}
          strokeWidth={stroke}
        />
        {share > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={theme.colors.accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${round * share} ${round}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View style={styles.ringMiddle} pointerEvents="none">
        <Text style={styles.ringText}>{`${percent}%`}</Text>
      </View>
    </View>
  )
}

/** A small whole number, a step at a time (C5a): Downloads at once. */
export function Stepper({
  value,
  min,
  max,
  label: name,
  onChange,
}: {
  value: number
  min: number
  max: number
  label: string
  onChange: (value: number) => void
}): ReactNode {
  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={name}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'increment') onChange(Math.min(max, value + 1))
        if (event.nativeEvent.actionName === 'decrement') onChange(Math.max(min, value - 1))
      }}
    >
      <IconButton
        label={`Fewer: ${name}`}
        size={34}
        disabled={value <= min}
        onPress={() => onChange(value - 1)}
      >
        <Minus size={iconSize.field} tone="textPrimary" />
      </IconButton>
      <Text style={styles.stepperValue}>{value}</Text>
      <IconButton
        label={`More: ${name}`}
        size={34}
        disabled={value >= max}
        onPress={() => onChange(value + 1)}
      >
        <Plus size={iconSize.field} tone="textPrimary" />
      </IconButton>
    </View>
  )
}

/**
 * A long value on one line (C6): a folder's path cut short, there whole to
 * copy. A phone cuts it in the middle, where the folder's own name survives.
 */
export function PathRow({ label: name, path }: { label: string; path: string }): ReactNode {
  return (
    <Row label={name} hint={undefined}>
      <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle" selectable>
        {path}
      </Text>
      <IconButton
        label={`Copy ${name.toLowerCase()}`}
        size={32}
        onPress={() =>
          void copyText(path).then(done =>
            done ? showToast('Copied', 'good') : showToast('Couldn’t copy it', 'error'),
          )
        }
      >
        <Copy size={iconSize.field} tone="textMuted" />
      </IconButton>
    </Row>
  )
}

/**
 * What cannot be undone, at the foot of a page (B): Sign out as an outlined
 * button the page's width, anything else as red words under it. Asked about
 * before it acts, by whoever presses it.
 */
export function DangerButton({
  label: name,
  onPress,
  outlined = false,
  disabled = false,
  testID,
}: {
  label: string
  onPress: () => void
  outlined?: boolean
  disabled?: boolean
  testID?: string
}): ReactNode {
  return (
    <Press
      feedback="dim"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled }}
      style={[styles.danger, outlined && styles.dangerOutlined, disabled && styles.labelDisabled]}
      testID={testID}
    >
      <Text style={[styles.dangerText, outlined && styles.dangerTextOutlined]}>{name}</Text>
    </Press>
  )
}

export const partStyles = StyleSheet.create(theme => ({
  // A notice in a panel (`NoticeCard`, washed): room above and below it, as a row has.
  notice: { marginVertical: space.sm },
  // A field beside a row's words: wide enough for an address or a name.
  field: { minWidth: 220 },
  progress: { marginVertical: space.roomy, gap: space.sm },
  progressText: { color: theme.colors.textSecondary, fontSize: type.sub },
  valueText: { color: theme.colors.textPrimary, fontSize: type.sub },
  input: {
    minWidth: 220,
    paddingVertical: 7,
    paddingHorizontal: space.roomy,
    fontSize: type.sub,
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
  },
  hint: hint(theme.colors),
  code: {
    fontSize: type.small,
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.surface2,
  },
}))

const styles = StyleSheet.create(theme => ({
  group: { gap: space.sm },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.snug,
    paddingHorizontal: space.xs,
  },
  groupMark: { alignSelf: 'center', marginRight: -4 },
  groupLabel: label(theme.colors),
  // The first row brings its own space above it; the last needs the card's below.
  panel: {
    ...card(theme.colors),
    paddingTop: 5,
    paddingBottom: space.lg,
    paddingHorizontal: space.lg,
  },
  panelFlush: { paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0, overflow: 'hidden' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  linkValue: { flexShrink: 1, color: theme.colors.textMuted, fontSize: type.sub },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.snug },
  // Four across on a wide page, where 40% would wrap them two by two.
  tilesWide: { flexWrap: 'nowrap' },
  tileCell: { flexGrow: 1, flexBasis: '40%', minWidth: 0 },
  tile: {
    ...card(theme.colors, radius.cardLg),
    flexGrow: 1,
    minHeight: 96,
    padding: space.roomy,
    gap: space.lg,
    justifyContent: 'space-between',
  },
  tileOn: { backgroundColor: theme.colors.accentPill },
  tileName: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  tileState: { color: theme.colors.textMuted, fontSize: type.sub, marginTop: 2 },
  tileStateOn: { color: theme.colors.accent },
  ringMiddle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringText: { color: theme.colors.textPrimary, ...textStyle('sub'), fontWeight: '700' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.field,
  },
  stepperValue: {
    minWidth: 22,
    textAlign: 'center',
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  path: { flexShrink: 1, color: theme.colors.textSecondary, fontSize: type.sub },
  danger: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.row,
  },
  dangerOutlined: {
    minHeight: 48,
    borderWidth: 1.5,
    borderColor: theme.colors.dangerWash,
  },
  dangerText: { color: theme.colors.danger, fontSize: type.sub, fontWeight: '500' },
  dangerTextOutlined: { fontSize: type.body, fontWeight: '600' },
  hint: { color: theme.colors.textMuted, fontSize: type.small },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    minHeight: 54,
    paddingVertical: 11,
  },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: space.snug },
  // The card's own padding is below the last row, so it needs none of its own.
  rowLast: { paddingBottom: 0 },
  label: { flex: 1, minWidth: 120, gap: 3 },
  labelDisabled: { opacity: OPACITY.disabled },
  name: { color: theme.colors.textPrimary, fontSize: type.body },
  rowHint: {
    ...hint(theme.colors),
    maxWidth: 400,
  },
  // Gives way before the words do, so a long value (a server's address) ends
  // in an ellipsis instead of running out of the card.
  control: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.snug,
  },
  controlStacked: { justifyContent: 'flex-start', flexWrap: 'wrap' },
}))
