import { ApiError, type Api } from '@selfmp3/client'
import type { AskAnswer } from '@selfmp3/shared'
import { countUse } from '../usage/usage'

/** One Ask, as `askKept` sends it. */
export interface AskSent {
  readonly text: string
  readonly playing: number | null
  readonly ticket: string
  readonly before: readonly string[]
}

/** How often the server is asked whether the answer is done, while its response is on the way. */
const WATCH_MS = 2_000
/** How often it is asked for the answer once the response is lost. */
const COLLECT_MS = 1_000
/** How long a response may lag the server saying it is done before the answer is collected instead. */
const LAG_MS = 1_500
/** How long the server may go unreached while the answer is collected, before the lost connection is what is said. */
const UNREACHED_MS = 60_000

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * An Ask whose answer outlasts the connection that asked for it (`ai/progress.ts`
 * on the server). A phone sent to the background loses its connection though
 * nobody stopped asking: the server goes on a while without it and keeps the
 * answer under the ticket. So a lost response is collected by the ticket, and
 * one that never arrives once the server says it is done is not waited for.
 *
 * `signal` is the person letting go of the question (Stop, new words, the box
 * closed): the server is told, so it asks the model no more.
 */
export async function askKept(
  api: Pick<Api, 'ask' | 'askProgress' | 'askStop'>,
  sent: AskSent,
  signal: AbortSignal,
  wait: (ms: number) => Promise<void> = pause,
): Promise<AskAnswer> {
  const { ticket } = sent
  const posting = new AbortController()
  const drop = (): void => {
    posting.abort()
    void api.askStop(ticket).catch(() => undefined)
  }
  signal.addEventListener('abort', drop, { once: true })
  try {
    return await new Promise<AskAnswer>((resolve, reject) => {
      let settled = false
      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        finish()
      }
      /** What the response failed with when its connection went, not the server's work. */
      let lost: ApiError | null = null

      countUse('ask')
      api.ask(sent.text, sent.playing, ticket, sent.before, posting.signal).then(
        answer => settle(() => resolve(answer)),
        (caught: unknown) => {
          if (!signal.aborted && caught instanceof ApiError && caught.isOffline) lost = caught
          else settle(() => reject(caught))
        },
      )

      void (async () => {
        let doneAt: number | null = null
        let reachedAt = Date.now()
        while (!settled && !signal.aborted) {
          await wait(lost ? COLLECT_MS : WATCH_MS)
          if (settled || signal.aborted) return
          const collecting = lost !== null || (doneAt !== null && Date.now() - doneAt >= LAG_MS)
          let progress
          try {
            progress = await api.askProgress(ticket, collecting, signal)
          } catch {
            const gaveUp = lost
            if (gaveUp && Date.now() - reachedAt > UNREACHED_MS) settle(() => reject(gaveUp))
            continue
          }
          reachedAt = Date.now()
          const { answer, failed } = progress
          const gaveUp = lost
          if (answer) settle(() => resolve(answer))
          else if (failed && collecting) {
            settle(() => reject(new ApiError(failed.status, failed.error, failed.code)))
          }
          // Let go of, or never seen: a server started again since. Nothing will come.
          else if (!progress.known && gaveUp) settle(() => reject(gaveUp))
          else if (progress.done) doneAt ??= Date.now()
        }
      })()
    })
  } finally {
    signal.removeEventListener('abort', drop)
    posting.abort()
  }
}
