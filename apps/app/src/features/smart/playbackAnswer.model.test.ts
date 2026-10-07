import { describe, expect, it } from 'vitest'
import { EMPTY_QUEUE, type AskAnswer, type QueueState } from '@selfmp3/shared'
import { ordinal, playbackStep } from './playbackAnswer.model'

type Playback = Extract<AskAnswer, { kind: 'playback' }>

const asked = (op: Playback['op'], place: number | null = null): Playback => ({
  kind: 'playback',
  op,
  place,
})

/** Songs 10 to 15, the third of them playing: two played, three in Up next. */
const QUEUE: QueueState = { ...EMPTY_QUEUE, items: [10, 11, 12, 13, 14, 15], index: 2 }
const titleOf = (id: number): string | null => (id === 99 ? null : `Song ${id}`)
const step = (answer: Playback, queue = QUEUE, isPlaying = true) =>
  playbackStep(answer, queue, isPlaying, titleOf)

describe('a playback answer on this device', () => {
  it('skips with the player’s own Next', () => {
    expect(step(asked('next'))).toEqual({
      command: { kind: 'next' },
      say: 'Skipped to the next song.',
    })
  })

  it('goes back to the song before, not to the start of this one', () => {
    expect(step(asked('previous'))).toEqual({
      command: { kind: 'jump', index: 1 },
      say: 'Back to “Song 11”.',
    })
    expect(step(asked('previous'), { ...QUEUE, index: 0 })).toEqual({
      command: null,
      say: 'Nothing played before this song.',
    })
  })

  it('starts this song again', () => {
    expect(step(asked('restart'))).toEqual({
      command: { kind: 'restart' },
      say: 'Back to the start of “Song 12”.',
    })
  })

  it('pauses and carries on only when that changes something', () => {
    expect(step(asked('pause'))).toEqual({ command: { kind: 'toggle' }, say: 'Paused.' })
    expect(step(asked('pause'), QUEUE, false)).toEqual({ command: null, say: 'Already paused.' })
    expect(step(asked('resume'), QUEUE, false)).toEqual({
      command: { kind: 'toggle' },
      say: 'Playing “Song 12”.',
    })
    expect(step(asked('resume'))).toEqual({ command: null, say: 'Already playing.' })
  })

  it('counts a place in Up next from the front, or from the back', () => {
    expect(step(asked('upNext', 1))).toEqual({
      command: { kind: 'jump', index: 3 },
      say: 'Playing “Song 13”, the 1st in Up next.',
    })
    expect(step(asked('upNext', 3))).toEqual({
      command: { kind: 'jump', index: 5 },
      say: 'Playing “Song 15”, the 3rd in Up next.',
    })
    expect(step(asked('upNext', -1))).toEqual({
      command: { kind: 'jump', index: 5 },
      say: 'Playing “Song 15”, the last in Up next.',
    })
    expect(step(asked('upNext', -3))).toEqual({
      command: { kind: 'jump', index: 3 },
      say: 'Playing “Song 13”, the 3rd from the end in Up next.',
    })
  })

  it('says how many there are when the place is past Up next, and does nothing', () => {
    for (const place of [4, -4, 0]) {
      expect(step(asked('upNext', place))).toEqual({
        command: null,
        say: 'Up next has only 3 songs.',
      })
    }
    expect(step(asked('upNext', 1), { ...QUEUE, index: 5 })).toEqual({
      command: null,
      say: 'Up next is empty.',
    })
  })

  it('does nothing to a player with nothing loaded, but can start a song in its Up next', () => {
    const idle: QueueState = { ...QUEUE, index: -1 }
    for (const op of ['next', 'previous', 'restart', 'pause', 'resume'] as const) {
      expect(step(asked(op), idle)).toEqual({ command: null, say: 'Nothing is playing.' })
    }
    expect(step(asked('upNext', 1), idle).command).toEqual({ kind: 'jump', index: 0 })
    expect(step(asked('next'), EMPTY_QUEUE).command).toBeNull()
  })

  it('names a song it cannot find a title for plainly', () => {
    const queue: QueueState = { ...EMPTY_QUEUE, items: [12, 99], index: 0 }
    expect(step(asked('upNext', 1), queue).say).toBe('Playing that song, the 1st in Up next.')
  })
})

describe('ordinal', () => {
  it('says each number the way it is read', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ])
  })
})
