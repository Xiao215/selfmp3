import { afterEach, describe, expect, it, vi } from 'vitest'

import { setStageExit } from '../../shell/stageExit'
import { putAwayForLink } from './leaveNowPlaying'

// React Native's own modules, which a test in Node cannot load.
vi.mock('../../ui/useBackTo', () => ({ goBack: vi.fn() }))

/*
 * A link followed while the phone's Now Playing is up: the modal goes down
 * first, so the link's page opens over the app and its dialogs can be seen.
 */

const fakeRouter = () => {
  const back = vi.fn()
  return { back, router: { back, canGoBack: () => true } as never }
}

afterEach(() => {
  setStageExit(null)
  vi.useRealTimers()
})

describe('putAwayForLink', () => {
  it('takes the phone’s Now Playing down before the link is followed', async () => {
    setStageExit(done => done(true), true)
    const { back, router } = fakeRouter()
    await putAwayForLink(router, 'selfmp3:///settings')
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('leaves a page that does not cover the app, and a link to Now Playing itself', async () => {
    const { back, router } = fakeRouter()
    setStageExit(done => done(true), false)
    await putAwayForLink(router, 'selfmp3:///settings')
    setStageExit(done => done(true), true)
    await putAwayForLink(router, 'selfmp3://now-playing')
    await putAwayForLink(router, '/now-playing?song=3')
    setStageExit(null)
    await putAwayForLink(router, 'selfmp3:///settings')
    expect(back).not.toHaveBeenCalled()
  })

  it('follows the link anyway when the page never finishes going, and does not go back after', async () => {
    vi.useFakeTimers()
    let finish: ((finished: boolean) => void) | null = null
    setStageExit(done => {
      finish = done
    }, true)
    const { back, router } = fakeRouter()
    const followed = putAwayForLink(router, 'selfmp3:///settings')
    await vi.advanceTimersByTimeAsync(2000)
    await followed
    ;(finish as ((finished: boolean) => void) | null)?.(true)
    expect(back).not.toHaveBeenCalled()
  })
})
