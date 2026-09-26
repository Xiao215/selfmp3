import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A paused load fetches nothing (`#startWhenPlayed`).
 *
 * An `<audio>` starts streaming on `load()` when `preload` is `auto`, and in a
 * browser tab every range it asks for is a read from the bucket. The element
 * here is a stand-in that records what it was told; the browser's own reading
 * of `preload` is what makes the difference, and is not something a test can
 * count.
 */

class FakeAudio extends EventTarget {
  preload = 'metadata'
  crossOrigin: string | null = null
  src = ''
  currentTime = 0
  duration = NaN
  volume = 1
  muted = false
  playbackRate = 1
  paused = true
  error: { code: number } | null = null
  loads: string[] = []
  loadedWithPreload: string[] = []
  load(): void {
    this.loads.push(this.src)
    this.loadedWithPreload.push(this.preload)
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
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function engine() {
  const { createEngine } = await import('./engine.web')
  const audioEngine = createEngine()
  audioEngine.connect({ streamUrl: id => `/api/stream/${id}` })
  const [primary, secondary] = made
  if (!primary || !secondary) throw new Error('two elements expected')
  return { audioEngine, primary, secondary }
}

describe('a song loaded to sit paused', () => {
  it('is loaded with preload off, and fetched when played', async () => {
    const { audioEngine, primary } = await engine()
    await audioEngine.load(7, { autoplay: false })
    expect(primary.src).toBe('/api/stream/7')
    expect(primary.loadedWithPreload).toEqual(['none'])

    await audioEngine.play()
    expect(primary.preload).toBe('auto')
    expect(primary.paused).toBe(false)
  })

  it('starts from where it was left once played, without seeking before then', async () => {
    const { audioEngine, primary } = await engine()
    await audioEngine.load(7, { autoplay: false, startAt: 203 })
    expect(primary.currentTime).toBe(0)
    expect(audioEngine.state.currentTime).toBe(203)

    const playing = audioEngine.play()
    expect(primary.currentTime).toBe(203)
    primary.dispatchEvent(new Event('loadedmetadata'))
    await playing
    expect(primary.currentTime).toBe(203)
  })

  it('seeks after the metadata where the position was not taken up front', async () => {
    const { audioEngine, primary } = await engine()
    await audioEngine.load(7, { autoplay: false, startAt: 203 })
    const playing = audioEngine.play()
    // A browser that ignores a seek before metadata: the position is lost.
    primary.currentTime = 0
    primary.dispatchEvent(new Event('loadedmetadata'))
    await playing
    await Promise.resolve()
    expect(primary.currentTime).toBe(203)
  })

  it('leaves a played load as it was: preload on, seek awaited', async () => {
    const { audioEngine, primary } = await engine()
    const loading = audioEngine.load(7, { autoplay: true, startAt: 30 })
    expect(primary.loadedWithPreload).toEqual(['auto'])
    primary.dispatchEvent(new Event('loadedmetadata'))
    await loading
    expect(primary.currentTime).toBe(30)
    expect(primary.paused).toBe(false)
  })

  it('does not carry the position onto the next song', async () => {
    const { audioEngine, primary } = await engine()
    await audioEngine.load(7, { autoplay: false, startAt: 203 })
    await audioEngine.load(8, { autoplay: false })
    await audioEngine.play()
    expect(primary.src).toBe('/api/stream/8')
    expect(primary.currentTime).toBe(0)
  })
})
