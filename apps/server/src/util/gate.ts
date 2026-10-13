/**
 * At most `size` of something at once, the rest waiting their turn in order.
 *
 * For work that is cheap to queue and expensive to run side by side: a server
 * working for several libraries analyses one song at a time across all of them
 * (docs/features/shared-server.md), where each library alone would run its own.
 */
export class Gate {
  readonly #size: number
  #running = 0
  readonly #waiting: (() => void)[] = []

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 1) throw new Error('a gate lets at least one through')
    this.#size = size
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#size) {
      await new Promise<void>(resolve => this.#waiting.push(resolve))
    } else {
      this.#running++
    }
    try {
      return await work()
    } finally {
      // The turn passes straight to the next in line, so `#running` holds.
      const next = this.#waiting.shift()
      if (next) next()
      else this.#running--
    }
  }
}
