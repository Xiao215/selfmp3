import { describe, expect, it } from 'vitest'
import { afterStop, fieldWords, retried, scrollToShow, type Turn } from './askTurns.model'

const turn = (id: number, patch: Partial<Turn> = {}): Turn => ({
  id,
  asked: `question ${id}`,
  playing: null,
  screen: null,
  before: [],
  answered: `answer ${id}`,
  outcomes: {},
  objects: [],
  list: null,
  listHandle: null,
  line: null,
  ...patch,
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

describe('fieldWords', () => {
  it('names the songs a chip means, one or several, and asks about them', () => {
    expect(fieldWords(1, 2)).toEqual({ chip: 'this song', placeholder: 'Ask about it…' })
    expect(fieldWords(18, 2)).toEqual({ chip: 'these 18 songs', placeholder: 'Ask about them…' })
  })

  it('asks anything to start, and a follow-up after', () => {
    expect(fieldWords(null, 0)).toEqual({ chip: null, placeholder: 'Ask anything…' })
    expect(fieldWords(null, 3)).toEqual({ chip: null, placeholder: 'Ask a follow-up…' })
  })
})

describe('scrollToShow', () => {
  const view = { y: 100, height: 300 }
  it('leaves a line in view where it is', () => {
    expect(scrollToShow({ y: 150, height: 50 }, view, 8)).toBeNull()
  })

  it('brings a line under the field up to the foot, and one above down to the top', () => {
    expect(scrollToShow({ y: 420, height: 50 }, view, 8)).toBe(178)
    expect(scrollToShow({ y: 40, height: 50 }, view, 8)).toBe(32)
    expect(scrollToShow({ y: 4, height: 50 }, view, 8)).toBe(0)
  })
})
