import type { ReactNode, RefObject } from 'react'
import type { View } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'
import { useFlyToUpNext } from '../../features/queue/useFlyToUpNext'
import { Button, PlayButton } from './Button'
import { Shuffle } from './Icons'
import { PlayPauseIcon } from './PlayPauseIcon'

/**
 * A list head's Play and Shuffle: the page's one white Play (`S2`) and
 * Shuffle beside it, both naming what they start ("Shuffle Evening"), and
 * both flying the first covers to Up next from the head's picture. A tag's,
 * an artist's, a playlist's and an answer's head each drew its own pair: the
 * answer's Shuffle said only "Shuffle", the playlist's had no testID and
 * flew nothing, and a playlist hid both when empty where the others greyed
 * them.
 *
 * A list known to be empty shows neither, since they could only do nothing.
 * One still loading shows them greyed. A list that says it is the one in Up
 * next (`playing`) has a Pause for its Play while it plays, and a Play that
 * goes on from where it was while it is paused; what to do is still `onPlay`'s.
 */
export function PlayShuffle({
  name,
  songIds,
  empty = songIds.length === 0,
  disabled = false,
  playing,
  heroRef,
  onPlay,
  onShuffle,
  testPrefix,
}: {
  /** What they start, said after "Play" and "Shuffle". */
  name: string
  songIds: readonly number[]
  /** Known to have no songs; by default, when none are here. */
  empty?: boolean
  disabled?: boolean
  /** Whether this list, the one in Up next, is playing; left out when it is not that list. */
  playing?: boolean
  /** The head's picture, which the covers fly from. */
  heroRef?: RefObject<View | null>
  onPlay: () => void
  onShuffle: () => void
  /** Named `<prefix>-play` and `<prefix>-shuffle`. */
  testPrefix: string
}): ReactNode {
  const { theme } = useUnistyles()
  const fly = useFlyToUpNext()
  if (empty) return null
  const off = disabled || songIds.length === 0
  return (
    <>
      <PlayButton
        testID={`${testPrefix}-play`}
        label={playing ? `Pause ${name}` : `Play ${name}`}
        icon={<PlayPauseIcon playing={playing === true} size={20} color={theme.colors.onPrimary} />}
        disabled={off}
        onPress={() => {
          // Up next has these already: nothing flies to it.
          if (playing === undefined) fly(heroRef?.current ?? null, songIds)
          onPlay()
        }}
      />
      <Button
        testID={`${testPrefix}-shuffle`}
        label="Shuffle"
        accessibilityLabel={`Shuffle ${name}`}
        icon={<Shuffle tone="textPrimary" />}
        disabled={off}
        onPress={() => {
          fly(heroRef?.current ?? null, songIds)
          onShuffle()
        }}
      />
    </>
  )
}
