import { describe, expect, it } from 'vitest'
import {
  boxMoved,
  fingersLeft,
  hasSeen,
  holeAround,
  layerPath,
  parseSeen,
  placeWords,
  stepAfter,
  takesTyping,
  withSeen,
  writeSeen,
} from './guide.model'

describe('what a device remembers of its guides', () => {
  it('starts with none seen', () => {
    expect(hasSeen(parseSeen(null), 'lyrics')).toBe(false)
  })

  it('keeps the names it was given and adds new ones once', () => {
    const seen = withSeen(withSeen(parseSeen('lyrics'), 'tag-hold'), 'lyrics')
    expect(writeSeen(seen)).toBe('lyrics,tag-hold')
    expect(hasSeen(parseSeen(writeSeen(seen)), 'tag-hold')).toBe(true)
  })

  it('reads * as every guide seen, and keeps it that way', () => {
    const seen = parseSeen('*')
    expect(hasSeen(seen, 'import-box')).toBe(true)
    expect(writeSeen(withSeen(seen, 'lyrics'))).toBe('*')
  })

  it('reads an empty memory as none seen, as "Show tips again" leaves it', () => {
    expect(hasSeen(parseSeen(''), 'lyrics')).toBe(false)
  })
})

describe('the spotlight', () => {
  const screen = { width: 390, height: 844 }

  it('stands off what it lights and stays on the screen', () => {
    expect(holeAround({ x: 0, y: 100, width: 390, height: 56 }, screen)).toEqual({
      x: 4,
      y: 94,
      width: 382,
      height: 68,
    })
  })

  it('is cut out of a path that covers the screen', () => {
    const path = layerPath(screen, { x: 10, y: 20, width: 100, height: 50 }, 12)
    expect(path.startsWith('M0 0H390V844H0Z')).toBe(true)
    expect(path).toContain('M22 20H98')
  })

  it('puts the words under a spotlight with room below it', () => {
    expect(placeWords({ x: 4, y: 120, width: 382, height: 68 }, screen)).toEqual({
      kind: 'below',
      top: 216,
      left: 25,
      width: 340,
    })
  })

  it('puts them over a spotlight near the bottom', () => {
    expect(placeWords({ x: 4, y: 740, width: 382, height: 68 }, screen).kind).toBe('above')
  })

  it('puts them beside a narrow column on a wide screen', () => {
    expect(
      placeWords({ x: 8, y: 300, width: 220, height: 120 }, { width: 1280, height: 860 }),
    ).toEqual({
      kind: 'beside',
      left: 264,
      top: 308,
      width: 340,
    })
  })

  it('keeps words under a spotlight at the right edge on the screen', () => {
    const place = placeWords(
      { x: 1000, y: 140, width: 270, height: 56 },
      { width: 1280, height: 860 },
    )
    expect(place).toMatchObject({ kind: 'below', left: 924, width: 340 })
  })
})

describe('the steps of a guide', () => {
  it('moves on, then closes after the last', () => {
    expect(stepAfter(0, 2)).toBe(1)
    expect(stepAfter(1, 2)).toBe(-1)
    expect(stepAfter(0, 1)).toBe(-1)
  })

  it('stays closed once closed: a tap as it fades does not start it again', () => {
    expect(stepAfter(-1, 2)).toBe(-1)
  })
})

describe('following what a guide lights', () => {
  const box = { x: 10, y: 100, width: 300, height: 60 }

  it('follows a move or a change of size', () => {
    expect(boxMoved(box, { ...box, y: 130 })).toBe(true)
    expect(boxMoved(box, { ...box, height: 120 })).toBe(true)
  })

  it('stays put for less than a point, so the spotlight does not shiver', () => {
    expect(boxMoved(box, { ...box, x: 10.3, y: 100.4 })).toBe(false)
  })
})

describe('how many fingers are down', () => {
  it('leaves out the finger this touch lifted, wherever the platform counts it', () => {
    expect(fingersLeft([{ identifier: 1 }], [{ identifier: 1 }])).toBe(0)
    expect(fingersLeft([], [{ identifier: 1 }])).toBe(0)
    expect(fingersLeft([{ identifier: 1 }, { identifier: 2 }], [{ identifier: 2 }])).toBe(1)
  })
})

describe('what is typed in', () => {
  it('is a text box, a text area, or something editable', () => {
    expect(takesTyping({ tagName: 'TEXTAREA' })).toBe(true)
    expect(takesTyping({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(takesTyping({ tagName: 'input', type: 'url' })).toBe(true)
    expect(takesTyping({ tagName: 'INPUT' })).toBe(true)
    expect(takesTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('is not a button, a box to tick, or nothing', () => {
    expect(takesTyping({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(takesTyping({ tagName: 'DIV' })).toBe(false)
    expect(takesTyping(null)).toBe(false)
  })
})
