/**
 * What a smart answer is doing while it is asked for (docs/features/ai.md,
 * "Steps"): the stages in plain words, with the numbers they find — "349 songs
 * fit", "Choosing 25 that suit it" — so the wait says what is happening
 * rather than "Working on the answer" for everything.
 *
 * The answer itself still comes back as one response. The device names its
 * request with a ticket and asks after it while it waits; the steps are kept
 * here for a few minutes, in memory only.
 */

/** Told as an answer moves from one stage to the next. */
export interface Steps {
  /** A new stage begins; the one before it is done. */
  begin(doing: string): void
  /** The stage running now is done, saying what it found when there is something to say. */
  done(said?: string): void
}

export interface Step {
  readonly text: string
  readonly done: boolean
}

/** For an answer nobody is watching. */
export const NO_STEPS: Steps = { begin: () => undefined, done: () => undefined }

const KEPT_MS = 5 * 60_000
const MAX_TICKETS = 200

export class AskProgress {
  readonly #tickets = new Map<string, { steps: Step[]; at: number }>()

  /** The steps of the request this ticket names, kept as it runs. */
  track(ticket: string | undefined): Steps {
    if (!ticket) return NO_STEPS
    this.#sweep()
    const entry = { steps: [] as Step[], at: Date.now() }
    this.#tickets.set(ticket, entry)
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
      done: said => {
        finishLast(said)
        entry.at = Date.now()
      },
    }
  }

  /** The steps so far, or none for a ticket this server has not seen. */
  steps(ticket: string): readonly Step[] {
    return this.#tickets.get(ticket)?.steps ?? []
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
