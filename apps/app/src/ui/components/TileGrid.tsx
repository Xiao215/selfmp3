import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { fonts, space, type, tracking } from '@selfmp3/client'
import { useContentWidth } from '../../shell/contentWidth'
import { tabbing } from '../../shell/tabbing'
import { useLayout } from '../../shell/useLayout'
import { useFade } from '../motion'
import { MOVE_MS } from '../motion.model'
import { rightClick, type PopoverAnchor } from '../rightClick'
import { tip } from '../tip'
import { Press } from './Press'
import { rowTitle } from '../surfaces'

/** A phone's grid is two across, whatever the tiles. */
const PHONE_COLUMNS = 2

/**
 * How many columns a grid of tiles has, and how wide a tile is: Home's tags,
 * Tags, Playlists.
 *
 * Worked out from the page, not measured: the window on a phone, the page
 * column beside the sidebar on a computer (`useContentWidth`), less the
 * gutters and whatever stands beside the grid (`reserve`). A width measured by
 * `onLayout` arrives a frame after the layout it was taken from, so the tiles
 * first drew at the width of the whole row and, while a window was dragged
 * narrower, kept the old width for a frame and lay across what was beside them.
 *
 * The tiles are laid out by flex (`TileGrid`), so the number is only for how
 * many columns there are and for what a tile draws to a size (a record, a
 * button over a cover); `tileWidth` is 0 until the page's width is known.
 */
export function useTileGrid({
  minTile,
  gap,
  maxColumns = Infinity,
  maxTile = Infinity,
  reserve = 0,
}: {
  /** The narrowest a computer's tile gets before the grid drops a column. */
  minTile: number
  gap: number
  maxColumns?: number
  /**
   * The widest a tile gets: past it the grid takes another column, beyond
   * `maxColumns`, so a very wide page fills with tiles rather than stretching
   * three of them (P1 C).
   */
  maxTile?: number
  /** What stands beside the grid on a computer: Home's card column. */
  reserve?: number
}): { columns: number; tileWidth: number } {
  // The app's own width, not the window's: an iPad in Split View is handed
  // half the screen and told about the whole of it (`shell/rootWidth.ts`).
  const { wide, width } = useLayout()
  const column = useContentWidth()
  const rowWidth = !wide
    ? Math.floor(width - space.gutter * 2)
    : column === null
      ? 0
      : Math.floor(column - space.gutterWide * 2 - reserve)
  const fit = Math.floor((rowWidth + gap) / (minTile + gap))
  const columns = !wide
    ? PHONE_COLUMNS
    : rowWidth <= 0
      ? Number.isFinite(maxColumns)
        ? maxColumns
        : PHONE_COLUMNS
      : Math.max(
          Math.min(maxColumns, Math.max(PHONE_COLUMNS, fit)),
          Math.min(fit, Math.ceil((rowWidth + gap) / (maxTile + gap))),
        )
  const tileWidth = rowWidth > 0 ? Math.floor((rowWidth - gap * (columns - 1)) / columns) : 0
  return { columns, tileWidth }
}

/**
 * Tiles in rows of `columns`, each a flex column of its row, and blank cells
 * filling out a row so a lone tile keeps a column's width. Sized by the row
 * rather than by a number, so a tile is as wide as the layout makes it on
 * every frame (d822f512).
 *
 * An item can take more than one column (`spanOf`): a tag that holds others
 * stands with its panel beside it. Its cell grows by its span from a basis of
 * the gaps it covers, so it is exactly that many tiles and the gaps between.
 */
