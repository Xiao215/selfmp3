import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Keyboard, Pressable, Text, View } from 'react-native'
import Reanimated, {
  Easing as ReanimatedEasing,
  FadeIn,
  withDelay,
  withTiming,
  type EntryAnimationsValues,
} from 'react-native-reanimated'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { iconSize, motion, radius, space, type } from '@selfmp3/client'
import { sizedIcon } from './Icons'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayoutValue, useWindowValue } from '../../shell/useLayout'
import { PanelDenseContext, usePanelDense } from './panel'
import { Press } from './Press'
import { floating, rowTitle, menuItem, menuItemDense } from '../surfaces'
import { ease, nativeDriver, spring, timing, useMotionReduced } from '../motion'
import { MOVE_MS, OPACITY, OVERSHOOT_S, overshootRange, PULL } from '../motion.model'
import { useKeyboardLift } from '../../ports/keyboardLift'
import { pressPutsKeyboardAway } from '../../ports/keyboard'

/**
 * How far a computer's dialog rises as it fades in: this sheet's wide shape,
 * and `ConfirmDialog`, which is the same fade-and-settle asking a question.
 */
export const DIALOG_RISE = 10

/**
 * Whether a phone's sheet rises as Reanimated's entering animation, which
 * starts on the UI thread the moment the panel is on screen. Everywhere but a
 * browser, which runs the rise with `Animated` as before.
 *
 * Over the phone's Now Playing — a native modal, and a heavy page — the panel
 * reached the screen long after a rise sent from JavaScript had begun, whether
 * from an effect or from its first layout: the first sheet opened there (the
 * room's Together, the song's ⋯) simply appeared, its rise spent off screen.
 */
const RISE_ON_MOUNT = nativeDriver

/**
 * How long a phone's sheet waits below the foot before it rises: the frames
 * right after it mounts are spent laying it out and drawing it for the first
 * time, and a rise begun at once lost its first third to them.
 */
const MOUNT_SETTLE_MS = 60

/** A phone's sheet rising by its own height from below the foot, a little past its place and back. */
function riseOnMount(values: EntryAnimationsValues) {
  'worklet'
  return {
    initialValues: { transform: [{ translateY: values.targetHeight }] },
    animations: {
      transform: [
        {
          translateY: withDelay(
            MOUNT_SETTLE_MS,
            withTiming(0, {
              duration: MOVE_MS.sheetUp,
              easing: ReanimatedEasing.out(ReanimatedEasing.back(OVERSHOOT_S)),
            }),
          ),
        },
      ],
    },
  }
}

/** The dim behind a phone's sheet, coming in with it. */
const DIM_IN = FadeIn.duration(MOVE_MS.sheetUp).delay(MOUNT_SETTLE_MS)

/** How long a phone's sheet waits for its panel's first layout before it rises regardless. */
const LAYOUT_WAIT_MS = 400

/** A change of height smaller than this is simply taken, not eased. */
const GROW_AT_LEAST = 8

