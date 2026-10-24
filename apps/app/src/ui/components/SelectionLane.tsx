import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { motion, radius, space, type, iconSize } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { ease, timing, usePresence } from '../motion'
import { MOVE_MS, overshootRange } from '../motion.model'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { IconButton } from './IconButton'
import { CheckSquare, More, type Play, X } from './Icons'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'
import { floating, smallTitle } from '../surfaces'
import { useFloatingChrome } from '../../shell/bottomInset'

/**
 * How much room a phone's list leaves under its last row while the bar is up,
 * so the last song can still be scrolled out from under it.
 */
export const SELECTION_BAR_SPACE = 72

/**
 * How far above its place a computer's bar starts, in points: the same six the
 * pages settle in by (`M3`, 5). Not its own height, which would draw it over
 * whatever the page keeps above the list while it came down.
 */
const LANE_SETTLE = 6

/*
 * Whether a phone's bar is up, for the shell's toast row. The toasts sit at the
 * foot of the page column, which is where the bar floats on a phone, and they
 * are drawn later: a "Continue from Mac" over the bar took the presses meant
 * for its More. Counted rather than a flag, so a screen leaving as the next
 * one's bar arrives cannot switch it off under the new one.
 */
let floatingOnPhone = 0

/**
 * How far a phone's bar is up: 0 with no bar, 1 with one landed, and the rise
 * and the sink in between. The bar plays its own rise from its own value; this
 * is the same move published for anything that has to step aside for it — the
 * shell's toast row (`Shell`). Started here rather than by the bar so that two screens
 * overlapping mid-transition cannot fight over it, and on the same lengths and
 * curves as the bar's own, so the two are in step.
 *
 * On the native driver, as everything that moves in space is: ride it with a
 * `translateY`, not with a `bottom`, which cannot be driven from there.
 */
export const selectionBarLift = new Animated.Value(0)

const setFloating = (change: 1 | -1): void => {
  const was = floatingOnPhone
  floatingOnPhone += change
  if (was === 0 && floatingOnPhone > 0) {
    timing(selectionBarLift, 1, MOVE_MS.sheetUp, undefined, { easing: ease.overshoot })
  } else if (was > 0 && floatingOnPhone === 0) {
    timing(selectionBarLift, 0, MOVE_MS.sheetDown, undefined, { easing: ease.in })
  }
}

/**
 * The bar that runs a multi-selection, whatever is being selected: songs
 * (`SelectionBar`) or the links you shared (`LinksScreen`). What it is in
 * itself is the same for both — where it stands, how it arrives, the count,
 * all and none, More and Done — and what is done to the selection is the
 * caller's: its `actions` in the bar, and its `menu` behind More.
 *
 * On a computer it takes a lane of its own at the top of the list area: the
 * list below it is that much shorter, so at no scroll position does the bar
 * cover a row. On a page whose head scrolls with its songs it is drawn in the
 * list instead, at the head's foot, and stays at the top once the head has gone
 * (`inline`, in `SongList`'s `pinned`). It never floats over the list: the row
 * it would land on is the one just ticked, which you could then neither read
 * nor untick. Instead the lane opens rather than
 * appearing: the room grows from nothing to the bar's height over `motion.base`
 * and closes again over `motion.fast`, and the bar comes down into it. The room
 * is a height, so it is the one thing here on the JavaScript side (as the
 * up-next rail's room is, and for the same reason); the bar's own fade and
 * settle are transforms and opacity, on the native driver. The lane is measured
 * rather than guessed, so it is always exactly as tall as the bar really is.
 *
 * It sits where the eye already is while ticking and where nothing else
 * competes (the foot of the window has the player bar and the toasts). It is
 * anchored by the count, because the count is what you have to be sure of before pressing anything
 * else, and by a tri-state checkbox beside a line that says in words what
 * "all" currently means. Select-all while a search or filter is on selects the
 * filtered set, and the bar says so.
 *
 * On a phone it still floats, at the bottom, above the mini player or the
 * tabs, where a thumb is: the count, then the actions, More and Done as icons
 * on one line. Select all moves into More there.
 *
 * It rises from under its place there with the same four points of overshoot
 * every sheet has, sinks back on `ease.in`, and is kept up until the sink has
 * landed (`usePresence`): a bar that pops in and out reads as a mistake rather
 * than as an answer to what was just ticked.
 *
 * The actions are drawn as labelled buttons on a computer and as icons on a
 * phone. More is a popover at desktop width and a sheet on a phone.
 */
