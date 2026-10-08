import { memo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { plural, artistOr, formatDuration, type Song, type Tag } from '@selfmp3/shared'
import { HIT_TARGET, motion, radius, space, tagColors, type } from '@selfmp3/client'
import {
  chipBudget,
  CHIP_DOT,
  CHIP_FONT_SIZE,
  CHIP_PADDING_X,
  rememberChipWidth,
  TAG_ADD_WIDTH,
  TAG_CHIP_MAX_WIDTH,
  TAG_GAP,
  TAG_SLOT_PADDING_LEFT,
  TAG_SLOT_WIDTH,
  useFittedTags,
} from './rowTags'
import { useSongPlayback } from '../../player/PlayerProvider'
import { useSongDragSource } from '../../ports/songDrag'
import { useContentWidthValue } from '../../shell/contentWidth'
import { SIDEBAR_WIDTH } from '../../shell/Sidebar'
import { useLayoutValue, useWindowValue } from '../../shell/useLayout'
import { tip } from '../tip'
import { useSongColor } from '../useSongColor'
import { Checkbox } from './Checkbox'
import { Cover } from './Cover'
import { Equalizer } from './Equalizer'
import { useFade, usePresence, usePressScale } from '../motion'
import { EASE_OUT_CSS, MOVE_MS, PRESS } from '../motion.model'
import { useShownScheme } from '../theme/unistyles'
import { floating } from '../surfaces'
import { Downloaded, More, NotDownloaded, Play, Plus } from './Icons'
import { useSvgId } from '../useSvgId'

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

/**
 * One song in a list: one row everywhere (docs/ui-mock `S3`) — cover, title,
 * the artist with the on-device mark, the time, ⋯, and in Library, Search and
 * Up next the song's tags, two and a count. Loving a song, its tempo and its
 * energy are on the song's own page and in its menu, not on every row.
 *
 * Two shapes. At phone width, with a finger and no hover: a tap plays, the ⋯
 * is always there at a finger-sized target, and holding the row selects it —
 * or, in a list whose order is yours, picks it up to move it. At desktop width it is a table row: the checkbox and
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
 * A playlist's rows are these rows. What a playlist adds — the lifted look
 * while a row is being moved — arrives as `lifted`, so there is one song row
 * in the app and not one per page; the rows it passes make room for it
 * themselves. Taking a song off a playlist is in its ⋯ menu, where every
 * other thing done to a song already is.
 */
export const SongRow = memo(function SongRow({
  testID,
  song,
  artUri,
  active: activeOverride,
  downloaded,
  notDownloadedMark = false,
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
  lifted = false,
}: {
  /** Named so a flow can tap a row by position: `song-row-0`. */
  testID?: string
  song: Song
  artUri: string | null | undefined
  /** Draw as the loaded song. Left out, the row asks the player, which is what a list wants. */
  active?: boolean
  downloaded: boolean
  /**
   * Mark a song that is not on this device. An installed app says so, since
   * such a song may not play; a browser streams, and leaves it unmarked.
   */
  notDownloadedMark?: boolean
  /**
   * The press event comes through, so a list can read Shift and Cmd on the web.
   * So does the song, so one handler can serve every row.
   */
  onPress: (event: GestureResponderEvent, song: Song) => void
  /**
   * The ⋯, which opens the song's menu. Handed the ⋯ itself, so at desktop
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
   * Holding the row, at either width. One rule says what a hold means (Xiao
   * chose D1, 2026-10-08): in a list whose order you set it moves the row, and
   * the hold belongs to the list's mover, so this is left out; everywhere else
   * it selects, and this is the list's way in to selecting.
   */
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
  /** This row is the one being moved, so it rides above its neighbours. */
  lifted?: boolean
}): ReactNode {
  const playback = useSongPlayback(song.id)
  const active = activeOverride ?? playback !== null
  const playing = playback === 'playing'
  // The wash and the equaliser, arriving as this row becomes the playing one
  // and leaving as it stops (`M2`, 5): in from the right over 260 ms, back out
  // over a short fade, and drawn for as long as the leaving takes. A row that
  // scrolls into view already playing starts at rest, since a presence begins
  // where it is asked to be.
  const wash = usePresence(active, MOVE_MS.wash, motion.base)
  // The playing row wears its cover's colour, and keeps it while its wash
  // draws back: asked for nothing the moment it stopped, the leaving wash
  // turned the accent's blue. Every other row asks for nothing, and so does
  // not re-render when the accent changes.
  const songColor = useSongColor(song, artUri, active || wash.mounted)
  // Asked as answers, not as the width: a window being dragged is a new width
  // every pixel, and a new answer only when it crosses a line.
  const wide = useLayoutValue(isWide)
  const dense = useLayoutValue(isDense)
  const room = usePageRoom()
  const [hovered, setHovered] = useState(false)
  const moreRef = useRef<View>(null)
  const tagAddRef = useRef<View>(null)
  // With a mouse a row drags onto a playlist in the sidebar. Nothing on a phone.
  const rowRef = useRef<View>(null)
  // The held row gives a little under the finger or the mouse, on the one
  // spring (`M1`, 1): a row's depth, since a row is wide enough that a
  // control's would walk its ends. Both widths spring from the row's main
  // press target only, so the ⋯, a tag or the select circle press as
  // themselves. On a computer it sits outside hover, which is the row's
  // background, and outside selection, which is the same press read with its
  // modifier keys. A drag to the sidebar puts the row back to full size the
  // instant it starts (`press.rest`): the browser draws the drag image from
  // the row as it stands then, and a row held a moment before the pointer
  // moved would otherwise leave as a pressed-in copy of itself.
  const press = usePressScale(PRESS.row)
  useSongDragSource(rowRef, () => [song.id], wide && dense, press.rest)
  // What holding the row does, the same at both widths: what the list asked
  // for, or nothing. It no longer opens the ⋯ menu anywhere — the ⋯ does.
  const onHold = onLongPress ? () => onLongPress(song) : undefined

  // What the row is, as well as which song: picked, out of reach, being moved.
  const states = [
    // Selected: a translucent accent that reads as picked on the dark UI.
    selected && styles.selected,
    unavailable && styles.unavailable,
    // Held and moving: off the page, over the rows it is passing.
    lifted && styles.lifted,
  ]

  if (!wide) {
    return (
      <Animated.View style={press.style}>
        {/*
          The row is a container, and the thing you press is inside it. In a
          browser only this shape works: react-native-web renders a button as a
          real <button>, and a row that was one would nest the ⋯ inside it, so
          the row is a role="row" with its buttons as siblings.
        */}
        <View testID={testID} role="row" style={[styles.row, ...states]}>
          {wash.mounted ? <RowWash color={songColor.color} progress={wash.progress} /> : null}
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
            onLongPress={onHold}
            {...press.handlers}
            delayLongPress={MOVE_MS.longPress}
            accessibilityRole="button"
            accessibilityLabel={`${song.title}, ${artistOr(song.artist)}`}
            accessibilityState={{ selected: active }}
            // No pressed background: the row already gives under the finger, and a
            // filled box over the cover and title flashed white in the light theme.
            style={styles.main}
          >
            <View style={styles.art}>
              <Cover uri={artUri} title={song.album || song.title} size={48} />
              {wash.mounted ? (
                <Waking progress={wash.progress} style={styles.playingOverlay}>
                  <Equalizer paused={!playing} size={12} color={songColor.tint} />
                </Waking>
              ) : null}
            </View>

            <View style={styles.text}>
              <Text style={[styles.title, active && { color: songColor.tint }]} numberOfLines={1}>
                {song.title}
              </Text>
              <View style={styles.subtitleRow}>
                <HereMark downloaded={downloaded} notDownloadedMark={notDownloadedMark} />
                <Text style={styles.subtitle} numberOfLines={1}>
                  {artistOr(song.artist)} · {formatDuration(song.duration)}
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
            <MoreButton moreRef={moreRef} song={song} onMore={onMore} style={styles.control} />
          ) : null}
        </View>
      </Animated.View>
    )
  }

  // --- desktop width ---------------------------------------------------------

  // With a mouse these wait for the pointer; a tablet at this width shows them.
  const revealed = !dense || hovered || menuOpen
  const albumColumn = (room & ROOM_FOR_ALBUM) !== 0
  const tagChips = (room & ROOM_FOR_CHIPS) !== 0
  const controlSize = dense ? 34 : HIT_TARGET

  return (
    <Animated.View style={press.style}>
      <View
        ref={rowRef}
        testID={testID}
        role="row"
        style={[styles.rowWide, dense && (hovered || menuOpen) && styles.rowHovered, ...states]}
        onPointerEnter={dense ? () => setHovered(true) : undefined}
        onPointerLeave={dense ? () => setHovered(false) : undefined}
      >
        {wash.mounted ? <RowWash color={songColor.color} progress={wash.progress} /> : null}
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
          {wash.mounted ? (
            <Waking progress={wash.progress}>
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
          // The phone's answer. This branch used to ignore `onLongPress`
          // altogether, so a row whose hold belonged to something else — a
          // playlist row being moved — still opened its ⋯ menu 450ms in, and
          // the menu's own backdrop then swallowed every press after it (Xiao,
          // 2026-09-21).
          onLongPress={onHold}
          {...press.handlers}
          delayLongPress={MOVE_MS.longPress}
          accessibilityRole="button"
          accessibilityLabel={`${song.title}, ${artistOr(song.artist)}`}
          accessibilityState={{ selected: active }}
          style={styles.mainWide}
        >
          <Cover uri={artUri} title={song.album || song.title} size={40} />
          <View style={styles.text}>
            <Text style={[styles.titleWide, active && { color: songColor.tint }]} numberOfLines={1}>
              {song.title}
            </Text>
            <View style={styles.subtitleRow}>
              <HereMark downloaded={downloaded} notDownloadedMark={notDownloadedMark} />
              <Text style={styles.artist} numberOfLines={1}>
                {artistOr(song.artist)}
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
              <MoreButton
                moreRef={moreRef}
                song={song}
                onMore={onMore}
                style={[styles.controlWide, { width: controlSize, height: controlSize }]}
              />
            </Reveal>
          ) : null}
        </View>
      </View>
    </Animated.View>
  )
})

