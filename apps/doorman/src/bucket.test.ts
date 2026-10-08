import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bucket, type Fetch } from './bucket.js'
import { APPLICATION_KEY, B2_HOST, BUCKET, FakeBucket, KEY_ID } from './fakes.js'

/**
 * The day's signing key, handed to aws4fetch rather than derived by it.
 *
 * aws4fetch looks a key up in the map it is given under a string it builds
 * itself, from the application key, the date, the region and the service —
 * its own format, not a documented one. `Bucket` builds the same string. If a
 * new aws4fetch builds it differently, every request still signs correctly,
 * because aws4fetch quietly derives the key again; only the cost comes back,
 * four HMACs a request. So what is counted here is HMACs, around a bucket the
 * fake checks every signature on.
 */

const DAY = Date.UTC(2026, 9, 7, 12)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('signing keys', () => {
  it('derives the day’s key once, and aws4fetch takes it rather than deriving its own', async () => {
    const fake = new FakeBucket()
    fake.put('selfmp3/format.json', '{}')

    // HMACs made while signing, not while the fake checks the signature.
    let counting = true
    let hmacs = 0
    const sign = crypto.subtle.sign.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'sign').mockImplementation((algorithm, key, data) => {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name
      if (counting && name === 'HMAC') hmacs += 1
      return sign(algorithm, key, data)
    })
    const fetch: Fetch = async (url, init) => {
      counting = false
      try {
        return await fake.handle(new Request(url, init))
      } finally {
        counting = true
      }
    }

    const bucket = new Bucket(
      {
        endpoint: `https://${B2_HOST}`,
        region: 'us-west-004',
        bucket: BUCKET,
        prefix: 'selfmp3',
        keyId: KEY_ID,
        applicationKey: APPLICATION_KEY,
      },
      { fetch, now: () => DAY, signingKeys: new Map() },
    )

    // The first request derives the key (four HMACs) and signs (one more).
    expect(await bucket.exists('format.json')).toBe(true)
    expect(hmacs).toBe(5)

    // The second, the same day, only signs. Five here means aws4fetch missed
    // the key it was handed and derived it again.
    hmacs = 0
    expect(await bucket.exists('format.json')).toBe(true)
    expect(hmacs).toBe(1)

    expect(fake.requests).toHaveLength(2)
  })
})
