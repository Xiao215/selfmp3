import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Song } from '@selfmp3/shared'
import { downloadedCount, isDownloaded } from '../../offline/downloadIndex'
import { useDownloads } from '../../offline/DownloadsProvider'
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

  const held = useMemo(() => downloadedCount(state.index), [state.index])
  const total = songs.length
  const missing = useMemo(
    () => songs.filter(song => !isDownloaded(state.index, song.id)).map(song => song.id),
    [songs, state.index],
  )

  if (total === 0) return null

  const working = state.queue.length > 0
  const fraction =
    state.totalBytes > 0 ? Math.min(1, state.bytesWritten / state.totalBytes) : 0

  if (working) {
    const done = Math.max(0, total - state.queue.length)
    return (
      <View style={styles.bar}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
        <View style={styles.row}>
          <Text style={styles.text}>
            {state.paused ? 'Paused' : 'Adding'} {done + 1} of {total}
          </Text>
          <Pressable
            onPress={() => (state.paused ? queue.resume() : queue.pause())}
            hitSlop={8}
          >
            <Text style={styles.action}>{state.paused ? 'Resume' : 'Pause'}</Text>
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

  // "New", not "0 of 13": a song in the bucket this phone has not fetched yet
  // is something waiting to be added, which is what it looks like to whoever
  // is holding it — not a shortfall against a total.
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Text style={styles.text}>
          {missing.length} new{held > 0 ? ` · ${held} on this phone` : ''}
        </Text>
        <Pressable onPress={() => queue.enqueue(missing)} hitSlop={8}>
          <Text style={styles.action}>Add {missing.length === total ? 'all' : missing.length}</Text>
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
  action: { color: colors.accent, fontSize: type.small, fontWeight: '600' },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: colors.accent },
})
