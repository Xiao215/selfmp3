import { BUCKET_HOLD_MS, DOORMAN_PATHS } from '@selfmp3/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DOORMAN_ORIGIN, harness, type Harness } from '../../../doorman/src/fakes.js'
import { handleAppScheme } from './protocol.js'
import { createStreamProxy, type StreamProxy } from './stream.js'

/*
 * A bucket song the desktop has not downloaded, played through
 * `app://selfmp3/_stream/<key>`: the shell's real scheme handler and stream
 * proxy, in front of the real doorman (apps/doorman, its own test harness)
 * and the harness's look-alike bucket. Faked is only what is outside: Electron's
 * `protocol`, which hands the handler its requests, and the bucket.
 */

const fake = vi.hoisted(() => ({
  handler: null as ((request: Request) => Promise<Response>) | null,
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/nowhere' },
  net: { fetch: () => Promise.reject(new Error('not this one')) },
  shell: {},
  protocol: {
    handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => {
      fake.handler = handler
    },
  },
}))

const SHA = 'cd'.repeat(32)
const SONG = `audio/${SHA}.m4a`
/** A song's bytes: 0, 1, 2… so any slice says where it came from. */
const BYTES = Uint8Array.from({ length: 1000 }, (_, index) => index % 256)

let h: Harness
let token: string
let stream: StreamProxy
const capped: string[] = []
let clock = 0

/** As the window's `<audio>` element asks: from the app's own origin, perhaps with a range. */
function play(key: string, init: { range?: string; method?: string } = {}): Promise<Response> {
  const headers = new Headers({ Origin: 'app://selfmp3' })
  if (init.range) headers.set('Range', init.range)
  return fake.handler!(
    new Request(`app://selfmp3/_stream/${key}`, { method: init.method ?? 'GET', headers }),
  )
}

beforeEach(async () => {
  h = harness()
  token = await h.signIn()
  expect((await h.connect(token)).status).toBe(200)
  h.bucket.put(`selfmp3/${SONG}`, BYTES, { contentType: 'audio/mp4' })
  capped.length = 0
  clock = Date.parse('2026-10-14T12:00:00Z')
  stream = createStreamProxy({
    fetch: (url, init) => h.doorman.fetch(new Request(url, init), h.env),
    onCapped: message => capped.push(message),
    now: () => clock,
  })
  handleAppScheme({ web: '/nowhere', devOrigin: null, stream })
  stream.use({ doormanUrl: DOORMAN_ORIGIN, token })
})

/** The bucket's own requests, without the ones signing in and connecting made. */
function bucketReads(): number {
  return h.bucket.requests.filter(request => request.method === 'GET').length
}

describe('streaming a bucket song on the desktop', () => {
  it('plays the whole song, with the doorman’s headers and the app’s CORS pair', async () => {
    const response = await play(SONG)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mp4')
    expect(response.headers.get('content-length')).toBe('1000')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('access-control-allow-origin')).toBe('app://selfmp3')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
  })

  it('seeks: a range comes back as the doorman’s 206, and only that range is fetched', async () => {
    const response = await play(SONG, { range: 'bytes=500-599' })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 500-599/1000')
    expect(response.headers.get('content-length')).toBe('100')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES.slice(500, 600))
    expect(h.bucket.requests.at(-1)?.headers.get('range')).toBe('bytes=500-599')

    // Safari's two-byte look, and an open-ended one from part-way.
    const look = await play(SONG, { range: 'bytes=0-1' })
    expect(look.status).toBe(206)
    expect(look.headers.get('content-range')).toBe('bytes 0-1/1000')
    const rest = await play(SONG, { range: 'bytes=990-' })
    expect(new Uint8Array(await rest.arrayBuffer())).toEqual(BYTES.slice(990))
  })

  it('says a range past the end is not in the file', async () => {
    const response = await play(SONG, { range: 'bytes=5000-' })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */1000')
  })

  it('answers a HEAD with the size and no body', async () => {
    const response = await play(SONG, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('1000')
    expect(await response.text()).toBe('')
  })

  it('sends the doorman’s refusal back when the session is over, for the player to explain', async () => {
    const out = await h.call(DOORMAN_PATHS.signOut, { method: 'POST', token })
    expect(out.ok).toBe(true)

    const response = await play(SONG, { range: 'bytes=0-1' })
    expect(response.status).toBe(401)
    expect(response.headers.get('access-control-allow-origin')).toBe('app://selfmp3')
    expect((await response.json()) as unknown).toMatchObject({ code: 'unauthorized' })
  })

  it('asks nothing once signed out', async () => {
    stream.use(null)
    const before = h.bucket.requests.length
    const response = await play(SONG)
    expect(response.status).toBe(401)
    expect(h.bucket.requests.length).toBe(before)
  })

  it('holds off for the day’s cap, tells the page, and asks once more when the hold is up', async () => {
    h.bucket.capped = true
    const first = await play(SONG, { range: 'bytes=0-1' })
    expect(first.status).toBe(502)
    const refusal = (await first.json()) as { code: string; error: string }
    expect(refusal.code).toBe('bucket_cap_exceeded')
    expect(capped).toEqual([refusal.error])

    // Every range the player wants meanwhile is answered from here.
    const reads = bucketReads()
    const again = await play(SONG, { range: 'bytes=500-' })
    expect(again.status).toBe(502)
    expect(((await again.json()) as { code: string }).code).toBe('bucket_cap_exceeded')
    expect(bucketReads()).toBe(reads)

    // A cap raised at backblaze.com is noticed without waiting for midnight.
    h.bucket.capped = false
    clock += BUCKET_HOLD_MS + 1
    const after = await play(SONG, { range: 'bytes=0-1' })
    expect(after.status).toBe(206)
    expect(capped).toHaveLength(1)
  })

  it('lets a new session ask straight away: another sign-in may be another bucket', async () => {
    h.bucket.capped = true
    expect((await play(SONG)).status).toBe(502)
    h.bucket.capped = false
    const other = await h.signIn({ sub: '2', email: 'friend@example.com' })
    expect((await h.connect(other)).status).toBe(200)
    stream.use({ doormanUrl: DOORMAN_ORIGIN, token: other })
    expect((await play(SONG, { range: 'bytes=0-1' })).status).toBe(206)
  })

  it('says the storage cannot be reached when the doorman does not answer', async () => {
    const offline = createStreamProxy({
      fetch: () => Promise.reject(new TypeError('fetch failed')),
      onCapped: () => {},
    })
    offline.use({ doormanUrl: DOORMAN_ORIGIN, token })
    const response = await offline.serve(new Request(`app://selfmp3/_stream/${SONG}`), SONG, 'x')
    expect(response.status).toBe(503)
  })

  it('reads only what a device may: a key the doorman would not serve is not asked for', async () => {
    const before = h.bucket.requests.length
    for (const key of ['secrets.json', `notes/${SHA}.m4a`, `audio/${SHA}.m4a/extra`]) {
      expect((await play(key)).status).toBe(404)
    }
    expect(h.bucket.requests.length).toBe(before)
  })

  it('never names an origin the page is not served from', async () => {
    const response = await fake.handler!(
      new Request(`app://selfmp3/_stream/${SONG}`, {
        headers: { Origin: 'https://evil.example', Range: 'bytes=0-1' },
      }),
    )
    expect(response.headers.get('access-control-allow-origin')).toBe('app://selfmp3')
  })
})
