import { act, renderHook } from '@testing-library/react-native'
import { reviewFrom } from '@selfmp3/client'

import { patchDraft, resetImportDraft } from './importDraft'
import { reviewUrls, useRefreshReview } from './useRefreshReview'

const item = (n: number) => ({
  url: `https://open.example/${n}`,
  title: `Song ${n}`,
  artist: 'YOASOBI',
  album: '',
  duration: 240,
  thumbnail: null,
  alreadyHave: false,
  waitingToUpload: false,
  inQueue: false,
  source: 'youtube' as const,
  netease: null,
  youtube: null,
})

const review = (...ns: number[]) =>
  reviewFrom({ from: 'youtube', kind: 'playlist', playlistTitle: null, items: ns.map(item) })

/**
 * The review asks the server what the library has once its songs stop
 * changing: a run of changes — rows switched one after another, batches of
 * names found — kept the server too busy to answer its health check.
 */
describe('useRefreshReview', () => {
  const importAlreadyHave = jest.fn(() => Promise.resolve({ have: [], waiting: [], queued: [] }))
  const api = { importAlreadyHave }

  beforeEach(() => {
    jest.useFakeTimers()
    importAlreadyHave.mockClear()
  })
  afterEach(async () => {
    jest.useRealTimers()
    await act(async () => resetImportDraft())
  })

  it('asks once for a run of changes, after the last', async () => {
    patchDraft('own', { review: review(1, 2, 3) })
    const { rerender } = await renderHook(
      ({ urls }: { urls: string | null }) => useRefreshReview(api, 'own', urls),
      { initialProps: { urls: reviewUrls(review(1, 2, 3)) } },
    )
    for (const next of [review(1, 2, 4), review(1, 5, 4), review(6, 5, 4)]) {
      await act(async () => {
        jest.advanceTimersByTime(200)
      })
      patchDraft('own', { review: next })
      await rerender({ urls: reviewUrls(next) })
    }
    expect(importAlreadyHave).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(500)
    })
    expect(importAlreadyHave).toHaveBeenCalledTimes(1)
    // About the songs as they are at the end of the run.
    expect(importAlreadyHave).toHaveBeenCalledWith(review(6, 5, 4).items)
  })

  it('asks nothing of a page left before the songs settled', async () => {
    patchDraft('own', { review: review(1, 2) })
    const { unmount } = await renderHook(() =>
      useRefreshReview(api, 'own', reviewUrls(review(1, 2))),
    )
    await act(async () => {
      jest.advanceTimersByTime(100)
    })
    await unmount()
    await act(async () => {
      jest.advanceTimersByTime(1_000)
    })
    expect(importAlreadyHave).not.toHaveBeenCalled()
  })
})
