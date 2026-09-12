import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Song } from '@selfmp3/shared'
import { downloadedCount, isDownloaded } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { freeToDownload, useConnectionKind } from '../../offline/connectionKind'
import { useAccent } from '../accent'
import { colors, radius, space, type } from '../theme'

/**
 * One line saying whether this phone has your music yet.
 *
 * Nothing plays from the bucket directly — the audio player is handed a URL
 * and cannot attach the header the doorman wants — so "is it downloaded" is
 * not a detail here the way it is in a browser. It is the difference between
 * a song that plays and a song that does not, and it belongs where you can
 * see it without going looking.
 */
export function SyncStatus({ songs }: { songs: readonly Song[] }): ReactNode {
  const { state, queue } = useDownloads()
  const connection = useConnectionKind()

  const accent = useAccent()
  const held = useMemo(() => downloadedCount(state.index), [state.index])
  const total = songs.length
  const missing = useMemo(
    () => songs.filter(song => !isDownloaded(state.index, song.id)).map(song => song.id),
    [songs, state.index],
  )

  if (total === 0) return null

  // A failure used to leave the line saying "13 new" — identical to never
  // having tried. The queue empties on error, so without this the only way to
  // know a download failed is that nothing happened.
  if (state.error) {
    return (
      <View style={styles.bar}>
        <View style={styles.row}>
          <Text style={styles.error} numberOfLines={2}>
            {state.error}
          </Text>
          <Pressable onPress={() => queue.enqueue(missing)} hitSlop={8}>
            <Text style={styles.action}>Retry</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  const working = state.queue.length > 0
  const fraction =
    state.totalBytes > 0 ? Math.min(1, state.bytesWritten / state.totalBytes) : 0

  if (working) {
    const done = Math.max(0, total - state.queue.length)
    return (
      <View style={styles.bar}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(fraction * 100)}%`, backgroundColor: accent.accent },
            ]}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.text}>
            {state.paused ? 'Paused' : 'Adding'} {done + 1} of {total}
          </Text>
          <Pressable
            onPress={() => (state.paused ? queue.resume() : queue.pause())}
            hitSlop={8}
          >
            <Text style={[styles.action, { color: accent.accent }]}>
              {state.paused ? 'Resume' : 'Pause'}
            </Text>
          </Pressable>
        </View>
      </View>
    )
  }

  if (missing.length === 0) {
    return (
      <View style={styles.bar}>
        <Text style={styles.text}>
          All {total} song{total === 1 ? '' : 's'} on this phone
        </Text>
      </View>
    )
  }

  if (connection === 'none') {
    return (
      <View style={styles.bar}>
        <Text style={styles.text}>
          {missing.length} new · offline
        </Text>
      </View>
    )
  }

  // "New", not "0 of 13": a song in the bucket this phone has not fetched yet
  // is something waiting to be added, which is what it looks like to whoever
  // is holding it — not a shortfall against a total.
  //
  // On mobile data it still offers, but says so first. A library is measured
  // in gigabytes and a phone plan is not, and downloading thirteen songs on a
  // train because somebody opened the app is a thing an app gets to do once.
  const onData = !freeToDownload(connection)
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Text style={styles.text}>
          {missing.length} new{held > 0 ? ` · ${held} on this phone` : ''}
          {onData ? ' · on mobile data' : ''}
        </Text>
        <Pressable onPress={() => queue.enqueue(missing)} hitSlop={8}>
          <Text
            style={[
              styles.action,
              { color: onData ? colors.warning : accent.accent },
            ]}
          >
            {onData ? 'Add anyway' : `Add ${missing.length === total ? 'all' : missing.length}`}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.surface1,
    borderRadius: radius.md,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    gap: space.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  text: { color: colors.textSecondary, fontSize: type.small },
  // No colour here: it is the device's accent, or amber on mobile data.
  action: { fontSize: type.small, fontWeight: '600' },
  error: { color: colors.danger, fontSize: type.small, flex: 1, marginRight: space.md },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  progressFill: { height: 3 },
})
