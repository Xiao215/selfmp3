import { describe, expect, it } from 'vitest'
import {
  ASK_BEFORE_MAX,
  AskRequestSchema,
  type AskCard,
  type AskReply,
  type DescribeResult,
  type Understanding,
} from './index.js'
import { answerRecap, beforeTurn, objectsOf, tooLongToAsk } from './askTurns.js'

type AskedTurn = Parameters<typeof beforeTurn>[0][number]

const turn = (id: number, patch: Partial<AskedTurn> = {}): AskedTurn => ({
  asked: `question ${id}`,
  answered: `answer ${id}`,
  outcomes: {},
  objects: [],
  ...patch,
})

/** A reply of one card. */
const one = (card: AskCard): AskReply => ({ say: null, cards: [card] })

const base: Understanding = {
  name: 'Calm',
  anyTags: [],
  artists: [],
  albums: [],
  noTags: [],
  energy: { min: null, max: null },
  bpm: { min: null, max: null },
  year: { min: null, max: null },
  words: null,
  loved: null,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: null,
  minutes: null,
  sound: null,
  brief: null,
}

describe('beforeTurn', () => {
  it('is every turn before, with what came of its proposals', () => {
    const turns = [
      turn(1, { outcomes: { 0: 'Fixed 3 songs', 1: 'Closed. Nothing changed.' } }),
      turn(2),
      turn(3, { answered: null }),
    ]
    expect(beforeTurn(turns, 2)).toEqual([
      {
        asked: 'question 1',
        answered: 'answer 1\nThen: Fixed 3 songs; Closed. Nothing changed.',
        objects: [],
      },
      { asked: 'question 2', answered: 'answer 2', objects: [] },
    ])
  })

  it('carries what each answer showed, and the one on the screen however long ago it was asked', () => {
    const shown = (at: number) => ({
      handle: `t${at}.1`,
      kind: 'songs' as const,
      label: `list ${at}`,
      songIds: [at * 10],
      why: [null],
      playlist: null,
      lead: 'play' as const,
      like: null,
      understanding: null,
    })
    const turns = Array.from({ length: 12 }, (_, at) => turn(at + 1, { objects: [shown(at + 1)] }))
    const newest = beforeTurn(turns, 12)
    expect(newest.map(each => each.asked)[0]).toBe('question 5')
    expect(newest.at(-1)?.objects).toEqual([shown(12)])
    const withScreen = beforeTurn(turns, 12, 't2.1')
    expect(withScreen).toHaveLength(ASK_BEFORE_MAX)
    expect(withScreen.map(each => each.asked)).toEqual([
      'question 2',
      ...Array.from({ length: ASK_BEFORE_MAX - 1 }, (_, at) => `question ${at + 6}`),
    ])
    expect(
      AskRequestSchema.safeParse({
        text: 'play the 1st one',
        context: { playing: null, screen: 't2.1' },
        before: withScreen,
      }).success,
    ).toBe(true)
  })

  it('sends only the newest turns of a long conversation, so the tenth is asked', () => {
    const turns = Array.from({ length: 25 }, (_, at) => turn(at + 1))
    const before = beforeTurn(turns, 24)
    expect(before).toHaveLength(ASK_BEFORE_MAX)
    expect(before.at(-1)?.asked).toBe('question 24')
    expect(AskRequestSchema.safeParse({ text: 'question 25', before }).success).toBe(true)
  })

  it('leaves out a question too long to have been asked, and cuts a long recap', () => {
    const long = 'x'.repeat(623)
    const turns = [turn(1, { asked: long }), turn(2, { answered: 'y'.repeat(2500) }), turn(3)]
    const before = beforeTurn(turns, 2)
    expect(before.map(each => each.asked)).toEqual(['question 2'])
    expect(AskRequestSchema.safeParse({ text: 'question 3', before }).success).toBe(true)
    expect(tooLongToAsk(long)).toBe(true)
    expect(tooLongToAsk('x'.repeat(500))).toBe(false)
  })
})

describe('answerRecap', () => {
  it('says only what was asked, not that it was done: the device says what came of it', () => {
    const recap = answerRecap(one({ kind: 'playback', op: 'next', place: null }))
    expect(recap).toBe('Asked to skip to the next song.')
  })

  it('says what a list was offered for, its songs left to its object', () => {
    const describe = {
      understanding: { ...base, name: 'Morning' },
      picks: [{ songId: 4, why: 'bright' }],
    } as unknown as DescribeResult
    expect(answerRecap(one({ kind: 'songs', lead: 'save', describe, like: null }))).toBe(
      'Offered 1 song (“Morning”) to keep as a playlist',
    )
  })
})

describe('objectsOf', () => {
  const describe = {
    understanding: { ...base, name: 'Rainy' },
    fit: 9,
    loosened: [],
    unknown: [],
    notes: [],
    picks: [
      { songId: 11, why: 'soft piano' },
      { songId: 12, why: null },
      { songId: 13, why: 'rain on glass' },
    ],
  } satisfies DescribeResult

  it('gives a list its handle, songs in order with their reasons, and what it was for', () => {
    const [object] = objectsOf(one({ kind: 'songs', lead: 'next', describe, like: 7 }), 3)
    expect(object).toEqual({
      handle: 't3.1',
      kind: 'songs',
      label: 'Rainy',
      songIds: [11, 12, 13],
      why: ['soft piano', null, 'rain on glass'],
      playlist: null,
      lead: 'next',
      like: 7,
      understanding: describe.understanding,
    })
  })

  it('sends a list as it is shown now: moved on its page, its reasons kept with their songs', () => {
    const now = { ...base, name: 'Rainy', size: 2 }
    const [object] = objectsOf(
      one({ kind: 'songs', lead: 'play', describe, like: null }),
      1,
      new Map([[0, { songIds: [13, 11], understanding: now }]]),
    )
    expect(object).toMatchObject({
      songIds: [13, 11],
      why: ['rain on glass', 'soft piano'],
      understanding: now,
    })
  })

  it('names the songs of a review and of a playlist edit, and nothing for words alone', () => {
    const [tags] = objectsOf(
      one({
        kind: 'tags',
        review: {
          changes: [
            {
              key: 'a',
              op: 'add',
              tag: '夜',
              isNew: true,
              to: null,
              songIds: [1, 2],
              who: '',
              why: '',
              by: 'model',
            },
            {
              key: 'b',
              op: 'add',
              tag: 'jpop',
              isNew: false,
              to: null,
              songIds: [2, 3],
              who: '',
              why: '',
              by: 'model',
            },
          ],
          looked: 3,
          asked: 'tag these',
          unsure: [],
          note: null,
        },
      }),
      2,
    )
    expect(tags).toMatchObject({ handle: 't2.1', kind: 'tagChanges', songIds: [1, 2, 3] })
    const [edit] = objectsOf(
      one({
        kind: 'playlistSongs',
        playlist: 'gym',
        op: 'add',
        songs: [{ songId: 5, why: null }],
        understanding: null,
        by: 'rule',
        sortBy: null,
        order: 'asc',
        unknown: [],
      }),
      4,
    )
    expect(edit).toMatchObject({ kind: 'playlistSongs', playlist: 'gym', songIds: [5] })
    expect(objectsOf(one({ kind: 'clarify', question: 'Which?', options: ['a'] }), 5)).toEqual([])
    expect(
      objectsOf(one({ kind: 'explore', say: 'None of yours.', songIds: [], get: null }), 6),
    ).toEqual([])
  })
})
