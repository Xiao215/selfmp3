import { describe, expect, it } from 'vitest'
import { ASK_BEFORE_MAX, AskRequestSchema } from '@selfmp3/shared'
import { afterStop, beforeTurn, retried, tooLongToAsk, type Turn } from './askTurns.model'

const turn = (id: number, patch: Partial<Turn> = {}): Turn => ({
  id,
  asked: `question ${id}`,
  playing: null,
  before: [],
  answered: `answer ${id}`,
  outcome: null,
  change: null,
  list: null,
  ...patch,
})

describe('beforeTurn', () => {
  it('is every turn before, with what came of a proposal', () => {
    const turns = [turn(1, { outcome: 'Fixed 3 songs' }), turn(2), turn(3, { answered: null })]
    expect(beforeTurn(turns, 2)).toEqual([
      { asked: 'question 1', answered: 'answer 1\nThen: Fixed 3 songs' },
      { asked: 'question 2', answered: 'answer 2' },
    ])
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

describe('retried', () => {
  it('waits again for the turn asked again, and only that one', () => {
    const turns = [turn(1), turn(2, { answered: '(This could not be answered.)' })]
    expect(retried(turns, 2).map(each => each.answered)).toEqual(['answer 1', null])
  })
})

describe('afterStop', () => {
  it('puts the stopped question back, unless something new was typed', () => {
    expect(afterStop('', 'calm songs')).toBe('calm songs')
    expect(afterStop('  ', 'calm songs')).toBe('calm songs')
    expect(afterStop('and some jazz', 'calm songs')).toBe('and some jazz')
  })
})
