import { describe, expect, it } from 'vitest'
import { isResting, REST_DAYS, restUntilFrom } from './rest.js'

const NOW = Date.parse('2026-10-25T12:00:00.000Z')

describe('a resting song', () => {
  it('rests for a month from now', () => {
    expect(restUntilFrom(NOW)).toBe('2026-11-24T12:00:00.000Z')
    expect(REST_DAYS).toBe(30)
  })

  it('rests until its time, and wakes by itself after', () => {
    const song = { restUntil: restUntilFrom(NOW) }
    expect(isResting(song, NOW)).toBe(true)
    expect(isResting(song, Date.parse('2026-11-24T12:00:00.001Z'))).toBe(false)
  })

  it('is awake with no time, or one that will not read', () => {
    expect(isResting({ restUntil: null }, NOW)).toBe(false)
    expect(isResting({ restUntil: 'soon' }, NOW)).toBe(false)
  })
})
