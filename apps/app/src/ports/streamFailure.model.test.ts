import { describe, expect, it } from 'vitest'
import { streamFailureMessage } from './streamFailure.model'

describe('why a song would not play', () => {
  it("repeats the doorman's reason, which is the bucket's", () => {
    const body = JSON.stringify({
      error:
        'Backblaze says “Transaction cap exceeded”: the bucket’s allowance for today is used up.',
      code: 'bucket_cap_exceeded',
    })
    expect(streamFailureMessage(502, body)).toBe(
      'Backblaze says “Transaction cap exceeded”: the bucket’s allowance for today is used up.',
    )
  })

  it("repeats the service worker's words for a song it has no way to fetch", () => {
    expect(streamFailureMessage(503, 'This song is not available offline.')).toBe(
      'This song is not available offline',
    )
    expect(
      streamFailureMessage(
        503,
        'This song is not on this device, and the cloud cannot be reached.',
      ),
    ).toBe('This song is not on this device, and the cloud cannot be reached')
  })

  it('falls back to a plain answer for a page, nothing, or an answer that is not words', () => {
    expect(streamFailureMessage(404, '')).toBe('This song is not available offline')
    expect(streamFailureMessage(502, '<html>Bad gateway</html>')).toBe('Could not play this song')
    expect(streamFailureMessage(500, '{"code":"internal"}')).toBe('Could not play this song')
  })
})
