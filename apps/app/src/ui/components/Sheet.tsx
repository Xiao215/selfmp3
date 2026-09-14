import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAccent } from '../accent'
import { HIT_TARGET, motion, radius, space, type } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { PanelDenseContext, usePanelDense } from './panel'

/**
 * A menu, as a sheet from the bottom of the screen — or, on a computer, as a
 * small window in the middle of it.
 *
 * The web's popovers become sheets on a phone (`.popover-sheet`): a song's ⋯
 * menu, the sort field, a sleep timer. This is that sheet. It rises with the
 * web's slow curve, dims what is behind it, and goes back down the way it
 * came before it unmounts — the same "hold the leaving state" the web does
 * with `is-leaving`, so it never blinks out.
 *
 * At desktop width a sheet across the whole foot of the window is a phone's
 * gesture on a screen that has none: a tag list opened from a song's menu ran
 * two thousand pixels wide. There it is a window the size of its content,
 * centred, as the web's dialogs are.
 *
 * Detached from whatever opened it, so a title names the thing it is about.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  titleTone = 'heading',
  children,
  testID,
}: {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  /**
   * `label` is the web's `.popover-title`: small and quiet, for a list whose
   * title only says what is being chosen ("Sort by"). `heading` names the
   * thing the sheet is about, the way the song menu's head does.
   */
  titleTone?: 'heading' | 'label'
  children: ReactNode
  testID?: string
}): ReactNode {
  const insets = useSafeAreaInsets()
  const { wide, dense } = useLayout()
  // Mounted from the moment it is asked for until its exit has played out.
  // Adjusted during render rather than in an effect, so opening never costs
  // a frame drawn without the sheet.
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  // State rather than a ref: it is read while rendering, and a ref read
  // during render is what the React Compiler objects to (see Equalizer).
  const [progress] = useState(() => new Animated.Value(0))
  // Escape closes it on the web, as the web's popovers do. Nothing on a phone.
  useEscape(open, onClose, { layer: true })

  useEffect(() => {
    if (open) {
      Animated.timing(progress, {
        toValue: 1,
        duration: motion.slow,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: motion.base,
      easing: Easing.bezier(0.4, 0, 1, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false)
    })
  }, [open, progress])

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
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      {wide ? (
        <View pointerEvents="box-none" style={styles.dialogFrame}>
          <Animated.View
            style={[
              styles.dialog,
              {
                opacity: progress,
                transform: [
                  {
                    translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
                  },
                ],
              },
            ]}
          >
            {head}
            {/* A window with a mouse to hand: the panel's items, not a finger's list. */}
            <PanelDenseContext.Provider value={dense}>{content}</PanelDenseContext.Provider>
          </Animated.View>
        </View>
      ) : (
        <Animated.View
          style={[
            styles.panel,
            {
              paddingBottom: Math.max(insets.bottom, space.sm) + space.xs,
              transform: [
                {
                  translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }),
                },
              ],
              opacity: progress,
            },
          ]}
        >
          <View style={styles.grabber} />
          {head}
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
  const accent = useAccent()
  const dense = usePanelDense()
  // With a mouse the row under it lights up, as the web's menus do.
  const [hovered, setHovered] = useState(false)
  // In a panel the web's items are quiet until pointed at or chosen; in a
  // sheet they are a finger's list and read at full strength.
  const ink = danger
    ? theme.colors.danger
    : dense
      ? active || hovered
        ? theme.colors.textPrimary
        : theme.colors.textSecondary
      : active
        ? accent.accent
        : theme.colors.textPrimary
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onHoverIn={dense ? () => setHovered(true) : undefined}
      onHoverOut={dense ? () => setHovered(false) : undefined}
      role={role}
      aria-selected={role === 'option' ? active : undefined}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.item,
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
    </Pressable>
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
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
    paddingTop: space.sm,
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
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: space.sm,
    overflow: 'hidden',
    boxShadow: '0 20px 48px rgba(0, 0, 0, 0.5)',
  },
  content: {
    alignSelf: 'stretch',
  },
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
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
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
    borderRadius: radius.sm,
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
    backgroundColor: `${theme.colors.danger}1f`,
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
