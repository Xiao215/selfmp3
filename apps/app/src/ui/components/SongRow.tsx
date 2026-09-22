import { memo, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { formatDuration, type Song, type Tag } from '@selfmp3/shared'
import {
  HIT_TARGET,
  motion,
  oklchToHexAlpha,
  radius,
  space,
  tagColors,
  type,
} from '@selfmp3/client'
import { chipBudget, fitTags, rememberChipWidth, TAG_CHIP_MAX_WIDTH, useChipWidth } from './rowTags'
import { useSongPlayback } from '../../player/PlayerProvider'
import { useSongDragSource } from '../../ports/songDrag'
import { useContentWidth } from '../../shell/contentWidth'
import { useLayout } from '../../shell/useLayout'
import { tip } from '../tip'
import { useSongColor } from '../useSongColor'
import { Checkbox } from './Checkbox'
import { Cover } from './Cover'
import { Equalizer } from './Equalizer'
import { ease, timing, useFade } from '../motion'
import { MOVE_MS } from '../motion.model'
import { floating } from '../surfaces'
import { Downloaded, More, NotDownloaded, Play, Plus } from './Icons'

/**
 * Past this width of page the album leaves the second line for a column of its
 * own. It was 1160 of window, of which the sidebar takes 244; measured against
 * the page itself, it stays right when the practice panel narrows the page.
 */
const ALBUM_COLUMN_CONTENT_WIDTH = 916
/**
 * And past this much, a row has room for its tags as chips — well below the
 * album's column, because an iPad in portrait has 590 points of page and a
 * tag added to a song there never appeared on its row at all (Xiao,
 * 2026-09-21). `RowTags` fits what it can into the room and counts the rest.
 */
const TAG_CHIPS_CONTENT_WIDTH = 520
const SIDEBAR_WIDTH = 244

/**
 * One song in a list: one row everywhere (docs/ui-mock `S3`) — cover, title,
 * the artist with the on-device mark, the time, ⋯, and in Library, Search and
 * Up next the song's tags, two and a count. Loving a song, its tempo and its
 * energy are on the song's own page and in its menu, not on every row.
 *
 * Two shapes. At phone width, with a finger and no hover: a tap plays, the ⋯
 * is always there at a finger-sized target, and holding the row selects it
 * or opens the same menu. At desktop width it is a table row: the checkbox and
 * the position (or the equaliser, for the song that is loaded), the art, the
 * title over the artist, the album in a column of its own once there is room,
 * the tags, the length and ⋯.
 *
 * With a mouse, the controls that are actions rather than information — the
 * checkbox, the play button over the number, the tag button, the ⋯ — wait for
 * the pointer, so a screen of songs reads as titles and not as a grid of grey
 * icons. Only three things are ever ink: title, artist, length.
 *
 * Memoised because the list is long — the one place in this app where a render
 * too many actually matters. The memo only holds if nothing handed to a row is
 * new each render, so the handlers are given the row's song rather than being
 * closures over it (one function serves every row), and whether this is the
 * loaded song is asked of the player by the row itself (`useSongPlayback`)
 * rather than handed down, which would redraw every row on every song change.
 *
 * A playlist's rows are these rows. What a playlist adds — a grip to drag by,
 * the lifted look while a row is being moved, the line where it would land —
 * arrives as `leading`, `lifted` and `dropTarget`, so there is one song row in
 * the app and not one per page. Taking a song off a playlist is in its ⋯ menu,
 * where every other thing done to a song already is.
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
  leading,
  lifted = false,
  dropTarget = null,
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
  /**
   * The song's tags, drawn as chips: two and a count. Only Library, Search and
   * Up next pass them (`S3`); inside a tag, an artist or a playlist they are
   * left off.
   */
  tags?: readonly Tag[]
  /** A tag chip filters the library by that tag. */
  onToggleTag?: (tagId: number) => void
  /** The dashed + beside the chips. Handed the +, so the tag window can open over it. */
  onEditTags?: (anchor: View | null, song: Song) => void
  /**
   * Holding the row on a phone. Without it, holding opens the ⋯ menu; `null`
   * when something outside the row has the hold already — on a playlist you
   * made, holding a row lifts it to be moved.
   */
  onLongPress?: ((song: Song) => void) | null
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
  /**
   * Drawn at the very start of the row, before the checkbox: a playlist's grip.
   * Memoise it at the call site, or the row's memo stops holding.
   */
  leading?: ReactNode
  /** This row is the one being moved, so it rides above its neighbours. */
  lifted?: boolean
  /** A move would land here: a line in the accent on the row's top edge. */
  /** Which edge the drop line falls on while a row is dragged over this one. */
  dropTarget?: 'above' | 'below' | null
}): ReactNode {
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
  const press = (down: boolean): void => void timing(scale, down ? 0.985 : 1, motion.base)
  // Whether this row became the playing one while on screen (`M2`, 5): then
  // its wash comes in from the left and the equaliser wakes. A row that
  // scrolls into view already playing is simply drawn playing. Adjusted
  // during render, the way React asks for state that follows a prop.
  const [wasActive, setWasActive] = useState(active)
  const [woke, setWoke] = useState(false)
  if (active !== wasActive) {
    setWasActive(active)
    setWoke(active)
  }

  const tint = [
    // Selected: a translucent accent that reads as picked on the dark UI.
    selected && styles.selected,
    (song.missing || unavailable) && styles.missing,
    // Held and moving: off the page, over the rows it is passing.
    lifted && styles.lifted,
  ]
  const dropLine =
    dropTarget === null ? null : (
      <View
        style={[
          styles.dropLine,
          dropTarget === 'below' ? styles.dropLineBelow : styles.dropLineAbove,
        ]}
      />
    )

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
          {active ? <RowWash color={songColor.color} play={woke} /> : null}
          {dropLine}
          {leading}
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
              onLongPress === null
                ? undefined
                : onLongPress
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
              <Cover uri={artUri} title={song.album || song.title} size={48} />
              {active ? (
                <Waking play={woke} style={styles.playingOverlay}>
                  <Equalizer paused={!playing} size={12} color={songColor.tint} />
                </Waking>
              ) : null}
            </View>

            <View style={styles.text}>
              <Text style={[styles.title, active && { color: songColor.tint }]} numberOfLines={1}>
                {song.title}
              </Text>
              <View style={styles.subtitleRow}>
                {/* The web calls this "On this device", and draws exactly this. */}
                {downloaded ? (
                  <Downloaded size={13} tone="good" />
                ) : notDownloadedMark ? (
                  <NotDownloaded size={13} tone="textMuted" />
                ) : null}
                <Text style={styles.subtitle} numberOfLines={1}>
                  {song.artist || 'Unknown artist'} · {formatDuration(song.duration)}
                </Text>
              </View>
            </View>
          </Pressable>

          {/* Two and a count, where a list shows tags at all (`S3`): Library, Search, Up next. */}
          {tags && tags.length > 0 ? (
            <View style={styles.tagsPhone}>
              <RowTags
                tags={tags}
                hasAddButton={false}
                onToggleTag={onToggleTag}
                onShowAll={anchor => onEditTags?.(anchor, song)}
              />
            </View>
          ) : null}

          {onMore ? (
            <View ref={moreRef} collapsable={false}>
              <Pressable
                onPress={() => onMore?.(moreRef.current, song)}
                accessibilityRole="button"
                accessibilityLabel={`More actions for ${song.title}`}
                {...tip('More')}
                style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
              >
                <More size={16} tone="textMuted" />
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
  const page = contentWidth ?? width - SIDEBAR_WIDTH
  const albumColumn = page >= ALBUM_COLUMN_CONTENT_WIDTH
  const tagChips = page >= TAG_CHIPS_CONTENT_WIDTH
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
      {active ? <RowWash color={songColor.color} play={woke} /> : null}
      {dropLine}
      {leading}
      {onToggleSelect && (dense || selecting || selected) ? (
        // A finger gets no circle waiting in every row (docs/ui-mock `T09`): it
        // holds a row to start choosing, as on a phone, and the circles come
        // then. Nor does it get the lane one would sit in — a hidden circle
        // still takes its width, which on a touch screen is a gap down the
        // left of every row that nothing ever fills.
        <Reveal shown={selecting || selected || (dense && revealed)}>
          <SelectBox song={song} selected={selected} onToggle={() => onToggleSelect(song)} />
        </Reveal>
      ) : null}

      <View style={styles.index}>
        {active ? (
          <Waking play={woke}>
            <Equalizer paused={!playing} size={14} color={songColor.tint} />
          </Waking>
        ) : revealed && dense ? (
          <Pressable
            onPress={event => onPress(event, song)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${song.title}`}
            {...tip('Play')}
            style={styles.indexPlay}
          >
            <Play size={16} tone="textPrimary" />
          </Pressable>
        ) : (
          <Text style={styles.indexNumber}>{index === undefined ? '' : index + 1}</Text>
        )}
      </View>

      <Pressable
        onPress={event => onPress(event, song)}
        // The same three answers as the phone's row above, in the same order.
        // This branch used to ignore `onLongPress` altogether, so a row whose
        // hold belonged to something else — a playlist row being moved — still
        // opened its ⋯ menu 450ms in, and the menu's own backdrop then
        // swallowed every press after it (Xiao, 2026-09-21).
        onLongPress={
          onLongPress === null
            ? undefined
            : onLongPress
              ? () => onLongPress(song)
              : !dense && onToggleSelect
                ? () => onToggleSelect(song)
                : onMore
                  ? () => onMore(moreRef.current, song)
                  : undefined
        }
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
              <Downloaded size={13} tone="good" />
            ) : notDownloadedMark ? (
              <NotDownloaded size={13} tone="textMuted" />
            ) : null}
            <Text style={styles.artist} numberOfLines={1}>
              {song.artist || 'Unknown artist'}
            </Text>
            {/* With a finger the second line is the artist alone (`T03`). */}
            {song.album && !albumColumn && dense ? (
              <Text style={styles.albumInline} numberOfLines={1}>
                {' · '}
                {song.album}
              </Text>
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
        {/* Below the width for chips they go; the button stays. */}
        {tagChips && tags ? (
          <RowTags
            tags={tags}
            hasAddButton={onEditTags !== undefined}
            onToggleTag={onToggleTag}
            onShowAll={anchor => onEditTags?.(anchor, song)}
          />
        ) : null}
        {onEditTags ? (
          <Reveal shown={revealed}>
            <Pressable
              ref={tagAddRef}
              onPress={() => onEditTags(tagAddRef.current, song)}
              accessibilityRole="button"
              accessibilityLabel={`Edit tags for ${song.title}`}
              {...tip('Edit tags')}
              style={styles.tagAdd}
            >
              <Plus size={13} tone="textMuted" />
            </Pressable>
          </Reveal>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Text style={styles.durationWide}>{formatDuration(song.duration)}</Text>
        {onMore ? (
          <Reveal shown={revealed}>
            <View ref={moreRef} collapsable={false}>
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
                <More size={16} tone="textMuted" />
              </Pressable>
            </View>
          </Reveal>
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
 * 48-point cover. Desktop: 7 above and below, and the heart and ⋯ at 44 with a
 * finger or 34 with a mouse, beside a 40-point cover.
 */
const PHONE_ROW_HEIGHT = 5 * 2 + 3 * 2 + 48
const TOUCH_WIDE_ROW_HEIGHT = 7 * 2 + HIT_TARGET
const DENSE_ROW_HEIGHT = 7 * 2 + 40

/**
 * The row height for this layout, or null when it cannot be promised: text
 * enlarged in the system's settings can wrap past the cover, and a list told
 * the wrong number places every row in the wrong spot.
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

/**
 * A song's tags, as many as the slot holds, and a count for the rest.
 *
 * The slot is a fixed width, so what used to happen to a fourth tag — or to
 * one long name — was that it was cut in half against the album column. Chips
 * are laid in until the next will not fit and the remainder becomes a "+2"
 * that opens the tag window, where all of them are. See `rowTags.ts` for how
 * the fitting is worked out.
 */
function RowTags({
  tags,
  hasAddButton,
  onToggleTag,
  onShowAll,
}: {
  tags: readonly Tag[]
  hasAddButton: boolean
  onToggleTag?: (tagId: number) => void
  onShowAll: (anchor: View | null) => void
}): ReactNode {
  const widthOf = useChipWidth()
  const moreRef = useRef<View>(null)
  const { shown, hidden } = fitTags(tags, widthOf, chipBudget({ hasAddButton }))

  return (
    <>
      {shown.map(tag => (
        <RowTag key={tag.id} tag={tag} onPress={() => onToggleTag?.(tag.id)} />
      ))}
      {hidden > 0 ? (
        <View ref={moreRef} collapsable={false}>
          <Pressable
            onPress={() => onShowAll(moreRef.current)}
            accessibilityRole="button"
            accessibilityLabel={`${hidden} more ${hidden === 1 ? 'tag' : 'tags'}`}
            {...tip(
              tags
                .slice(shown.length)
                .map(tag => tag.name)
                .join(', '),
            )}
            style={[styles.rowTag, styles.rowTagMore]}
          >
            <Text style={[styles.rowTagText, styles.rowTagMoreText]}>+{hidden}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  )
}

/**
 * A small tag chip: a neutral pill with a dot of the tag's hue (`S2`).
 *
 * It reports the width it drew at, once: a name is the same width on every
 * row, so one measurement is what tells every other row whether this tag fits.
 */
function RowTag({ tag, onPress }: { tag: Tag; onPress: () => void }): ReactNode {
  const { dot } = tagColors(tag.hue)
  return (
    <Pressable
      onPress={onPress}
      onLayout={event => rememberChipWidth(tag.name, event.nativeEvent.layout.width)}
      accessibilityRole="button"
      accessibilityLabel={tag.name}
      style={styles.rowTag}
    >
      <View style={[styles.rowTagDot, { backgroundColor: dot }]} />
      <Text style={styles.rowTagText} numberOfLines={1}>
        {tag.name}
      </Text>
    </Pressable>
  )
}

/**
 * A row's controls with a mouse (`M3`, 3): they fade in over 100 ms as the
 * pointer arrives and out over 140 as it leaves. Only the desktop's rows draw
 * these, so a phone's list carries no animated value per row.
 */
function Reveal({ shown, children }: { shown: boolean; children: ReactNode }): ReactNode {
  const opacity = useFade(shown, MOVE_MS.hoverIn, MOVE_MS.hoverOut)
  return <Animated.View style={{ opacity }}>{children}</Animated.View>
}

/**
 * The equaliser over a row's cover, waking as the row starts playing: it
 * fades in just behind the wash (`M2`, 5). With `play` false it is simply there.
 */
function Waking({
  play,
  style,
  children,
}: {
  play: boolean
  style?: StyleProp<ViewStyle>
  children: ReactNode
}): ReactNode {
  const [shown] = useState(() => new Animated.Value(play ? 0 : 1))
  useEffect(() => {
    if (play)
      timing(shown, 1, MOVE_MS.wash, undefined, { easing: ease.out, delay: MOVE_MS.wash / 3 })
  }, [play, shown])
  return <Animated.View style={[style, { opacity: shown }]}>{children}</Animated.View>
}

/**
 * Now playing: a wash that comes in from the right, where the row is empty —
 * the cover already fills the left. It stays while the song is paused, so
 * the row still says "this is the one".
 *
 * As the row starts playing it washes in from the left edge, 260 ms, the way
 * the mini player's progress fills (`M2`, 5), so the two read as one thing.
 */
function RowWash({ color, play }: { color: string; play: boolean }): ReactNode {
  // Its own id per row. A screen the router keeps hidden behind this one (a
  // playlist listing the same song) holds a wash too; with one shared id, the
  // visible row's url() landed on the hidden, zero-size gradient and drew nothing.
  const id = `rowwash${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [grown] = useState(() => new Animated.Value(play ? 0 : 1))
  useEffect(() => {
    if (play) timing(grown, 1, MOVE_MS.wash, undefined, { easing: ease.out })
  }, [play, grown])
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.washFrom, { transform: [{ scaleX: grown }] }]}
    >
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
    </Animated.View>
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
    borderRadius: 14,
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
    borderRadius: 14,
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
    gap: 12,
    paddingVertical: 3,
  },
  mainWide: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  // The palette's own selected-row colour, so picking a row is recoloured by
  // the accent picker without re-rendering a list of them.
  selected: { backgroundColor: theme.colors.accentSelected },
  missing: {
    opacity: 0.55,
  },
  /* A row held and moving. The cell around it does the raising (`LiftedCell`);
     this is only what the row itself wears while it is off the page. */
  // The same shadow everything floating wears, from the palette: written out
  // here it was black at 0.45 whatever the theme, so in the light one a held
  // row cast a shadow the design system does not have.
  lifted: {
    backgroundColor: theme.colors.surface2,
    ...floating(theme.colors),
  },
  /* Where a held row would land, on the top edge of the row it is over. */
  dropLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.accent,
  },
  dropLineAbove: { top: 0 },
  dropLineBelow: { bottom: 0 },
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
    fontSize: type.row,
    fontWeight: '600',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 },
  titleWide: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
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
    color: theme.colors.textSecondary,
    fontSize: type.rowSub,
    flexShrink: 1,
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  /* The artist is what is scanned for, so it never shrinks; the album does. */
  artist: { flexShrink: 0, color: theme.colors.textSecondary, fontSize: type.small },
  albumInline: { flexShrink: 1, minWidth: 0, color: theme.colors.textMuted, fontSize: type.small },
  // The wash grows from the row's left edge.
  washFrom: { transformOrigin: 'left' },
  playingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.coverShade,
    borderRadius: radius.cover,
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
    borderRadius: radius.pill,
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
  tagsPhone: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0, maxWidth: 170 },
  tagsColumn: { width: 180, paddingLeft: 20, overflow: 'hidden', flexWrap: 'nowrap' },
  tagAdd: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  rowTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: space.sm,
    backgroundColor: theme.colors.surface2,
    // No one name may take the slot: past this it ends in an ellipsis.
    maxWidth: TAG_CHIP_MAX_WIDTH,
  },
  rowTagMore: { backgroundColor: theme.colors.surface2 },
  rowTagMoreText: { color: theme.colors.textSecondary },
  rowTagDot: { width: 6, height: 6, borderRadius: 3 },
  rowTagText: { fontSize: 11, color: theme.colors.textPrimary, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  control: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  controlWide: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
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
