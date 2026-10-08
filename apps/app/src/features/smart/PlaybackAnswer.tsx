import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Text } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { AskAnswer } from '@selfmp3/shared'
import { usePlayer, usePlayerCommands } from '../../player/PlayerProvider'
import { useSongsById } from '../../ui/songsById'
import { playbackStep, type PlaybackStep } from './playbackAnswer.model'
import { leading, type } from '@selfmp3/client'

/**
 * What each playback answer came to, by the answer, once it has been carried
 * out: done once however often it is drawn again — React Query hands back the
 * same answer object while it is cached, and going back along the follow-up
 * trail draws it anew.
 */
const carriedOut = new WeakMap<object, PlaybackStep>()

/**
 * "Skip this song", "play the last song in Up next" (docs/features/ai.md,
 * "Controlling what plays"): the one Ask answer done as it arrives, with no
 * button to press, since it is what the buttons beside the music already do.
 * It says in a line what it did, or why it did nothing.
 */
export function PlaybackAnswer({
  answer,
}: {
  answer: Extract<AskAnswer, { kind: 'playback' }>
}): ReactNode {
  const { queue, isPlaying } = usePlayer()
  const player = usePlayerCommands()
  const songsById = useSongsById()
  // Worked out from the player as it is when the answer is first drawn, and
  // kept: what it says must not change as the music moves on because of it.
  const [step] = useState(
    () =>
      carriedOut.get(answer) ??
      playbackStep(answer, queue, isPlaying, id => songsById.get(id)?.title ?? null),
  )

  useEffect(() => {
    if (carriedOut.has(answer)) return
    carriedOut.set(answer, step)
    const command = step.command
    if (command === null) return
    switch (command.kind) {
      case 'next':
        player.next()
        break
      case 'restart':
        player.seekTo(0)
        break
      case 'toggle':
        player.toggle()
        break
      case 'jump':
        player.jumpTo(command.index)
        break
    }
  }, [answer, step, player])

  return (
    <Text style={styles.line} testID="ask-playback-said">
      {step.say}
    </Text>
  )
}

const styles = StyleSheet.create(theme => ({
  line: { color: theme.colors.textPrimary, fontSize: type.body, lineHeight: leading.body },
}))
