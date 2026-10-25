import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The browser's engine when a song does not come: one failure told once, a
 * stream that never answers given up on, and what the bar is told while the
 * next song loads. The element is a stand-in that records what it was told.
 */

vi.mock('./device', () => ({ deviceKind: () => 'desktop' }))

class FakeAudio extends EventTarget {
  preload = 'auto'
  crossOrigin: string | null = null
  src = ''
  currentTime = 0
  readyState = 0
  duration = NaN
  volume = 1
  paused = true
  error: { code: number } | null = null
  load(): void {
    this.error = null
    this.readyState = 0
    this.duration = NaN
  }
  play(): Promise<void> {
    this.paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
}

const made: FakeAudio[] = []

beforeEach(() => {
  made.length = 0
  vi.stubGlobal(
    'Audio',
    class extends FakeAudio {
      constructor() {
        super()
        made.push(this)
      }
    },
  )
  vi.stubGlobal('MediaError', {
    MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
    MEDIA_ERR_NETWORK: 2,
    MEDIA_ERR_DECODE: 3,
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function engine(next: () => number | null = () => null) {
  const { createEngine } = await import('./engine.web')
  const audioEngine = createEngine()
  audioEngine.connect({ streamUrl: id => `/api/stream/${id}`, nextTrackId: next })
  const [primary, secondary] = made
  if (!primary || !secondary) throw new Error('two elements expected')
  const told: string[] = []
  audioEngine.subscribe(state => {
    if (state.error !== null && told.at(-1) !== state.error) told.push(state.error)
  })
  return { audioEngine, primary, secondary, told }
}

describe('a song that does not come', () => {
  it('is told once, though the element and the address each say so', async () => {
    // The address answers why: a 404 from a bucket without the file.
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('not in the bucket yet', { status: 404 })),
    )
    const { audioEngine, primary, told } = await engine()
    await audioEngine.load(7)

    primary.error = { code: 4 }
    primary.dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(told).toHaveLength(1))
    // Late, and in other words: the same failure.
    primary.dispatchEvent(new Event('error'))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(told).toEqual(['not in the bucket yet'])
  })

  it('says nothing of a failure once another song has been asked for', async () => {
    let answer: (response: Response) => void = () => undefined
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => (answer = resolve)))
    const { audioEngine, primary, told } = await engine()
    await audioEngine.load(7)
    primary.error = { code: 4 }
    primary.dispatchEvent(new Event('error'))

    // Asked for again before the reason came back: the retry is a new load.
    await audioEngine.load(7)
    answer(new Response('gone', { status: 404 }))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(told).toEqual([])
  })

  it('gives up on a stream that never answers, as a lost connection', async () => {
    vi.useFakeTimers()
    const { audioEngine, primary, told } = await engine()
    await audioEngine.load(7)
    expect(told).toEqual([])

    await vi.advanceTimersByTimeAsync(15_000)

    expect(told).toEqual(['Lost connection to the library'])
    expect(primary.src).toBe('')
    expect(audioEngine.state.playing).toBe(false)
  })

  it('waits as long as it likes on a song paused while it was coming', async () => {
    vi.useFakeTimers()
    const { audioEngine, told } = await engine()
    await audioEngine.load(7)
    audioEngine.pause()

    await vi.advanceTimersByTimeAsync(60_000)

    expect(told).toEqual([])
  })
})

describe('the next song, while it loads', () => {
  it('has no length until its own arrives, rather than the last song’s', async () => {
    const { audioEngine, primary } = await engine()
    await audioEngine.load(7)
    primary.duration = 255.5
    primary.dispatchEvent(new Event('durationchange'))
    expect(audioEngine.state.duration).toBe(255.5)

    await audioEngine.load(8)

    expect(audioEngine.state.duration).toBe(0)
  })
})

describe('a crossfade into a song taken out of Up next', () => {
  it('is called off: the song stops fading in, and is let go', async () => {
    let next: number | null = 8
    const { audioEngine, primary, secondary } = await engine(() => next)
    audioEngine.configure({ crossfadeSeconds: 5 })
    await audioEngine.load(7)

    // The last seconds: 8 is fetched and starts fading in.
    primary.duration = 200
    primary.currentTime = 197
    primary.dispatchEvent(new Event('timeupdate'))
    expect(secondary.src).toBe('/api/stream/8')
    expect(secondary.paused).toBe(false)

    next = 9
    audioEngine.refreshLookahead?.()

    expect(secondary.paused).toBe(true)
    expect(secondary.src).toBe('')
    expect(primary.volume).toBe(1)
  })
})
