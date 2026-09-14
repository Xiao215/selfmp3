import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PanResponder, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { LayoutChangeEvent } from 'react-native'
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router'
import { parseMode, parseTab } from '../features/nowPlaying/nowPlaying.model'
import { loopRegionPercent, radius, space, type, withAlpha } from '@selfmp3/client'
import { useToggleLoved } from '../api/queries'
import { DevicesSheet } from '../features/devices/DevicesSheet'
import { useArt } from '../offline/useArt'
import { usePlayer, usePlayerProgress } from '../player/PlayerProvider'
import { useSongColor } from '../ui/useSongColor'
import { Cover } from '../ui/components/Cover'
import { ProgressWash } from '../ui/components/ProgressWash'
import { tip, tipTarget } from '../ui/tip'
import { IconButton } from '../ui/components/IconButton'
import {
  ChevronDown,
  Devices,
  Heart,
  Metronome,
  Moon,
  Next,
  Pause,
  Play,
  Prev,
  Queue,
  Repeat,
  RepeatOne,
  Shuffle,
  Speed,
  TagPlus,
  Volume,
  VolumeMute,
} from '../ui/components/Icons'
import { Popover } from '../ui/components/Popover'
import { SleepMenu, useSleepMinutesLeft } from '../ui/components/SleepMenu'
import { SeekBar } from '../ui/components/SeekBar'
import { SheetItem } from '../ui/components/Sheet'
import { TagPicker } from '../ui/components/TagPicker'
import { leaveStage } from './stageExit'
import { useLayout } from './useLayout'
import { setPracticeOpen, usePracticeOpen } from './practicePanel'

/**
 * The transport across the foot of the desktop layout: the web's `.player-bar`.
 *
 * Three columns. The song on the left, with love and tags. The transport in
 * the middle: shuffle, previous, play, next, repeat, and the scrubber. On the
 * right, three groups with a hairline between them, because nine controls in a
 * row read as a wall of icons and they are three jobs: what is on screen, how
 * it plays, and where it comes out.
 *
 * The bar fills with the cover's colour up to where the song has got, fading
 * out at its leading edge, with a bright line along its top edge, as the web's
 * did.
 */
export const PLAYER_BAR_HEIGHT = 84

/** Below this the volume slider folds into a popover on the speaker. */
const COMPACT_WIDTH = 1160
/** Below this the song and the transport shrink, so the tools on the right still fit. */
const TIGHT_WIDTH = 900

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

const REPEAT_LABEL = {
  off: 'Repeat off',
  all: 'Repeat all',
  one: 'Repeat this song',
} as const

