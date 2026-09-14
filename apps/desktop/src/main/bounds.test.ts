import { describe, expect, it } from 'vitest'

import { onSomeDisplay, type Bounds } from './bounds.js'

/**
 * The rule that decides whether a remembered window is still somewhere a person
 * can reach it. Tested rather than trusted: getting it wrong means an app that
 * opens off-screen, which looks exactly like an app that failed to start, and
 * it only happens to someone who unplugged a monitor — so nobody would find it.
 */
const laptop = { workArea: { x: 0, y: 0, width: 1512, height: 916 } } as Electron.Display
const toTheRight = { workArea: { x: 1512, y: 0, width: 2560, height: 1440 } } as Electron.Display

const at = (x: number, y: number): Bounds => ({ x, y, width: 1280, height: 800 })

describe('onSomeDisplay', () => {
  it('takes a window sitting on the only display there is', () => {
    expect(onSomeDisplay(at(100, 100), [laptop])).toBe(true)
  })

  it('takes one on a second display, and refuses it once that is unplugged', () => {
    expect(onSomeDisplay(at(1800, 200), [laptop, toTheRight])).toBe(true)
    expect(onSomeDisplay(at(1800, 200), [laptop])).toBe(false)
  })

  it('refuses a window whose title bar is above the screen', () => {
    // Dragged up under the menu bar on the display it was on, then remembered.
    expect(onSomeDisplay(at(100, -400), [laptop])).toBe(false)
  })

  it('refuses one hanging off the side by all but a sliver', () => {
    expect(onSomeDisplay(at(1470, 100), [laptop])).toBe(false)
    expect(onSomeDisplay(at(1400, 100), [laptop])).toBe(true)
  })

  it('takes one that straddles two displays', () => {
    expect(onSomeDisplay(at(1400, 100), [laptop, toTheRight])).toBe(true)
  })

  it('refuses everything when nothing is plugged in', () => {
    expect(onSomeDisplay(at(0, 0), [])).toBe(false)
  })
})
