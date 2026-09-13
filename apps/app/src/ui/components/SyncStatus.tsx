import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { radius, space, syncHeader, syncHeaderText, type } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useAccent } from '../accent'

/**
 * One line saying whether this device has your music yet, in the words Xiao
 * chose: "Downloading 12 of 40", "40 not downloaded · on data · Download",
 * "40 not downloaded · offline".
 *
 * Only when there is something to say. On Wi-Fi with automatic downloads on,
 * a missing song is about to be fetched, and a browser streams, so neither
 * says anything until a download is actually running.
 */
export function SyncStatus(): ReactNode {
  const { theme } = useUnistyles()
  const downloads = useDownloads()
  const accent = useAccent()
  const header = syncHeader(downloads.situation)
  if (header.kind === 'none') return null

  const { text, action } = syncHeaderText(header)
  const { state, queue } = downloads
  const onAction = (): void => {
    if (header.kind === 'downloading') {
      if (header.paused) queue.resume()
      else queue.pause()
    } else {
      downloads.requestDownload(downloads.missingIds)
    }
  }
  const fraction = state.totalBytes > 0 ? Math.min(1, state.bytesWritten / state.totalBytes) : 0
  const warn = header.kind === 'waiting' && header.reason === 'data'

  return (
    <View style={styles.bar} testID="sync-status" accessibilityLiveRegion="polite">
      {header.kind === 'downloading' ? (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(fraction * 100)}%`, backgroundColor: accent.accent },
            ]}
          />
        </View>
      ) : null}
      <View style={styles.row}>
        <Text
          style={header.kind === 'error' ? styles.error : styles.text}
          numberOfLines={header.kind === 'error' ? 2 : 1}
        >
          {text}
        </Text>
        {action ? (
          <Pressable
            onPress={onAction}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={action}
          >
            <Text style={[styles.action, { color: warn ? theme.colors.warning : accent.accent }]}>
              {action}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  bar: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: theme.colors.surface1,
    borderRadius: radius.md,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    gap: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  text: { color: theme.colors.textSecondary, fontSize: type.small, flexShrink: 1 },
  // The device's accent, or amber on mobile data.
  action: { fontSize: type.small, fontWeight: '600' },
  error: { color: theme.colors.danger, fontSize: type.small, flex: 1 },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.colors.surface2,
    overflow: 'hidden',
  },
  progressFill: { height: 3 },
}))
