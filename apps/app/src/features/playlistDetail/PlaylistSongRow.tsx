import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PanResponder, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { GestureResponderEvent } from 'react-native'
import { formatDuration, type Song } from '@selfmp3/shared'
import { radius, space, type } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { dragCursor } from '../../ports/dragCursor'
import { tip } from '../../ui/tip'
import { useAccent } from '../../ui/accent'
import { useSongColor } from '../../ui/useSongColor'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { Grip, More, X } from '../../ui/components/Icons'

/** How long a finger rests on a row before the row lifts to be moved. */
const LIFT_DELAY = 350

/**
 * One track of a playlist.
 *
 * At desktop width: the position, the cover, title over artist, the length,
 * and — where there is a mouse, once it is on the row — ⋯ for the song's menu
 * and, in a playlist you made, a grip to drag it by and ✕ to take it out
 * (never out of the library).
 *
 * On a phone the row is only the cover, title over artist, the length and ⋯:
 * a grip and a position number cost the title room it needs on a narrow
 * screen. Holding the row lifts it, and it follows the finger to its new
 * place. A live playlist's rows do not lift: its rules decide the order.
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
  dragOffset,
  dropTarget,
  menuOpen,
  onDragStart,
  onDragMove,
  onDragEnd,
  onToggleSelect,
  onPress,
  onMore,
  onRemove,
  onLayoutHeight,
  unavailable = false,
}: {
  song: Song
  index: number
  artUri: string | null
  active: boolean
  /** Not on this device, and no server to stream it from: drawn faded. */
  unavailable?: boolean
  manual: boolean
  playlistName: string
  selecting: boolean
  selected: boolean
  /** This row is the one being moved. */
  dragging: boolean
  /** How far the moving row has travelled from its place, so it follows the pointer. */
  dragOffset: number
  /** A move is over this row: the line on its top edge says it lands here. */
  dropTarget: boolean
  /** This row's ⋯ menu is open, so its controls stay while the menu covers the pointer. */
  menuOpen: boolean
  /**
   * The move, in points travelled from where it started. The row owns one
   * gesture responder for its whole life: a responder made afresh on every
   * render loses its gesture part-way, because each re-render during a move
   * would start counting from nothing.
   */
  onDragStart?: () => void
  onDragMove?: (dy: number) => void
  onDragEnd?: (dy: number) => void
  onToggleSelect: () => void
  onPress: (event: GestureResponderEvent) => void
  /** Handed the ⋯ itself, so at desktop width the menu opens beside it. */
  onMore: (anchor: View | null) => void
  onRemove?: () => void
  /** Reports the row's height, so a move can count rows travelled. */
  onLayoutHeight?: (height: number) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const songColor = useSongColor(active ? song : null, artUri)
  const { wide, finePointer } = useLayout()
  const [hovered, setHovered] = useState(false)
  const moreRef = useRef<View>(null)
  const revealed = !finePointer || hovered || menuOpen

  const drag = useRef({ onDragStart, onDragMove, onDragEnd })
  useEffect(() => {
    drag.current = { onDragStart, onDragMove, onDragEnd }
  }, [onDragStart, onDragMove, onDragEnd])

  // Desktop: the grip takes the pointer the moment it is pressed.
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

  // Phone: holding the row arms it, and the finger's next movement is taken
  // from the row's press and becomes the move. A hold let go without moving
  // puts the row straight back.
  const armed = useRef(false)
  const moving = useRef(false)
  const hold = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: () => armed.current,
        onMoveShouldSetPanResponder: () => armed.current,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          moving.current = true
        },
        onPanResponderMove: (_, gesture) => drag.current.onDragMove?.(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          armed.current = false
          moving.current = false
          drag.current.onDragEnd?.(gesture.dy)
        },
        onPanResponderTerminate: () => {
          armed.current = false
          moving.current = false
          drag.current.onDragEnd?.(0)
        },
      }),
    [],
  )
  const liftable = !wide && manual && !selecting && onDragStart !== undefined

  const selectBox = (
    <Pressable
      onPress={onToggleSelect}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={selected ? `Deselect ${song.title}` : `Select ${song.title}`}
      style={[styles.select, !wide && styles.selectCompact]}
    >
      <Checkbox checked={selected} />
    </Pressable>
  )

  const more = (
    <View ref={moreRef} collapsable={false} style={{ opacity: revealed ? 1 : 0 }}>
      <IconButton
        onPress={() => onMore(moreRef.current)}
        label={`More actions for ${song.title}`}
        caption="More"
        active={menuOpen}
      >
        <More size={16} color={theme.colors.textMuted} />
      </IconButton>
    </View>
  )

  return (
    <View
      role="row"
      {...(liftable ? hold.panHandlers : {})}
      style={[
        styles.row,
        !wide && styles.rowCompact,
        hovered && styles.rowHovered,
        selected && styles.rowSelected,
        dragging && [styles.rowDragging, { transform: [{ translateY: dragOffset }] }],
        unavailable && styles.rowUnavailable,
      ]}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
      onLayout={
        onLayoutHeight ? event => onLayoutHeight(event.nativeEvent.layout.height) : undefined
      }
    >
      {dropTarget ? <View style={[styles.dropLine, { backgroundColor: accent.accent }]} /> : null}

      {wide ? (
        <View style={{ opacity: selecting || selected || hovered ? 1 : 0 }}>{selectBox}</View>
      ) : selecting ? (
        selectBox
      ) : null}

      {/* Reordering is not what selection mode is for, so the grip steps aside. */}
      {wide && manual && !selecting ? (
        <View
          {...grip.panHandlers}
          accessibilityRole="button"
          accessibilityLabel={`Move ${song.title}`}
          style={[
            styles.grip,
            !finePointer && styles.gripTouch,
            { opacity: revealed ? 1 : 0.45 },
            dragCursor(dragging),
          ]}
          {...tip('Drag to reorder')}
        >
          <Grip size={16} color={revealed ? theme.colors.textSecondary : theme.colors.textMuted} />
        </View>
      ) : null}

      <Pressable
        onPress={onPress}
        onLongPress={
          liftable
            ? () => {
                armed.current = true
                drag.current.onDragStart?.()
              }
            : undefined
        }
        onPressOut={
          liftable
            ? () => {
                // Let go without moving: the row goes back where it was. When
                // the move took the press over, the release is the move's.
                if (armed.current && !moving.current) {
                  armed.current = false
                  drag.current.onDragEnd?.(0)
                }
              }
            : undefined
        }
        delayLongPress={LIFT_DELAY}
        accessibilityRole="button"
        accessibilityLabel={`${song.title}, ${song.artist || 'Unknown artist'}`}
        accessibilityHint={liftable ? 'Hold to move' : undefined}
        accessibilityState={{ selected: active }}
        style={[styles.main, !wide && styles.mainCompact]}
      >
        {wide ? <Text style={styles.index}>{index + 1}</Text> : null}
        <Cover uri={artUri} title={song.album || song.title} size={wide ? 36 : 42} />
        <View style={styles.meta}>
          <Text style={[styles.title, active && { color: songColor.tint }]} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist || 'Unknown artist'}
          </Text>
        </View>
      </Pressable>

      <Text style={styles.time}>{formatDuration(song.duration)}</Text>

      {selecting ? null : more}

      {wide && manual && !selecting && onRemove ? (
        <View style={{ opacity: revealed ? 1 : 0 }}>
          <IconButton
            onPress={onRemove}
            label={`Remove ${song.title} from ${playlistName}`}
            caption="Remove from playlist"
          >
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
  rowCompact: { gap: 2 },
  rowHovered: { backgroundColor: theme.colors.surface1 },
  rowSelected: { backgroundColor: theme.colors.surface2 },
  rowUnavailable: { opacity: 0.55 },
  rowDragging: {
    zIndex: 2,
    backgroundColor: theme.colors.surface2,
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)',
  },
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
  mainCompact: { paddingHorizontal: 0, paddingVertical: 5 },
  index: { width: 22, color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  meta: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '500' },
  artist: { color: theme.colors.textMuted, fontSize: 12 },
  time: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 4,
  },
}))
