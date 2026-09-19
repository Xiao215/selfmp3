import { useCallback, useMemo } from 'react'
import { useRouter } from 'expo-router'
import { useLibrary } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { untaggedSongs } from './tag.model'

/**
 * Tagging the songs that have none, one at a time while they play
 * (docs/UI-MIGRATION.md, Open question 1): they become the queue, newest
 * first, and Now Playing opens with its tag editor raised. Saving a song's
 * tags moves on to the next; that part is Now Playing's.
 *
 * What the untagged card on All tags and the palette's "Tag untagged songs"
 * both do, so the two doors cannot drift apart. `count` is how many songs it
 * would play, for the card's title and the command's hint.
 */
export function usePlayAndTag(): { readonly count: number; readonly start: () => void } {
  const router = useRouter()
  const player = usePlayer()
  const { data: library } = useLibrary()
  // A pass over the whole library; its answer only changes when the library does.
  const ids = useMemo(
    () => (library ? untaggedSongs(library.songs).map(song => song.id) : []),
    [library],
  )
  const start = useCallback(() => {
    if (ids.length === 0) return
    player.playFrom(ids, 0)
    router.push({ pathname: '/now-playing', params: { tagging: '1' } })
  }, [ids, player, router])
  return { count: ids.length, start }
}