export function PlayerBar(): ReactNode {
  const practiceOpen = usePracticeOpen()
  const { theme } = useUnistyles()
  const player = usePlayer()
  const { position, duration } = usePlayerProgress()
  const artFor = useArt()
  const router = useRouter()
  const toggleLoved = useToggleLoved()
  const { width } = useLayout()
  const insets = useSafeAreaInsets()
  // An iPad at 834 points has less room than any desktop window the bar was
  // drawn for: the song and the transport give up width before the tools go.
  const tight = width < TIGHT_WIDTH
  const song = player.current
  const songColor = useSongColor(song, song ? artFor(song) : null)
  const tagsRef = useRef<View>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const devicesRef = useRef<View>(null)

  const percent =
    song && duration > 0 ? Math.min(100, (position / duration) * 100) : 0
  // Now Playing's tab and mode live in its address, so the bar can read and
  // change them the way the web's bar changes its page.
  const pathname = usePathname()
  const pageParams = useGlobalSearchParams<{ tab?: string; mode?: string }>()
  const onPage = pathname === '/now-playing'
  const pageMode = onPage ? parseMode(pageParams.mode) : null
  const pageTab = onPage ? parseTab(pageParams.tab) : null
  const queueOpen = pageMode === 'stage' && pageTab === 'queue'
  const closePage = (): void =>
    leaveStage(() => {
      if (router.canGoBack()) router.back()
      else router.replace('/')
    })
  const togglePage = (): void => (onPage ? closePage() : router.push('/now-playing'))
  /** With the page open, the queue is one of its tabs. */
  const openQueue = (): void => {
    if (onPage) router.setParams({ mode: 'stage', tab: queueOpen ? 'lyrics' : 'queue' })
    else router.push('/now-playing?tab=queue')
  }

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
      {song ? (
        <>
          <ProgressWash fraction={percent / 100} color={songColor.color} alpha={0.2} fade={40} />
          <View
            pointerEvents="none"
            style={[styles.playedLine, { width: `${percent}%`, backgroundColor: songColor.color }]}
          />
        </>
      ) : null}

      <View style={[styles.left, tight && styles.leftTight]}>
        {song ? (
          <>
            <Pressable
              style={styles.open}
              onPress={togglePage}
              accessibilityRole="button"
              accessibilityLabel={onPage ? 'Close now playing' : `Open now playing: ${song.title}`}
              {...tip(onPage ? 'Close' : 'Open the song: lyrics, up next, details')}
              accessibilityState={{ expanded: onPage }}
            >
              {/* The caption sits over the cover, not between it and the title. */}
              <View {...tipTarget()}>
                <Cover uri={artFor(song)} title={song.album || song.title} size={54} />
                {onPage ? (
                  <View style={styles.openChevron} pointerEvents="none">
                    <ChevronDown size={22} color="#fff" />
                  </View>
                ) : null}
              </View>
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={1}>
                  {song.title}
                </Text>
                <Text style={styles.artist} numberOfLines={1}>
                  {song.artist || 'Unknown artist'}
                </Text>
              </View>
            </Pressable>
            <IconButton
              onPress={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
              label={song.loved ? 'Unlike' : 'Like'}
              active={song.loved}
            >
              <Heart
                size={17}
                filled={song.loved}
                color={song.loved ? theme.colors.danger : theme.colors.textSecondary}
              />
            </IconButton>
            <View ref={tagsRef} collapsable={false}>
              <IconButton
                onPress={() => setTagsOpen(open => !open)}
                label={`Tags for ${song.title}`}
                caption="Edit tags"
                active={tagsOpen}
              >
                <TagPlus size={17} color={tagsOpen ? songColor.color : theme.colors.textSecondary} />
              </IconButton>
            </View>
          </>
        ) : (
          <Text style={styles.artist}>Nothing playing</Text>
        )}
      </View>

      <View style={[styles.centre, tight && styles.centreTight]}>
        <View style={styles.buttons}>
          <IconButton onPress={player.toggleShuffle} label="Shuffle" active={player.queue.shuffle}>
            <Shuffle
              size={17}
              color={player.queue.shuffle ? songColor.color : theme.colors.textSecondary}
            />
          </IconButton>
          <IconButton onPress={player.previous} label="Previous" disabled={!song}>
            <Prev size={20} color={theme.colors.textSecondary} />
          </IconButton>
          <Pressable
            onPress={player.toggle}
            disabled={!song}
            accessibilityRole="button"
            accessibilityLabel={player.isPlaying ? 'Pause' : 'Play'}
            {...tip(player.isPlaying ? 'Pause' : 'Play')}
            accessibilityState={{ disabled: !song, busy: player.stalled }}
            style={({ pressed }) => [
              styles.playButton,
              { backgroundColor: song ? theme.colors.textPrimary : theme.colors.surface3 },
              pressed && styles.playPressed,
            ]}
          >
            {player.isPlaying ? (
              <Pause size={20} color={theme.colors.surface0} />
            ) : (
              <Play size={20} color={song ? theme.colors.surface0 : theme.colors.textMuted} />
            )}
          </Pressable>
          <IconButton onPress={player.next} label="Next" disabled={!song}>
            <Next size={20} color={theme.colors.textSecondary} />
          </IconButton>
          <IconButton
            onPress={player.cycleRepeatMode}
            label={REPEAT_LABEL[player.queue.repeat]}
            active={player.queue.repeat !== 'off'}
          >
            {player.queue.repeat === 'one' ? (
              <RepeatOne size={17} color={songColor.color} />
            ) : (
              <Repeat
                size={17}
                color={player.queue.repeat === 'off' ? theme.colors.textSecondary : songColor.color}
              />
            )}
          </IconButton>
        </View>
        <View style={styles.progress}>
          <SeekBar
            loop={loopRegionPercent(player.loopA, player.loopB, duration)}
            inline
            position={position}
            duration={duration}
            onSeek={player.seekTo}
            color={songColor.color}
          />
        </View>
      </View>

      <View style={styles.right}>
        <View style={styles.group} role="group" aria-label="Panels">
          <IconButton onPress={openQueue} label="Queue" active={queueOpen}>
            <Queue size={17} color={queueOpen ? songColor.color : theme.colors.textSecondary} />
          </IconButton>
          <IconButton
            onPress={() => setPracticeOpen(!practiceOpen)}
            label="Practice tools"
            active={practiceOpen || player.loopB !== null}
          >
            <Metronome
              size={17}
              color={
                practiceOpen || player.loopB !== null ? songColor.color : theme.colors.textSecondary
              }
            />
          </IconButton>
        </View>
        <View style={[styles.group, styles.groupDivided]} role="group" aria-label="Playback">
          <SpeedButton />
          <SleepButton />
        </View>
        <View style={[styles.group, styles.groupDivided]} role="group" aria-label="Output">
          <View ref={devicesRef} collapsable={false}>
            <IconButton onPress={() => setDevicesOpen(true)} label="Devices">
              <Devices size={17} color={theme.colors.textSecondary} />
            </IconButton>
          </View>
          <VolumeControl compact={width < COMPACT_WIDTH} />
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

/** What a lit control is drawn in: the playing song's colour, as the seek bar is. */
function usePlayingColor(): string {
  return usePlayingTone().color
}

/** The playing song's colour, and the lighter tint of it that text is drawn in. */
function usePlayingTone(): { color: string; tint: string } {
  const player = usePlayer()
  const artFor = useArt()
  return useSongColor(player.current, player.current ? artFor(player.current) : null)
}

/**
 * A lit control that says its value — "1.25×", "24 min" — so a changed speed
 * or a running timer can be read off the bar without opening its menu. Shown
 * only while the setting differs from normal; otherwise the plain icon is.
 */
function ValuePill({
  Icon,
  value,
  label,
  caption,
  onPress,
}: {
  Icon: typeof Speed
  value: string
  label: string
  caption: string
  onPress: () => void
}): ReactNode {
  const tone = usePlayingTone()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...tip(caption)}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: withAlpha(tone.color, pressed ? 0.3 : 0.18) },
      ]}
    >
      <Icon size={14} color={tone.tint} />
      <Text style={[styles.pillText, { color: tone.tint }]}>{value}</Text>
    </Pressable>
  )
}

