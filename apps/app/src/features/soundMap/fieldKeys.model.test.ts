import { describe, expect, it } from 'vitest'
import {
  actionKey,
  answerKey,
  KEY_ZOOM,
  NO_FIELD_KEYS,
  readingOrder,
  songNearest,
  songToward,
  type FieldKey,
  type FieldKeyState,
} from './fieldKeys.model'

// A plus of songs round one in the middle, and one far off up and to the right.
const spots = [
  { id: 1, x: 100, y: 100 },
  { id: 2, x: 160, y: 100 },
  { id: 3, x: 40, y: 104 },
  { id: 4, x: 100, y: 40 },
  { id: 5, x: 104, y: 170 },
  { id: 6, x: 400, y: -200 },
]
const middle = spots[0]!

const right = { x: 1, y: 0 }
const left = { x: -1, y: 0 }
const up = { x: 0, y: -1 }
const down = { x: 0, y: 1 }

describe('the song an arrow steps to', () => {
  it('is the nearest one the way it points', () => {
    expect(songToward(spots, middle, right)).toBe(2)
    expect(songToward(spots, middle, left)).toBe(3)
    expect(songToward(spots, middle, up)).toBe(4)
    expect(songToward(spots, middle, down)).toBe(5)
  })

  it('counts one straight ahead nearer than one as close but off to the side', () => {
    const row = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 50, y: 40 },
      { id: 3, x: 70, y: 0 },
    ]
    expect(songToward(row, row[0]!, right)).toBe(3)
  })

  it('takes nothing behind, or so far to the side it is another way', () => {
    const lone = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: -50, y: 0 },
      { id: 3, x: 10, y: 80 },
    ]
    expect(songToward(lone, lone[0]!, right)).toBeNull()
  })

  it('goes on past the edge of the field, for the map to follow', () => {
    expect(songToward(spots, spots[1]!, { x: 1, y: -1 })).toBe(6)
  })
})

describe('the song nearest a point', () => {
  it('is where Tab comes into the map', () => {
    expect(songNearest(spots, { x: 95, y: 110 })).toBe(1)
    expect(songNearest([], { x: 0, y: 0 })).toBeNull()
  })
})

describe('the order a screen reader steps through', () => {
  it('ploughs the map in bands, each song near the one before', () => {
    const grid = [
      { id: 1, x: 0.1, y: 0.1 },
      { id: 2, x: 0.5, y: 0.12 },
      { id: 3, x: 0.9, y: 0.08 },
      { id: 4, x: 0.1, y: 0.5 },
      { id: 5, x: 0.5, y: 0.52 },
      { id: 6, x: 0.9, y: 0.48 },
      { id: 7, x: 0.1, y: 0.9 },
      { id: 8, x: 0.5, y: 0.88 },
      { id: 9, x: 0.9, y: 0.92 },
    ]
    expect(readingOrder(grid)).toEqual([1, 2, 3, 6, 5, 4, 7, 8, 9])
  })

  it('has every song once', () => {
    const many = Array.from({ length: 50 }, (_, id) => ({
      id,
      x: ((id * 37) % 50) / 50,
      y: ((id * 11) % 50) / 50,
    }))
    expect([...readingOrder(many)].sort((a, b) => a - b)).toEqual(many.map(place => place.id))
    expect(readingOrder([])).toEqual([])
  })
})

/** The map's answers to keys pressed one after another, with spots laid out as above. */
function pressAll(keys: readonly FieldKey[], { armed = false, from = NO_FIELD_KEYS } = {}) {
  let state: FieldKeyState = from
  const effects: unknown[] = []
  const handled: boolean[] = []
  const order = readingOrder(spots.map(spot => ({ ...spot })))
  for (const key of keys) {
    const answer = answerKey(state, key, {
      armed,
      toward: (id, direction) =>
        songToward(
          spots,
          spots.find(s => s.id === id)!,
          direction,
        ),
      beside: (id, step) => order[order.indexOf(id) + step] ?? null,
      middle: () => 1,
    })
    state = answer.state
    effects.push(...answer.effects)
    handled.push(answer.handled)
  }
  return { state, effects, handled }
}

const arrow = (direction: { x: number; y: number }): FieldKey => ({ key: 'arrow', direction })

