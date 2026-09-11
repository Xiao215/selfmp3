import { describe, expect, it } from 'vitest'
import { energyWavePath, waveShape } from './energyWave.js'

describe('waveShape', () => {
  it('grows taller and denser with energy, with no steps in between', () => {
    const values = [0, 0.14, 0.34, 0.55, 0.62, 0.66, 0.92, 1]
    const shapes = values.map(energy => waveShape(energy, 12))
    for (let i = 1; i < shapes.length; i++) {
      expect(shapes[i]!.amplitude).toBeGreaterThan(shapes[i - 1]!.amplitude)
      expect(shapes[i]!.cycles).toBeGreaterThan(shapes[i - 1]!.cycles)
    }
  })

  it('never draws a flat line, and never draws past the edge', () => {
    expect(waveShape(0, 12).amplitude).toBeGreaterThan(0.5)
    // Half the height, minus half the stroke: the peaks stay inside the box.
    expect(waveShape(1, 12).amplitude).toBeLessThanOrEqual(12 / 2 - 0.75)
  })

  it('treats out-of-range and missing values as the nearest edge', () => {
    expect(waveShape(1.7, 12)).toEqual(waveShape(1, 12))
    expect(waveShape(-3, 12)).toEqual(waveShape(0, 12))
    expect(waveShape(Number.NaN, 12)).toEqual(waveShape(0, 12))
  })
})

describe('energyWavePath', () => {
  it('starts on the centre line at the left edge and ends at the right edge', () => {
    const path = energyWavePath(0.5, 22, 12)
    expect(path.startsWith('M0.00 6.00')).toBe(true)
    expect(path).toMatch(/L22\.00 [\d.]+$/)
  })

  it('stays inside the drawing', () => {
    const ys = [...energyWavePath(1, 22, 12).matchAll(/[ML][\d.]+ ([\d.]+)/g)].map(match =>
      Number(match[1]),
    )
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(12)
  })
})
