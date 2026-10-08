import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { space, type, useLibrary } from '@selfmp3/client'
import type { PlayerApi } from '../../player/PlayerProvider'
import { Button } from '../../ui/components/Button'
import { Shuffle, Sparkles } from '../../ui/components/Icons'
import { dismissToast, showToast } from '../../ui/toast'
import { playSimilar } from '../song/playSimilar'
import { onlySongEnded } from './queue.model'
import { isQueueSheetOpen, openQueueSheet, useQueueSheetOpen } from './queueSheet.store'

/**
 * What Up next shows once a song played on its own has ended
 * (docs/features/lists.md, "A song picked from Library"): it says so, and
 * offers the two likely next steps. Nothing plays that was not asked for —
 * a Library tap still means just that song — but the silence after it is
 * explained rather than left to look like a fault.
 *
 * "Songs like this" is the song menu's Play similar songs; "Shuffle library"
 * is Library's Shuffle with no tags on.
 */
export function OnlySongEnd({
  song,
  player,
}: {
  song: Song
  player: Pick<PlayerApi, 'playFrom' | 'playShuffled'>
}): ReactNode {
  const { data: library } = useLibrary()
  const shuffleLibrary = (): void => {
    const songIds = (library?.songs ?? []).map(each => each.id)
    player.playShuffled(songIds, { kind: 'library' })
  }
  return (
    <View style={styles.card} testID="only-song-end">
      <Text style={styles.title}>That was the only song</Text>
      <View style={styles.buttons}>
        <Button
          label="Songs like this"
          icon={<Sparkles size={15} tone="textPrimary" />}
          onPress={() => playSimilar(player, song)}
          testID="only-song-similar"
        />
        <Button
          label="Shuffle library"
          icon={<Shuffle size={15} tone="textPrimary" />}
          onPress={shuffleLibrary}
          testID="only-song-shuffle"
        />
      </View>
    </View>
  )
}

/**
 * Says the song was the only one the moment it ends, wherever you are, when
 * Up next is not already open to say it: the mini player or the player bar
 * stays, paused at the song's end, and the message points at Up next. Taken
 * away once Up next is open, or once something plays again: it is then said
 * there, or no longer true. Called by the sheet and by the rail, only one of
 * which is ever mounted.
 */
export function useOnlySongEndNotice(player: Parameters<typeof onlySongEnded>[0]): void {
  const ended = onlySongEnded(player)
  const open = useQueueSheetOpen()
  const raised = useRef<number | null>(null)
  useEffect(() => {
    if (!ended || isQueueSheetOpen()) return
    raised.current = showToast('That was the only song', 'info', {
      actions: [{ label: 'Up next', onPress: openQueueSheet }],
    })
  }, [ended])
  useEffect(() => {
    if (raised.current === null || (ended && !open)) return
    dismissToast(raised.current)
    raised.current = null
  }, [ended, open])
}

const styles = StyleSheet.create(theme => ({
  card: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Side by side where they fit; a narrow rail stacks them.
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
  },
}))