/*
 * How tall a row is, in each of its shapes. Every row of a shape is exactly
 * this tall — its tallest cell is a fixed-size control, and its text is one
 * line of each of two sizes that fit inside the cover beside it — so a list
 * can place rows by arithmetic (`SongList`'s `rowHeight`).
 *
 * Phone: 5 above and below the row, 3 above and below the press target, the
 * 48-point cover. Desktop: 7 above and below, and the ⋯ at 44 with a
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
  const wide = useLayoutValue(isWide)
  const dense = useLayoutValue(isDense)
  const enlarged = useWindowValue(window => window.fontScale > 1)
  if (enlarged) return null
  if (!wide) return PHONE_ROW_HEIGHT
  return dense ? DENSE_ROW_HEIGHT : TOUCH_WIDE_ROW_HEIGHT
}

const isWide = (layout: { wide: boolean }): boolean => layout.wide
const isDense = (layout: { dense: boolean }): boolean => layout.dense

/** The page has room for the album column. */
const ROOM_FOR_ALBUM = 1
/** The page has room for the tag chips. */
const ROOM_FOR_CHIPS = 2

function roomFor(page: number): number {
  return (
    (page >= ALBUM_COLUMN_CONTENT_WIDTH ? ROOM_FOR_ALBUM : 0) |
    (page >= TAG_CHIPS_CONTENT_WIDTH ? ROOM_FOR_CHIPS : 0)
  )
}

