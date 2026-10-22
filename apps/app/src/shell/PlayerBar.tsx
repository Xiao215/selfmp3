import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { artistOr } from '@selfmp3/shared'
import { warmCoverPalette } from '../features/nowPlaying/useCoverPalette'
import { isRoomTrackId, iconSize } from '@selfmp3/client'
import { radius, space, type, withAlpha, type SongColors } from '@selfmp3/client'
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
  TagPlus,
  UpNext,
  Volume,
  VolumeMute,
} from '../ui/components/Icons'
import { Popover } from '../ui/components/Popover'
import { SleepMenu, useSleepTimerStatus } from '../ui/components/SleepMenu'
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
 * right — sleep, volume, Up next, devices — three groups with room between
 * them, because a row of controls reads as a wall of icons and they are three
 * jobs: when it stops, how loud, and what is beside the page and where it
 * comes out. Up next toggles the rail (`QueueRail`) and is lit while it is
 * open.
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
  const [devicesOpen, setDevicesOpen] = useState(false)
  const devicesRef = useRef<View>(null)

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

      <View style={[styles.left, tight && styles.leftTight]}>
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

      <View style={[styles.right, { minWidth: toolsWidth }]}>
        <View
          style={styles.tools}
          onLayout={event => setToolsWidth(Math.ceil(event.nativeEvent.layout.width))}
        >
          <View style={styles.group} role="group" aria-label="Sleep">
            <SleepButton tone={songColor} />
          </View>
          <View style={[styles.group, styles.groupDivided]} role="group" aria-label="Volume">
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
            <View ref={devicesRef} collapsable={false}>
              <IconButton onPress={() => setDevicesOpen(true)} label="Devices">
                <Devices size={iconSize.medium} color={theme.colors.textSecondary} />
              </IconButton>
            </View>
            {/* Listen together, or the room's faces while you are in one. */}
            <TogetherButton iconSize={iconSize.medium} color={theme.colors.textSecondary} />
          </View>
        </View>
      </View>

      {/* A small window over its button, not a sheet across the window. */}
      <TagPicker
        song={tagsOpen ? song : null}
        onClose={() => setTagsOpen(false)}
        anchorRef={tagsRef}
      />
      <DevicesSheet
        open={devicesOpen}
        onClose={() => setDevicesOpen(false)}
        anchorRef={devicesRef}
      />
    </View>
  )
}

/**
 * A lit control that says its value — "24 min", "End of song" — so a running
 * timer can be read off the bar without opening anything. Shown only while
 * the setting differs from normal; otherwise the plain icon is.
 */
function ValuePill({
  tone,
  Icon,
  value,
  label,
  caption,
  onPress,
}: {
  /** The playing song's colour, and the lighter tint of it that text is drawn in. */
  tone: SongColors
  Icon: typeof Moon
  value: string
  label: string
  caption: string
  onPress: () => void
}): ReactNode {
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...tip(caption)}
      style={[styles.pill, { backgroundColor: withAlpha(tone.color, 0.18) }]}
    >
      <Icon size={iconSize.field} color={tone.tint} />
      <Text style={[styles.pillText, { color: tone.tint }]}>{value}</Text>
    </Press>
  )
}

function SleepButton({ tone }: { tone: SongColors }): ReactNode {
  const { theme } = useUnistyles()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const { left, line } = useSleepTimerStatus()
  const toggle = (): void => setOpen(value => !value)

  return (
    <View ref={anchorRef} collapsable={false}>
      {left ? (
        <ValuePill
          tone={tone}
          Icon={Moon}
          value={left}
          label={`Sleep timer: ${line}`}
          caption="Sleep timer"
          onPress={toggle}
        />
      ) : (
        <IconButton onPress={toggle} label="Sleep timer">
          <Moon size={iconSize.medium} color={theme.colors.textSecondary} />
        </IconButton>
      )}
      <SleepMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} />
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
      vertical={vertical}
      size={vertical ? 'large' : 'small'}
      thumb={vertical}
      color={color}
      caption={vertical ? undefined : `Volume: ${Math.round(value * 100)}%`}
      style={vertical ? styles.sliderUpright : styles.slider}
    />
  )
}

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
    // The song's room (docs/ui-mock `T09`): 300 in full, 220 under the tight width.
    minWidth: 300,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  open: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 1, minWidth: 0 },
  meta: { flexShrink: 1, minWidth: 0 },
  title: rowTitle(theme.colors),
  // The mini player's ink: muted, the artist all but went on a song-coloured wash.
  artist: { color: theme.colors.textSecondary, fontSize: type.small },
  /* A lit control with its value in it: 24 min. */
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 9,
    marginHorizontal: 2,
    borderRadius: radius.pill,
  },
  pillText: { fontSize: type.small, fontWeight: '600', fontVariant: ['tabular-nums'] },
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
  leftTight: { minWidth: 220 },
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
