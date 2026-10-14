import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUCKET_HOLD_MS, DOORMAN_PATHS, PLAYED_KEPT, WAIT_AHEAD_BYTES } from '@selfmp3/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DOORMAN_ORIGIN, harness, type Harness } from '../../../doorman/src/fakes.js'
import { handleAppScheme } from './protocol.js'
import { createStreamProxy, type StreamProxy } from './stream.js'

/*
 * A bucket song the desktop has not downloaded, played through
 * `app://selfmp3/_stream/<key>`: the shell's real scheme handler and stream
 * proxy, a real folder for the played songs, in front of the real doorman
 * (apps/doorman, its own test harness) and the harness's look-alike bucket.
 * Faked is only what is outside: Electron's `protocol`, which hands the
 * handler its requests, and the bucket — and, where a test needs a song to
 * arrive slowly, the network itself.
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
/** Where the folder keeps it. */
const KEPT = `audio-${SHA}.m4a`
/** A song's bytes: 0, 1, 2… so any slice says where it came from. */
const BYTES = Uint8Array.from({ length: 1000 }, (_, index) => index % 256)

let h: Harness
let token: string
let dir: string
let stream: StreamProxy
const capped: string[] = []
/** Every request the proxy made of the doorman, by its range. */
const asked: (string | null)[] = []
let clock = 0

function proxy(): StreamProxy {
  const made = createStreamProxy({
    fetch: (url, init) => {
      asked.push(init.headers.get('Range'))
      return h.doorman.fetch(new Request(url, init), h.env)
    },
    onCapped: message => capped.push(message),
    dir,
    now: () => clock,
  })
  handleAppScheme({ web: '/nowhere', devOrigin: null, stream: made })
  made.use({ doormanUrl: DOORMAN_ORIGIN, token })
  return made
}

/** As the window's `<audio>` element asks: from the app's own origin, perhaps with a range. */
function play(key: string, init: { range?: string; method?: string } = {}): Promise<Response> {
  const headers = new Headers({ Origin: 'app://selfmp3' })
  if (init.range) headers.set('Range', init.range)
  return fake.handler!(
    new Request(`app://selfmp3/_stream/${key}`, { method: init.method ?? 'GET', headers }),
  )
}

async function bytesOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer())
}

/** Until the song is whole in the folder, which happens just after its last byte is read. */
async function keptAs(name: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !existsSync(join(dir, name)); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(existsSync(join(dir, name))).toBe(true)
}

beforeEach(async () => {
  h = harness()
  token = await h.signIn()
  expect((await h.connect(token)).status).toBe(200)
  h.bucket.put(`selfmp3/${SONG}`, BYTES, { contentType: 'audio/mp4' })
  h.bucket.requests.length = 0
  dir = await mkdtemp(join(tmpdir(), 'selfmp3-played-'))
  capped.length = 0
  asked.length = 0
  clock = Date.parse('2026-10-14T12:00:00Z')
  stream = proxy()
})