/**
 * Which of a desktop row's optional columns its page has room for, as one
 * number: the page column the shell works out, or the window less the sidebar
 * where nothing works it out (a row drawn alone). A number that changes when
 * a column comes or goes, so a row renders then and not on every pixel.
 */
function usePageRoom(): number {
  const fromPage = useContentWidthValue(width => (width === null ? -1 : roomFor(width)))
  const fromWindow = useLayoutValue(layout =>
    fromPage === -1 ? roomFor(layout.width - SIDEBAR_WIDTH) : 0,
  )
  return fromPage === -1 ? fromWindow : fromPage
}

/** Whether the song is on this device, beside its artist ("On this device"). */
function HereMark({
  downloaded,
  notDownloadedMark,
}: {
  downloaded: boolean
  notDownloadedMark: boolean
}): ReactNode {
  if (downloaded) return <Downloaded size={13} tone="good" />
  if (notDownloadedMark) return <NotDownloaded size={13} tone="textMuted" />
  return null
}

/** The ⋯, handing itself to `onMore` so a menu can open beside it. */
function MoreButton({
  moreRef,
  song,
  onMore,
  style,
}: {
  moreRef: RefObject<View | null>
  song: Song
  onMore: (anchor: View | null, song: Song) => void
  style: StyleProp<ViewStyle>
}): ReactNode {
  return (
    <View ref={moreRef} collapsable={false}>
      <Pressable
        onPress={() => onMore(moreRef.current, song)}
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${song.title}`}
        {...tip('More')}
        style={({ pressed }) => [style, pressed && styles.controlPressed]}
      >
        <More size={16} tone="textMuted" />
      </Pressable>
    </View>
  )
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
  const moreRef = useRef<View>(null)
  const { shown, hidden } = useFittedTags(tags, chipBudget({ hasAddButton }))
  // The dots are worked out here rather than read from a stylesheet, so they
  // follow the theme by asking for it: a row is memoised, and nothing else
  // re-renders it when light turns to dark.
  const scheme = useShownScheme()

  return (
    <>
      {shown.map(tag => (
        <RowTag
          key={tag.id}
          tag={tag}
          dot={tagColors(tag.hue, scheme).dot}
          onPress={() => onToggleTag?.(tag.id)}
        />
      ))}
      {hidden > 0 ? (
        <View ref={moreRef} collapsable={false}>
          <Pressable
            onPress={() => onShowAll(moreRef.current)}
            accessibilityRole="button"
            accessibilityLabel={plural(hidden, 'more tag', 'more tags')}
            {...tip(
              tags
                .slice(shown.length)
                .map(tag => tag.name)
                .join(', '),
            )}
            style={styles.rowTag}
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
function RowTag({
  tag,
  dot,
  onPress,
}: {
  tag: Tag
  /** The tag's hue as a dot, in the scheme on screen. */
  dot: string
  onPress: () => void
}): ReactNode {
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
 * fades in just behind the wash (`M2`, 5), over the last two thirds of the
 * wash's move, and goes with it.
 */
function Waking({
  progress,
  style,
  children,
}: {
  progress: Animated.Value
  style?: StyleProp<ViewStyle>
  children: ReactNode
}): ReactNode {
  const [opacity] = useState(() =>
    progress.interpolate({ inputRange: [0, 1 / 3, 1], outputRange: [0, 0, 1] }),
  )
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>
}

/**
 * Now playing: a wash that comes in from the right, where the row is empty —
 * the cover already fills the left. It stays while the song is paused, so
 * the row still says "this is the one".
 *
 * As the row starts playing it grows in from the right edge, 260 ms, and as
 * the song moves on it draws back to that edge, quicker, while the next
 * row's comes in. `progress` is the row's presence.
 *
 * From the right, where the gradient is strongest, rather than from the left:
 * grown from the left, the strong end rode the stretch and stopped at a hard
 * line partway across the row on every frame of the move. Anchored at the
 * right it never leaves the row's rounded edge, and the edge that moves is the
 * clear one (Xiao chose A, 2026-10-04).
 */
function RowWash({ color, progress }: { color: string; progress: Animated.Value }): ReactNode {
  // Its own id per row. A screen the router keeps hidden behind this one (a
  // playlist listing the same song) holds a wash too; with one shared id, the
  // visible row's url() landed on the hidden, zero-size gradient and drew nothing.
  const id = useSvgId('rowwash')
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.washFrom, { transform: [{ scaleX: progress }] }]}
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
    borderRadius: radius.row,
    overflow: 'hidden',
  },
  /* At desktop width: 7 by 10, 12 between cells. */
  rowWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginHorizontal: space.sm,
    borderRadius: radius.row,
    overflow: 'hidden',
    _web: {
      transitionProperty: 'background-color',
      transitionDuration: `${MOVE_MS.hoverOut}ms`,
      transitionTimingFunction: EASE_OUT_CSS,
    },
  },
  // With a mouse the row warms as the pointer arrives and cools as it leaves
  // (`M3`, 3), on the same two clocks as its controls: a browser can move a
  // colour itself, and there is no pointer anywhere else.
  rowHovered: {
    backgroundColor: theme.colors.surface1,
    _web: { transitionDuration: `${MOVE_MS.hoverIn}ms` },
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
  unavailable: {
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
  titleWide: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
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
  // The wash grows from the row's right edge, where it is strongest.
  washFrom: { transformOrigin: 'right' },
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
  /* The checkbox's column at phone width, there only while selecting. */
  select: {
    width: 34,
    height: HIT_TARGET,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* The checkbox's column at desktop width: 24 wide. */
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
  tags: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: TAG_GAP },
  tagsPhone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TAG_GAP,
    flexShrink: 0,
    maxWidth: 170,
  },
  tagsColumn: {
    width: TAG_SLOT_WIDTH,
    paddingLeft: TAG_SLOT_PADDING_LEFT,
    overflow: 'hidden',
    flexWrap: 'nowrap',
  },
  tagAdd: {
    width: TAG_ADD_WIDTH,
    height: TAG_ADD_WIDTH,
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
    gap: TAG_GAP,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: CHIP_PADDING_X,
    backgroundColor: theme.colors.surface2,
    // No one name may take the slot: past this it ends in an ellipsis.
    maxWidth: TAG_CHIP_MAX_WIDTH,
  },
  rowTagMoreText: { color: theme.colors.textSecondary },
  rowTagDot: { width: CHIP_DOT, height: CHIP_DOT, borderRadius: CHIP_DOT / 2 },
  rowTagText: { fontSize: CHIP_FONT_SIZE, color: theme.colors.textPrimary, flexShrink: 1 },
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
  durationWide: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 40,
    textAlign: 'right',
  },
}))
