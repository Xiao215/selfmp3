import { describe, expect, it } from 'vitest'

import {
  createLayerCache,
  DISC_SHADOW,
  flashLift,
  layersKey,
  shadowSprite,
} from './visualLayers.model'
import type { VisualColors } from './visuals.model'

const colors: VisualColors = {
  inks: [
    [200, 120, 90],
    [90, 140, 220],
    [240, 220, 180],
  ],
  ground: [
    [30, 24, 40],
    [12, 10, 18],
  ],
}

const size = { width: 1440, height: 900, dpr: 2 }

describe('what the kept layers are a picture of', () => {
  it('is the same for the same size and the same colours, even in a new object', () => {
    const copy: VisualColors = {
      inks: [[...colors.inks[0]], [...colors.inks[1]], [...colors.inks[2]]],
      ground: [[...colors.ground[0]], [...colors.ground[1]]],
    }
    expect(layersKey({ ...size }, copy)).toBe(layersKey(size, colors))
  })

  it('changes with the size, the density, and every colour the layers are painted in', () => {
    const key = layersKey(size, colors)
    expect(layersKey({ ...size, width: 1441 }, colors)).not.toBe(key)
    expect(layersKey({ ...size, height: 899 }, colors)).not.toBe(key)
    expect(layersKey({ ...size, dpr: 1 }, colors)).not.toBe(key)
    expect(layersKey(size, { ...colors, ground: [[31, 24, 40], colors.ground[1]] })).not.toBe(key)
    expect(layersKey(size, { ...colors, ground: [colors.ground[0], [12, 10, 19]] })).not.toBe(key)
    expect(
      layersKey(size, { ...colors, inks: [[201, 120, 90], colors.inks[1], colors.inks[2]] }),
    ).not.toBe(key)
    expect(
      layersKey(size, { ...colors, inks: [colors.inks[0], [90, 141, 220], colors.inks[2]] }),
    ).not.toBe(key)
  })

  it('leaves out the disc, which is drawn every frame, and a difference no canvas can draw', () => {
    const key = layersKey(size, colors)
    expect(layersKey(size, { ...colors, inks: [colors.inks[0], colors.inks[1], [0, 0, 0]] })).toBe(
      key,
    )
    expect(layersKey(size, { ...colors, ground: [[30.2, 24, 40], colors.ground[1]] })).toBe(key)
  })
})

describe('holding one set of layers', () => {
  it('makes a set once per key, and lets the old one go before making the next', () => {
    const events: string[] = []
    const cache = createLayerCache<string>(layers => events.push(`free ${layers}`))
    const make = (name: string) => () => {
      events.push(`make ${name}`)
      return name
    }
    expect(cache.get('a', make('A'))).toBe('A')
    expect(cache.get('a', make('A again'))).toBe('A')
    expect(cache.get('b', make('B'))).toBe('B')
    expect(events).toEqual(['make A', 'free A', 'make B'])
  })

  it('lets go of what it holds when released, and makes it again if asked after', () => {
    const freed: string[] = []
    const cache = createLayerCache<string>(layers => freed.push(layers))
    cache.get('a', () => 'A')
    cache.release()
    cache.release()
    expect(freed).toEqual(['A'])
    expect(cache.get('a', () => 'A2')).toBe('A2')
  })
})

describe("the shadow's own canvas", () => {
  it('fits the disc and the whole of the blur and the drop, in canvas pixels', () => {
    const { side, half } = shadowSprite(225, 2)
    const room = (side - 450 * 2) / 2
    expect(room).toBeGreaterThanOrEqual(DISC_SHADOW.blur * 1.5 + DISC_SHADOW.offsetY)
    expect(half).toBe(side / 4)
  })

  it('keeps the same room at any density, because a canvas shadow ignores the transform', () => {
    const one = shadowSprite(100, 1)
    const two = shadowSprite(100, 2)
    expect(two.side - 400).toBe(one.side - 200)
  })
})

describe('the flash', () => {
  it('lifts the middle by up to 5%, as it lightened the ground', () => {
    expect(flashLift(1)).toBeCloseTo(0.05)
    expect(flashLift(0.5)).toBeCloseTo(0.025)
  })

  it('is nothing when it would not move a pixel', () => {
    expect(flashLift(0)).toBe(0)
    expect(flashLift(0.03)).toBe(0)
    expect(flashLift(-1)).toBe(0)
    expect(flashLift(0.05)).toBeGreaterThan(0)
  })
})
