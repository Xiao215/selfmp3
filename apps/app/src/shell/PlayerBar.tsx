import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { artistOr } from '@selfmp3/shared'
import { warmCoverPalette } from '../features/nowPlaying/useCoverPalette'
import { isRoomTrackId, iconSize } from '@selfmp3/client'
import { radius, space, type, type SongColors } from '@selfmp3/client'
import { DevicesSheet } from '../features/devices/DevicesSheet'
import { TogetherButton } from '../features/room/Together'
import { UpNextTarget } from '../ui/components/CoverFlight'
import { toggleQueueSheet, useQueueSheetOpen } from '../features/queue/queueSheet.store'
import { useArt } from '../offline/useArt'
import { usePlayer, usePlayerCommands, usePlayerVolume } from '../player/PlayerProvider'
import { VOLUME_STEP } from '../player/progress.model'
import { useSongColor } from '../ui/useSongColor'
import { Cover } from '../ui/components/Cover'
import { ProgressWash } from '../ui/components/ProgressWash'
import { tip, tipTarget } from '../ui/tip'
import { IconButton } from '../ui/components/IconButton'
import {
  ChevronDown,
  Devices,
  Moon,
  More,
  TagPlus,
  UpNext,
  Volume,
  VolumeMute,
} from '../ui/components/Icons'
import { Popover } from '../ui/components/Popover'
import { SleepItem, SleepMenu, useSleepTimerStatus } from '../ui/components/SleepMenu'
import { SheetItem } from '../ui/components/Sheet'
import { Scrubber } from '../ui/components/Scrubber'
import { SeekBar } from '../ui/components/SeekBar'
import { TagPicker } from '../ui/components/TagPicker'
import { leaveStage } from './stageExit'
import { useOpenNowPlaying } from '../ui/useOpenNowPlaying'
import { Press } from '../ui/components/Press'
import { useLayoutValue } from './useLayout'
import { floating, rowTitle } from '../ui/surfaces'
import { LikeButton } from '../ui/components/LikeButton'
import { TransportControls } from '../ui/components/TransportControls'
import { goBack } from '../ui/useBackTo'
import { WINDOW_WIDTH } from './widths'

/**
 * The transport across the foot of the desktop layout.
 *
 * Three columns. The song on the left, with love and tags. The transport in
 * the middle: shuffle, previous, play, next, repeat, and the scrubber. On the
 * right, volume; then Up next, Listen together and a ⋯ "This player" that
 * holds the sleep timer and Play on… (B1, Xiao 2026-10-25: Listen together
 * keeps its own button, being too hard to find otherwise). A running timer
 * shows as a dot on the ⋯. Up next toggles the rail (`QueueRail`) and is lit
 * while it is open.
 *
 * The bar fills with the cover's colour up to where the song has got, fading
 * out at its leading edge, with a bright line along its top edge.
 */
export const PLAYER_BAR_HEIGHT = 84

