import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@selfmp3/client'
import type { AskAnswer, AskProgress } from '@selfmp3/shared'
import { askKept, type AskSent } from './askKept'

const sent: AskSent = { text: 'only the albums', playing: null, ticket: 'ticket-1', before: [] }
const answer: AskAnswer = { kind: 'none', say: 'Here it is.', try: [] }
const running: AskProgress = { steps: [], known: true, done: false, answer: null, failed: null }
const done: AskProgress = { ...running, done: true }

/** A server whose answer to the Ask itself is `posted`, and whose progress is read from `progress`. */
function server(posted: Promise<AskAnswer>, progress: (answer: boolean) => AskProgress) {
  return {
    ask: vi.fn(() => posted),
    askProgress: vi.fn((_ticket: string, collect = false) => Promise.resolve(progress(collect))),
    askStop: vi.fn(() => Promise.resolve({ ok: true as const })),
  }
}

const never = new Promise<AskAnswer>(() => undefined)
const lost = (): Promise<AskAnswer> =>
  Promise.reject(new ApiError(0, 'The network connection was lost.', 'offline'))
const noWait = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('an Ask that outlasts its connection', () => {
  it('is the response, when it comes', async () => {
    const api = server(Promise.resolve(answer), () => running)
    await expect(askKept(api, sent, new AbortController().signal, noWait)).resolves.toEqual(answer)
    expect(api.askStop).not.toHaveBeenCalled()
  })

  it('collects the answer by its ticket when the connection was lost on the way', async () => {
    const api = server(lost(), collect => (collect ? { ...done, answer } : running))
    await expect(askKept(api, sent, new AbortController().signal, noWait)).resolves.toEqual(answer)
    expect(api.askProgress).toHaveBeenLastCalledWith('ticket-1', true, expect.anything())
  })

  it('says the server’s failure, as the lost response would have', async () => {
    const failed = { status: 502, error: 'The model didn’t answer.', code: 'ai_unreachable' }
    const api = server(lost(), () => ({ ...done, failed }))
    await expect(askKept(api, sent, new AbortController().signal, noWait)).rejects.toMatchObject({
      status: 502,
      code: 'ai_unreachable',
    })
  })

  it('says the connection was lost when the server no longer knows the ticket', async () => {
    const api = server(lost(), () => ({ ...running, known: false }))
    await expect(askKept(api, sent, new AbortController().signal, noWait)).rejects.toMatchObject({
      status: 0,
    })
  })

  it('does not wait on a response that never comes once the server is done', async () => {
    vi.useFakeTimers()
    try {
      const api = server(never, collect => (collect ? { ...done, answer } : done))
      const asked = askKept(api, sent, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(asked).resolves.toEqual(answer)
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells the server when the question is let go of', async () => {
    const stop = new AbortController()
    const api = server(never, () => running)
    const asked = askKept(api, sent, stop.signal, noWait)
    stop.abort()
    expect(api.askStop).toHaveBeenCalledWith('ticket-1')
    await expect(Promise.race([asked, Promise.resolve('waiting')])).resolves.toBe('waiting')
  })

  it('passes on a failure that is the server’s answer, not a lost connection', async () => {
    const api = server(Promise.reject(new ApiError(403, 'Off.', 'ai_disabled')), () => running)
    await expect(askKept(api, sent, new AbortController().signal, noWait)).rejects.toMatchObject({
      status: 403,
    })
  })
})