function SpeedButton(): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const toggle = (): void => setOpen(value => !value)
  return (
    <View ref={anchorRef} collapsable={false}>
      {player.rate !== 1 ? (
        <ValuePill
          Icon={Speed}
          value={`${player.rate}×`}
          label={`Playback speed: ${player.rate}×`}
          caption="Playback speed"
          onPress={toggle}
        />
      ) : (
        <IconButton onPress={toggle} label="Playback speed: 1×">
          <Speed size={17} color={theme.colors.textSecondary} />
        </IconButton>
      )}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement="above"
        title="Playback speed"
        titleTone="label"
        width={160}
        testID="speed-menu"
      >
        {SPEEDS.map(rate => (
          <SheetItem
            key={rate}
            label={`${rate}×${rate === 1 ? ' (normal)' : ''}`}
            active={player.rate === rate}
            onPress={() => {
              player.setRate(rate)
              setOpen(false)
            }}
          />
        ))}
      </Popover>
    </View>
  )
}

function SleepButton(): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const left = useSleepMinutesLeft(player.sleepTimerEndsAt)
  const toggle = (): void => setOpen(value => !value)

  return (
    <View ref={anchorRef} collapsable={false}>
      {left ? (
        <ValuePill
          Icon={Moon}
          value={left}
          label={`Sleep timer: ${left} left`}
          caption="Sleep timer"
          onPress={toggle}
        />
      ) : (
        <IconButton onPress={toggle} label="Sleep timer">
          <Moon size={17} color={theme.colors.textSecondary} />
        </IconButton>
      )}
      <SleepMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} />
    </View>
  )
}

function VolumeControl({ compact }: { compact: boolean }): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const lit = usePlayingColor()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const muted = player.muted || player.volume === 0
  const percent = Math.round(player.volume * 100)
  const Icon = muted ? VolumeMute : Volume

  const mute = (
    <IconButton
      onPress={player.toggleMute}
      label={player.muted ? 'Unmute' : 'Mute'}
      active={player.muted}
    >
      <Icon size={17} color={theme.colors.textSecondary} />
    </IconButton>
  )
  const slider = <VolumeSlider value={player.volume} onChange={player.setVolume} />

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
        active={player.muted}
      >
        <Icon size={17} color={player.muted ? lit : theme.colors.textSecondary} />
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
          <VolumeSlider value={player.volume} onChange={player.setVolume} vertical />
          {mute}
        </View>
      </Popover>
    </View>
  )
}

