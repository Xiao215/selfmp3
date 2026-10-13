import { describe, expect, it } from 'vitest'
import { cannotPlayYet, streamFailureMessage } from './streamFailure.model'

describe('why a song would not play', () => {
  it("repeats the doorman's reason, which is the bucket's", () => {
    const body = JSON.stringify({
      error:
        'Backblaze says “Transaction cap exceeded”: the bucket’s allowance for today is used up.',
      code: 'bucket_cap_exceeded',
    })
    expect(streamFailureMessage(502, body, 'computer')).toBe(
      'Backblaze says “Transaction cap exceeded”: the bucket’s allowance for today is used up.',
    )
  })

  it('says a song the service worker has no way to fetch is not on this device', () => {
    expect(streamFailureMessage(503, 'This song is not available offline.', 'phone')).toBe(
      'This song isn’t on this phone',
    )
    expect(
      streamFailureMessage(
        503,
        'This song is not on this device, and the cloud cannot be reached.',
        'computer',
      ),
    ).toBe('This song isn’t on this computer')
  })

  it('names a song it cannot play, when it knows the name', () => {
    expect(cannotPlayYet('Evening', 'phone')).toBe('“Evening” can’t be played on this phone yet.')
    expect(cannotPlayYet(undefined, 'computer')).toBe(
      'This song can’t be played on this computer yet.',
    )
  })

  it('falls back to a plain answer for a page, nothing, or an answer that is not words', () => {
    expect(streamFailureMessage(404, '', 'phone')).toBe('This song isn’t on this phone')
    expect(streamFailureMessage(502, '<html>Bad gateway</html>', 'phone')).toBe(
      'Could not play this song',
    )
    expect(streamFailureMessage(500, '{"code":"internal"}', 'phone')).toBe(
      'Could not play this song',
    )
  })
})
