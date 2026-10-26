import {
  isResting,
  nearestFirst,
  soundCentre,
  soundCloseness,
  type QueueState,
  type Song,
} from '@selfmp3/shared'

/**
 * Keep going (docs/features/lists.md): when Up next runs out, songs from the
 * library that sound like the last few played. Picked the way a listening
 * room's Autoplay picks (`keepGoingPicks`): the songs playing and just played
 * make one place in sound, and the songs nearest it come first
 * (`nearestFirst`); with no vectors to go on, in no particular order.
 *
 * Pure, so vitest runs it: no React, no player.
 */

/** Songs Keep going adds at a time, as a room keeps two waiting. */
const KEEP_GOING_COUNT = 2

/** How many of the last songs the next ones should sound like: the room's three. */
const SOUND_OF_LAST = 3

/** Whether Keep going should add songs now: the song playing is the last, alone, with repeat off. */
export function keepGoingDue(queue: QueueState, playing: boolean): boolean {
  return (
    playing && queue.repeat === 'off' && queue.index >= 0 && queue.index === queue.items.length - 1
  )
}

/**
 * The songs to add: not in Up next or its Played already, not resting, those
 * that sound nearest the last few first. `vectorOf` is a song's packed vector,
 * or null where it has none.
 */
export function keepGoingSongs(input: {
  readonly queue: QueueState
  readonly songs: readonly Song[]
  readonly vectorOf: (songId: number) => Int8Array | null
  readonly count?: number
  readonly now?: number
  readonly random?: () => number
}): number[] {
  const { queue, songs, vectorOf } = input
  const count = input.count ?? KEEP_GOING_COUNT
  const now = input.now ?? Date.now()
  const last = queue.items.slice(Math.max(0, queue.index - SOUND_OF_LAST + 1), queue.index + 1)
  const target = soundCentre(
    last.flatMap(songId => {
      const vector = vectorOf(songId)
      return vector ? [vector] : []
    }),
  )
  const heard = new Set(queue.items)
  const candidates = songs.filter(song => !heard.has(song.id) && !isResting(song, now))
  const near = (song: Song): number | null => {
    const vector = target ? vectorOf(song.id) : null
    return vector && target ? soundCloseness(vector, target) : null
  }
  return nearestFirst(candidates, near, input.random)
    .slice(0, count)
    .map(song => song.id)
}