/**
 * The web's `input.volume`: a thin track that fills with the playing song's
 * colour. Flat beside the speaker when the bar has room; upright in the volume
 * pop-up, a fader that fills from the bottom with a handle on top.
 */
function VolumeSlider({
  value,
  onChange,
  vertical = false,
}: {
  value: number
  onChange: (value: number) => void
  vertical?: boolean
}): ReactNode {
  const player = usePlayer()
  const artFor = useArt()
  const songColor = useSongColor(player.current, player.current ? artFor(player.current) : null)
  // The track's length along the way it slides: its width, or its height upright.
  const [length, setLength] = useState(0)
  const responder = useMemo(() => {
    // The track and its fill take no touches, so the position is always the
    // slider's own (see SeekBar).
    const valueAt = (x: number, y: number): number => {
      if (length <= 0) return value
      return Math.max(0, Math.min(1, vertical ? 1 - y / length : x / length))
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event =>
        onChange(valueAt(event.nativeEvent.locationX, event.nativeEvent.locationY)),
      onPanResponderMove: event =>
        onChange(valueAt(event.nativeEvent.locationX, event.nativeEvent.locationY)),
    })
  }, [length, value, onChange, vertical])

  return (
    <View
      style={vertical ? styles.sliderUpright : styles.slider}
      onLayout={(event: LayoutChangeEvent) =>
        setLength(vertical ? event.nativeEvent.layout.height : event.nativeEvent.layout.width)
      }
      accessibilityRole="adjustable"
      accessibilityLabel="Volume"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      {...tip(vertical ? undefined : `Volume: ${Math.round(value * 100)}%`)}
      {...responder.panHandlers}
    >
      {vertical ? (
        <View pointerEvents="none" style={styles.sliderTrackUpright}>
          <View
            style={[
              styles.sliderFillUpright,
              { height: `${value * 100}%`, backgroundColor: songColor.color },
            ]}
          />
          <View
            style={[
              styles.sliderHandle,
              { bottom: Math.max(-HANDLE / 2, value * length - HANDLE / 2) },
            ]}
          />
        </View>
      ) : (
        <View pointerEvents="none" style={styles.sliderTrack}>
          <View
            style={[
              styles.sliderFill,
              { width: `${value * 100}%`, backgroundColor: songColor.color },
            ]}
          />
        </View>
      )}
    </View>
  )
}

/** The upright fader's handle. */
const HANDLE = 14

const styles = StyleSheet.create(theme => ({
  /* Open, the cover says the same button now closes the page. */
  openChevron: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  bar: {
    height: PLAYER_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: 18,
    backgroundColor: theme.colors.surface1,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    overflow: 'hidden',
  },
  playedLine: { position: 'absolute', left: 0, top: -1, height: 2 },
  left: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  open: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 1, minWidth: 0 },
  meta: { flexShrink: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  artist: { color: theme.colors.textMuted, fontSize: type.small },
  /* A lit control with its value in it: 1.25×, 24 min. */
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 9,
    marginHorizontal: 2,
    borderRadius: 14,
  },
  pillText: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  centre: {
    flexGrow: 1.9,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 300,
    alignItems: 'center',
    gap: 2,
  },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  playPressed: { transform: [{ scale: 0.96 }] },
  progress: { alignSelf: 'stretch' },
  centreTight: { minWidth: 250 },
  leftTight: { minWidth: 150 },
  right: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  group: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  groupDivided: { paddingLeft: space.sm, borderLeftWidth: 1, borderLeftColor: theme.colors.border },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  volumePopover: { alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 2 },
  readout: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  slider: { width: 88, height: 24, justifyContent: 'center', cursor: 'pointer' },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: 'hidden',
  },
  sliderFill: { height: 4, borderRadius: radius.sm },
  /* Wider than the track, so the handle is easy to catch. */
  sliderUpright: { width: 32, height: 128, alignItems: 'center', cursor: 'pointer' },
  sliderTrackUpright: {
    width: 6,
    height: '100%',
    borderRadius: 3,
    backgroundColor: theme.colors.surface3,
    justifyContent: 'flex-end',
  },
  sliderFillUpright: { width: 6, borderRadius: 3 },
  sliderHandle: {
    position: 'absolute',
    left: 3 - HANDLE / 2,
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: theme.colors.textPrimary,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
  },
}))
