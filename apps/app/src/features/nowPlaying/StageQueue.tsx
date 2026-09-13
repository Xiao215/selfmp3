import { memo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { formatDuration, formatLongDuration, type Song } from '@selfmp3/shared'
import { radius } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { dragCursor } from '../../ports/dragCursor'
import { tip } from '../../ui/tip'
import { useAccent } from '../../ui/accent'
import { useSongColor } from '../../ui/useSongColor'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { IconButton } from '../../ui/components/IconButton'
import { Grip, Queue, Trash, X } from '../../ui/components/Icons'
import { Toggle } from '../../ui/components/Toggle'
import { autoMixLine } from './nowPlaying.model'
import { dropIndex } from '../playlistDetail/playlistDetail.model'

/** A row's height before it has been measured. */
const ROW = 46

/**
 * Up next, as the Now Playing page's second tab: the web's `QueuePanel`.
 *
 * Every song in the queue, the one playing marked and the played ones
 * quieter. Click a song to play it, ✕ to drop it, the grip to drag it
 * somewhere else, and the bin to clear the lot.
 */
export function StageQueue({ onClose }: { onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const artFor = useArt()
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const rowHeight = useRef(ROW)

  const count = player.songs.length
  const upcoming = player.songs.slice(player.queue.index + 1)
  const remaining = upcoming.reduce((sum, song) => sum + song.duration, 0)

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={styles.titles}>
          <Text style={styles.title}>Up next</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {count === 0
              ? 'Nothing playing'
              : upcoming.length === 0
                ? 'Nothing after this one'
                : `${upcoming.length} ${upcoming.length === 1 ? 'song' : 'songs'} · ${formatLongDuration(remaining)} left`}
          </Text>
        </View>
        <View style={styles.actions}>
          {count > 0 ? (
            <IconButton onPress={player.clearQueue} label="Clear queue">
              <Trash size={17} color={theme.colors.textSecondary} />
            </IconButton>
          ) : null}
          <View style={styles.divider} />
          <IconButton onPress={onClose} label="Close queue">
            <X size={17} color={theme.colors.textSecondary} />
          </IconButton>
        </View>
      </View>

      {/* Its own row, as on the web, where it has room to say what it is doing. */}
      <View style={styles.toolbar}>
        <Toggle
          value={player.autoMix}
          onChange={player.setAutoMix}
          label="Auto-mix"
          testID="auto-mix"
        />
        <Text style={styles.toolbarLabel}>Auto-mix</Text>
        <Text style={styles.toolbarHint} numberOfLines={1}>
          {autoMixLine({
            autoMix: player.autoMix,
            canCrossfade: player.canCrossfade,
            upcoming: upcoming.length,
            nextCrossfadeSeconds: player.nextCrossfadeSeconds,
          })}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.list} scrollEnabled={drag === null}>
        {count === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Queue size={20} color={theme.colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Nothing queued</Text>
            <Text style={styles.emptyText}>
              Play a song to start a queue, or use Add to queue on any song.
            </Text>
          </View>
        ) : null}
        {player.songs.map((song, index) => (
          <QueueRow
            key={`${song.id}-${index}`}
            song={song}
            index={index}
            artUri={artFor(song)}
            current={index === player.queue.index}
            past={index < player.queue.index}
            playing={player.isPlaying}
            dragging={drag?.from === index}
            dropEdge={
              drag && drag.to === index && drag.to !== drag.from
                ? drag.to < drag.from
                  ? 'top'
                  : 'bottom'
                : null
            }
            onDragStart={() => setDrag({ from: index, to: index })}
            onDragMove={dy =>
              setDrag(current =>
                current
                  ? { ...current, to: dropIndex(current.from, dy, rowHeight.current, count) }
                  : null,
              )
            }
            onDragEnd={dy => {
              setDrag(null)
              const to = dropIndex(index, dy, rowHeight.current, count)
              if (to !== index) player.reorderQueue(index, to)
            }}
            onLayoutHeight={height => {
              rowHeight.current = height
            }}
            onPlay={() => player.jumpTo(index)}
            onRemove={() => player.removeFromQueue(index)}
          />
        ))}
      </ScrollView>
    </View>
  )
}

