import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePlayer } from '../../player/PlayerProvider'
import { IconButton } from './IconButton'
import { Next, Prev, Repeat, RepeatOne, Shuffle } from './Icons'
import { PlayPauseButton } from './PlayPauseButton'
import { space } from '@selfmp3/client'

/** Said as a sentence, because "Repeat: off" is not what a screen reader wants. */
const REPEAT_LABEL = {
  off: 'Repeat off',
  all: 'Repeat all',
  one: 'Repeat this song',
} as const

/**
 * How big each part of the row is, by where it is drawn:
 * - `page`, Now Playing's cover view on a phone, low where a thumb is;
 * - `words`, the same page reading along, with only previous, play and next;
 * - `bar`, the player bar's middle column on a computer.
 */
const SIZES = {
  page: { mode: 19, step: 32, stepButton: 52, play: 72, glyph: 30 },
  words: { mode: 0, step: 28, stepButton: undefined, play: 60, glyph: 26 },
  bar: { mode: 17, step: 20, stepButton: undefined, play: 40, glyph: 20 },
} as const

/**
 * Shuffle, previous, play, next and repeat: the transport, drawn the same way
 * wherever it is. Now Playing's page and the player bar had a copy each, the
 * repeat labels word for word, and had drifted: the bar greyed previous and
 * next with nothing loaded and the page did not, and Shuffle was "Shuffle on"
 * on one and "Shuffle", lit, on the other. Lit is said by the button's state.
 *
 * `tint` is what shuffle and repeat are lit in: the playing song's colour.
 */
export function TransportControls({
  size,
  tint,
  style,
}: {
  size: keyof typeof SIZES
  tint: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const sizes = SIZES[size]
  const none = player.current === null
  const { shuffle, repeat } = player.queue
  // On a song-coloured page the steps are ink; on the bar they are quieter than Play.
  const stepInk = size === 'bar' ? theme.colors.textSecondary : theme.colors.textPrimary
  // Reading along, the page keeps only what skips: shuffle and repeat are a step away.
  const modes = sizes.mode > 0
  const modeSize = sizes.mode

  return (
    <View style={[styles.row, styles[size], style]}>
      {modes ? (
        <IconButton onPress={player.toggleShuffle} label="Shuffle" active={shuffle}>
          <Shuffle size={modeSize} color={shuffle ? tint : theme.colors.textSecondary} />
        </IconButton>
      ) : null}
      <IconButton
        onPress={player.previous}
        label="Previous"
        size={sizes.stepButton}
        disabled={none}
      >
        <Prev size={sizes.step} color={stepInk} />
      </IconButton>
      <View style={size === 'bar' ? styles.barPlay : null}>
        <PlayPauseButton size={sizes.play} glyph={sizes.glyph} disabled={none} />
      </View>
      <IconButton onPress={player.next} label="Next" size={sizes.stepButton} disabled={none}>
        <Next size={sizes.step} color={stepInk} />
      </IconButton>
      {modes ? (
        <IconButton
          onPress={player.cycleRepeatMode}
          label={REPEAT_LABEL[repeat]}
          active={repeat !== 'off'}
        >
          {repeat === 'one' ? (
            <RepeatOne size={modeSize} color={tint} />
          ) : (
            <Repeat size={modeSize} color={repeat === 'off' ? theme.colors.textSecondary : tint} />
          )}
        </IconButton>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  page: { justifyContent: 'space-between' },
  words: { justifyContent: 'center', gap: 26 },
  bar: { gap: space.tight },
  barPlay: { marginHorizontal: space.xs },
})
