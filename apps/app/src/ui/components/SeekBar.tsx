import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { formatDuration } from '@selfmp3/shared'
import { type, space } from '@selfmp3/client'
import { usePlayerCommands, usePlayerProgress } from '../../player/PlayerProvider'
import { SEEK_STEP_SECONDS } from '../../player/progress.model'
import { Scrubber } from './Scrubber'

/**
 * The playing song's scrubber, with its times: Now Playing's thick track
 * with elapsed and what is left beneath it, or the player bar's thin one
 * between elapsed and the length (`inline`). A thumb that is always there, in
 * a hit area big enough to grab while walking.
 *
 * It reads the position itself, so each tick redraws the scrubber and not the
 * page or the bar around it. Let go, it holds where the finger left it until
 * the engine says it is there (`Scrubber`'s `hold`).
 */
export function SeekBar({
  inline = false,
  color,
  waiting,
}: {
  /** The player bar's: elapsed, a thin track, and the length on one line. */
  inline?: boolean
  /** The playing song's colour, for the played part. The accent when not given. */
  color?: string
  /**
   * The length of a song not loaded yet, held at its start and still: a share
   * link's page keeps the bar's place before Play, so nothing moves when it starts.
   */
  waiting?: number
}): ReactNode {
  const progress = usePlayerProgress()
  const seekTo = usePlayerCommands().seekTo
  const position = waiting === undefined ? progress.position : 0
  const duration = waiting ?? progress.duration
  const onSeek = waiting === undefined ? seekTo : () => undefined
  return (
    <Scrubber
      value={position}
      max={duration}
      onCommit={onSeek}
      hold={waiting === undefined}
      label="Seek"
      step={SEEK_STEP_SECONDS}
      size={inline ? 'small' : 'large'}
      color={color}
      around={(bar, shown) =>
        inline ? (
          <View style={styles.inline}>
            <Text style={styles.timeInline}>{formatDuration(shown)}</Text>
            <View style={styles.inlineTrack}>{bar}</View>
            <Text style={styles.timeInline}>{formatDuration(duration)}</Text>
          </View>
        ) : (
          <View style={styles.wrapper}>
            {bar}
            {/* Elapsed on the left, what is left on the right. */}
            <View style={styles.times}>
              <Text style={styles.time}>{formatDuration(shown)}</Text>
              <Text style={styles.time}>-{formatDuration(Math.max(0, duration - shown))}</Text>
            </View>
          </View>
        )
      }
    />
  )
}

const styles = StyleSheet.create(theme => ({
  /* The player bar's: the times either side, 11-point and tabular. */
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    width: '100%',
  },
  inlineTrack: { flex: 1, minWidth: 0 },
  /* In the title's colour: muted, the times all but disappeared over a song-coloured page. */
  timeInline: {
    color: theme.colors.textPrimary,
    fontSize: type.tiny,
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'center',
  },
  wrapper: { width: '100%' },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  time: {
    color: theme.colors.textPrimary,
    fontSize: type.tiny,
    fontVariant: ['tabular-nums'],
  },
}))
