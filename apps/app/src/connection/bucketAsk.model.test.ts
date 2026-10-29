import { describe, expect, it } from 'vitest'
import type { BucketHold } from '@selfmp3/replica'

import { ASK_ON_PLAY_AFTER_MS, ASK_ON_RETURN_AFTER_MS, askBucketNow } from './bucketAsk.model'

/*
 * R2-M9: with the cap raised at backblaze.com, songs not on this device stayed
 * refused for the whole hold unless Try again was pressed. The app asks again
 * by itself at these moments.
 */

const NOW = 10_000_000
const heard = (ago: number): BucketHold => ({
  message: 'used up',
  until: NOW + 60_000,
  heardAt: NOW - ago,
  refusals: 1,
})

describe('when the bucket is asked again before anyone presses Try again', () => {
  it('asks when the page is looked at again, once the hold has stood a while', () => {
    expect(askBucketNow('returned', heard(ASK_ON_RETURN_AFTER_MS), 1, NOW)).toBe(true)
    expect(askBucketNow('returned', heard(ASK_ON_RETURN_AFTER_MS - 1), 1, NOW)).toBe(false)
    // Run out while nobody was looking.
    expect(askBucketNow('returned', null, 2, NOW)).toBe(true)
    expect(askBucketNow('returned', null, 0, NOW)).toBe(false)
  })

  it('lets a song pressed ask, a little after the last refusal', () => {
    expect(askBucketNow('play', heard(ASK_ON_PLAY_AFTER_MS), 3, NOW)).toBe(true)
    expect(askBucketNow('play', heard(ASK_ON_PLAY_AFTER_MS - 1), 3, NOW)).toBe(false)
    expect(askBucketNow('play', null, 0, NOW)).toBe(false)
  })
})