const QueueRow = memo(function QueueRow({
  song,
  index,
  artUri,
  current,
  past,
  playing,
  dragging,
  dropEdge,
  onDragStart,
  onDragMove,
  onDragEnd,
  onLayoutHeight,
  onPlay,
  onRemove,
}: {
  song: Song
  index: number
  artUri: string | null
  current: boolean
  past: boolean
  playing: boolean
  dragging: boolean
  dropEdge: 'top' | 'bottom' | null
  onDragStart: () => void
  onDragMove: (dy: number) => void
  onDragEnd: (dy: number) => void
  onLayoutHeight: (height: number) => void
  onPlay: () => void
  onRemove: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const songColor = useSongColor(current ? song : null, artUri)
  const { finePointer } = useLayout()
  const [hovered, setHovered] = useState(false)

  // The grip answers the responder system directly. Where the drag began is
  // kept between its events, and only its events read it.
  const startY = useRef(0)

  return (
    <View
      style={[
        styles.row,
        (hovered || current) && styles.rowHighlighted,
        current && { borderLeftColor: songColor.color },
        dragging && styles.rowDragging,
      ]}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
      onLayout={
        index === 0 ? event => onLayoutHeight(event.nativeEvent.layout.height + 1) : undefined
      }
    >
      {dropEdge ? (
        <View
          style={[
            styles.dropLine,
            dropEdge === 'top' ? styles.dropTop : styles.dropBottom,
            { backgroundColor: accent.accent },
          ]}
        />
      ) : null}
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={event => {
          startY.current = event.nativeEvent.pageY
          onDragStart()
        }}
        onResponderMove={event => onDragMove(event.nativeEvent.pageY - startY.current)}
        onResponderRelease={event => onDragEnd(event.nativeEvent.pageY - startY.current)}
        onResponderTerminate={() => onDragEnd(0)}
        accessibilityRole="button"
        accessibilityLabel={`Reorder ${song.title}`}
        style={[styles.grip, !finePointer && styles.gripTouch, dragCursor(dragging)]}
        {...tip('Drag to reorder')}
      >
        <Grip size={16} color={hovered ? theme.colors.textSecondary : theme.colors.textMuted} />
      </View>
      <Pressable
        style={styles.main}
        onPress={onPlay}
        accessibilityRole="button"
        accessibilityLabel={`Play ${song.title}`}
      >
        {current ? (
          <View style={styles.marker}>
            <Equalizer paused={!playing} size={14} color={songColor.tint} />
          </View>
        ) : (
          <View style={past && styles.pastArt}>
            <Cover uri={artUri} title={song.album || song.title} size={34} />
          </View>
        )}
        <View style={styles.meta}>
          <Text style={[styles.songTitle, past && styles.pastTitle]} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist || 'Unknown artist'}
          </Text>
        </View>
        <Text style={styles.duration}>{formatDuration(song.duration)}</Text>
      </Pressable>
      <IconButton
        onPress={onRemove}
        label={`Remove ${song.title} from queue`}
        size={finePointer ? 28 : 36}
      >
        <X size={15} color={theme.colors.textMuted} />
      </IconButton>
    </View>
  )
})

const styles = StyleSheet.create(theme => ({
  panel: { flex: 1, minHeight: 0 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 58,
    paddingVertical: 10,
    paddingRight: 10,
    paddingLeft: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  titles: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' },
  sub: { color: theme.colors.textMuted, fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  divider: { width: 1, height: 18, marginHorizontal: 4, backgroundColor: theme.colors.border },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  toolbarLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '500' },
  toolbarHint: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  list: { padding: 8, gap: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  rowHighlighted: { backgroundColor: theme.colors.surface2 },
  rowDragging: { opacity: 0.4 },
  dropLine: { position: 'absolute', left: 0, right: 0, height: 2 },
  dropTop: { top: -1 },
  dropBottom: { bottom: -1 },
  grip: { width: 24, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  gripTouch: { width: 34 },
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  marker: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  pastArt: { opacity: 0.55 },
  meta: { flex: 1, minWidth: 0, gap: 1 },
  songTitle: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  pastTitle: { color: theme.colors.textMuted, fontWeight: '500' },
  artist: { color: theme.colors.textMuted, fontSize: 11 },
  duration: { color: theme.colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 40, paddingHorizontal: 24 },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
  },
  emptyTitle: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center' },
}))
