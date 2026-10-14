import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The desktop app's addresses for bucket songs, over a fake of the shell's
 * `bucket` channels (the bridge is the boundary). Pinned: a song streams from
 * the shell's own address once the player has said which key it has and that
 * there is a session, the session goes to the shell and is taken back on
 * signing out, and the shell saying the bucket is capped holds the page's
 * reads too. What the shell does with the address is
 * apps/desktop/src/main/stream.test.ts.
 */

const capListeners: ((message: string) => void)[] = []
const bridge = {
  bucket: {
    use: vi.fn(async (_session: unknown) => {}),
    streamUrl: (key: string) => `app://selfmp3/_stream/${key}`,
    onCapped: vi.fn((listener: (message: string) => void) => {
      capListeners.push(listener)
      return () => {}
    }),
  },
}
const holds: [string, string][] = []

vi.mock('./bridge', () => ({
  get desktop() {
    return bridge
  },
}))
vi.mock('../doormanUrl', () => ({ doormanUrl: 'https://doorman.example' }))
vi.mock('@selfmp3/replica', () => ({
  holdBucket: (message: string, call: string) => void holds.push([message, call]),
}))

const SONG = `audio/${'e'.repeat(64)}.m4a`

async function fresh() {
  vi.resetModules()
  const { desktopBucketMedia } = await import('./bucketMedia.desktop')
  if (!desktopBucketMedia) throw new Error('no bridge')
  return desktopBucketMedia
}

describe('bucket songs on the desktop', () => {
  beforeEach(() => {
    bridge.bucket.use.mockClear()
    bridge.bucket.onCapped.mockClear()
    capListeners.length = 0
    holds.length = 0
  })

  it('has no address until it knows the song and the session', async () => {
    const media = await fresh()
    expect(media.routes.stream(7)).toBe('')
    media.configure({ pathOf: () => null, bearer: 't' })
    expect(media.routes.stream(7)).toBe('')
    media.configure({ pathOf: () => SONG, bearer: null })
    expect(media.routes.stream(7)).toBe('')
  })

  it('streams a song from the shell, which is handed the session', async () => {
    const media = await fresh()
    media.configure({ pathOf: id => (id === 7 ? SONG : null), bearer: 't' })

    expect(media.routes.stream(7)).toBe(`app://selfmp3/_stream/${SONG}`)
    expect(media.routes.stream(8)).toBe('')
    // Covers stay files, as on a phone; the address carries no header.
    expect(media.routes.art(7)).toBeNull()
    expect(media.routes.headers).toBeUndefined()
    expect(bridge.bucket.use).toHaveBeenLastCalledWith({
      doormanUrl: 'https://doorman.example',
      token: 't',
    })
  })

  it('tells the shell only of a change', async () => {
    const media = await fresh()
    // Mounting signed out: the shell has nothing to take back.
    media.configure(null)
    expect(bridge.bucket.use).not.toHaveBeenCalled()
    media.configure({ pathOf: () => SONG, bearer: 't' })
    media.configure({ pathOf: () => null, bearer: 't' })
    expect(bridge.bucket.use).toHaveBeenCalledTimes(1)
  })

  it('takes the session back on signing out', async () => {
    const media = await fresh()
    media.configure({ pathOf: () => SONG, bearer: 't' })
    media.configure(null)
    expect(bridge.bucket.use).toHaveBeenLastCalledWith(null)
    expect(media.routes.stream(7)).toBe('')
  })

  it('holds the page’s reads when the shell hears the bucket is capped, listening once', async () => {
    const media = await fresh()
    media.configure({ pathOf: () => SONG, bearer: 't' })
    media.configure({ pathOf: () => SONG, bearer: 't' })
    expect(bridge.bucket.onCapped).toHaveBeenCalledTimes(1)

    capListeners[0]?.('allowance used up')
    expect(holds).toEqual([['allowance used up', 'read']])
  })
})