afterEach(async () => {
  // A download nobody read to the end may still be writing.
  stream.use(null)
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

describe('streaming a bucket song on the desktop', () => {
  it('plays the whole song, with the app’s CORS pair', async () => {
    const response = await play(SONG)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mp4')
    expect(response.headers.get('content-length')).toBe('1000')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('access-control-allow-origin')).toBe('app://selfmp3')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(await bytesOf(response)).toEqual(BYTES)
  })

  it('asks the bucket once for a song, however many ranges and seeks the player makes', async () => {
    // What an `<audio>` element does: a first look, the range after it, a
    // seek, a seek back, and the next song's preload asking for the start.
    const look = await play(SONG, { range: 'bytes=0-1' })
    expect(look.status).toBe(206)
    expect(look.headers.get('content-range')).toBe('bytes 0-1/1000')
    expect(await bytesOf(look)).toEqual(BYTES.slice(0, 2))

    const rest = await play(SONG, { range: 'bytes=2-' })
    expect(await bytesOf(rest)).toEqual(BYTES.slice(2))
    const seek = await play(SONG, { range: 'bytes=500-599' })
    expect(seek.status).toBe(206)
    expect(seek.headers.get('content-range')).toBe('bytes 500-599/1000')
    expect(seek.headers.get('content-length')).toBe('100')
    expect(await bytesOf(seek)).toEqual(BYTES.slice(500, 600))
    const back = await play(SONG, { range: 'bytes=990-' })
    expect(await bytesOf(back)).toEqual(BYTES.slice(990))

    await keptAs(KEPT)
    // Played again, from the folder.
    const replay = await play(SONG, { range: 'bytes=100-199' })
    expect(replay.status).toBe(206)
    expect(await bytesOf(replay)).toEqual(BYTES.slice(100, 200))
    expect(await bytesOf(await play(SONG))).toEqual(BYTES)

    expect(asked).toEqual([null])
    expect(h.bucket.requests.filter(request => request.method === 'GET')).toHaveLength(1)
  })

  it('keeps a played song across a relaunch, answered from the disk', async () => {
    await bytesOf(await play(SONG))
    await keptAs(KEPT)
    asked.length = 0

    stream = proxy()
    const response = await play(SONG, { range: 'bytes=10-19' })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 10-19/1000')
    expect(await bytesOf(response)).toEqual(BYTES.slice(10, 20))
    expect(asked).toEqual([])
  })

  it(`keeps the last ${PLAYED_KEPT} songs played, the least recently played going first`, async () => {
    const keys = Array.from({ length: PLAYED_KEPT + 1 }, (_, index) => {
      const key = `audio/${index.toString(16).padStart(64, '0')}.m4a`
      h.bucket.put(`selfmp3/${key}`, BYTES, { contentType: 'audio/mp4' })
      return key
    })
    for (const key of keys) {
      clock += 1000
      await bytesOf(await play(key))
      await keptAs(key.split('/').join('-'))
      // The first, played again before the rest: newer now than the second.
      if (key === keys[1]) {
        clock += 1000
        await bytesOf(await play(keys[0]!))
      }
    }
    const names = (await readdir(dir)).sort()
    expect(names).toHaveLength(PLAYED_KEPT)
    expect(names).not.toContain(keys[1]!.split('/').join('-'))
    expect(names).toContain(keys[0]!.split('/').join('-'))
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
    expect(existsSync(join(dir, KEPT))).toBe(false)
  })

  it('asks nothing once signed out', async () => {
    stream.use(null)
    const response = await play(SONG)
    expect(response.status).toBe(401)
    expect(asked).toEqual([])
  })

  it('holds off for the day’s cap, tells the page, and asks once more when the hold is up', async () => {
    h.bucket.capped = true
    const first = await play(SONG, { range: 'bytes=0-1' })
    expect(first.status).toBe(502)
    const refusal = (await first.json()) as { code: string; error: string }
    expect(refusal.code).toBe('bucket_cap_exceeded')
    expect(capped).toEqual([refusal.error])

    // Every range the player wants meanwhile is answered from here.
    const again = await play(SONG, { range: 'bytes=500-' })
    expect(again.status).toBe(502)
    expect(((await again.json()) as { code: string }).code).toBe('bucket_cap_exceeded')
    expect(asked).toHaveLength(1)

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

  it('reads only what a device may: a key the doorman would not serve is not asked for', async () => {
    for (const key of ['secrets.json', `notes/${SHA}.m4a`, `audio/${SHA}.m4a/extra`]) {
      expect((await play(key)).status).toBe(404)
    }
    expect(asked).toEqual([])
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

/*
 * The network itself, slowed down: a song that arrives in pieces the test
 * hands over, so what is checked is that a range is answered as soon as its
 * bytes are on the disk, and what happens when the rest never comes.
 */
describe('a song still arriving', () => {
  const SIZE = 3 * WAIT_AHEAD_BYTES
  const big = Uint8Array.from({ length: SIZE }, (_, index) => (index * 7) % 256)

  function slow(): {
    proxy: StreamProxy
    send: (from: number, to: number) => Promise<void>
    fail: () => Promise<void>
    reset: () => void
    ranges: (string | null)[]
  } {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    /** The download, once the proxy has asked for it. */
    const asked = async (): Promise<ReadableStreamDefaultController<Uint8Array>> => {
      for (let attempt = 0; attempt < 200 && controller === null; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      if (controller === null) throw new Error('the song was never asked for')
      return controller
    }
    const ranges: (string | null)[] = []
    const made = createStreamProxy({
      fetch: async (_url, init) => {
        const range = init.headers.get('Range')
        ranges.push(range)
        if (range) {
          // A range asked for by itself: answered whole, at once.
          const [, from = '0'] = /^bytes=(\d+)-$/.exec(range) ?? []
          const start = Number(from)
          return new Response(big.slice(start), {
            status: 206,
            headers: {
              'Content-Length': String(SIZE - start),
              'Content-Range': `bytes ${start}-${SIZE - 1}/${SIZE}`,
            },
          })
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start: started => {
              controller = started
            },
          }),
          { status: 200, headers: { 'Content-Length': String(SIZE), 'Content-Type': 'audio/mp4' } },
        )
      },
      onCapped: () => {},
      dir,
    })
    made.use({ doormanUrl: DOORMAN_ORIGIN, token: 't' })
    return {
      proxy: made,
      // The last piece ends the download.
      send: async (from, to) => {
        const download = await asked()
        download.enqueue(big.slice(from, to))
        if (to >= SIZE) download.close()
      },
      fail: async () => (await asked()).error(new Error('connection reset')),
      reset: () => {
        controller = null
      },
      ranges,
    }
  }

  const ask = (proxy: StreamProxy, range: string) =>
    proxy.serve(
      new Request(`app://selfmp3/_stream/${SONG}`, { headers: { Range: range } }),
      SONG,
      'app://selfmp3',
    )

  it('answers a range as soon as its bytes are here, before the rest of the song', async () => {
    const { proxy, send, ranges } = slow()
    const opening = ask(proxy, 'bytes=0-99')
    await send(0, 1000)
    expect(await bytesOf(await opening)).toEqual(big.slice(0, 100))

    // A range waiting on bytes not here yet gets them as they come.
    const later = ask(proxy, 'bytes=900-1999')
    const answered = later.then(bytesOf)
    await send(1000, SIZE)
    expect(await answered).toEqual(big.slice(900, 2000))
    expect(ranges).toEqual([null])
    await keptAs(KEPT)
  })

  it('asks for a range far past what has arrived by itself, rather than wait for it', async () => {
    const { proxy, send, ranges } = slow()
    const opening = ask(proxy, 'bytes=0-99')
    await send(0, 100)
    await bytesOf(await opening)

    const far = await ask(proxy, `bytes=${SIZE - 10}-`)
    expect(far.status).toBe(206)
    expect(await bytesOf(far)).toEqual(big.slice(SIZE - 10))
    expect(ranges).toEqual([null, `bytes=${SIZE - 10}-`])
    await send(100, SIZE)
  })

  it('keeps nothing of a song that stopped arriving, and fetches it again next time', async () => {
    const { proxy, send, fail, reset, ranges } = slow()
    const opening = ask(proxy, 'bytes=0-')
    await send(0, 1000)
    const reading = (await opening).arrayBuffer()
    await fail()
    await expect(reading).rejects.toThrow()

    for (let attempt = 0; attempt < 200 && (await readdir(dir)).length > 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(await readdir(dir)).toEqual([])
    reset()
    const again = ask(proxy, 'bytes=0-9')
    await send(0, SIZE)
    expect(await bytesOf(await again)).toEqual(big.slice(0, 10))
    expect(ranges).toEqual([null, null])
  })
})

it('says the storage cannot be reached when the doorman does not answer', async () => {
  const offline = createStreamProxy({
    fetch: () => Promise.reject(new TypeError('fetch failed')),
    onCapped: () => {},
    dir,
  })
  offline.use({ doormanUrl: DOORMAN_ORIGIN, token })
  const response = await offline.serve(new Request(`app://selfmp3/_stream/${SONG}`), SONG, 'x')
  expect(response.status).toBe(503)
})
