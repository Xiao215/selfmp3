import { describe, expect, it } from 'vitest'
import {
  LOST_CONNECTION,
  STORAGE_BUSY,
  TOOK_TOO_LONG,
  cannotPlayYet,
  isStorageBusy,
  isUnreachable,
  stoppedOn,
  streamFailureMessage,
} from './streamFailure.model'

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

  // Bug bash R3-M2: the doorman's words for a busy bucket read as a broken song.
  it('says the storage is busy, in its own words, when the bucket asked for fewer requests', () => {
    const body = JSON.stringify({
      error: 's3.us-west-004.backblazeb2.com is busy: Please reduce your request rate. (SlowDown)',
      code: 'bucket_busy',
    })
    const said = streamFailureMessage(502, body, 'phone')
    expect(said).toBe(STORAGE_BUSY)
    expect(isStorageBusy(said)).toBe(true)
    expect(isUnreachable(said)).toBe(false)
    expect(isStorageBusy('This song isn’t on this phone')).toBe(false)
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

describe('the toast when the player stops on a song', () => {
  it('blames the connection, not the song, when nothing answered', () => {
    expect(stoppedOn('第八夜', LOST_CONNECTION)).toBe('Can’t reach your library')
  })

  it('says a song that never came took too long, not that the library is away', () => {
    expect(stoppedOn('第八夜', TOOK_TOO_LONG)).toBe('“第八夜” took too long to load')
  })

  it('blames the storage being busy, not the song, once the player has stopped waiting it out', () => {
    expect(stoppedOn('第八夜', STORAGE_BUSY)).toBe(
      'Your storage is still busy. Press Play to try “第八夜” again',
    )
  })

  it('names the song that would not play otherwise', () => {
    expect(stoppedOn('第八夜', 'This file could not be decoded')).toBe('Couldn’t play “第八夜”')
  })
})

describe('whether the player stops on a failed song rather than skipping on', () => {
  it('stops when nothing answered, or the song never came', () => {
    expect(isUnreachable(LOST_CONNECTION)).toBe(true)
    expect(isUnreachable(TOOK_TOO_LONG)).toBe(true)
  })

  it('skips on past a song that is itself the trouble', () => {
    expect(isUnreachable('This file could not be decoded')).toBe(false)
    expect(isUnreachable(null)).toBe(false)
  })
})
