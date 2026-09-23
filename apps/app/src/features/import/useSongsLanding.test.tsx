import { act, renderHook } from '@testing-library/react-native'
import { IDLE_PACING } from '@selfmp3/shared'
import type { ImportJob, ImportQueue } from '@selfmp3/shared'

import { useSongsLanding } from './useSongsLanding'

const job = (id: string, status: ImportJob['status']): ImportJob => ({
  id,
  url: `https://youtu.be/${id}`,
  status,
  step: status === 'done' ? 'finished' : 'downloading',
  progress: null,
  title: id,
  artist: '',
  album: '',
  thumbnail: null,
  duration: 0,
  error: null,
  songId: null,
  attempts: 0,
  tagIds: [],
  createdAt: '2026-09-22 10:00:00',
  updatedAt: '2026-09-22 10:00:00',
})

const queueOf = (...jobs: ImportJob[]): ImportQueue => ({
  jobs,
  active: jobs.filter(each => each.status === 'running').length,
  queued: 0,
  pacing: IDLE_PACING,
})

/**
 * The library asked for again as each import lands — at once for the first,
 * and no closer together than the gap for the rest.
 */
describe('useSongsLanding', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('looks the moment a job is done that was not before', async () => {
    const look = jest.fn()
    const { rerender } = await renderHook(
      ({ queue }: { queue: ImportQueue }) => useSongsLanding(queue, 'here', look),
      { initialProps: { queue: queueOf(job('a', 'running')) } },
    )
    expect(look).not.toHaveBeenCalled()

    await rerender({ queue: queueOf(job('a', 'done')) })
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    expect(look).toHaveBeenCalledTimes(1)
  })

  it('does not look at a queue opened with finished jobs already on it', async () => {
    const look = jest.fn()
    const { rerender } = await renderHook(
      ({ queue }: { queue: ImportQueue }) => useSongsLanding(queue, 'here', look),
      { initialProps: { queue: queueOf(job('old', 'done'), job('b', 'running')) } },
    )
    await act(async () => {
      jest.advanceTimersByTime(5_000)
    })
    expect(look).not.toHaveBeenCalled()

    // The same queue read again lands nothing either.
    await rerender({ queue: queueOf(job('old', 'done'), job('b', 'running')) })
    await act(async () => {
      jest.advanceTimersByTime(5_000)
    })
    expect(look).not.toHaveBeenCalled()
  })

  it('folds songs landing a second apart onto one trailing look', async () => {
    const look = jest.fn()
    const { rerender } = await renderHook(
      ({ queue }: { queue: ImportQueue }) => useSongsLanding(queue, 'here', look),
      {
        initialProps: {
          queue: queueOf(job('a', 'running'), job('b', 'running'), job('c', 'running')),
        },
      },
    )

    await rerender({ queue: queueOf(job('a', 'done'), job('b', 'running'), job('c', 'running')) })
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    expect(look).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(1_000)
    })
    await rerender({ queue: queueOf(job('a', 'done'), job('b', 'done'), job('c', 'running')) })
    await act(async () => {
      jest.advanceTimersByTime(1_000)
    })
    await rerender({ queue: queueOf(job('a', 'done'), job('b', 'done'), job('c', 'done')) })
    // Within the gap: nothing yet.
    expect(look).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(1_000)
    })
    // The gap is up: one look for both, not one each.
    expect(look).toHaveBeenCalledTimes(2)
    await act(async () => {
      jest.advanceTimersByTime(10_000)
    })
    expect(look).toHaveBeenCalledTimes(2)
  })

  it('starts over when the queue is another server’s', async () => {
    const look = jest.fn()
    const { rerender } = await renderHook(
      ({ queue, key }: { queue: ImportQueue; key: string }) => useSongsLanding(queue, key, look),
      { initialProps: { queue: queueOf(job('a', 'running')), key: 'one' } },
    )
    // The other server's queue has a finished job on it: that is not a landing.
    await rerender({ queue: queueOf(job('a', 'done')), key: 'two' })
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    expect(look).not.toHaveBeenCalled()
  })

  it('looks on the way out rather than dropping a look that was waiting', async () => {
    const look = jest.fn()
    const { rerender, unmount } = await renderHook(
      ({ queue }: { queue: ImportQueue }) => useSongsLanding(queue, 'here', look),
      { initialProps: { queue: queueOf(job('a', 'running'), job('b', 'running')) } },
    )
    await rerender({ queue: queueOf(job('a', 'done'), job('b', 'running')) })
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    await rerender({ queue: queueOf(job('a', 'done'), job('b', 'done')) })
    expect(look).toHaveBeenCalledTimes(1)

    await unmount()
    expect(look).toHaveBeenCalledTimes(2)
  })
})
