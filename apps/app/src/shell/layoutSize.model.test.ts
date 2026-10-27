import { describe, expect, it } from 'vitest'

import { createLayoutSize } from './layoutSize.model'

const PORTRAIT = { width: 834, height: 1210 }
const LANDSCAPE = { width: 1210, height: 834 }

describe('the size the app lays out by', () => {
  it('turns with the window at once, width and shape together, before the root has measured', () => {
    const layout = createLayoutSize(PORTRAIT)
    layout.root(PORTRAIT)

    layout.window(LANDSCAPE)
    expect(layout.size.get()).toEqual(LANDSCAPE)

    // The root's measure, a second later, says the same.
    layout.root(LANDSCAPE)
    expect(layout.size.get()).toEqual(LANDSCAPE)
  })

  it("is the root's in Split View, where the window goes on saying the whole screen", () => {
    const layout = createLayoutSize(LANDSCAPE)
    layout.root({ width: 694, height: 834 })
    expect(layout.size.get()).toEqual({ width: 694, height: 834 })

    // The text size changing reports the window again, unchanged: not a new size.
    layout.window(LANDSCAPE)
    expect(layout.size.get()).toEqual({ width: 694, height: 834 })
  })

  it('takes no size from a view still being laid out', () => {
    const layout = createLayoutSize(PORTRAIT)
    layout.root({ width: 0, height: 1210 })
    expect(layout.size.get()).toEqual(PORTRAIT)
  })

  it('wakes nobody for a size it already has', () => {
    const layout = createLayoutSize(PORTRAIT)
    let told = 0
    layout.size.subscribe(() => (told += 1))
    layout.root({ width: 834.2, height: 1209.8 })
    layout.window(PORTRAIT)
    expect(told).toBe(0)
  })
})
