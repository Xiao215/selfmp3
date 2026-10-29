import { afterEach, describe, expect, it } from 'vitest'
import { closeLayer, openLayer } from '../../shell/layers'
import { guidesWait, holdGuides, setFingers, setTyping, subscribeBusy } from './guideBusy'

/** Back to still: every hand these tests use let go. */
function still(): void {
  setFingers(0)
  setTyping(false)
  for (const name of ['row', 'a', 'b']) holdGuides(name, false)
}

afterEach(still)

describe('whether the guides wait', () => {
  it('not when nothing is going on', () => {
    expect(guidesWait()).toBe(false)
  })

  it('while a finger is down, a hold is under way, or a field has the keys', () => {
    setFingers(1)
    expect(guidesWait()).toBe(true)
    setFingers(0)
    holdGuides('row', true)
    expect(guidesWait()).toBe(true)
    holdGuides('row', false)
    setTyping(true)
    expect(guidesWait()).toBe(true)
    setTyping(false)
    expect(guidesWait()).toBe(false)
  })

  it('until every hold has ended', () => {
    holdGuides('a', true)
    holdGuides('b', true)
    holdGuides('a', false)
    expect(guidesWait()).toBe(true)
    holdGuides('b', false)
    expect(guidesWait()).toBe(false)
  })

  it('for a layer over the screen, but not the one the screen is drawn in', () => {
    openLayer('sheet')
    expect(guidesWait()).toBe(true)
    expect(guidesWait(1)).toBe(false)
    openLayer('menu')
    expect(guidesWait(1)).toBe(true)
    closeLayer('menu')
    closeLayer('sheet')
    expect(guidesWait()).toBe(false)
  })

  it('tells a waiting guide when any of it changes, and only then', () => {
    let told = 0
    const stop = subscribeBusy(() => {
      told += 1
    })
    setFingers(1)
    setFingers(1)
    holdGuides('row', true)
    openLayer('menu')
    closeLayer('menu')
    stop()
    setFingers(0)
    expect(told).toBe(4)
  })
})
