import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { answerWithin } from './shellWait.model'

describe('answerWithin', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is the network when it answers in time', async () => {
    const answer = answerWithin(Promise.resolve('fresh'), 'kept', 3_000)
    await expect(answer).resolves.toBe('fresh')
  })

  it('is the kept copy when the network hangs', async () => {
    const answer = answerWithin(new Promise<string>(() => {}), 'kept', 3_000)
    await vi.advanceTimersByTimeAsync(2_999)
    let settled = false
    void answer.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(answer).resolves.toBe('kept')
  })

  it('is the kept copy at once when the network fails', async () => {
    const answer = answerWithin(Promise.reject(new Error('offline')), 'kept', 3_000)
    await expect(answer).resolves.toBe('kept')
  })

  it('waits on the network as long as it takes with nothing kept', async () => {
    let answerNow: (value: string) => void = () => {}
    const network = new Promise<string>(resolve => (answerNow = resolve))
    const answer = answerWithin(network, undefined, 3_000)
    await vi.advanceTimersByTimeAsync(60_000)
    answerNow('fresh')
    await expect(answer).resolves.toBe('fresh')
  })

  it('fails as the network does with nothing kept', async () => {
    const answer = answerWithin(Promise.reject(new Error('offline')), undefined, 3_000)
    await expect(answer).rejects.toThrow('offline')
  })
})