/**
 * A menu, as a sheet from the bottom of the screen — or, on a computer, as a
 * small window in the middle of it.
 *
 * A popover becomes a sheet below the breakpoint: a song's ⋯ menu, the sort
 * field, a sleep timer. This is that sheet. It rises with a slow curve, dims
 * what is behind it, and goes back down the way it came before it unmounts,
 * holding the leaving state so it never blinks out.
 *
 * At desktop width a sheet across the whole foot of the window is a phone's
 * gesture on a screen that has none — a tag list would run two thousand
 * pixels wide. There it is a window the size of its content,
 * centred.
 *
 * Detached from whatever opened it, so a title names the thing it is about.
 *
 * On a phone it can be pulled away by its head: the panel follows the finger,
 * and far enough down or flicked fast enough it goes (`M2`, 3). Only the head,
 * so a pull on the items below is still a scroll.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  titleTone = 'heading',
  children,
  testID,
  width,
}: {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  /** How wide the window may grow at desktop width, for content wider than a menu. */
  width?: number
  /**
   * `label` is small and quiet, for a list whose title only says what is
   * being chosen ("Sort by"). `heading` names the
   * thing the sheet is about, the way the song menu's head does.
   */
  titleTone?: 'heading' | 'label'
  children: ReactNode
  testID?: string
}): ReactNode {
  const insets = useSafeAreaInsets()
  const wide = useLayoutValue(layout => layout.wide)
  const dense = useLayoutValue(layout => layout.dense)
  /*
   * How far the panel travels: its own height, once it has laid out. The
   * window's height is farther than the panel is tall, so a first open
   * measured by it would cover more ground in the same 300 ms and arrive
   * visibly faster than every open after it. The panel is held invisible and
   * still for the one frame it takes to measure instead.
   */
  const [panelHeight, setPanelHeight] = useState(0)
  const measured = panelHeight > 0
  // Mounted from the moment it is asked for until its exit has played out.
  // Adjusted during render rather than in an effect, so opening never costs
  // a frame drawn without the sheet.
  const [mounted, setMounted] = useState(open)
  // The window's height only while there is a sheet to fit in it: a closed one
  // — most are — has no reason to render for a window being resized.
  const windowHeight = useWindowValue(window => (mounted ? window.height : 0))
  // A sheet that was never told its height would never rise: every platform
  // the app runs on reports a layout, but a panel held invisible on the
  // strength of that is a panel that could be lost. So the window's height
  // stands in if no layout has come by the next frame, which only makes the
  // very first rise a little quick.
  useEffect(() => {
    if (!open || wide || measured) return undefined
    const frame = requestAnimationFrame(() => setPanelHeight(height => height || windowHeight))
    return () => cancelAnimationFrame(frame)
  }, [open, wide, measured, windowHeight])
  if (open && !mounted) setMounted(true)
  // State rather than a ref: it is read while rendering, and a ref read
  // during render is what the React Compiler objects to (see Equalizer).
  const [progress] = useState(() => new Animated.Value(0))
  // Every sheet — menus, the tag picker, sleep — can be pulled away by its
  // head; `pull` is how far a finger has pulled it, added to its rise.
  const { pull, gesture: pullDown } = useSheetPull(onClose)
  // How far the panel is still below its new top, after its content grew.
  const [grow] = useState(() => new Animated.Value(0))
  // Whether this opening's rise has already been sent. A sheet's height changes
  // while it is up — the tag picker's list shortens as you type — and without
  // this the rise would play again every time it did.
  const risen = useRef(false)
  // The panel's height as last laid out while up, for easing a change in it.
  const lastHeight = useRef(0)
  // Whether it has been open since it last went down: a sheet that has never
  // been opened has no exit to play. Most are mounted closed — every list's
  // song menu, its tag picker — and each would otherwise send two moves on mount.
  const up = useRef(false)
  // Escape closes it on the web. Nothing on a phone.
  useEscape(open, onClose, { layer: true })
  const reduced = useMotionReduced()
  /** In a browser, a narrow window's sheet rising once each time it opens: up from below the foot, past its place, and back. */
  const startRise = useCallback(() => {
    if (risen.current || !up.current) return
    risen.current = true
    pull.setValue(0)
    timing(progress, 1, MOVE_MS.sheetUp, undefined, { easing: ease.overshoot })
  }, [progress, pull])

  useEffect(() => {
    if (!open) {
      if (!up.current) return
      up.current = false
      // Back down from wherever it is, including wherever a pull left it: the
      // pull runs out on the same curve and clock as the exit, so a panel let
      // go of part-way down carries on down rather than snapping up first.
      risen.current = false
      lastHeight.current = 0
      timing(pull, 0, wide ? motion.base : MOVE_MS.sheetDown, undefined, { easing: ease.in })
      timing(progress, 0, wide ? motion.base : MOVE_MS.sheetDown, () => setMounted(false), {
        easing: ease.in,
      })
      return
    }
    up.current = true
    if (risen.current) return
    // A computer's window fades and settles, and can start now.
    if (wide) {
      risen.current = true
      pull.setValue(0)
      timing(progress, 1, motion.slow, undefined, { easing: ease.out })
      return
    }
    // On a phone the panel's own entering animation is the rise (`riseOnMount`):
    // the sheet is simply up, and its exit runs from there.
    if (RISE_ON_MOUNT) {
      risen.current = true
      pull.setValue(0)
      progress.setValue(1)
      return
    }
    // In a browser the sheet rises from its first layout (`onPanelLayout`):
    // the overlay host draws the panel a commit after this, and over a heavy
    // page — Now Playing — that commit came so late that a rise sent from here
    // had all but finished before the panel was there to see. Should no layout
    // come, it rises anyway.
    const late = setTimeout(startRise, LAYOUT_WAIT_MS)
    return () => clearTimeout(late)
  }, [open, progress, pull, wide, startRise])

  // The curve runs past 1 on the way up; nothing that fades goes past opaque.
  const shown = useMemo(
    () => progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    [progress],
  )
  // Above the keyboard while one is up: a field in a sheet is near its top,
  // and the rows it searches are what the keyboard would cover.
  const keyboard = useKeyboardLift(mounted && !wide)
  // The rise, plus whatever a finger has added to it. Rebuilt only when the
  // panel's own height — the distance — changes.
  const rise = useMemo(
    () =>
      Animated.add(
        Animated.add(
          Animated.add(progress.interpolate(overshootRange(panelHeight, 4)), pull),
          keyboard.lift,
        ),
        grow,
      ),
    [progress, pull, panelHeight, keyboard.lift, grow],
  )
  // A sheet whose content changes while it is up — Together growing into the
  // room it opened (M1) — eases to its new height from where its top was,
  // rather than jumping there. Not while the keyboard is up: the keyboard
  // moves the panel itself, and the two would fight.
  const onPanelLayout = (height: number): void => {
    const before = lastHeight.current
    lastHeight.current = height
    setPanelHeight(height)
    if (!risen.current) {
      startRise()
      return
    }
    if (before === 0 || keyboard.height > 0) return
    const change = height - before
    if (Math.abs(change) < GROW_AT_LEAST) return
    grow.setValue(change)
    timing(grow, 0, MOVE_MS.sheetUp, undefined, { easing: ease.out })
  }
  const settle = useMemo(
    () => ({
      opacity: shown,
      transform: [
        { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [DIALOG_RISE, 0] }) },
      ],
    }),
    [shown],
  )

  const head = title ? (
    <View style={styles.head}>
      <Text style={[styles.title, titleTone === 'label' && styles.titleLabel]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  ) : null

  /*
    The id sits on the content rather than on the panel or the `Modal`.
    A `Modal` is its own window on iOS and an id on it never reaches the
    hierarchy a flow reads; an id on the animated panel did not either,
    though the text inside it did. A plain view around the items is the
    thing that is actually there, and it is what "the menu is open" means
    anyway.
  */
  const content = (
    <View testID={testID} style={styles.content} {...pressPutsKeyboardAway}>
      {children}
    </View>
  )

  // Drawn by the shell's overlay host rather than in a `Modal` of its own
  // (src/shell/Overlay.tsx says why).
  useOverlay(
    <>
      {RISE_ON_MOUNT && !wide ? (
        <Reanimated.View
          entering={reduced ? undefined : DIM_IN}
          pointerEvents="box-none"
          style={StyleSheet.absoluteFill}
        >
          <SheetBackdrop opacity={shown} onClose={onClose} />
        </Reanimated.View>
      ) : (
        <SheetBackdrop opacity={shown} onClose={onClose} />
      )}
      {wide ? (
        <View pointerEvents="box-none" style={styles.dialogFrame}>
          <Animated.View
            style={[styles.dialog, width !== undefined && { maxWidth: width }, settle]}
          >
            {head}
            {/* A window with a mouse to hand: the panel's items, not a finger's list. */}
            <PanelDenseContext.Provider value={dense}>{content}</PanelDenseContext.Provider>
          </Animated.View>
        </View>
      ) : (
        <Reanimated.View
          entering={RISE_ON_MOUNT && !reduced ? riseOnMount : undefined}
          pointerEvents="box-none"
          style={styles.panelFrame}
        >
          <Animated.View
            onLayout={event => onPanelLayout(event.nativeEvent.layout.height)}
            style={[
              styles.panel,
              {
                // The keyboard covers the home indicator's room; above it the
                // panel needs none, and no taller than the window it leaves.
                paddingBottom:
                  keyboard.height > 0 ? space.sm : Math.max(insets.bottom, space.sm) + space.xs,
                maxHeight:
                  keyboard.height > 0
                    ? windowHeight - keyboard.height - insets.top - space.sm
                    : undefined,
                // In a browser, invisible and still until it has been measured,
                // then up from below the foot, four points past its place, and
                // back. On a phone the frame around it does the rise.
                opacity: measured || RISE_ON_MOUNT ? 1 : 0,
                transform: measured || RISE_ON_MOUNT ? [{ translateY: rise }] : undefined,
              },
            ]}
          >
            {/* The grabber and the title are the handle the sheet is pulled by. */}
            <GestureDetector gesture={pullDown}>
              <View style={styles.handle}>
                <SheetGrabber style={styles.grabberGap} />
                {head}
              </View>
            </GestureDetector>
            {content}
            {/* The panel carries on below its foot, out of sight until something
              lifts it: the keyboard, whose rounded and see-through edge
              otherwise showed the dimmed page under a sheet that had been
              shifted up whole, and the four points the rise overshoots. */}
            <View pointerEvents="none" style={[styles.skirt, { height: windowHeight }]} />
          </Animated.View>
        </Reanimated.View>
      )}
    </>,
    mounted,
  )

  return null
}

