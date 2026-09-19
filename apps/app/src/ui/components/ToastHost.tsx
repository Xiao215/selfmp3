import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, Pressable, Text } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { motion, radius } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { currentToasts, dismissToast, subscribeToasts, type Toast } from '../toast'
import { IconButton } from './IconButton'
import { X } from './Icons'
import { floating } from '../surfaces'
import { motionMs } from '../motion'

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
      duration: motionMs(leaving ? motion.base : motion.fast),
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished && leaving) onGone(toast.id)
    })
    return () => animation.stop()
  }, [leaving, shown, onGone, toast.id])

  return (
    <Animated.View
      style={[
        styles.toast,
        {
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
    // A floating pill with no edge: its shadow lifts it off the page. An error
    // says so in its red text; the other tones are told by what they say.
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    ...floating(theme.colors),
  },
  text: { color: theme.colors.textPrimary, fontSize: 13, flexShrink: 1 },
  action: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  actionPressed: { backgroundColor: theme.colors.surface3 },
  actionLabel: { fontSize: 13, fontWeight: '600' },
}))
