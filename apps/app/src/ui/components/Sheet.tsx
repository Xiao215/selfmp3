import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAccent } from '../accent'
import { colors, HIT_TARGET, motion, radius, space, type } from '@selfmp3/client'

/**
 * A menu, as a sheet from the bottom of the screen.
 *
 * The web's popovers become sheets on a phone (`.popover-sheet`): a song's ⋯
 * menu, the sort field, a sleep timer. This is that sheet. It rises with the
 * web's slow curve, dims what is behind it, and goes back down the way it
 * came before it unmounts — the same "hold the leaving state" the web does
 * with `is-leaving`, so it never blinks out.
 *
 * Detached from whatever opened it, so a title names the thing it is about.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: ReactNode
}): ReactNode {
  const insets = useSafeAreaInsets()
  // Mounted from the moment it is asked for until its exit has played out.
  // Adjusted during render rather than in an effect, so opening never costs
  // a frame drawn without the sheet.
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  // State rather than a ref: it is read while rendering, and a ref read
  // during render is what the React Compiler objects to (see Equalizer).
  const [progress] = useState(() => new Animated.Value(0))

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

  if (!mounted) return null

  return (
    <Modal transparent visible statusBarTranslucent onRequestClose={onClose} animationType="none">
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
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
        {title ? (
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        ) : null}
        {children}
      </Animated.View>
    </Modal>
  )
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
}: {
  icon?: ReactNode
  label: string
  detail?: string
  onPress: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
}): ReactNode {
  const accent = useAccent()
  const ink = danger ? colors.danger : active ? accent.accent : colors.textPrimary
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.item,
        pressed && styles.itemPressed,
        disabled && styles.itemDisabled,
      ]}
    >
      {icon ? <View style={styles.itemIcon}>{icon}</View> : null}
      <Text style={[styles.itemLabel, { color: ink }]} numberOfLines={1}>
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

const styles = StyleSheet.create({
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
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: space.sm,
    paddingHorizontal: space.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface3,
    marginBottom: space.sm,
  },
  head: {
    paddingHorizontal: space.md,
    paddingTop: space.xs,
    paddingBottom: space.sm + 2,
    marginBottom: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.textMuted,
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
  itemPressed: {
    backgroundColor: colors.surface2,
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
    color: colors.textMuted,
    fontSize: type.small,
  },
})