export function TileGrid<T>({
  items,
  columns,
  gap,
  rowGap = gap,
  keyOf,
  spanOf,
  renderItem,
  style,
  testID,
}: {
  items: readonly T[]
  columns: number
  gap: number
  rowGap?: number
  keyOf: (item: T) => string | number
  spanOf?: (item: T) => number
  renderItem: (item: T, index: number) => ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  const rows: { item: T; index: number; span: number }[][] = []
  let row: { item: T; index: number; span: number }[] = []
  let used = 0
  items.forEach((item, index) => {
    const span = Math.min(columns, Math.max(1, spanOf?.(item) ?? 1))
    if (used + span > columns) {
      rows.push(row)
      row = []
      used = 0
    }
    row.push({ item, index, span })
    used += span
  })
  if (row.length > 0) rows.push(row)

  const cell = (span: number): ViewStyle => ({
    flexGrow: span,
    flexShrink: 1,
    flexBasis: (span - 1) * gap,
    minWidth: 0,
  })
  return (
    <View style={[{ gap: rowGap }, style]} testID={testID}>
      {rows.map(cells => {
        const filled = cells.reduce((sum, { span }) => sum + span, 0)
        const first = cells[0]
        return (
          <View key={first ? keyOf(first.item) : 'empty'} style={[styles.row, { gap }]}>
            {cells.map(({ item, index, span }) => (
              <View key={keyOf(item)} style={cell(span)}>
                {renderItem(item, index)}
              </View>
            ))}
            {Array.from({ length: columns - filled }, (_, blank) => (
              <View key={`blank-${blank}`} style={cell(1)} />
            ))}
          </View>
        )
      })}
    </View>
  )
}

/** What the controls laid over a tile spread, so keyboard focus brings them out as a pointer does. */
export interface TileFocus {
  onFocus: () => void
  onBlur: () => void
}

/**
 * One tile of a grid: its cover, its name and a line under it — a playlist,
 * a shared playlist, a tag.
 *
 * With a pointer, the controls laid over it (`overlay`: a Play, a ⋯) fade in
 * as the pointer arrives and out as it leaves, on a song row's clocks, and
 * come out the same way when Tab reaches the tile or one of them, so a
 * keyboard can get to them. A cover that moves when they do (a tag's record)
 * is a function of whether they are out.
 *
 * `onMenu` is the tile's menu: a right-click opens it at the pointer, and a
 * hold — the app's one hold, `MOVE_MS.hold` — opens it from the tile.
 * Everything sinks on the spring while pressed (`Press`).
 */
export function GridTile({
  cover,
  title,
  titleLead,
  look = 'plain',
  sub,
  onPress,
  onMenu,
  overlay,
  role = 'button',
  label,
  hint,
  caption,
  testID,
  tileRef,
}: {
  cover: ReactNode | ((out: boolean) => ReactNode)
  title: string
  /** Before the name: a tag's dot. */
  titleLead?: ReactNode
  /** The name in the body's weight (a playlist), or the display face (a tag, a place of its own). */
  look?: 'plain' | 'display'
  sub?: string
  onPress: () => void
  onMenu?: (at: PopoverAnchor) => void
  overlay?: (focus: TileFocus) => ReactNode
  /** A link for a tile that opens a place, a button for one that does something. */
  role?: 'button' | 'link'
  label: string
  hint?: string
  /** A hover caption, for what the tile's words leave out. */
  caption?: string
  testID?: string
  /** The tile's own view, for what is anchored to it. */
  tileRef?: (node: View | null) => void
}): ReactNode {
  const { finePointer } = useLayout()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const out = finePointer && (hovered || focused)
  const fade = useFade(out, MOVE_MS.hoverIn, MOVE_MS.hoverOut)
  const fadeStyle = useMemo(() => ({ opacity: fade }), [fade])
  // Only Tab's focus brings the controls out: the focus a click leaves behind would keep them.
  const focus = useMemo<TileFocus>(
    () => ({ onFocus: () => setFocused(tabbing()), onBlur: () => setFocused(false) }),
    [],
  )
  const own = useRef<View | null>(null)
  const hold = onMenu
    ? () => {
        if (own.current) onMenu(own.current)
      }
    : undefined

  return (
    <View
      ref={node => {
        own.current = node
        tileRef?.(node)
      }}
      collapsable={false}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
      {...rightClick(onMenu)}
    >
      <Press
        onPress={onPress}
        onLongPress={hold}
        delayLongPress={MOVE_MS.hold}
        {...focus}
        accessibilityRole={role}
        accessibilityLabel={label}
        accessibilityHint={hint}
        {...tip(caption)}
        testID={testID}
      >
        {typeof cover === 'function' ? cover(out) : cover}
        <View style={[styles.nameRow, look === 'display' && styles.nameRowDisplay]}>
          {titleLead}
          <Text style={look === 'display' ? styles.nameDisplay : styles.name} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {sub ? (
          <Text style={[styles.sub, look === 'display' && styles.subDisplay]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </Press>
      {overlay && finePointer ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, fadeStyle]}
          pointerEvents={out ? 'box-none' : 'none'}
        >
          {overlay(focus)}
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  row: { flexDirection: 'row' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  nameRowDisplay: { marginTop: 11 },
  name: {
    flexShrink: 1,
    ...rowTitle(theme.colors),
  },
  nameDisplay: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.title,
    letterSpacing: tracking.heading,
  },
  sub: {
    marginTop: 1,
    color: theme.colors.textMuted,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
  },
  subDisplay: { marginTop: 3 },
}))
