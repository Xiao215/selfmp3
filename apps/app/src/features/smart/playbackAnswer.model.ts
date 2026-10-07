import { plural, queueSections, type AskAnswer, type QueueState } from '@selfmp3/shared'

/**
 * Ask's playback answer ("skip this song", "play the last song in Up next")
 * as this device carries it out: the server says what was asked for, and only
 * the device knows what is playing and what is in its Up next, so the place a
 * song has there is found here.
 */

/** What the player is told to do: its own commands, one each. */
type PlaybackCommand =
  | { readonly kind: 'next' }
  | { readonly kind: 'restart' }
  | { readonly kind: 'toggle' }
  /** Play the song at this index of the queue's `items`. */
  | { readonly kind: 'jump'; readonly index: number }

export interface PlaybackStep {
  /** Null when there is nothing to do: nothing playing, already paused, no such song. */
  readonly command: PlaybackCommand | null
  /** The line that says what was done, or why nothing was. */
  readonly say: string
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

/** A place in Up next as the words said it: "the 3rd", "the last", "the 2nd from the end". */
function placeWords(place: number): string {
  if (place > 0) return `the ${ordinal(place)}`
  return place === -1 ? 'the last' : `the ${ordinal(-place)} from the end`
}

/**
 * The step a playback answer comes to, given the queue as it is now.
 *
 * Next and starting again are the buttons' own, so they keep the music
 * playing or paused as it was. Going back is the song before in the queue,
 * never "this one from the start" — the buttons' Previous restarts a song past
 * its first seconds, which is every song by the time an answer has come back.
 * Going back and a song in Up next are a jump, which plays it.
 */
export function playbackStep(
  answer: Extract<AskAnswer, { kind: 'playback' }>,
  queue: QueueState,
  isPlaying: boolean,
  titleOf: (songId: number) => string | null,
): PlaybackStep {
  const { playing, next } = queueSections(queue)
  const named = (songId: number): string => {
    const title = titleOf(songId)
    return title === null ? 'that song' : `“${title}”`
  }

  if (answer.op === 'upNext') {
    if (next.length === 0) return { command: null, say: 'Up next is empty.' }
    const place = answer.place ?? 1
    const entry = next[place > 0 ? place - 1 : next.length + place]
    if (place === 0 || !entry) {
      return {
        command: null,
        say: `Up next has only ${plural(next.length, 'song', 'songs')}.`,
      }
    }
    return {
      command: { kind: 'jump', index: entry.index },
      say: `Playing ${named(entry.id)}, ${placeWords(place)} in Up next.`,
    }
  }

  if (!playing) return { command: null, say: 'Nothing is playing.' }
  switch (answer.op) {
    case 'next':
      return { command: { kind: 'next' }, say: 'Skipped to the next song.' }
    case 'previous': {
      const before = queue.items[playing.index - 1]
      if (before === undefined) return { command: null, say: 'Nothing played before this song.' }
      return {
        command: { kind: 'jump', index: playing.index - 1 },
        say: `Back to ${named(before)}.`,
      }
    }
    case 'restart':
      return { command: { kind: 'restart' }, say: `Back to the start of ${named(playing.id)}.` }
    case 'pause':
      return isPlaying
        ? { command: { kind: 'toggle' }, say: 'Paused.' }
        : { command: null, say: 'Already paused.' }
    case 'resume':
      return isPlaying
        ? { command: null, say: 'Already playing.' }
        : { command: { kind: 'toggle' }, say: `Playing ${named(playing.id)}.` }
  }
}
