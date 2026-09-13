import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, oklchToHex } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { currentToasts, dismissToast, subscribeToasts, type Toast } from '../toast'
import { IconButton } from './IconButton'
import { X } from './Icons'

/** Mounted once, in the shell's toast row: every message raised with `showToast`. */
export function ToastHost(): ReactNode {
  const toasts = useSyncExternalStore(subscribeToasts, currentToasts, currentToasts)
  return (
    <>
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </>
  )
}

function ToastItem({ toast }: { toast: Toast }): ReactNode {
  const { finePointer } = useLayout()

  useEffect(() => {
    if (toast.autoDismissMs <= 0) return undefined
    const timer = setTimeout(() => dismissToast(toast.id), toast.autoDismissMs)
    return () => clearTimeout(timer)
  }, [toast.id, toast.autoDismissMs])

  const border =
    toast.tone === 'good'
      ? oklchToHex(0.5, 0.1, 155)
      : toast.tone === 'warn'
        ? oklchToHex(0.55, 0.12, 78)
        : toast.tone === 'error'
          ? colors.danger
          : colors.borderStrong

  return (
    <View style={[styles.toast, { borderColor: border }]} role="status">
      <Text
        style={[styles.text, toast.tone === 'error' && { color: colors.danger }]}
        numberOfLines={2}
      >
        {toast.text}
      </Text>
      <IconButton
        onPress={() => dismissToast(toast.id)}
        label="Dismiss"
        size={finePointer ? 28 : 40}
      >
        <X size={14} color={colors.textMuted} />
      </IconButton>
    </View>
  )
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.surface2,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  text: { color: colors.textPrimary, fontSize: 13, flexShrink: 1 },
})