export function PlayerBar(): ReactNode {
  const { theme } = useUnistyles()
  // Not the position: that is the wash's and the scrubber's own, so a tick
  // redraws those two and not the rest of the bar.
  const player = usePlayer()
  const artFor = useArt()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  // An iPad at 834 points has less room than any desktop window the bar was
  // drawn for: the song and the transport give up width before the tools go.
  // Asked as answers, so a window being dragged redraws the bar only as it
  // crosses one of these lines.
  const tight = useLayoutValue(layout => layout.width < WINDOW_WIDTH.barTight)
  const compact = useLayoutValue(layout => layout.width < WINDOW_WIDTH.barCompact)
  const song = player.current
  // Asked once here and handed to every control that draws in it, rather than
  // each asking the player and the covers again for the same colour.
  const art = song ? artFor(song) : null
  const songColor = useSongColor(song, art)
  // Now Playing glows with the cover's colours; read them as the song starts,
  // so the page opens in its own light rather than in a stand-in for a frame.
  useEffect(() => {
    if (song) void warmCoverPalette(song, art)
  }, [song, art])
  const tagsRef = useRef<View>(null)
  const [tagsOpen, setTagsOpen] = useState(false)

  const pathname = usePathname()
  const onPage = pathname === '/now-playing'
  const closePage = (): void => leaveStage(() => goBack(router, '/'))
  const { coverRef, open: openPage } = useOpenNowPlaying()
  const togglePage = (): void => (onPage ? closePage() : openPage())
  // Up next is the rail beside whatever page is open, Now Playing included
  // (docs/ui-mock `C11`), so the button toggles the rail and goes nowhere.
  const queueOpen = useQueueSheetOpen()
  // The tools' own width, the least their column may be: it grows like the
  // song's, so the transport sits in the middle of the window, not of what the
  // tools leave.
  const [toolsWidth, setToolsWidth] = useState(0)
  // The song's floor, which the tools' column also keeps, so the two sides
  // stay one width: under the compact width the volume folds and the tools
  // need little, and a song held to 300 beside them pushed Play right of
  // centre (+41 at 1000).
  const songFloor = compact ? SONG_FLOOR_COMPACT : SONG_FLOOR

  return (
    <View
      style={[
        styles.bar,
        insets.bottom > 0 && {
          height: PLAYER_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
        },
      ]}
      testID="player-bar"
    >
      {song ? <ProgressWash color={songColor.color} fade={40} line="top" /> : null}

      <View style={[styles.left, { minWidth: songFloor }]}>
        {song ? (
          <>
            <Press
              feedback="dim"
              style={styles.open}
              onPress={togglePage}
              accessibilityRole="button"
              accessibilityLabel={onPage ? 'Close now playing' : `Open now playing: ${song.title}`}
              {...tip(onPage ? 'Close' : 'Open the song: lyrics, Up next, details')}
              accessibilityState={{ expanded: onPage }}
            >
              {/* The caption sits over the cover, not between it and the title. */}
              <View {...tipTarget()} ref={coverRef} collapsable={false}>
                <Cover uri={art} title={song.album || song.title} size={54} />
                {onPage ? (
                  <View style={styles.openChevron} pointerEvents="none">
                    <ChevronDown size={iconSize.large} tone="onArt" />
                  </View>
                ) : null}
              </View>
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={1}>
                  {song.title}
                </Text>
                <Text style={styles.artist} numberOfLines={1}>
                  {artistOr(song.artist)}
                </Text>
              </View>
            </Press>
            {/* Under the tight width the song's name needs the room more: Like and
                Tags are on Now Playing and in the song menu as well. A friend's
                song in a room is not in your library to like or tag. */}
            {tight || isRoomTrackId(song.id) ? null : (
              <>
                <LikeButton song={song} />
                <View ref={tagsRef} collapsable={false}>
                  <IconButton
                    onPress={() => setTagsOpen(open => !open)}
                    label={`Tags for ${song.title}`}
                    caption="Edit tags"
                    active={tagsOpen}
                  >
                    <TagPlus
                      size={iconSize.medium}
                      color={tagsOpen ? songColor.color : theme.colors.textSecondary}
                    />
                  </IconButton>
                </View>
              </>
            )}
          </>
        ) : (
          <Text style={styles.artist}>Nothing playing</Text>
        )}
      </View>

      <View style={[styles.centre, tight && styles.centreTight]}>
        <TransportControls size="bar" tint={songColor.color} />
        <View style={styles.progress}>
          <SeekBar inline color={songColor.color} />
        </View>
      </View>

      <View style={[styles.right, { minWidth: Math.max(toolsWidth, songFloor) }]}>
        <View
          style={styles.tools}
          onLayout={event => setToolsWidth(Math.ceil(event.nativeEvent.layout.width))}
        >
          <View style={styles.group} role="group" aria-label="Volume">
            <VolumeControl compact={compact} tone={songColor} />
          </View>
          <View style={[styles.group, styles.groupDivided]} role="group" aria-label="Panels">
            <UpNextTarget>
              <IconButton
                testID="player-bar-queue"
                onPress={toggleQueueSheet}
                label="Up next"
                active={queueOpen}
              >
                <UpNext
                  size={iconSize.medium}
                  color={queueOpen ? songColor.color : theme.colors.textSecondary}
                />
              </IconButton>
            </UpNextTarget>
            {/* Listen together, or the room's faces while you are in one. */}
            <TogetherButton iconSize={iconSize.medium} color={theme.colors.textSecondary} />
            <ThisPlayer tone={songColor} />
          </View>
        </View>
      </View>

      {/* A small window over its button, not a sheet across the window. */}
      <TagPicker
        song={tagsOpen ? song : null}
        onClose={() => setTagsOpen(false)}
        anchorRef={tagsRef}
      />
    </View>
  )
}

/**
 * The ⋯ at the end of the bar: what this player does beside playing — the
 * sleep timer, and which device the music comes out of. The phone's Now
 * Playing has the same "This player" group at the foot of its menu. While a
 * timer runs a dot in the song's colour sits on the ⋯, so "is a timer
 * running?" still reads from the bar; the menu's row says how long is left.
 */
function ThisPlayer({ tone }: { tone: SongColors }): ReactNode {
  const { theme } = useUnistyles()
  const anchorRef = useRef<View>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sleepOpen, setSleepOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const { line } = useSleepTimerStatus()
  const then = (open: () => void) => (): void => {
    setMenuOpen(false)
    open()
  }
  return (
    <View ref={anchorRef} collapsable={false}>
      <IconButton
        testID="player-bar-more"
        onPress={() => setMenuOpen(open => !open)}
        label={line ? `This player. Sleep timer: ${line}` : 'This player'}
        caption="This player"
        active={menuOpen}
      >
        <More size={iconSize.medium} color={theme.colors.textSecondary} />
      </IconButton>
      {line ? (
        <View style={[styles.timerDot, { backgroundColor: tone.color }]} pointerEvents="none" />
      ) : null}
      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={anchorRef}
        placement="above"
        title="This player"
        panelTitle="This player"
        width={220}
        testID="player-bar-menu"
      >
        <SleepItem
          icon={<Moon size={iconSize.item} tone="textSecondary" />}
          onPress={then(() => setSleepOpen(true))}
        />
        <SheetItem
          icon={<Devices tone="textSecondary" />}
          label="Play on…"
          onPress={then(() => setDevicesOpen(true))}
        />
      </Popover>
      <SleepMenu open={sleepOpen} onClose={() => setSleepOpen(false)} anchorRef={anchorRef} />
      <DevicesSheet
        open={devicesOpen}
        onClose={() => setDevicesOpen(false)}
        anchorRef={anchorRef}
      />
    </View>
  )
}

