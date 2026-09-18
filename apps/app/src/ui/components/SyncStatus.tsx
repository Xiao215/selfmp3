import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, syncHeader, syncHeaderText, type } from '@selfmp3/client'
import { useDownloadProgress, useDownloads } from '../../offline/DownloadsProvider'
import { card } from '../surfaces'

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
  const downloads = useDownloads()
  // Bytes from their own store: a moving bar redraws this line, not every reader of the queue.
  const progress = useDownloadProgress()
  const header = syncHeader(downloads.situation)
  if (header.kind === 'none') return null

  const { text, action } = syncHeaderText(header)
  const { queue } = downloads
  const onAction = (): void => {
    if (header.kind === 'downloading') {
      if (header.paused) queue.resume()
      else queue.pause()
    } else {
      downloads.requestDownload(downloads.missingIds)
    }
  }
  const fraction =
    progress.totalBytes > 0 ? Math.min(1, progress.bytesWritten / progress.totalBytes) : 0
  const warn = header.kind === 'waiting' && header.reason === 'data'

  return (
    <View style={styles.bar} testID="sync-status" accessibilityLiveRegion="polite">
      {header.kind === 'downloading' ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(fraction * 100)}%` }]} />
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
            <Text style={[styles.action, warn ? styles.actionOnData : styles.actionAccent]}>
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
    ...card(theme.colors),
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
  // The device's accent, or amber on mobile data. Both are the theme's own, so
  // the accent picker recolours this line without re-rendering it.
  action: { fontSize: type.small, fontWeight: '600' },
  actionAccent: { color: theme.colors.accent },
  actionOnData: { color: theme.colors.warning },
  error: { color: theme.colors.danger, fontSize: type.small, flex: 1 },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.colors.surface2,
    overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: theme.colors.accent },
}))