describe('the keys on the map', () => {
  it('leaves the arrows to move the map while no song is chosen', () => {
    const { handled, effects } = pressAll([arrow(right)])
    expect(handled).toEqual([false])
    expect(effects).toEqual([])
  })

  it('chooses the song in the middle with Enter, steps with the arrows, and plays with Enter', () => {
    const { state, effects, handled } = pressAll([{ key: 'enter' }, arrow(right), { key: 'enter' }])
    expect(handled).toEqual([true, true, true])
    expect(effects).toEqual([
      { do: 'choose', id: 1 },
      { do: 'choose', id: 2 },
      { do: 'play', id: 2 },
    ])
    expect(state).toEqual({ chosen: 2, line: null })
  })

  it('stays put, and keeps the key, at the last song that way', () => {
    const { state, effects, handled } = pressAll([arrow(left)], {
      from: { chosen: 3, line: null },
    })
    expect(handled).toEqual([true])
    expect(effects).toEqual([])
    expect(state.chosen).toBe(3)
  })

  it('draws a line through the songs the arrows go to once armed, and ends it with Enter', () => {
    const { state, effects } = pressAll(
      [{ key: 'enter' }, arrow(right), arrow(left), { key: 'enter' }],
      {
        armed: true,
        from: { chosen: 3, line: null },
      },
    )
    expect(effects).toEqual([
      { do: 'lineFrom', id: 3 },
      { do: 'choose', id: 1 },
      { do: 'lineTo', id: 1 },
      { do: 'choose', id: 3 },
      { do: 'lineTo', id: 3 },
      { do: 'lineEnd' },
    ])
    expect(state).toEqual({ chosen: 3, line: null })
  })

  it('stops a line with Escape, then lets go of the song, then leaves Escape to the page', () => {
    const { state, effects, handled } = pressAll(
      [{ key: 'escape' }, { key: 'escape' }, { key: 'escape' }],
      { from: { chosen: 2, line: 1 } },
    )
    expect(handled).toEqual([true, true, false])
    expect(effects).toEqual([{ do: 'lineCancel' }, { do: 'letGo' }])
    expect(state).toEqual(NO_FIELD_KEYS)
  })

  it('zooms with + and −', () => {
    const { effects } = pressAll([{ key: 'in' }, { key: 'out' }])
    expect(effects).toEqual([
      { do: 'zoom', factor: KEY_ZOOM },
      { do: 'zoom', factor: 1 / KEY_ZOOM },
    ])
  })
})

describe('a screen reader’s actions on the map', () => {
  it('steps through the songs in order, starting in the middle', () => {
    const order = readingOrder(spots)
    const { state, effects } = pressAll([{ key: 'next' }, { key: 'next' }, { key: 'previous' }])
    const after = order[order.indexOf(1) + 1]!
    expect(effects).toEqual([
      { do: 'choose', id: 1 },
      { do: 'choose', id: after },
      { do: 'choose', id: 1 },
    ])
    expect(state.chosen).toBe(1)
  })

  it('plays the song in the middle when nothing is chosen yet', () => {
    expect(pressAll([{ key: 'play' }]).effects).toEqual([
      { do: 'choose', id: 1 },
      { do: 'play', id: 1 },
    ])
  })

  it('draws a line from one song straight to another, its steps not part of it', () => {
    const { effects, state } = pressAll([{ key: 'draw' }, { key: 'next' }, { key: 'draw' }], {
      from: { chosen: 1, line: null },
    })
    const after = readingOrder(spots)[readingOrder(spots).indexOf(1) + 1]!
    expect(effects).toEqual([
      { do: 'lineFrom', id: 1 },
      { do: 'choose', id: after },
      { do: 'lineTo', id: after },
      { do: 'lineEnd' },
    ])
    expect(state.line).toBeNull()
  })
})

describe('a screen reader’s action names', () => {
  it('are the keys they stand for', () => {
    expect(actionKey('increment')).toEqual({ key: 'next' })
    expect(actionKey('decrement')).toEqual({ key: 'previous' })
    expect(actionKey('activate')).toEqual({ key: 'play' })
    expect(actionKey('draw')).toEqual({ key: 'draw' })
    expect(actionKey('escape')).toEqual({ key: 'escape' })
    expect(actionKey('magicTap')).toBeNull()
  })
})