function VolumeControl({ compact, tone }: { compact: boolean; tone: SongColors }): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayerCommands()
  const level = usePlayerVolume()
  const lit = tone.color
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const muted = level.muted || level.volume === 0
  const percent = Math.round(level.volume * 100)
  const Icon = muted ? VolumeMute : Volume

  const mute = (
    <IconButton
      onPress={player.toggleMute}
      label={level.muted ? 'Unmute' : 'Mute'}
      active={level.muted}
    >
      <Icon size={iconSize.medium} color={theme.colors.textSecondary} />
    </IconButton>
  )
  const slider = <VolumeSlider value={level.volume} onChange={player.setVolume} color={lit} />

  if (!compact) {
    return (
      <View style={styles.volume}>
        {mute}
        {slider}
      </View>
    )
  }

  return (
    <View ref={anchorRef} collapsable={false}>
      <IconButton
        onPress={() => setOpen(value => !value)}
        label={`Volume: ${percent}%`}
        active={level.muted}
      >
        <Icon size={iconSize.medium} color={level.muted ? lit : theme.colors.textSecondary} />
      </IconButton>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement="above"
        title="Volume"
        titleTone="label"
        width={60}
        testID="volume-popover"
      >
        {/* A fader rising out of its button: the level on top, mute at its foot. */}
        <View style={styles.volumePopover}>
          <Text style={styles.readout}>{percent}%</Text>
          <VolumeSlider value={level.volume} onChange={player.setVolume} color={lit} vertical />
          {mute}
        </View>
      </Popover>
    </View>
  )
}

/**
 * A thin track that fills with the playing song's colour. Flat beside the
 * speaker when the bar has room; upright in the volume pop-up, a fader that
 * fills from the bottom with a handle on top. It follows the finger: each step
 * of a drag sets the level.
 */
function VolumeSlider({
  value,
  onChange,
  color,
  vertical = false,
}: {
  value: number
  onChange: (value: number) => void
  /** What the track fills with: the playing song's colour. */
  color: string
  vertical?: boolean
}): ReactNode {
  return (
    <Scrubber
      value={value}
      max={1}
      onChange={onChange}
      onCommit={onChange}
      label="Volume"
      step={VOLUME_STEP}
      spokenScale={100}
      valueText={at => `${Math.round(at * 100)}%`}
      vertical={vertical}
      size={vertical ? 'large' : 'small'}
      thumb={vertical}
      color={color}
      caption={vertical ? undefined : `Volume: ${Math.round(value * 100)}%`}
      style={vertical ? styles.sliderUpright : styles.slider}
    />
  )
}

/** The song's room (docs/ui-mock `T09`): 300 in full, 220 once the volume has folded away. */
const SONG_FLOOR = 300
const SONG_FLOOR_COMPACT = 220

const styles = StyleSheet.create(theme => ({
  /*
   * Open, the cover says the same button now closes the page: `onArt` on the
   * cover's shade in either theme, since what it sits on is the picture.
   */
  openChevron: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.cover,
    backgroundColor: theme.colors.coverShade,
  },
  bar: {
    height: PLAYER_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: 18,
    // A card's tone with no line along its top; it floats over the page, so it
    // casts the floating shadow (`S2`, "Depth").
    backgroundColor: theme.colors.surface1,
    overflow: 'hidden',
    ...floating(theme.colors),
  },
  left: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  open: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 1, minWidth: 0 },
  meta: { flexShrink: 1, minWidth: 0 },
  title: rowTitle(theme.colors),
  // The mini player's ink: muted, the artist all but went on a song-coloured wash.
  artist: { color: theme.colors.textSecondary, fontSize: type.small },
  // A sleep timer is running: a dot on the ⋯'s shoulder, in the song's colour.
  timerDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  centre: {
    flexGrow: 1.9,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 300,
    alignItems: 'center',
    gap: 2,
  },
  progress: { alignSelf: 'stretch' },
  centreTight: { minWidth: 250 },
  // Grows as the song's column does, so the two stay one width and the
  // transport between them is in the middle of the bar.
  right: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  tools: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
  },
  group: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // The groups are set apart by room, not a rule.
  groupDivided: { paddingLeft: space.md },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  volumePopover: {
    alignItems: 'center',
    gap: space.snug,
    paddingTop: space.snug,
    paddingBottom: 2,
  },
  readout: {
    color: theme.colors.textSecondary,
    fontSize: type.tiny,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  slider: { width: 88, height: 24, paddingVertical: 0 },
  /* Wider than the track, so the handle is easy to catch. */
  sliderUpright: { width: 32, height: 128 },
}))
