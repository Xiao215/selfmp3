import { describe, expect, it } from 'vitest'

import {
  energyWavePath,
  formatName,
  sourceName,
  tempoMark,
  tempoWords,
  waveShape,
} from './facts.js'

describe('song facts', () => {
  it('writes a tempo like a metronome marking that never wraps', () => {
    expect(tempoMark(129.6)).toBe('♩ = 130')
  })

  it('names the pace in plain words', () => {
    expect(tempoWords(60)).toBe('slow')
    expect(tempoWords(90)).toBe('relaxed')
    expect(tempoWords(110)).toBe('moderate')
    expect(tempoWords(140)).toBe('fast')
    expect(tempoWords(170)).toBe('very fast')
  })

  it('draws calm low and slow, intense tall and dense', () => {
    const calm = waveShape(0, 12)
    const intense = waveShape(1, 12)
    expect(intense.amplitude).toBeGreaterThan(calm.amplitude)
    expect(intense.cycles).toBeGreaterThan(calm.cycles)
    // Never a flat line: that would read as no data.
    expect(calm.amplitude).toBeGreaterThan(0)
  })

  it('treats nonsense energy as calm rather than throwing', () => {
    expect(waveShape(Number.NaN, 12)).toEqual(waveShape(0, 12))
    expect(waveShape(5, 12)).toEqual(waveShape(1, 12))
  })

  it('samples a path across the whole width', () => {
    const path = energyWavePath(0.5, 22, 12)
    expect(path.startsWith('M0.00 ')).toBe(true)
    expect(path).toContain('L22.00 ')
  })

  it('names formats rather than MIME types', () => {
    expect(formatName('audio/mp4', 'a.m4a')).toBe('AAC (.m4a)')
    expect(formatName('application/x-unknown', 'song.aiff')).toBe('AIFF')
  })

  it('names the source a song came from', () => {
    expect(sourceName('https://music.youtube.com/watch?v=1')).toBe('YouTube Music')
    expect(sourceName('https://www.youtube.com/watch?v=1')).toBe('YouTube')
    expect(sourceName('https://youtu.be/1')).toBe('YouTube')
    expect(sourceName('https://example.com:8080/a')).toBe('example.com')
    expect(sourceName('not a url')).toBe('not a url')
  })
})
