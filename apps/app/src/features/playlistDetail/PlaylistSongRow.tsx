import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PanResponder, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { GestureResponderEvent } from 'react-native'
import { formatDuration, type Song } from '@selfmp3/shared'
import { radius, space, type } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { Grip, X } from '../../ui/components/Icons'

/**
 * One track of a playlist: the web's `.playlist-row`.
 *
 * Plainer than a library row on purpose: the position, the cover, title over
 * artist, and the length. A manual playlist adds a grip to drag the track by
 * and a ✕ that takes it out of this playlist (never out of the library); a
 * smart one has neither, because its order and its contents are its rules'.
 *
 * With a mouse the grip is faint and the ✕ hidden until the pointer is on the
 * row; a finger has no hover, so on a touch screen both are simply there.
 */
export const PlaylistSongRow = memo(function PlaylistSongRow({
  song,
  index,
  artUri,
  active,
  manual,
  playlistName,
  selecting,
  selected,
  dragging,
  dropTarget,
  onDragStart,
  onDragMove,
  onDragEnd,
  onToggleSelect,
  onPress,
  onLongPress,
  onRemove,
  onLayoutHeight,
}: {
  song: Song
  index: number
  artUri: string | null
  active: boolean
  manual: boolean
  playlistName: string
  selecting: boolean
  selected: boolean
  /** This row is the one being dragged. */
  dragging: boolean
  /** A drag is over this row: the line on its top edge says it lands here. */
  dropTarget: boolean
  /**
   * The grip's drag, in points travelled from where it started. The row owns
   * one gesture responder for its whole life: a responder made afresh on
   * every render loses its gesture part-way, because each re-render during a
   * drag would start counting from nothing.
   */
  onDragStart?: () => void
  onDragMove?: (dy: number) => void
  onDragEnd?: (dy: number) => void
  onToggleSelect: () => void
  onPress: (event: GestureResponderEvent) => void
  onLongPress?: () => void
  onRemove: () => void
  /** Reports the row's height, so a drag can count rows travelled. */
  onLayoutHeight?: (height: number) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { wide, finePointer } = useLayout()
  const [hovered, setHovered] = useState(false)
  const revealed = !finePointer || hovered

  const drag = useRef({ onDragStart, onDragMove, onDragEnd })
  useEffect(() => {
    drag.current = { onDragStart, onDragMove, onDragEnd }
  }, [onDragStart, onDragMove, onDragEnd])
  const grip = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => drag.current.onDragStart?.(),
        onPanResponderMove: (_, gesture) => drag.current.onDragMove?.(gesture.dy),
        onPanResponderRelease: (_, gesture) => drag.current.onDragEnd?.(gesture.dy),
        onPanResponderTerminate: () => drag.current.onDragEnd?.(0),
      }),
    [],
  )
  // Selection mode on a phone brings the column in; at desktop width it is
  // always in the layout and shown when it has something to say.
  const showSelect = wide ? selecting || selected || hovered : selecting

  return (
    <View
      role="row"
      style={[
        styles.row,
        hovered && styles.rowHovered,
        selected && styles.rowSelected,
        dragging && styles.rowDragging,
      ]}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
      onLayout={
        onLayoutHeight ? event => onLayoutHeight(event.nativeEvent.layout.height) : undefined
      }
    >
      {dropTarget ? <View style={[styles.dropLine, { backgroundColor: accent.accent }]} /> : null}

      {wide || selecting ? (
        <View style={{ opacity: showSelect ? 1 : 0 }}>
          <Pressable
            onPress={onToggleSelect}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={selected ? `Deselect ${song.title}` : `Select ${song.title}`}
            style={[styles.select, !wide && styles.selectCompact]}
          >
            <Checkbox checked={selected} />
          </Pressable>
        </View>
      ) : null}

      {/* Reordering is not what selection mode is for, so the grip steps aside. */}
      {manual && !selecting ? (
        <View
          {...grip.panHandlers}
          accessibilityRole="button"
          accessibilityLabel={`Move ${song.title}`}
          style={[styles.grip, !finePointer && styles.gripTouch, { opacity: revealed ? 1 : 0.45 }]}
        >
          <Grip size={16} color={revealed ? theme.colors.textSecondary : theme.colors.textMuted} />
        </View>
      ) : null}

      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={450}
        accessibilityRole="button"
        accessibilityLabel={`${song.title}, ${song.artist || 'Unknown artist'}`}
        accessibilityState={{ selected: active }}
        style={styles.main}
      >
        <Text style={styles.index}>{index + 1}</Text>
        <Cover uri={artUri} title={song.album || song.title} size={36} />
        <View style={styles.meta}>
          <Text style={[styles.title, active && { color: accent.accent }]} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist || 'Unknown artist'}
          </Text>
        </View>
      </Pressable>

      <Text style={styles.time}>{formatDuration(song.duration)}</Text>

      {manual && !selecting ? (
        <View style={{ opacity: revealed ? 1 : 0 }}>
          <IconButton onPress={onRemove} label={`Remove ${song.title} from ${playlistName}`}>
            <X size={15} color={theme.colors.textMuted} />
          </IconButton>
        </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create(theme => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.sm,
  },
  rowHovered: { backgroundColor: theme.colors.surface1 },
  rowSelected: { backgroundColor: theme.colors.surface2 },
  rowDragging: { opacity: 0.45, backgroundColor: theme.colors.surface2 },
  dropLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -1,
    height: 2,
    borderRadius: 1,
  },
  select: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  selectCompact: { width: 34, height: 44 },
  grip: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  gripTouch: { width: 44, height: 44 },
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 7,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  index: { width: 22, color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  meta: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '500' },
  artist: { color: theme.colors.textMuted, fontSize: 12 },
  time: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    paddingRight: 4,
  },
}))
