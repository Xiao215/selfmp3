import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AskAnswer } from '@selfmp3/shared'
import { AskProgress, GONE_MS, type Steps } from './progress.js'

describe('AskProgress', () => {
  it('keeps a count on the running step’s own line', () => {
    const progress = new AskProgress()
    const steps = progress.track('t')
    steps.begin('Looking up 75 songs')
    steps.update('Looking up 75 songs · 25 done')
    steps.update('Looking up 75 songs · 50 done')
    expect(progress.seen('t').steps).toEqual([
      { text: 'Looking up 75 songs · 50 done', done: false },
    ])

    steps.done('Found 70 of 75')
    steps.update('Reading 70 songs · 10 done')
    expect(progress.seen('t').steps).toEqual([
      { text: 'Found 70 of 75', done: true },
      { text: 'Reading 70 songs · 10 done', done: false },
    ])
  })
})

describe('AskProgress.outlast', () => {
  const answer: AskAnswer = { kind: 'none', say: 'Done.', try: [] }

  /** Work that waits for its signal or to be let finish. */
  function waiting(): {
    work: (steps: Steps, signal: AbortSignal | undefined) => Promise<AskAnswer>
    finish: () => void
    stopped: () => boolean
  } {
    let finish = (): void => undefined
    let signal: AbortSignal | undefined
    return {
      work: (_steps, given) => {
        signal = given
        return new Promise<AskAnswer>((resolve, reject) => {
          finish = () => resolve(answer)
          given?.addEventListener('abort', () => reject(new Error('stopped')))
        })
      },
      finish: () => finish(),
      stopped: () => signal?.aborted ?? false,
    }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('goes on after the connection closes, and keeps the answer for the device to collect', async () => {
    vi.useFakeTimers()
    const progress = new AskProgress()
    const gone = new AbortController()
    const { work, finish, stopped } = waiting()
    const running = progress.outlast('ticket-1', gone.signal, work)

    gone.abort()
    await vi.advanceTimersByTimeAsync(GONE_MS / 2)
    // Back from the background: asking after it keeps it going.
    expect(progress.seen('ticket-1')).toMatchObject({ known: true, outcome: null })
    await vi.advanceTimersByTimeAsync(GONE_MS / 2 + 10_000)
    expect(stopped()).toBe(false)

    finish()
    await running
    expect(progress.seen('ticket-1').outcome).toEqual({ answer })
  })

  it('stops once the device has not asked after it for a while', async () => {
    vi.useFakeTimers()
    const progress = new AskProgress()
    const gone = new AbortController()
    const { work, stopped } = waiting()
    const running = progress.outlast('ticket-2', gone.signal, work)
    running.catch(() => undefined)

    gone.abort()
    await vi.advanceTimersByTimeAsync(GONE_MS + 10_000)
    expect(stopped()).toBe(true)
    await expect(running).rejects.toThrow('stopped')
    expect(progress.seen('ticket-2').outcome).toEqual({ failed: expect.any(Error) })
  })

  it('stops at once when Stop is pressed, connection or not', () => {
    const progress = new AskProgress()
    const { work, stopped } = waiting()
    progress.outlast('ticket-3', new AbortController().signal, work).catch(() => undefined)
    progress.stop('ticket-3')
    expect(stopped()).toBe(true)
  })

  it('stops with the connection when there is no ticket to collect it by', () => {
    const progress = new AskProgress()
    const gone = new AbortController()
    const { work, stopped } = waiting()
    progress.outlast(undefined, gone.signal, work).catch(() => undefined)
    gone.abort()
    expect(stopped()).toBe(true)
  })

  it('says it does not know a ticket it never saw', () => {
    expect(new AskProgress().seen('nobody-asked')).toEqual({
      steps: [],
      known: false,
      outcome: null,
    })
  })
})
