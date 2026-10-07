import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The browser's engine, over a fake `<audio>` element: enough of one to be
 * told a source, a level and play or pause.
 *
 * Two regressions pinned. A level set while muted was recorded as unmuted and
 * played as silence, because the element was told from the old mute flag. And
 * a song with nowhere to play from (an empty address) threw out of `load`, a
 * promise the player never awaits: no error on screen, no recovery, a silent
 * player. The phone's engine says it cannot play the song; this one does too.
 */

class FakeAudio {
  src = ''
  volume = 1
  playbackRate = 1
  paused = true
  currentTime = 0
  duration = Number.NaN
  preload = ''
  crossOrigin = ''
  preservesPitch = true
  error = null

  constructor() {
    elements.push(this)
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  load(): void {}
  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
}

let elements: FakeAudio[] = []

beforeEach(() => {
  elements = []
  vi.stubGlobal('Audio', FakeAudio)
})

async function engine() {
  const { createEngine } = await import('./engine.web')
  return createEngine()
}

describe('the browser engine', () => {
  it('unmutes when the level is moved, and plays at that level', async () => {
    const audio = await engine()
    audio.setMuted(true)

    audio.setVolume(0.5)

    expect(audio.state).toMatchObject({ volume: 0.5, muted: false })
    // The first element made is the one playing.
    expect(elements[0]?.volume).toBe(0.5)
  })

  it('stays muted when the level is moved to nothing', async () => {
    const audio = await engine()
    audio.setMuted(true)

    audio.setVolume(0)

    expect(audio.state).toMatchObject({ volume: 0, muted: true })
    expect(elements[0]?.volume).toBe(0)
  })

  it('says a song with nowhere to play from cannot be played, rather than throwing', async () => {
    const audio = await engine()
    audio.connect({ streamUrl: () => '' })

    await expect(audio.load(3)).resolves.toBeUndefined()

    expect(audio.state.error).toMatch(/cannot be played from this device/)
    expect(audio.state.playing).toBe(false)
  })

  it('plays a song it has an address for', async () => {
    const audio = await engine()
    audio.connect({ streamUrl: songId => `https://music.example/api/stream/${songId}` })

    await audio.load(4, { autoplay: false })

    expect(audio.state.error).toBeNull()
    expect(elements[0]?.src).toBe('https://music.example/api/stream/4')
  })
})
