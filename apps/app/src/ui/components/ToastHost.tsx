import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, Pressable, Text } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { motion, oklchToHex } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { currentToasts, dismissToast, subscribeToasts, type Toast } from '../toast'
import { IconButton } from './IconButton'
import { X } from './Icons'

/**
 * Mounted once, in the shell's toast row: every message raised with `showToast`.
 *
 * A dismissed message stays drawn while it fades. The store forgets a message
 * the moment it is dismissed, and one that simply vanished read as something
 * having gone wrong; so the host keeps the ones on their way out beside the
 * ones still up, in the order they were raised, and lets each go once its fade
 * has finished.
 */
export function ToastHost(): ReactNode {
  const toasts = useSyncExternalStore(subscribeToasts, currentToasts, currentToasts)
  const [seen, setSeen] = useState(toasts)
  const [leaving, setLeaving] = useState<readonly Toast[]>([])

  // Worked out while rendering rather than in an effect, so a dismissed
  // message never has a frame in which it is gone before its fade begins.
  if (seen !== toasts) {
    const gone = seen.filter(old => !toasts.some(toast => toast.id === old.id))
    setSeen(toasts)
    if (gone.length > 0) setLeaving(current => [...current, ...gone])
  }

  const forget = useCallback((id: number) => {
    setLeaving(current => current.filter(toast => toast.id !== id))
  }, [])

  const shown = [...toasts, ...leaving].sort((a, b) => a.id - b.id)
  return (
    <>
      {shown.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          leaving={!toasts.some(up => up.id === toast.id)}
          onGone={forget}
        />
      ))}
    </>
  )
}

function ToastItem({
  toast,
  leaving,
  onGone,
}: {
  toast: Toast
  leaving: boolean
  onGone: (id: number) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { finePointer } = useLayout()
  // From 0, and the animated value from the first render: swapping a plain
  // number for an Animated value after mount leaves react-native-web drawing
  // the number (see Popover).
  const [shown] = useState(() => new Animated.Value(0))

  useEffect(() => {
    if (leaving || toast.autoDismissMs <= 0) return undefined
    const timer = setTimeout(() => dismissToast(toast.id), toast.autoDismissMs)
    return () => clearTimeout(timer)
  }, [toast.id, toast.autoDismissMs, leaving])

  useEffect(() => {
    const animation = Animated.timing(shown, {
      toValue: leaving ? 0 : 1,
      duration: leaving ? motion.base : motion.fast,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished && leaving) onGone(toast.id)
    })
    return () => animation.stop()
  }, [leaving, shown, onGone, toast.id])

  const border =
    toast.tone === 'good'
      ? oklchToHex(0.5, 0.1, 155)
      : toast.tone === 'warn'
        ? oklchToHex(0.55, 0.12, 78)
        : toast.tone === 'error'
          ? theme.colors.danger
          : theme.colors.borderStrong

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          borderColor: border,
          opacity: shown,
          transform: [
            { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
          ],
        },
      ]}
      pointerEvents={leaving ? 'none' : 'auto'}
      role="status"
    >
      <Text
        style={[styles.text, toast.tone === 'error' && { color: theme.colors.danger }]}
        numberOfLines={2}
      >
        {toast.text}
      </Text>
      {toast.actions.map(action => (
        <Pressable
          key={action.label}
          onPress={() => {
            // The message has been answered; leaving it up invites a second press.
            dismissToast(toast.id)
            action.onPress()
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={[styles.actionLabel, { color: accent.accent }]}>{action.label}</Text>
        </Pressable>
      ))}
      <IconButton
        onPress={() => dismissToast(toast.id)}
        label="Dismiss"
        size={finePointer ? 28 : 40}
      >
        <X size={14} color={theme.colors.textMuted} />
      </IconButton>
    </Animated.View>
  )
}

const styles = StyleSheet.create(theme => ({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 560,
    paddingVertical: 8,
    paddingRight: 8,
    paddingLeft: 14,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: theme.colors.surface2,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  text: { color: theme.colors.textPrimary, fontSize: 13, flexShrink: 1 },
  action: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  actionPressed: { backgroundColor: theme.colors.surface3 },
  actionLabel: { fontSize: 13, fontWeight: '600' },
}))
