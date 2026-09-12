import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { useRouter } from 'expo-router'
import { formatDuration } from '@selfmp3/shared'
import { colors, oklchToHexAlpha, radius, space, type } from '@selfmp3/client'
import { useToggleLoved } from '../api/queries'
import { DevicesSheet } from '../features/devices/DevicesSheet'
import { useArt } from '../offline/useArt'
import { usePlayer } from '../player/PlayerProvider'
import { useAccent } from '../ui/accent'
import { Cover } from '../ui/components/Cover'
import { IconButton } from '../ui/components/IconButton'
import {
  Devices,
  Heart,
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
import { SeekBar } from '../ui/components/SeekBar'
import { SheetItem } from '../ui/components/Sheet'
import { TagPicker } from '../ui/components/TagPicker'
import { useLayout } from './useLayout'

/**
 * The transport across the foot of the desktop layout: the web's `.player-bar`.
 *
 * Three columns. The song on the left, with love and tags. The transport in
 * the middle: shuffle, previous, play, next, repeat, and the scrubber. On the
 * right, three groups with a hairline between them, because nine controls in a
 * row read as a wall of icons and they are three jobs: what is on screen, how
 * it plays, and where it comes out.
 *
 * The bar fills with the accent up to where the song has got, with a bright
 * line along its top edge, as the web's does in the cover's colour.
 */
export const PLAYER_BAR_HEIGHT = 84

/** Below this the volume slider folds into a popover on the speaker. */
const COMPACT_WIDTH = 1160

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const
const SLEEP_OPTIONS = [15, 30, 45, 60, 90] as const

const REPEAT_LABEL = {
  off: 'Repeat off',
  all: 'Repeat all',
  one: 'Repeat this song',
} as const

export function PlayerBar(): ReactNode {
  const player = usePlayer()
  const accent = useAccent()
  const artFor = useArt()
  const router = useRouter()
  const toggleLoved = useToggleLoved()
  const { width } = useLayout()
  const song = player.current
  const [tagsOpen, setTagsOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const devicesRef = useRef<View>(null)

  const percent =
    song && player.duration > 0 ? Math.min(100, (player.position / player.duration) * 100) : 0
  const openPage = (): void => router.push('/now-playing')

  return (
    <View style={styles.bar} testID="player-bar">
      {song ? (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.wash,
              {
                width: `${percent}%`,
                backgroundColor: oklchToHexAlpha(0.72, 0.16, accent.hue, 0.2),
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[styles.playedLine, { width: `${percent}%`, backgroundColor: accent.accent }]}
          />
        </>
      ) : null}

      <View style={styles.left}>
        {song ? (
          <>
            <Pressable
              style={styles.open}
              onPress={openPage}
              accessibilityRole="button"
              accessibilityLabel={`Open now playing: ${song.title}`}
            >
              <Cover uri={artFor(song)} title={song.album || song.title} size={54} />
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
                color={song.loved ? colors.danger : colors.textSecondary}
              />
            </IconButton>
            <View>
              <IconButton
                onPress={() => setTagsOpen(true)}
                label={`Tags for ${song.title}`}
                active={tagsOpen}
              >
                <TagPlus size={17} color={tagsOpen ? accent.accent : colors.textSecondary} />
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

      <View style={styles.centre}>
        <View style={styles.buttons}>
          <IconButton onPress={player.toggleShuffle} label="Shuffle" active={player.queue.shuffle}>
            <Shuffle
              size={17}
              color={player.queue.shuffle ? accent.accent : colors.textSecondary}
            />
          </IconButton>
          <IconButton onPress={player.previous} label="Previous" disabled={!song}>
            <Prev size={20} color={colors.textSecondary} />
          </IconButton>
          <Pressable
            onPress={player.toggle}
            disabled={!song}
            accessibilityRole="button"
            accessibilityLabel={player.isPlaying ? 'Pause' : 'Play'}
            accessibilityState={{ disabled: !song, busy: player.stalled }}
            style={({ pressed }) => [
              styles.playButton,
              { backgroundColor: song ? colors.textPrimary : colors.surface3 },
              pressed && styles.playPressed,
            ]}
          >
            {player.isPlaying ? (
              <Pause size={20} color={colors.surface0} />
            ) : (
              <Play size={20} color={song ? colors.surface0 : colors.textMuted} />
            )}
          </Pressable>
          <IconButton onPress={player.next} label="Next" disabled={!song}>
            <Next size={20} color={colors.textSecondary} />
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
                color={player.queue.repeat === 'off' ? colors.textSecondary : accent.accent}
              />
            )}
          </IconButton>
        </View>
        <View style={styles.progress}>
          <SeekBar
            inline
            position={player.position}
            duration={player.duration}
            onSeek={player.seekTo}
          />
        </View>
      </View>

      <View style={styles.right}>
        <View style={styles.group} role="group" aria-label="Panels">
          <IconButton onPress={openPage} label="Lyrics">
            <Mic size={17} color={colors.textSecondary} />
          </IconButton>
          <IconButton onPress={openPage} label="Queue">
            <Queue size={17} color={colors.textSecondary} />
          </IconButton>
        </View>
        <View style={[styles.group, styles.groupDivided]} role="group" aria-label="Playback">
          <SpeedButton />
          <SleepButton />
        </View>
        <View style={[styles.group, styles.groupDivided]} role="group" aria-label="Output">
          <View ref={devicesRef} collapsable={false}>
            <IconButton onPress={() => setDevicesOpen(true)} label="Devices">
              <Devices size={17} color={colors.textSecondary} />
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
        <Speed size={17} color={player.rate !== 1 ? accent.accent : colors.textSecondary} />
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
  const player = usePlayer()
  const accent = useAccent()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const remaining = useRemaining(player.sleepTimerEndsAt)
  const running = player.sleepTimerEndsAt !== null

  return (
    <View ref={anchorRef} collapsable={false}>
      <IconButton onPress={() => setOpen(value => !value)} label="Sleep timer" active={running}>
        <Moon size={17} color={running ? accent.accent : colors.textSecondary} />
      </IconButton>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement="above"
        title={running ? `Stopping in ${remaining}` : 'Sleep timer'}
        titleTone="label"
        width={180}
        testID="sleep-menu"
      >
        <Text style={styles.menuTitle}>{running ? `Stopping in ${remaining}` : 'Sleep timer'}</Text>
        {SLEEP_OPTIONS.map(minutes => (
          <SheetItem
            key={minutes}
            label={`${minutes} minutes`}
            onPress={() => {
              player.setSleepTimer(minutes)
              setOpen(false)
            }}
          />
        ))}
        {running ? (
          <SheetItem
            label="Cancel timer"
            danger
            onPress={() => {
              player.setSleepTimer(null)
              setOpen(false)
            }}
          />
        ) : null}
      </Popover>
    </View>
  )
}

/** "12:04" until the timer runs out, ticking once a second while it is set. */
function useRemaining(endsAt: number | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (endsAt === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [endsAt])
  return endsAt === null ? '' : formatDuration(Math.max(0, endsAt - now) / 1000)
}

function VolumeControl({ compact }: { compact: boolean }): ReactNode {
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
      <Icon size={17} color={colors.textSecondary} />
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
        <Icon size={17} color={player.muted ? accent.accent : colors.textSecondary} />
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

/** The web's `input.volume`: a thin track that fills with the accent. */
function VolumeSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}): ReactNode {
  const accent = useAccent()
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
          style={[styles.sliderFill, { width: `${value * 100}%`, backgroundColor: accent.accent }]}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    height: PLAYER_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: 18,
    backgroundColor: colors.surface1,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    overflow: 'hidden',
  },
  wash: { position: 'absolute', left: 0, top: 0, bottom: 0 },
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
  title: { color: colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  artist: { color: colors.textMuted, fontSize: type.small },
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
  right: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  group: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  groupDivided: { paddingLeft: space.sm, borderLeftWidth: 1, borderLeftColor: colors.border },
  menuTitle: {
    color: colors.textMuted,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingTop: space.sm,
    paddingBottom: 6,
  },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  volumePopover: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6 },
  readout: { color: colors.textMuted, fontSize: 11, minWidth: 32, textAlign: 'right' },
  slider: { width: 88, height: 24, justifyContent: 'center' },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface3,
    overflow: 'hidden',
  },
  sliderFill: { height: 4, borderRadius: radius.sm },
})