export function SelectionLane({
  count,
  total,
  noun,
  narrowed = false,
  scope,
  allSelected,
  onSelectAll,
  onDeselectAll,
  onDone,
  shown,
  inline = false,
  actions,
  moreRef,
  summary,
  menu,
}: {
  /** How many are selected. */
  count: number
  /** How many rows the list is showing right now. */
  total: number
  /** What one of them is called, and many: "song", "songs". */
  noun: { readonly one: string; readonly many: string }
  /** A search or filter is narrowing the list. */
  narrowed?: boolean
  /** What "all" means here, in words: "in this view", "in your library". */
  scope: string
  allSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onDone: () => void
  /**
   * Whether the bar belongs on screen. Kept mounted and turned off, it sinks
   * rather than vanishing.
   */
  shown: boolean
  /**
   * On a computer, drawn inside the list at the foot of its header
   * (`SongList`'s `pinned`) rather than over the top of the list area: a page
   * whose head scrolls with its songs, where the top of the list area is above
   * the head. The room it opens is then in the list, under the head.
   */
  inline?: boolean
  /** What the bar itself offers, in order. */
  actions: readonly BarAction[]
  /** More's button, which the menu opens beside and the caller may anchor to. */
  moreRef: RefObject<View | null>
  /** One line under the menu's title saying what is selected. */
  summary?: string | null
  /** What More holds, handed the way to close it. */
  menu: (close: () => void) => ReactNode
}): ReactNode {
  const { theme } = useUnistyles()
  const wide = useLayoutValue(layout => layout.wide)
  // Above the tab bar and the mini player, which float over the page on a phone.
  const chrome = useFloatingChrome()
  /*
   * In a list the lane stays at its very top once the head has gone, which on
   * a tablet is under the status bar: it carries that room above the bar on its
   * own ground, rather than leave the clock over the bar or the head showing
   * through behind it. A browser has none.
   */
  const { top: statusBar } = useSafeAreaInsets()
  const [menuOpen, setMenuOpen] = useState(false)

  /*
   * Up while it is asked for, and kept up until the sink has landed. The
   * lengths differ by surface — a computer's lane opens and closes with the
   * page's own `motion.base` and `motion.fast`, a phone's bar rises and sinks
   * like the sheet it is one of — and `usePresence` starts where `shown` says
   * and moves only when it changes, so a screen that draws this already shown
   * gets no rise at all: it has to keep the bar and turn `shown` off and on.
   */
  const { mounted, progress } = usePresence(
    shown,
    wide ? motion.base : MOVE_MS.sheetUp,
    wide ? motion.fast : MOVE_MS.sheetDown,
    wide ? { easeIn: ease.out, easeOut: ease.in } : { easeIn: ease.overshoot, easeOut: ease.in },
  )

  /*
   * How tall the bar is, as laid out: a phone's rise is its own height plus
   * the chrome it comes up from behind, and a computer's lane is exactly it.
   * Until it is known, a phone falls back on the room its list already leaves
   * for it, and a computer opens from nothing and catches up in the same move.
   */
  const [measured, setMeasured] = useState(0)
  const travel = (measured || SELECTION_BAR_SPACE) + chrome + space.sm
  // Rebuilt only when the distance changes, never in the render.
  const rise = useMemo(
    () => ({ transform: [{ translateY: progress.interpolate(overshootRange(travel, 4)) }] }),
    [progress, travel],
  )
  // The lane's fade and its six points of settle: it comes down from under the
  // head, not from its own height above it, which would draw it over whatever
  // the page has above the list.
  const [arrival] = useState(() => ({
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-LANE_SETTLE, 0] }) },
    ],
  }))

  /*
   * The room the lane takes from the list. A height is beyond the native
   * driver, and one value cannot be native for the bar's fade and not for this,
   * so the room is a value of its own (`QueueRail` splits the same move the
   * same way). It stays shut while the bar floats instead.
   */
  const [room] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (!wide) return
    if (shown) timing(room, 1, motion.base, undefined, { easing: ease.out, native: false })
    else timing(room, 0, motion.fast, undefined, { easing: ease.in, native: false })
  }, [wide, shown, room])
  const roomStyle = useMemo(
    () => ({
      height: room.interpolate({
        inputRange: [0, 1],
        outputRange: [0, measured],
        extrapolate: 'clamp' as const,
      }),
    }),
    [room, measured],
  )

  // The toasts step up above the bar while it floats at a phone's foot, and
  // ride `selectionBarLift` down again when it sinks.
  useEffect(() => {
    if (wide || !shown) return undefined
    setFloating(1)
    return () => setFloating(-1)
  }, [wide, shown])

  const word = (n: number): string => (n === 1 ? noun.one : noun.many)
  // What ticking every row does, in words: the checkbox on a computer, the
  // first item of a phone's More, which has no room for a checkbox.
  const selectAllLabel = `${allSelected ? 'Deselect' : 'Select'} all ${total} ${word(total)}${scope ? ` ${scope}` : ''}`

  const closeMenu = (): void => setMenuOpen(false)

  const drawAction = (action: BarAction): ReactNode => (
    <BarButton key={action.key} action={action} wide={wide} disabled={count === 0} />
  )

  // More, at either width. A phone's opens with nothing ticked, since all is
  // chosen from it there; a computer's has its checkbox, and nothing to offer
  // none.
  const more = (
    <View ref={moreRef} collapsable={false}>
      {wide ? (
        <Button
          label="More"
          icon={<More color={theme.colors.textPrimary} />}
          onPress={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          disabled={count === 0}
          active={menuOpen}
          testID="selection-more"
        />
      ) : (
        <IconButton
          onPress={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          label="More"
          active={menuOpen}
          testID="selection-more"
        >
          <More color={theme.colors.textPrimary} />
        </IconButton>
      )}
    </View>
  )

  const done = (
    <IconButton onPress={onDone} label="Done selecting" testID="selection-done">
      <X size={iconSize.item} color={theme.colors.textSecondary} />
    </IconButton>
  )
  const countWords = count === 0 ? 'None selected' : `${count} selected`
  const countText = (
    <Text
      style={styles.count}
      accessibilityLiveRegion="polite"
      numberOfLines={1}
      aria-label={countWords}
    >
      {countWords}
    </Text>
  )
  /*
   * The same count on a phone, where the bar is icons and the number is the
   * only word in it: the figure in an accent pill with "selected" beside it,
   * rather than one small grey line adrift in the bar's left half. It is what
   * you check before pressing anything, so it is what the bar is anchored by.
   */
  const countBadge = (
    // One phrase to anything that reads or looks for it — a screen reader, and
    // the flow that checks the count — while the eye gets the figure and the
    // word as two things.
    <View
      style={styles.countRow}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={countWords}
      aria-label={countWords}
    >
      {count === 0 ? (
        <Text style={styles.countWord}>None selected</Text>
      ) : (
        <>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{count}</Text>
          </View>
          <Text style={styles.countWord}>selected</Text>
        </>
      )}
    </View>
  )

  // A computer's lane, drawn at its own size so it can be measured there, and
  // faded and settled in over its room.
  const lane = (
    <Animated.View
      style={[styles.laneOver, arrival]}
      pointerEvents={shown ? 'box-none' : 'none'}
      onLayout={event => setMeasured(event.nativeEvent.layout.height)}
    >
      <View
        style={[
          styles.lane,
          inline && styles.laneInList,
          inline && statusBar > 0 && { paddingTop: space.xs + statusBar },
        ]}
      >
        <View
          style={styles.bar}
          role="toolbar"
          aria-label="Selection actions"
          testID="selection-bar"
        >
          <View style={styles.anchor}>
            <Checkbox
              checked={allSelected}
              mixed={!allSelected && count > 0}
              onChange={() => (allSelected ? onDeselectAll() : onSelectAll())}
              label={selectAllLabel}
              style={styles.all}
            />
            <View style={styles.counts}>
              {countText}
              {allSelected ? (
                <Text style={styles.scope}>
                  {narrowed
                    ? `every ${noun.one} ${scope}`
                    : `everything${scope ? ` ${scope}` : ''}`}
                </Text>
              ) : (
                <Pressable onPress={onSelectAll} accessibilityRole="button">
                  <Text style={[styles.scope, styles.scopeLink]}>
                    Select all {total}
                    {scope ? ` ${scope}` : ''}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.actions}>
            {actions.map(drawAction)}
            {more}
          </View>

          <View style={styles.doneWide}>{done}</View>
        </View>
      </View>
    </Animated.View>
  )

  const bar = wide ? (
    inline ? (
      // In the list: the room is under the head, and the lane is over it.
      <Animated.View style={roomStyle}>{lane}</Animated.View>
    ) : (
      <>
        {/* The room, which is all that moves the list: the bar itself is over it. */}
        <Animated.View style={roomStyle} />
        {lane}
      </>
    )
  ) : (
    <Animated.View
      style={[styles.float, styles.floatBottom, { bottom: chrome + space.sm }, rise]}
      pointerEvents={shown ? 'box-none' : 'none'}
    >
      <View
        style={[styles.bar, styles.barCompact]}
        role="toolbar"
        aria-label="Selection actions"
        testID="selection-bar"
        onLayout={event => setMeasured(event.nativeEvent.layout.height)}
      >
        <View style={styles.countCompact}>{countBadge}</View>
        {actions.map(drawAction)}
        {more}
        {/* Done is leaving, not another thing to do to the songs. */}
        <View style={styles.leave} />
        {done}
      </View>
    </Animated.View>
  )

  // Nothing at all once it has sunk: until then `usePresence` keeps it up, so
  // the sink has somewhere to play.
  if (!mounted) return null

  return (
    <>
      {bar}

      <Popover
        open={menuOpen}
        onClose={closeMenu}
        anchorRef={moreRef}
        title={`${count} ${word(count)} selected`}
        width={280}
        testID="selection-menu"
      >
        {/* A sheet carries the count as its title; an anchored panel has none. */}
        {wide ? (
          <Text style={styles.menuTitle} numberOfLines={1}>
            {count} {word(count)} selected
          </Text>
        ) : null}
        {count > 0 && summary ? (
          <Text style={styles.summary} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}

        {/* On a phone the bar has no room for the checkbox, so all is chosen here. */}
        {wide ? null : (
          <>
            <SheetItem
              icon={<CheckSquare tone="textSecondary" />}
              label={selectAllLabel}
              onPress={() => {
                if (allSelected) onDeselectAll()
                else onSelectAll()
                closeMenu()
              }}
            />
            {count > 0 ? <View style={styles.groupGap} /> : null}
          </>
        )}

        {menu(closeMenu)}
      </Popover>
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  /*
   * A computer's lane: above the list, so the list is shorter and nothing is
   * covered. In from the sides as far as a song row is (`SongRow`'s `rowWide`),
   * so the bar is exactly as wide as the songs under it.
   */
  lane: { paddingHorizontal: space.sm, paddingTop: space.xs, paddingBottom: space.sm },
  /*
   * Where the lane is drawn: over the head of the list area, or over its room
   * in the list (`inline`), while the room opens to exactly its height. Absolute so that the room's height is
   * the only thing that moves the list, and so the lane can be measured at its
   * own size rather than at whatever the room has opened to so far. Above the
   * rows it is briefly over on the first selection of a session, before the
   * room it will sit in has been measured.
   */
  laneOver: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 4 },
  /*
   * Pinned at the top of a list whose head has scrolled away, the songs pass
   * under the lane: the page's own ground behind the bar, so they go beneath
   * it rather than showing round its corners.
   */
  laneInList: { backgroundColor: theme.colors.surface0 },
  /* A phone's bar floats instead, over the foot of the list, where a thumb is. */
  float: {
    position: 'absolute',
    zIndex: 5,
  },
  /* The foot itself is worked out per screen, above the player bar and the tab bar. */
  floatBottom: { left: space.sm, right: space.sm },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.card,
    // Lifted off the rows it covers, so it reads as over them rather than one of them.
    ...floating(theme.colors),
  },
  // Room between the icons, and a tone of its own: at `surface2` the bar and
  // the mini player under it were two identical slabs.
  barCompact: {
    gap: space.tight,
    paddingVertical: 7,
    paddingLeft: space.sm,
    paddingRight: space.tight,
    backgroundColor: theme.colors.surface3,
  },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  countPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: space.tight,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: {
    color: theme.colors.onAccent,
    fontSize: type.sub,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  countWord: { color: theme.colors.textSecondary, fontSize: type.sub, fontWeight: '500' },
  leave: { width: 1, height: 20, backgroundColor: theme.colors.border, marginHorizontal: 1 },
  anchor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    minWidth: 0,
    flexShrink: 1,
  },
  all: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  counts: { minWidth: 0 },
  countCompact: { flex: 1, minWidth: 0 },
  count: {
    ...smallTitle(theme.colors),
    fontVariant: ['tabular-nums'],
  },
  scope: { color: theme.colors.textMuted, fontSize: type.tiny },
  scopeLink: { textDecorationLine: 'underline' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.tight,
    minWidth: 0,
  },
  doneWide: { marginLeft: 'auto' },
  menuTitle: {
    ...smallTitle(theme.colors),
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
  summary: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  // The menu's groups are set apart by room, not a rule.
  groupGap: { height: space.sm },
}))

/** One of the bar's own actions, by name and mark. */
export interface BarAction {
  readonly key: string
  readonly label: string
  readonly Glyph: typeof Play
  /** Handed the button, which Up next's covers fly from. */
  readonly onPress: (from: View | null) => void
  /** A phone's filled round button: the one thing the bar is mostly for (Play). */
  readonly filled?: boolean
  /** It takes something away: red ink. */
  readonly danger?: boolean
}

/** One of the bar's own actions: a labelled button on a computer, an icon on a phone. */
function BarButton({
  action,
  wide,
  disabled,
}: {
  action: BarAction
  wide: boolean
  disabled: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const ref = useRef<View>(null)
  const press = (): void => action.onPress(ref.current)
  const ink = action.danger ? theme.colors.danger : theme.colors.textPrimary
  return (
    <View ref={ref} collapsable={false}>
      {wide ? (
        <Button
          label={action.label}
          variant={action.danger ? 'danger' : 'secondary'}
          icon={<action.Glyph color={ink} />}
          onPress={press}
          disabled={disabled}
        />
      ) : (
        <IconButton onPress={press} label={action.label} disabled={disabled} filled={action.filled}>
          <action.Glyph color={ink} />
        </IconButton>
      )}
    </View>
  )
}
