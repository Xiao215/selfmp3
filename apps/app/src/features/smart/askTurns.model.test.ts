import { describe, expect, it } from 'vitest'
import {
  afterStop,
  fromLine,
  listChange,
  namedObjects,
  retried,
  scrollToShow,
  type Turn,
} from './askTurns.model'

const turn = (id: number, patch: Partial<Turn> = {}): Turn => ({
  id,
  asked: `question ${id}`,
  playing: null,
  screen: null,
  before: [],
  answered: `answer ${id}`,
  outcomes: {},
  objects: [],
  lists: [],
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

describe('namedObjects', () => {
  it('names each answer shown by its handle, with its turn and the list it opens as', () => {
    const list = { id: 'answer-1', handle: 't1.1', lead: 'play' as const }
    const object = {
      handle: 't1.1',
      kind: 'songs' as const,
      label: 'Calm study night',
      songIds: [3, 4],
      why: [],
      playlist: null,
      lead: 'play' as const,
      like: null,
      understanding: null,
    }
    const named = namedObjects([turn(7, { objects: [object], lists: [list] }), turn(8)])
    expect(named.get('t1.1')).toEqual({
      label: 'Calm study night',
      turnId: 7,
      kind: 'songs',
      songIds: [3, 4],
      list,
    })
    expect(named.size).toBe(1)
  })
})

describe('fromLine', () => {
  it('names one, two, or the first and how many more', () => {
    expect(fromLine([])).toBeNull()
    expect(fromLine(['Calm'])).toBe('From “Calm”')
    expect(fromLine(['Calm', 'Rain'])).toBe('From “Calm” and “Rain”')
    expect(fromLine(['Calm', 'Rain', 'Night'])).toBe('From “Calm” and 2 more')
  })
})

describe('listChange', () => {
  it('counts the songs that went and came', () => {
    expect(listChange([1, 2, 3, 4], [1, 2, 3, 5, 6])).toEqual({ removed: 1, added: 2 })
    expect(listChange([1, 2, 3], [1, 3])).toEqual({ removed: 1, added: 0 })
  })

  it('says nothing of the same songs', () => {
    expect(listChange([1, 2], [2, 1])).toBeNull()
  })

  it('says nothing of a list that shares under half of the earlier one', () => {
    expect(listChange([1, 2, 3, 4], [1, 9, 10])).toBeNull()
    expect(listChange([], [1])).toBeNull()
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
