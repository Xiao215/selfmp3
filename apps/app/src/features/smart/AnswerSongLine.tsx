import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import Svg, { Circle } from 'react-native-svg'
import type { Song } from '@selfmp3/shared'
import { coverSize, iconSize, motion, radius, space } from '@selfmp3/client'
import { usePlayerCommands, usePlayerProgress, useSongPlayback } from '../../player/PlayerProvider'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { IconButton } from '../../ui/components/IconButton'
import { Pause, Play } from '../../ui/components/Icons'
import { RowWash, Waking } from '../../ui/components/SongRow'
import { SongLine } from '../../ui/components/SongLine'
import { usePresence } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { useSongColor } from '../../ui/useSongColor'

/**
 * A song an Ask answer names, which plays from ▶ (Xiao picked A1 B1 C1,
 * 2026-10-24). While it is the song playing, the row says so as Library's do —
 * its cover's colour washes in from the right, the title takes its tint, the
 * equaliser sits over the cover — and ▶ is a pause inside a ring that fills as
 * the song goes. Moving through the song stays in Now Playing, which the
 * playing row opens; on a phone the Ask page has no mini player, so this row
 * is how the song is paused there.
 *
 * The control sits beside the row rather than in it, so a press on it is never
 * a press on the row as well.
 */
export function AnswerSongLine({
  song,
  artUri,
  sub,
  onPlay,
  testID,
}: {
  song: Song
  artUri: string | null | undefined
  sub: ReactNode
  onPlay: () => void
  testID?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const player = usePlayerCommands()
  const playback = useSongPlayback(song.id)
  const active = playback !== null
  const playing = playback === 'playing'
  const wash = usePresence(active, MOVE_MS.wash, motion.base)
  const songColor = useSongColor(song, artUri, active || wash.mounted)
  return (
    <View style={styles.line} testID={testID}>
      {wash.mounted ? <RowWash color={songColor.color} progress={wash.progress} /> : null}
      {/* SongLine's style is its press's; the box around it is what takes the row's room. */}
      <View style={styles.face}>
        <SongLine
          onPress={active ? () => router.navigate('/now-playing') : onPlay}
          accessibilityLabel={active ? `${song.title}, open Now Playing` : `Play ${song.title}`}
          cover={
            <View>
              <Cover uri={artUri} title={song.album || song.title} size={coverSize.line} />
              {wash.mounted ? (
                <Waking progress={wash.progress} style={styles.overlay}>
                  <Equalizer paused={!playing} size={11} color={songColor.tint} />
                </Waking>
              ) : null}
            </View>
          }
          title={song.title}
          titleStyle={active ? { color: songColor.tint } : undefined}
          sub={sub}
        />
      </View>
      {active ? (
        <IconButton
          label={playing ? `Pause ${song.title}` : `Play ${song.title}`}
          size={RING}
          onPress={player.toggle}
          testID="ask-song-toggle"
        >
          <View style={styles.ringBox}>
            <ProgressRing color={songColor.tint} />
            {playing ? (
              <Pause size={iconSize.small} color={theme.colors.textPrimary} />
            ) : (
              <Play size={iconSize.small} color={theme.colors.textPrimary} />
            )}
          </View>
        </IconButton>
      ) : (
        <IconButton
          label={`Play ${song.title}`}
          size={RING}
          onPress={onPlay}
          testID="ask-song-play"
        >
          <Play size={iconSize.field} color={theme.colors.textSecondary} />
        </IconButton>
      )}
    </View>
  )
}

/** How far into the song, as a ring around the control. Its own component: it redraws each tick. */
function ProgressRing({ color }: { color: string }): ReactNode {
  const { theme } = useUnistyles()
  const { position, duration } = usePlayerProgress()
  const done = duration > 0 ? Math.min(1, position / duration) : 0
  const r = (RING - STROKE) / 2 - 1
  const around = 2 * Math.PI * r
  return (
    <View style={styles.ring} pointerEvents="none">
      <Svg width={RING} height={RING}>
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          fill="none"
          stroke={theme.colors.surface3}
          strokeWidth={STROKE}
        />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${around} ${around}`}
          strokeDashoffset={around * (1 - done)}
          // From the top, clockwise, as a clock's hand goes.
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
    </View>
  )
}

/** The control's size, ring included. */
const RING = 34
const STROKE = 2.5

const styles = StyleSheet.create(theme => ({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.row,
    overflow: 'hidden',
    paddingRight: space.xs,
  },
  face: { flex: 1, minWidth: 0 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.coverShade,
    borderRadius: radius.coverSm,
  },
  // The ring around the icon, both centred in the control's square.
  ringBox: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', top: 0, left: 0, width: RING, height: RING },
}))
