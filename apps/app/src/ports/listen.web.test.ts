import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ListenState } from './listen.types'

/*
 * A preview in a browser, over a stand-in `<audio>` element. Pinned: a stream
 * that says nothing at all after play is asked — a request the browser left
 * hanging — is a preview that would not play, said as such, as it is on a
 * phone, and not a spinner for good.
 */

class FakeAudio extends EventTarget {
  preload = ''
  src = ''
  paused = true
  seeking = false
  readyState = 0
  currentTime = 0
  duration = Number.NaN
  error: { code: number } | null = null
  getAttribute(name: string): string | null {
    return name === 'src' && this.src ? this.src : null
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
  load(): void {}
  play(): Promise<void> {
    this.paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

let element: FakeAudio

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.stubGlobal(
    'Audio',
    class extends FakeAudio {
      constructor() {
        super()
        element = this
      }
    },
  )
  vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function preview(): Promise<{ last: () => ListenState | undefined }> {
  const { createListenAudio } = await import('./listen.web')
  const audio = createListenAudio()
  if (!audio) throw new Error('no audio')
  const heard: ListenState[] = []
  audio.subscribe(state => heard.push(state))
  audio.play('https://music.example/api/import/listen?url=x')
  return { last: () => heard.at(-1) }
}

describe('a preview in a browser', () => {
  it('says it would not play when the stream stays silent', async () => {
    const { last } = await preview()
    expect(last()?.status).toBe('loading')

    vi.advanceTimersByTime(45_000)

    expect(last()?.status).toBe('error')
    expect(element.paused).toBe(true)
  })

  it('leaves a preview alone once it has started to sound', async () => {
    const { last } = await preview()
    element.readyState = 4
    element.dispatchEvent(new Event('playing'))
    expect(last()?.status).toBe('playing')

    vi.advanceTimersByTime(60_000)

    expect(last()?.status).toBe('playing')
  })
})
