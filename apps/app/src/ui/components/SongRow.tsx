import { memo, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { GestureResponderEvent } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { formatDuration, type Song, type Tag } from '@selfmp3/shared'
import {
  HIT_TARGET,
  motion,
  oklchToHexAlpha,
  radius,
  space,
  tagColors,
  tempoMark,
  type,
  describeEnergy,
  describeTempo,
} from '@selfmp3/client'
import { useSongPlayback } from '../../player/PlayerProvider'
import { useSongDragSource } from '../../ports/songDrag'
import { useContentWidth } from '../../shell/contentWidth'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { tip } from '../tip'
import { useSongColor } from '../useSongColor'
import { Checkbox } from './Checkbox'
import { Cover } from './Cover'
import { EnergyWave } from './EnergyWave'
import { Equalizer } from './Equalizer'
import { Downloaded, Heart, More, NotDownloaded, Play, Plus } from './Icons'

/**
 * Past this width of page the album leaves the second line for a column of its
 * own. It was 1160 of window, of which the sidebar takes 244; measured against
 * the page itself, it stays right when the practice panel narrows the page.
 */
const ALBUM_COLUMN_CONTENT_WIDTH = 916
const SIDEBAR_WIDTH = 244

/**
 * One song in a list.
 *
 * Two shapes. At phone width, with a finger and no hover: a tap plays, the
 * heart and ⋯ are always there at a finger-sized target, and holding the row
 * opens the same menu. At desktop width it is a table row: the
 * position (or the equaliser, for the song that is loaded), the art, the title
 * over the artist with the tempo and energy after it, the album in a column of
 * its own once there is room, the tags, and the heart, length and ⋯.
 *
 * With a mouse, the controls that are actions rather than information — the
 * play button over the number, the checkbox, the tag button, an unloved heart,
 * the ⋯ — wait for the pointer, so a screen of songs reads as titles and not as
 * a grid of grey icons. Only three things are ever ink: title, artist, length.
 *
 * Memoised because the list is long — the one place in this app where a render
 * too many actually matters. The memo only holds if nothing handed to a row is
 * new each render, so the handlers are given the row's song rather than being
 * closures over it (one function serves every row), and whether this is the
 * loaded song is asked of the player by the row itself (`useSongPlayback`)
 * rather than handed down, which used to redraw every row on every song change.
 */
export const SongRow = memo(function SongRow({
  testID,
  song,
  artUri,
  active: activeOverride,
  downloaded,
  notDownloadedMark = false,
  playing: playingOverride,
  onPress,
  onMore,
  onToggleLoved,
  selecting = false,
  selected = false,
  onToggleSelect,
  index,
  tags,
  onToggleTag,
  onEditTags,
  onLongPress,
  menuOpen = false,
  unavailable = false,
}: {
  /** Named so a flow can tap a row by position: `song-row-0`. */
  testID?: string
  song: Song
  artUri: string | null
  /** Draw as the loaded song. Left out, the row asks the player, which is what a list wants. */
  active?: boolean
  downloaded: boolean
  /**
   * Mark a song that is not on this device. An installed app says so, since
   * such a song may not play; a browser streams, and leaves it unmarked.
   */
  notDownloadedMark?: boolean
  /** Whether the song is the one actually sounding, for the equaliser. Left out, the player says. */
  playing?: boolean
  /**
   * The press event comes through, so a list can read Shift and Cmd on the web.
   * So does the song, so one handler can serve every row.
   */
  onPress: (event: GestureResponderEvent, song: Song) => void
  /**
   * The ⋯, and what a held finger opens. Handed the ⋯ itself, so at desktop
   * width the menu can open beside it.
   */
  onMore?: (anchor: View | null, song: Song) => void
  onToggleLoved?: (song: Song) => void
  /**
   * Selection mode is on, so the checkbox column is showing. On a phone the
   * column is not there until then, rather than spending 34 points of every
   * row on nothing; the row decides what a tap means via `onPress`.
   */
  selecting?: boolean
  selected?: boolean
  onToggleSelect?: (song: Song) => void
  /** Position in the list, shown at desktop width. */
  index?: number
  /** The song's tags, drawn as chips at desktop width. */
  tags?: readonly Tag[]
  /** A tag chip filters the library by that tag. */
  onToggleTag?: (tagId: number) => void
  /** The dashed + beside the chips. Handed the +, so the tag window can open over it. */
  onEditTags?: (anchor: View | null, song: Song) => void
  /** Holding the row on a phone. Without it, holding opens the ⋯ menu. */
  onLongPress?: (song: Song) => void
  /**
   * This row's menu is open. The menu covers the pointer, so the row stops
   * hearing it; without this the ⋯ faded out under its own menu and stayed
   * clickable while invisible.
   */
  menuOpen?: boolean
  /**
   * Nothing could play this right now: it is not on this device and the
   * server is not answering. Drawn faded, as a song whose file is missing is.
   */
  unavailable?: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const playback = useSongPlayback(song.id)
  const active = activeOverride ?? playback !== null
  const playing = playingOverride ?? playback === 'playing'
  // The playing row wears its cover's colour; every other row asks for nothing.
  const songColor = useSongColor(active ? song : null, artUri)
  const { wide, dense, width } = useLayout()
  const contentWidth = useContentWidth()
  const [hovered, setHovered] = useState(false)
  const moreRef = useRef<View>(null)
  const tagAddRef = useRef<View>(null)
  // With a mouse a row drags onto a playlist in the sidebar. Nothing on a phone.
  const rowRef = useRef<View>(null)
  useSongDragSource(rowRef, () => [song.id], wide && dense)
  // The held-finger state: the row gives a little under the
  // finger so something is visibly happening while the menu is on its way.
  const [scale] = useState(() => new Animated.Value(1))
  const press = (down: boolean): void => {
    Animated.timing(scale, {
      toValue: down ? 0.985 : 1,
      duration: motion.base,
      useNativeDriver: true,
    }).start()
  }

  const tint = [
    // Selected: a translucent accent that reads as picked on the dark UI.
    selected && { backgroundColor: oklchToHexAlpha(0.36, 0.08, accent.hue, 0.4) },
    (song.missing || unavailable) && styles.missing,
  ]

  if (!wide) {
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        {/*
          The row is a container, and the thing you press is inside it. In a
          browser only this shape works: react-native-web renders a button as a
          real <button>, and a row that was one would nest the heart and ⋯
          inside it. The web has always drawn a role="row" with buttons as
          siblings.
        */}
        <View testID={testID} role="row" style={[styles.row, ...tint]}>
          {active ? <RowWash color={songColor.color} /> : null}
          {selecting && onToggleSelect ? (
            <SelectBox
              song={song}
              selected={selected}
              onToggle={() => onToggleSelect(song)}
              phone
            />
          ) : null}

          <Pressable
            onPress={event => onPress(event, song)}
            onLongPress={
              onLongPress
                ? () => onLongPress(song)
                : onMore
                  ? () => onMore(moreRef.current, song)
                  : undefined
            }
            onPressIn={() => press(true)}
            onPressOut={() => press(false)}
            delayLongPress={450}
            accessibilityRole="button"
            accessibilityLabel={`${song.title}, ${song.artist || 'Unknown artist'}`}
            accessibilityState={{ selected: active }}
            // No pressed background: the row already gives under the finger, and a
            // filled box over the cover and title flashed white in the light theme.
            style={styles.main}
          >
            <View style={styles.art}>
              <Cover uri={artUri} title={song.album || song.title} size={40} />
              {active ? (
                <View style={styles.playingOverlay}>
                  <Equalizer paused={!playing} size={12} color={songColor.tint} />
                </View>
              ) : null}
            </View>

            <View style={styles.text}>
              <Text style={[styles.title, active && { color: songColor.tint }]} numberOfLines={1}>
                {song.title}
              </Text>
              <View style={styles.subtitleRow}>
                {/* The web calls this "On this device", and draws exactly this. */}
                {downloaded ? (
                  <Downloaded size={13} color={accent.accent} knockout={theme.colors.surface0} />
                ) : notDownloadedMark ? (
                  <NotDownloaded size={13} color={theme.colors.textMuted} />
                ) : null}
                <Text style={styles.subtitle} numberOfLines={1}>
                  {song.artist || 'Unknown artist'}
                  {song.album ? ` · ${song.album}` : ''}
                </Text>
              </View>
            </View>
          </Pressable>

          {onToggleLoved ? (
            <Love song={song} onPress={() => onToggleLoved(song)} size={HIT_TARGET} visible />
          ) : null}

          <Text style={styles.duration}>{formatDuration(song.duration)}</Text>

          {onMore ? (
            <View ref={moreRef} collapsable={false}>
              <Pressable
                onPress={() => onMore?.(moreRef.current, song)}
                accessibilityRole="button"
                accessibilityLabel={`More actions for ${song.title}`}
                {...tip('More')}
                style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
              >
                <More size={16} color={theme.colors.textMuted} />
              </Pressable>
            </View>
          ) : null}
        </View>
      </Animated.View>
    )
  }

  // --- desktop width ---------------------------------------------------------

  // With a mouse these wait for the pointer; a tablet at this width shows them.
  const revealed = !dense || hovered || menuOpen
  const albumColumn = (contentWidth ?? width - SIDEBAR_WIDTH) >= ALBUM_COLUMN_CONTENT_WIDTH
  const features = song.audioFeatures
  const badges = features && (features.bpm != null || features.energy != null)
  const controlSize = dense ? 34 : HIT_TARGET

  return (
    <View
      ref={rowRef}
      testID={testID}
      role="row"
      style={[styles.rowWide, dense && (hovered || menuOpen) && styles.rowHovered, ...tint]}
      onPointerEnter={dense ? () => setHovered(true) : undefined}
      onPointerLeave={dense ? () => setHovered(false) : undefined}
    >
      {active ? <RowWash color={songColor.color} /> : null}
      {onToggleSelect ? (
        <View style={{ opacity: selecting || selected || revealed ? 1 : 0 }}>
          <SelectBox song={song} selected={selected} onToggle={() => onToggleSelect(song)} />
        </View>
      ) : null}

      <View style={styles.index}>
        {active ? (
          <Equalizer paused={!playing} size={14} color={songColor.tint} />
        ) : revealed && dense ? (
          <Pressable
            onPress={event => onPress(event, song)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${song.title}`}
            {...tip('Play')}
            style={styles.indexPlay}
          >
            <Play size={16} color={theme.colors.textPrimary} />
          </Pressable>
        ) : (
          <Text style={styles.indexNumber}>{index === undefined ? '' : index + 1}</Text>
        )}
      </View>

      <Pressable
        onPress={event => onPress(event, song)}
        onLongPress={onMore ? () => onMore(moreRef.current, song) : undefined}
        delayLongPress={450}
        accessibilityRole="button"
        accessibilityLabel={`${song.title}, ${song.artist || 'Unknown artist'}`}
        accessibilityState={{ selected: active }}
        style={styles.mainWide}
      >
        <Cover uri={artUri} title={song.album || song.title} size={40} />
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text style={[styles.titleWide, active && { color: songColor.tint }]} numberOfLines={1}>
              {song.title}
            </Text>
            {song.missing ? <Text style={styles.badge}>FILE MISSING</Text> : null}
          </View>
          <View style={styles.subtitleRow}>
            {downloaded ? (
              <Downloaded size={13} color={accent.accent} knockout={theme.colors.surface0} />
            ) : notDownloadedMark ? (
              <NotDownloaded size={13} color={theme.colors.textMuted} />
            ) : null}
            <Text style={styles.artist} numberOfLines={1}>
              {song.artist || 'Unknown artist'}
            </Text>
            {song.album && !albumColumn ? (
              <Text style={styles.albumInline} numberOfLines={1}>
                {' · '}
                {song.album}
              </Text>
            ) : null}
            {badges ? (
              <View style={[styles.badges, { opacity: hovered ? 1 : 0.75 }]}>
                <Text style={styles.subtitle}>·</Text>
                {features.bpm != null ? (
                  <Text style={styles.tempo} {...tip(describeTempo(features.bpm))}>
                    {tempoMark(features.bpm)}
                  </Text>
                ) : null}
                {features.energy != null ? (
                  <View {...tip(describeEnergy(features.energy))}>
                    <EnergyWave energy={features.energy} />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>

      {albumColumn ? (
        <Text style={styles.albumColumn} numberOfLines={1}>
          {song.album}
        </Text>
      ) : null}

      <View style={[styles.tags, albumColumn && styles.tagsColumn]}>
        {/* Below the album column's width the chips go; the button stays. */}
        {albumColumn && tags
          ? tags.map(tag => <RowTag key={tag.id} tag={tag} onPress={() => onToggleTag?.(tag.id)} />)
          : null}
        {onEditTags ? (
          <Pressable
            ref={tagAddRef}
            onPress={() => onEditTags(tagAddRef.current, song)}
            accessibilityRole="button"
            accessibilityLabel={`Edit tags for ${song.title}`}
            {...tip('Edit tags')}
            style={[styles.tagAdd, { opacity: revealed ? 1 : 0 }]}
          >
            <Plus size={13} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.actions}>
        {onToggleLoved ? (
          <Love
            song={song}
            onPress={() => onToggleLoved(song)}
            size={controlSize}
            visible={revealed || song.loved}
          />
        ) : null}
        <Text style={styles.durationWide}>{formatDuration(song.duration)}</Text>
        {onMore ? (
          <View ref={moreRef} collapsable={false} style={{ opacity: revealed ? 1 : 0 }}>
            <Pressable
              onPress={() => onMore?.(moreRef.current, song)}
              accessibilityRole="button"
              accessibilityLabel={`More actions for ${song.title}`}
              {...tip('More')}
              style={({ pressed }) => [
                styles.controlWide,
                { width: controlSize, height: controlSize },
                pressed && styles.controlPressed,
              ]}
            >
              <More size={16} color={theme.colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  )
})

/*
 * How tall a row is, in each of its shapes. Every row of a shape is exactly
 * this tall — its tallest cell is a fixed-size control, and its text is one
 * line of each of two sizes that fit inside the cover beside it — so a list
 * can place rows by arithmetic (`SongList`'s `rowHeight`).
 *
 * Phone: 5 above and below the row, 3 above and below the press target, the
 * 40-point cover. Desktop: 7 above and below, and the heart and ⋯ at 44 with a
 * finger or 34 with a mouse, beside a 40-point cover.
 */
const PHONE_ROW_HEIGHT = 5 * 2 + 3 * 2 + 40
const TOUCH_WIDE_ROW_HEIGHT = 7 * 2 + HIT_TARGET
const DENSE_ROW_HEIGHT = 7 * 2 + 40

/**
 * The row height for this layout, or null when it cannot be promised: text
 * enlarged in the system's settings can wrap past the cover, and a list that
 * believed the old number would place every row in the wrong spot.
 */
export function useSongRowHeight(): number | null {
  const { wide, dense } = useLayout()
  const { fontScale } = useWindowDimensions()
  if (fontScale > 1) return null
  if (!wide) return PHONE_ROW_HEIGHT
  return dense ? DENSE_ROW_HEIGHT : TOUCH_WIDE_ROW_HEIGHT
}

function SelectBox({
  song,
  selected,
  onToggle,
  phone = false,
}: {
  song: Song
  selected: boolean
  onToggle: () => void
  phone?: boolean
}): ReactNode {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={selected ? `Deselect ${song.title}` : `Select ${song.title}`}
      style={phone ? styles.select : styles.selectWide}
    >
      <Checkbox checked={selected} />
    </Pressable>
  )
}

function Love({
  song,
  onPress,
  size,
  visible,
}: {
  song: Song
  onPress: () => void
  size: number
  visible: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={song.loved ? `Remove ${song.title} from loved` : `Love ${song.title}`}
      {...tip(song.loved ? 'Unlike' : 'Like')}
      accessibilityState={{ selected: song.loved }}
      style={({ pressed }) => [
        styles.controlWide,
        { width: size, height: size, opacity: visible ? 1 : 0 },
        pressed && styles.controlPressed,
      ]}
    >
      <Heart
        size={16}
        filled={song.loved}
        color={song.loved ? theme.colors.danger : theme.colors.textMuted}
      />
    </Pressable>
  )
}

/** A small tag chip, in the tag's own hue. */
function RowTag({ tag, onPress }: { tag: Tag; onPress: () => void }): ReactNode {
  const palette = tagColors(tag.hue)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tag.name}
      style={[styles.rowTag, { backgroundColor: palette.background }]}
    >
      <Text style={[styles.rowTagText, { color: palette.text }]} numberOfLines={1}>
        {tag.name}
      </Text>
    </Pressable>
  )
}

/**
 * Now playing: a wash that comes in from the right, where the row is empty —
 * the cover already fills the left. It stays while the song is paused, so
 * the row still says "this is the one".
 */
function RowWash({ color }: { color: string }): ReactNode {
  // Its own id per row. A screen the router keeps hidden behind this one (a
  // playlist listing the same song) holds a wash too; with one shared id, the
  // visible row's url() landed on the hidden, zero-size gradient and drew nothing.
  const id = `rowwash${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0.34" stopColor={color} stopOpacity={0} />
            <Stop offset="0.62" stopColor={color} stopOpacity={0.15} />
            <Stop offset="1" stopColor={color} stopOpacity={0.38} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    marginHorizontal: space.xs,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  /* `.song-row` at desktop width: 7 by 10, 12 between cells. */
  rowWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginHorizontal: space.sm,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  /* The press target: everything from the cover to the end of the title. */
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  mainWide: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  missing: {
    opacity: 0.55,
  },
  art: {
    position: 'relative',
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 },
  titleWide: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '500',
  },
  badge: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    color: theme.colors.warning,
    backgroundColor: oklchToHexAlpha(0.36, 0.09, 78, 0.5),
    overflow: 'hidden',
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    flexShrink: 1,
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  /* The artist is what is scanned for, so it never shrinks; the album does. */
  artist: { flexShrink: 0, color: theme.colors.textMuted, fontSize: type.small },
  albumInline: { flexShrink: 1, minWidth: 0, color: theme.colors.textMuted, fontSize: type.small },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 0 },
  tempo: { color: theme.colors.textMuted, fontSize: type.small, fontVariant: ['tabular-nums'] },
  playingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 8, 16, 0.55)',
    borderRadius: radius.sm,
  },
  /* `.song-list.is-selecting .song-select` at phone width. */
  select: {
    width: 34,
    height: HIT_TARGET,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* `.song-select` at desktop width: 24 wide, always in the layout. */
  selectWide: {
    width: 24,
    height: 24,
    marginLeft: -4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  index: { width: 28, alignItems: 'center', justifyContent: 'center' },
  indexNumber: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  indexPlay: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  /* A fixed column, so it lines up down the page; the title takes the slack. */
  albumColumn: {
    flexBasis: '20%',
    flexGrow: 0,
    flexShrink: 0,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  tags: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  tagsColumn: { width: 180, paddingLeft: 20, overflow: 'hidden', flexWrap: 'nowrap' },
  tagAdd: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  rowTag: { borderRadius: 20, paddingVertical: 4, paddingHorizontal: space.sm },
  rowTagText: { fontSize: 11 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  control: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  controlWide: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  controlPressed: {
    backgroundColor: theme.colors.surface2,
  },
  duration: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
    minWidth: 34,
    textAlign: 'right',
  },
  durationWide: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 40,
    textAlign: 'right',
  },
}))