/**
 * A sheet pulled down by its head: the panel follows the finger (`pull`, to
 * add to its rise), and far enough or fast enough puts it away. Only the head
 * holds the gesture, not the items, so a pull on a long list is still a
 * scroll. Every sheet and Up next's (`QueueSheet`) pull the same way.
 */
export function useSheetPull(onClose: () => void): {
  pull: Animated.Value
  gesture: ReturnType<typeof Gesture.Pan>
} {
  const [pull] = useState(() => new Animated.Value(0))
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-20, 20])
        .runOnJS(true)
        // A pull puts the keyboard away first, as a list's drag does.
        .onStart(() => Keyboard.dismiss())
        .onUpdate(event => pull.setValue(Math.max(0, event.translationY)))
        .onEnd((event, success) => {
          if (success && (event.translationY > PULL.close || event.velocityY > PULL.flick)) {
            onClose()
          } else {
            spring(pull, 0)
          }
        }),
    [pull, onClose],
  )
  return { pull, gesture }
}

/** The dim behind a sheet, which closes it when pressed. */
export function SheetBackdrop({
  opacity,
  onClose,
  label = 'Close',
}: {
  opacity: Animated.Value | Animated.AnimatedInterpolation<number>
  onClose: () => void
  /** What a screen reader calls it: "Close Up next". */
  label?: string
}): ReactNode {
  return (
    <Animated.View style={[styles.backdrop, { opacity }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={label} />
    </Animated.View>
  )
}

/** The bar at a sheet's head that says it can be pulled. */
export function SheetGrabber({ style }: { style?: StyleProp<ViewStyle> }): ReactNode {
  return <View style={[styles.grabber, style]} />
}

/** One line of a sheet: an icon, a label, and what it does. */
export function SheetItem({
  icon,
  label,
  detail,
  onPress,
  active = false,
  danger = false,
  disabled = false,
  role = 'menuitem',
  testID,
}: {
  icon?: ReactNode
  label: string
  detail?: string
  onPress: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
  /** A menu's action, or one of a list's choices (a `Select`'s options). */
  role?: 'menuitem' | 'option'
  testID?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const dense = usePanelDense()
  // With a mouse the row under it lights up.
  const [hovered, setHovered] = useState(false)
  // In a panel the items are quiet until pointed at or chosen; in a sheet
  // they are a finger's list and read at full strength.
  const ink = danger
    ? theme.colors.danger
    : dense
      ? active || hovered
        ? theme.colors.textPrimary
        : theme.colors.textSecondary
      : theme.colors.textPrimary
  return (
    // A row the width of the sheet, so it sinks to a row's depth rather than a
    // control's, which on something this wide would walk its ends (`M1`, 1).
    <Press
      depth="row"
      onPress={onPress}
      disabled={disabled}
      onHoverIn={dense ? () => setHovered(true) : undefined}
      onHoverOut={dense ? () => setHovered(false) : undefined}
      role={role}
      testID={testID}
      aria-selected={role === 'option' ? active : undefined}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.item,
        !dense && active && styles.itemActive,
        dense && styles.itemDense,
        dense && (active || hovered) && styles.itemActiveDense,
        dense && danger && hovered && styles.itemDangerDense,
        pressed && styles.itemPressed,
        disabled && styles.itemDisabled,
      ]}
    >
      {icon ? <View style={styles.itemIcon}>{sizedIcon(icon, iconSize.item)}</View> : null}
      <Text
        style={[styles.itemLabel, dense && styles.itemLabelDense, { color: ink }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {detail ? (
        <Text style={styles.itemDetail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.backdrop,
  },
  // The foot of the window, which the panel stands in: what rises on a phone.
  panelFrame: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  panel: {
    backgroundColor: theme.colors.surface1,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    ...floating(theme.colors),
    paddingHorizontal: space.sm,
  },
  skirt: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: theme.colors.surface1,
  },
  dialogFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.sheet,
    padding: space.sm,
    overflow: 'hidden',
    ...floating(theme.colors),
  },
  content: {
    alignSelf: 'stretch',
    // Gives way when the panel is held under the keyboard's line, so a list in
    // it scrolls in the room left rather than running off the top.
    flexShrink: 1,
  },
  // The room above the grabber belongs to the handle rather than the panel, so
  // that a finger landing on it is landing on the thing that pulls.
  handle: { paddingTop: space.sm },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
  },
  grabberGap: { marginBottom: space.sm },
  head: {
    paddingHorizontal: space.md,
    paddingTop: space.xs,
    paddingBottom: space.sm + 2,
    marginBottom: space.xs,
    gap: 1,
  },
  titleLabel: {
    fontSize: type.small,
    fontWeight: '400',
    color: theme.colors.textMuted,
  },
  title: rowTitle(theme.colors),
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: type.small,
  },
  item: menuItem,
  // The chosen line is a lighter surface, not accent ink: the accent is kept
  // for the one button that commits something (`S2`).
  itemActive: {
    backgroundColor: theme.colors.surface2,
  },
  /* In a panel with a mouse: 8 by 10, 13-point type. */
  itemDense: menuItemDense,
  itemActiveDense: {
    backgroundColor: theme.colors.surface3,
  },
  itemDangerDense: {
    backgroundColor: theme.colors.dangerWash,
  },
  itemLabelDense: {
    fontSize: type.sub,
  },
  itemPressed: {
    backgroundColor: theme.colors.surface2,
  },
  itemDisabled: {
    opacity: OPACITY.disabled,
  },
  itemIcon: {
    width: 18,
    alignItems: 'center',
  },
  itemLabel: {
    flex: 1,
    fontSize: type.body,
  },
  itemDetail: {
    color: theme.colors.textMuted,
    fontSize: type.small,
  },
}))
