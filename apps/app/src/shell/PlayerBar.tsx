import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PanResponder, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { LayoutChangeEvent } from 'react-native'
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router'
import { parseMode, parseTab } from '../features/nowPlaying/nowPlaying.model'
import { loopRegionPercent, radius, space, type } from '@selfmp3/client'
import { useToggleLoved } from '../api/queries'
import { DevicesSheet } from '../features/devices/DevicesSheet'
import { useArt } from '../offline/useArt'
import { usePlayer } from '../player/PlayerProvider'
import { useAccent } from '../ui/accent'
import { useSongColor } from '../ui/useSongColor'
import { Cover } from '../ui/components/Cover'
import { ProgressWash } from '../ui/components/ProgressWash'
import { IconButton } from '../ui/components/IconButton'
import {
  ChevronDown,
  Devices,
  Heart,
  Metronome,
  Mic,
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
import { SleepMenu } from '../ui/components/SleepMenu'
import { SeekBar } from '../ui/components/SeekBar'
import { SheetItem } from '../ui/components/Sheet'
import { TagPicker } from '../ui/components/TagPicker'
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
  const accent = useAccent()
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
  const [tagsOpen, setTagsOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const devicesRef = useRef<View>(null)

  const percent =
    song && player.duration > 0 ? Math.min(100, (player.position / player.duration) * 100) : 0
  // Now Playing's tab and mode live in its address, so the bar can read and
  // change them the way the web's bar changes its page.
  const pathname = usePathname()
  const pageParams = useGlobalSearchParams<{ tab?: string; mode?: string }>()
  const onPage = pathname === '/now-playing'
  const pageMode = onPage ? parseMode(pageParams.mode) : null
  const pageTab = onPage ? parseTab(pageParams.tab) : null
  const queueOpen = pageMode === 'stage' && pageTab === 'queue'
  const closePage = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }
  const togglePage = (): void => (onPage ? closePage() : router.push('/now-playing'))
  /** The mic: straight to the words, and the same again to put them away. */
  const toggleLyrics = (): void => {
    if (pageMode === 'focus') closePage()
    else if (onPage) router.setParams({ mode: 'focus', tab: 'lyrics' })
    else router.push('/now-playing?mode=focus')
  }
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
              accessibilityState={{ expanded: onPage }}
            >
              <View>
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
              label={song.loved ? 'Unlove' : 'Love'}
              active={song.loved}
            >
              <Heart
                size={17}
                filled={song.loved}
                color={song.loved ? theme.colors.danger : theme.colors.textSecondary}
              />
            </IconButton>
            <View>
              <IconButton
                onPress={() => setTagsOpen(true)}
                label={`Tags for ${song.title}`}
                active={tagsOpen}
              >
                <TagPlus size={17} color={tagsOpen ? accent.accent : theme.colors.textSecondary} />
              </IconButton>
              {song.tagIds.length > 0 ? (
                <View
                  style={[styles.tagCount, { backgroundColor: accent.accent }]}
                  pointerEvents="none"
                >
                  <Text style={[styles.tagCountText, { color: accent.onAccent }]}>
                    {song.tagIds.length}
                  </Text>
                </View>
              ) : null}
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
              color={player.queue.shuffle ? accent.accent : theme.colors.textSecondary}
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
              <RepeatOne size={17} color={accent.accent} />
            ) : (
              <Repeat
                size={17}
                color={player.queue.repeat === 'off' ? theme.colors.textSecondary : accent.accent}
              />
            )}
          </IconButton>
        </View>
        <View style={styles.progress}>
          <SeekBar
            loop={loopRegionPercent(player.loopA, player.loopB, player.duration)}
            inline
            position={player.position}
            duration={player.duration}
            onSeek={player.seekTo}
            color={songColor.color}
          />
        </View>
      </View>

      <View style={styles.right}>
        <View style={styles.group} role="group" aria-label="Panels">
          <IconButton onPress={toggleLyrics} label="Lyrics" active={pageMode === 'focus'}>
            <Mic
              size={17}
              color={pageMode === 'focus' ? accent.accent : theme.colors.textSecondary}
            />
          </IconButton>
          <IconButton onPress={openQueue} label="Queue" active={queueOpen}>
            <Queue size={17} color={queueOpen ? accent.accent : theme.colors.textSecondary} />
          </IconButton>
          <IconButton
            onPress={() => setPracticeOpen(!practiceOpen)}
            label="Practice tools"
            active={practiceOpen || player.loopB !== null}
          >
            <Metronome
              size={17}
              color={
                practiceOpen || player.loopB !== null ? accent.accent : theme.colors.textSecondary
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

      <TagPicker song={tagsOpen ? song : null} onClose={() => setTagsOpen(false)} />
      <DevicesSheet
        open={devicesOpen}
        onClose={() => setDevicesOpen(false)}
        anchorRef={devicesRef}
      />
    </View>
  )
}

function SpeedButton(): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const accent = useAccent()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  return (
    <View ref={anchorRef} collapsable={false}>
      <IconButton
        onPress={() => setOpen(value => !value)}
        label={`Playback speed: ${player.rate}×`}
        active={player.rate !== 1}
      >
        <Speed size={17} color={player.rate !== 1 ? accent.accent : theme.colors.textSecondary} />
      </IconButton>
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
  const accent = useAccent()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const running = player.sleepTimerEndsAt !== null

  return (
    <View ref={anchorRef} collapsable={false}>
      <IconButton onPress={() => setOpen(value => !value)} label="Sleep timer" active={running}>
        <Moon size={17} color={running ? accent.accent : theme.colors.textSecondary} />
      </IconButton>
      <SleepMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} />
    </View>
  )
}

function VolumeControl({ compact }: { compact: boolean }): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const accent = useAccent()
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
        <Icon size={17} color={player.muted ? accent.accent : theme.colors.textSecondary} />
      </IconButton>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement="above"
        title="Volume"
        titleTone="label"
        width={200}
        testID="volume-popover"
      >
        <View style={styles.volumePopover}>
          {mute}
          {slider}
          <Text style={styles.readout}>{percent}%</Text>
        </View>
      </Popover>
    </View>
  )
}

/** The web's `input.volume`: a thin track that fills with the playing song's colour. */
function VolumeSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}): ReactNode {
  const player = usePlayer()
  const artFor = useArt()
  const songColor = useSongColor(player.current, player.current ? artFor(player.current) : null)
  const [trackWidth, setTrackWidth] = useState(0)
  const responder = useMemo(() => {
    const valueAt = (x: number): number =>
      trackWidth <= 0 ? value : Math.max(0, Math.min(1, x / trackWidth))
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event => onChange(valueAt(event.nativeEvent.locationX)),
      onPanResponderMove: event => onChange(valueAt(event.nativeEvent.locationX)),
    })
  }, [trackWidth, value, onChange])

  return (
    <View
      style={styles.slider}
      onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel="Volume"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      {...responder.panHandlers}
    >
      <View style={styles.sliderTrack}>
        <View
          style={[
            styles.sliderFill,
            { width: `${value * 100}%`, backgroundColor: songColor.color },
          ]}
        />
      </View>
    </View>
  )
}

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
  tagCount: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagCountText: { fontSize: 9, fontWeight: '700' },
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
  volumePopover: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6 },
  readout: { color: theme.colors.textMuted, fontSize: 11, minWidth: 32, textAlign: 'right' },
  slider: { width: 88, height: 24, justifyContent: 'center' },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: 'hidden',
  },
  sliderFill: { height: 4, borderRadius: radius.sm },
}))
