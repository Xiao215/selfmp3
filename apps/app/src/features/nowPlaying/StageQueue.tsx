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
import { ChevronDown, ChevronRight, Grip, Queue, Trash, X } from '../../ui/components/Icons'
import { Toggle } from '../../ui/components/Toggle'
import { autoMixLine, queueLines, upNextLine } from './nowPlaying.model'
import { dropIndex } from '../playlistDetail/playlistDetail.model'

/** A row's height before it has been measured. */
const ROW = 46

/**
 * The queue, as the Now Playing page's second tab: the web's `QueuePanel`.
 *
 * It starts at the song that is playing: the songs already played fold into
 * one "Played" line above it (`queueLines`), which opens them again for a jump
 * back, and what follows sits under an "Up next" label. Click a song to play
 * it, ✕ to drop it, the grip to drag it somewhere else, and the bin to clear
 * the lot. A drag never lands among folded songs it cannot see.
 */
export function StageQueue({ onClose }: { onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const artFor = useArt()
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const [playedOpen, setPlayedOpen] = useState(false)
  const rowHeight = useRef(ROW)

  const count = player.songs.length
  const current = player.queue.index
  const upcoming = player.songs.slice(current + 1)
  const remaining = upcoming.reduce((sum, song) => sum + song.duration, 0)
  // The first place a drag may land: the top of what is on screen.
  const firstShown = playedOpen ? 0 : Math.max(0, current)
  const dropAt = (from: number, dy: number): number =>
    Math.max(firstShown, dropIndex(from, dy, rowHeight.current, count))

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={styles.titles}>
          <Text style={styles.title}>Queue</Text>
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
            <IconButton onPress={player.clearQueue} label="Clear queue" caption="Clear">
              <Trash size={17} color={theme.colors.textSecondary} />
            </IconButton>
          ) : null}
          <View style={styles.divider} />
          <IconButton onPress={onClose} label="Close queue" caption="Close">
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
        {queueLines(current, count, playedOpen).map(line => {
          if (line.kind === 'played') {
            return (
              <Pressable
                key="played"
                onPress={() => setPlayedOpen(open => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: line.open }}
                accessibilityLabel={`${line.open ? 'Hide' : 'Show'} ${line.count} played ${line.count === 1 ? 'song' : 'songs'}`}
                style={({ pressed }) => [styles.played, pressed && styles.playedPressed]}
              >
                {line.open ? (
                  <ChevronDown size={14} color={theme.colors.textMuted} />
                ) : (
                  <ChevronRight size={14} color={theme.colors.textMuted} />
                )}
                <Text style={styles.playedText}>Played · {line.count}</Text>
              </Pressable>
            )
          }
          if (line.kind === 'upNext') {
            return (
              <Text key="up-next" style={styles.upNext}>
                {upNextLine(upcoming.length, remaining)}
              </Text>
            )
          }
          const index = line.index
          const song = player.songs[index]
          if (!song) return null
          return (
            <QueueRow
              key={`${song.id}-${index}`}
              song={song}
              measure={index === current}
              artUri={artFor(song)}
              current={index === current}
              past={index < current}
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
                setDrag(moving => (moving ? { ...moving, to: dropAt(moving.from, dy) } : null))
              }
              onDragEnd={dy => {
                setDrag(null)
                const to = dropAt(index, dy)
                if (to !== index) player.reorderQueue(index, to)
              }}
              onLayoutHeight={height => {
                rowHeight.current = height
              }}
              onPlay={() => player.jumpTo(index)}
              onRemove={() => player.removeFromQueue(index)}
            />
          )
        })}
      </ScrollView>
    </View>
  )
}

const QueueRow = memo(function QueueRow({
  song,
  measure,
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
  /** The row whose height stands for all of them: the one playing, which always shows. */
  measure: boolean
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
        measure ? event => onLayoutHeight(event.nativeEvent.layout.height + 1) : undefined
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
  titles: { flex: 1, minWidth: 0, gap: 3 },
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
  played: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
  },
  playedPressed: { backgroundColor: theme.colors.surface2 },
  playedText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '500' },
  upNext: {
    color: theme.colors.textMuted,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 10,
  },
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
