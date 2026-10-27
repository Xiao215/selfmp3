import { describe, expect, it } from 'vitest'
import {
  baseOf,
  between,
  boundsOf,
  centredOn,
  fitView,
  keptClear,
  MAX_SCALE,
  tileSide,
  toMap,
  toScreen,
  zoomAt,
} from './soundMapView.model'

describe('the sound map’s view', () => {
  const field = { width: 1000, height: 600 }
  const base = baseOf(field)

  it('fits where the songs are to the field, centred', () => {
    const bounds = boundsOf([
      { x: 0.2, y: 0.4 },
      { x: 0.8, y: 0.6 },
    ])
    const view = fitView(field, bounds)
    const left = toScreen(view, base, { x: 0.2, y: 0.5 })
    const right = toScreen(view, base, { x: 0.8, y: 0.5 })
    // A wide map fills the width, less the inset, and sits in the middle.
    expect(right.x - left.x).toBeCloseTo(1000 - 32, 5)
    expect((left.x + right.x) / 2).toBeCloseTo(500, 5)
    expect(toScreen(view, base, { x: 0.5, y: 0.5 }).y).toBeCloseTo(300, 5)
  })

  it('zooms about the point under the pointer, within limits', () => {
    const view = fitView(field)
    const point = { x: 640, y: 210 }
    const under = toMap(view, base, point)
    const zoomed = zoomAt(view, 3, point)
    expect(zoomed.scale).toBeCloseTo(view.scale * 3, 5)
    const after = toScreen(zoomed, base, under)
    expect(after.x).toBeCloseTo(point.x, 5)
    expect(after.y).toBeCloseTo(point.y, 5)
    expect(zoomAt(view, 1000, point).scale).toBe(MAX_SCALE)
  })

  it('stands a wide map up on a tall field, and finds the same song under a finger', () => {
    const tall = { width: 390, height: 700 }
    const tallBase = baseOf(tall)
    const view = fitView(tall, { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.6 })
    expect(view.turned).toBe(true)
    const left = toScreen(view, tallBase, { x: 0.1, y: 0.5 })
    const right = toScreen(view, tallBase, { x: 0.9, y: 0.5 })
    // The map's left and right ends are now its top and bottom.
    expect(Math.abs(right.y - left.y)).toBeGreaterThan(Math.abs(right.x - left.x))
    const place = { x: 0.3, y: 0.55 }
    const back = toMap(view, tallBase, toScreen(view, tallBase, place))
    expect(back.x).toBeCloseTo(place.x, 6)
    expect(back.y).toBeCloseTo(place.y, 6)
    expect(fitView(field, { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.6 }).turned).toBe(false)
  })

  it('grows tiles more slowly than it spreads the songs', () => {
    expect(tileSide(1)).toBe(8)
    expect(tileSide(8)).toBeGreaterThan(tileSide(1) * 2)
    expect(tileSide(8)).toBeLessThan(tileSide(1) * 8)
  })

  it('fits clear of what the page lays over the field, and keeps a turned map turned', () => {
    const tall = { width: 400, height: 800 }
    const bounds = { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.6 }
    const view = fitView(tall, bounds, { insets: { top: 120, bottom: 200, right: 0 } })
    const tallBase = baseOf(tall)
    const middle = toScreen(view, tallBase, { x: 0.5, y: 0.5 })
    expect(middle.y).toBeCloseTo(120 + (800 - 120 - 200) / 2, 5)
    expect(fitView(tall, bounds, { turned: false }).turned).toBe(false)
  })

  it('centres a song in what is left clear, and flies there in a straight line', () => {
    const start = fitView(field)
    const song = { x: 0.7, y: 0.3 }
    const there = centredOn(start, field, song, 6, { top: 100, bottom: 0, right: 0 })
    const at = toScreen(there, base, song)
    expect(at.x).toBeCloseTo(500, 5)
    expect(at.y).toBeCloseTo(100 + 250, 5)
    expect(there.scale).toBe(6)
    expect(between(start, there, 0, field)).toMatchObject({ scale: start.scale })
    const done = between(start, there, 1, field)
    expect(done.scale).toBeCloseTo(6, 5)
    // Halfway, the scale is halfway on its logarithm.
    expect(between(start, there, 0.5, field).scale).toBeCloseTo(Math.sqrt(start.scale * 6), 5)
  })

  it('fits and centres beside a panel down the right', () => {
    const view = fitView(field, undefined, { insets: { top: 0, bottom: 0, right: 400 } })
    expect(toScreen(view, base, { x: 0.5, y: 0.5 }).x).toBeCloseTo((field.width - 400) / 2, 5)
    const there = centredOn(view, field, { x: 0.2, y: 0.2 }, 4, { top: 0, bottom: 0, right: 400 })
    expect(toScreen(there, base, { x: 0.2, y: 0.2 }).x).toBeCloseTo((field.width - 400) / 2, 5)
  })

  it('slides a stroke out from under the panel, and leaves one already clear', () => {
    const view = fitView(field)
    const insets = { top: 0, bottom: 0, right: 400 }
    const under = [
      toMap(view, base, { x: field.width - 300, y: 300 }),
      toMap(view, base, { x: field.width - 200, y: 400 }),
    ]
    const moved = keptClear(view, field, under, insets)
    expect(moved).not.toBeNull()
    expect(moved!.scale).toBe(view.scale)
    expect(toScreen(moved!, base, under[1]!).x).toBeCloseTo(field.width - 400 - 24, 5)
    const clear = [toMap(view, base, { x: 100, y: 300 }), toMap(view, base, { x: 200, y: 350 })]
    expect(keptClear(view, field, clear, insets)).toBeNull()
  })
})
