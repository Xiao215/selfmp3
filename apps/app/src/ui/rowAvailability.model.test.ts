import { describe, expect, it } from 'vitest'

import { rowAvailability } from './rowAvailability.model'

const phone = { installed: true, streamBlocked: false, libraryUnreachable: false }
const browser = { installed: false, streamBlocked: false, libraryUnreachable: false }

describe('whether a row can play here', () => {
  it('marks only a song that is kept here', () => {
    expect(rowAvailability(true, phone)).toEqual({ downloaded: true, unavailable: false })
    expect(rowAvailability(false, phone)).toEqual({ downloaded: false, unavailable: false })
    expect(rowAvailability(false, browser)).toEqual({ downloaded: false, unavailable: false })
  })

  it('fades a song that is not here when the bucket cannot be read', () => {
    expect(rowAvailability(false, { ...phone, streamBlocked: true }).unavailable).toBe(true)
    expect(rowAvailability(true, { ...phone, streamBlocked: true }).unavailable).toBe(false)
  })

  it('does not fade a song a browser kept for having played it', () => {
    const capped = { ...browser, streamBlocked: true }
    expect(rowAvailability(false, capped).unavailable).toBe(true)
    expect(rowAvailability(false, capped, true)).toEqual({ downloaded: false, unavailable: false })
  })

  // Up next knew only the bucket's side: a phone whose server was away faded
  // nothing there, while Library faded the same song.
  it('fades a song that is not here when the server is away, on an installed app', () => {
    expect(rowAvailability(false, { ...phone, libraryUnreachable: true }).unavailable).toBe(true)
    expect(rowAvailability(true, { ...phone, libraryUnreachable: true }).unavailable).toBe(false)
    expect(rowAvailability(false, { ...browser, libraryUnreachable: true }).unavailable).toBe(false)
  })
})
