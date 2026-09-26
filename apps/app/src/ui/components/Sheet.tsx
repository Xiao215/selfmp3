import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, useWindowDimensions, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { HIT_TARGET, motion, radius, space, type, withAlpha } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { PanelDenseContext, usePanelDense } from './panel'
import { Press } from './Press'
import { floating } from '../surfaces'
import { ease, spring, timing } from '../motion'
import { MOVE_MS, overshootRange, PULL } from '../motion.model'

/**
 * How far a computer's dialog rises as it fades in: this sheet's wide shape,
 * and `ConfirmDialog`, which is the same fade-and-settle asking a question.
 */
export const DIALOG_RISE = 10

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
 * gesture on a screen that has none: a tag list opened from a song's menu ran
 * two thousand pixels wide. There it is a window the size of its content,
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
  const { wide, dense } = useLayout()
  /*
   * How far the panel travels: its own height, once it has laid out. Until then
   * there is nothing to rise from — it used to fall back to the window's
   * height, which is farther than the panel is tall, so the very first open of
   * a sheet covered more ground in the same 300 ms and arrived visibly faster
   * than every open after it. The panel is held invisible and still for the one
   * frame it takes to measure instead.
   */
  const [panelHeight, setPanelHeight] = useState(0)
  const measured = panelHeight > 0
  // A sheet that was never told its height would never rise: every platform
  // the app runs on reports a layout, but a panel held invisible on the
  // strength of that is a panel that could be lost. So the window's height
  // stands in if no layout has come by the next frame — the old travel, which
  // only makes the very first rise a little quick.
  const window = useWindowDimensions()
  useEffect(() => {
    if (!open || wide || measured) return undefined
    const frame = requestAnimationFrame(() => setPanelHeight(height => height || window.height))
    return () => cancelAnimationFrame(frame)
  }, [open, wide, measured, window.height])
  // Mounted from the moment it is asked for until its exit has played out.
  // Adjusted during render rather than in an effect, so opening never costs
  // a frame drawn without the sheet.
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  // State rather than a ref: it is read while rendering, and a ref read
  // during render is what the React Compiler objects to (see Equalizer).
  const [progress] = useState(() => new Animated.Value(0))
  // How far a finger has pulled the panel down, added to its rise.
  const [pull] = useState(() => new Animated.Value(0))
  // Whether this opening's rise has already been sent. A sheet's height changes
  // while it is up — the tag picker's list shortens as you type — and without
  // this the rise would play again every time it did.
  const risen = useRef(false)
  // Escape closes it on the web. Nothing on a phone.
  useEscape(open, onClose, { layer: true })

  useEffect(() => {
    if (!open) {
      // Back down from wherever it is, including wherever a pull left it: the
      // pull runs out on the same curve and clock as the exit, so a panel let
      // go of part-way down carries on down rather than snapping up first.
      risen.current = false
      timing(pull, 0, wide ? motion.base : MOVE_MS.sheetDown, undefined, { easing: ease.in })
      timing(progress, 0, wide ? motion.base : MOVE_MS.sheetDown, () => setMounted(false), {
        easing: ease.in,
      })
      return
    }
    // A phone's sheet rises by its own height and cannot start until it has
    // been measured; a computer's window only fades and settles, and can.
    if (risen.current || (!wide && !measured)) return
    risen.current = true
    pull.setValue(0)
    // A computer's window fades and settles; a phone's sheet overshoots.
    if (wide) timing(progress, 1, motion.slow, undefined, { easing: ease.out })
    else timing(progress, 1, MOVE_MS.sheetUp, undefined, { easing: ease.overshoot })
  }, [open, progress, pull, wide, measured])

  /*
   * Pulled down by its head: the panel follows the finger, and far enough or
   * fast enough puts it away. Only the head, not the items, so a pull on a long
   * list of tags is still a scroll. Lifted here from the queue sheet, which had
   * it alone, so that every sheet — menus, the tag picker, sleep — can be pulled
   * away.
   */
  const pullDown = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-20, 20])
        .runOnJS(true)
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

  // The curve runs past 1 on the way up; nothing that fades goes past opaque.
  // Built once, not per render.
  const shown = useMemo(
    () => progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    [progress],
  )
  // The rise, plus whatever a finger has added to it. Rebuilt only when the
  // panel's own height — the distance — changes.
  const rise = useMemo(
    () => Animated.add(progress.interpolate(overshootRange(panelHeight, 4)), pull),
    [progress, pull, panelHeight],
  )
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
    <View testID={testID} style={styles.content}>
      {children}
    </View>
  )

  // Drawn by the shell's overlay host rather than in a `Modal` of its own.
  // See src/shell/Overlay.tsx for why there are no windows any more.
  useOverlay(
    <>
      <Animated.View style={[styles.backdrop, { opacity: shown }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
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
        <Animated.View
          onLayout={event => setPanelHeight(event.nativeEvent.layout.height)}
          style={[
            styles.panel,
            {
              paddingBottom: Math.max(insets.bottom, space.sm) + space.xs,
              // Invisible and still until it has been measured, then up from
              // below the foot, four points past its place, and back.
              opacity: measured ? 1 : 0,
              transform: measured ? [{ translateY: rise }] : undefined,
            },
          ]}
        >
          {/* The grabber and the title are the handle the sheet is pulled by. */}
          <GestureDetector gesture={pullDown}>
            <View style={styles.handle}>
              <View style={styles.grabber} />
              {head}
            </View>
          </GestureDetector>
          {content}
        </Animated.View>
      )}
    </>,
    mounted,
  )

  return null
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
      {icon ? <View style={styles.itemIcon}>{icon}</View> : null}
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
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surface1,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    ...floating(theme.colors),
    paddingHorizontal: space.sm,
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
    marginBottom: space.sm,
  },
  head: {
    paddingHorizontal: space.md,
    paddingTop: space.xs,
    paddingBottom: space.sm + 2,
    marginBottom: space.xs,
    gap: 1,
  },
  titleLabel: {
    fontSize: 12,
    fontWeight: '400',
    color: theme.colors.textMuted,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: type.small,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: HIT_TARGET + 4,
    paddingHorizontal: space.md,
    borderRadius: 12,
  },
  // The chosen line is a lighter surface, not accent ink: the accent is kept
  // for the one button that commits something (`S2`).
  itemActive: {
    backgroundColor: theme.colors.surface2,
  },
  /* `.popover-item`: 8 by 10, 13-point type, where there is a mouse. */
  itemDense: {
    minHeight: 0,
    gap: 9,
    paddingVertical: space.sm,
    paddingHorizontal: 10,
  },
  itemActiveDense: {
    backgroundColor: theme.colors.surface3,
  },
  itemDangerDense: {
    backgroundColor: withAlpha(theme.colors.danger, 0.12),
  },
  itemLabelDense: {
    fontSize: 13,
  },
  itemPressed: {
    backgroundColor: theme.colors.surface2,
  },
  itemDisabled: {
    opacity: 0.45,
  },
  itemIcon: {
    width: 18,
    alignItems: 'center',
  },
  itemLabel: {
    flex: 1,
    fontSize: 15,
  },
  itemDetail: {
    color: theme.colors.textMuted,
    fontSize: type.small,
  },
}))
