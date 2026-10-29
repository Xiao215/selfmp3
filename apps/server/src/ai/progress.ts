import type { AskReply } from '@selfmp3/shared'

/**
 * What a smart answer is doing while it is asked for (docs/features/ai.md,
 * "Steps"): the stages in plain words, with the numbers they find — "349 songs
 * fit", "Choosing 25 that suit it" — so the wait says what is happening
 * rather than "Working on the answer" for everything.
 *
 * The answer itself still comes back as one response. The device names its
 * request with a ticket and asks after it while it waits; the steps are kept
 * here for a few minutes, in memory only.
 *
 * An Ask also outlasts its connection (`outlast`): a phone sent to the
 * background for a moment loses it, though nobody stopped asking. The work
 * goes on for a while without the device, and what it comes to is kept under
 * the ticket for the device to collect when it is back.
 */

/** Told as an answer moves from one stage to the next. */
export interface Steps {
  /** A new stage begins; the one before it is done. */
  begin(doing: string): void
  /**
   * The stage running now says how far it has got ("525 of 1,112"): its own line
   * changes rather than a new one being added, so a long count stays one step.
   */
  update(doing: string): void
  /** The stage running now is done, saying what it found when there is something to say. */
  done(said?: string): void
}

interface Step {
  readonly text: string
  readonly done: boolean
}

/** For an answer nobody is watching. */
export const NO_STEPS: Steps = {
  begin: () => undefined,
  update: () => undefined,
  done: () => undefined,
}

/** What an Ask came to: its answer, or what stopped it (an error, as thrown). */
type Outcome = { readonly answer: AskReply } | { readonly failed: unknown }

/** An Ask as the device sees it when it asks after the ticket. */
export interface Seen {
  readonly steps: readonly Step[]
  /** False for a ticket this server has not seen, or let go of. */
  readonly known: boolean
  readonly outcome: Outcome | null
}

const KEPT_MS = 5 * 60_000
const MAX_TICKETS = 200
/**
 * How long an Ask goes on once the device's connection has closed, unless the
 * device asks after it meanwhile: long enough to switch apps and come back,
 * not so long that a phone put away keeps the model busy for nobody.
 */
export const GONE_MS = 60_000
const GONE_CHECK_MS = 5_000

interface Entry {
  steps: Step[]
  /** When it last changed, for letting it go. */
  at: number
  /** When the device last asked after it. */
  lookedAt: number
  outcome: Outcome | null
  /** Stops the work, when it is an Ask that outlasts its connection. */
  stop: AbortController | null
}

export class AskProgress {
  readonly #tickets = new Map<string, Entry>()

  /** The steps of the request this ticket names, kept as it runs. */
  track(ticket: string | undefined): Steps {
    if (!ticket) return NO_STEPS
    return this.#stepsOf(this.#open(ticket))
  }

  /**
   * `work`, which goes on when `gone` says the device's connection closed:
   * for as long as the device asks after the ticket within `GONE_MS`, and its
   * outcome kept for the device to collect (`seen`). Without a ticket nobody
   * can collect it, so it stops with the connection, as any other request.
   */
  outlast(
    ticket: string | undefined,
    gone: AbortSignal | undefined,
    work: (steps: Steps, signal: AbortSignal | undefined) => Promise<AskReply>,
  ): Promise<AskReply> {
    if (!ticket) return work(NO_STEPS, gone)
    const entry = this.#open(ticket)
    const stop = new AbortController()
    entry.stop = stop
    const left = (): void => {
      if (entry.outcome) return
      entry.lookedAt = Date.now()
      const check = setInterval(() => {
        if (entry.outcome || stop.signal.aborted) clearInterval(check)
        else if (Date.now() - entry.lookedAt > GONE_MS) {
          clearInterval(check)
          stop.abort()
        }
      }, GONE_CHECK_MS)
      check.unref?.()
    }
    if (gone?.aborted) left()
    else gone?.addEventListener('abort', left, { once: true })
    const running = work(this.#stepsOf(entry), stop.signal)
    running.then(
      answer => this.#settle(entry, { answer }),
      (caught: unknown) => this.#settle(entry, { failed: caught }),
    )
    return running
  }

  /** Stop pressed: the Ask this ticket names asks the model no more. */
  stop(ticket: string): void {
    this.#tickets.get(ticket)?.stop?.abort()
  }

  /** How the Ask this ticket names is going, or what it came to; asking keeps it going. */
  seen(ticket: string): Seen {
    const entry = this.#tickets.get(ticket)
    if (!entry) return { steps: [], known: false, outcome: null }
    entry.lookedAt = Date.now()
    return { steps: entry.steps, known: true, outcome: entry.outcome }
  }

  #open(ticket: string): Entry {
    this.#sweep()
    const now = Date.now()
    const entry: Entry = { steps: [], at: now, lookedAt: now, outcome: null, stop: null }
    this.#tickets.set(ticket, entry)
    return entry
  }

  #settle(entry: Entry, outcome: Outcome): void {
    entry.outcome = outcome
    entry.at = Date.now()
    entry.stop = null
  }

  #stepsOf(entry: Entry): Steps {
    const finishLast = (said?: string): void => {
      const last = entry.steps.at(-1)
      if (last && !last.done)
        entry.steps[entry.steps.length - 1] = { text: said ?? last.text, done: true }
    }
    return {
      begin: doing => {
        finishLast()
        entry.steps.push({ text: doing, done: false })
        entry.at = Date.now()
      },
      update: doing => {
        const last = entry.steps.at(-1)
        if (last && !last.done) entry.steps[entry.steps.length - 1] = { text: doing, done: false }
        else entry.steps.push({ text: doing, done: false })
        entry.at = Date.now()
      },
      done: said => {
        finishLast(said)
        entry.at = Date.now()
      },
    }
  }

  #sweep(): void {
    const now = Date.now()
    for (const [ticket, entry] of this.#tickets) {
      if (now - entry.at > KEPT_MS) this.#tickets.delete(ticket)
    }
    while (this.#tickets.size > MAX_TICKETS) {
      const oldest = this.#tickets.keys().next().value
      if (oldest === undefined) break
      this.#tickets.delete(oldest)
    }
  }
}
