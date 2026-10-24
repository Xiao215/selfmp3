import type { AdminData } from '@selfmp3/shared'

/** How long one look at the model's endpoint is believed. */
const PROBE_TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 3_000

/**
 * Whether the Smart features' endpoint answers, looked at no more than once a
 * minute. Any HTTP answer counts, even an error: the question is whether
 * something is there, not whether a request would work without a key.
 */
export class SmartProbe {
  readonly #baseUrl: string
  readonly #fetch: typeof fetch
  #last: { at: number; state: AdminData['status']['smart'] } | null = null

  constructor(baseUrl: string | null | undefined, fetcher: typeof fetch = fetch) {
    this.#baseUrl = (baseUrl ?? '').replace(/\/+$/, '')
    this.#fetch = fetcher
  }

  async state(now = Date.now()): Promise<AdminData['status']['smart']> {
    if (!this.#baseUrl) return 'off'
    if (this.#last && now - this.#last.at < PROBE_TTL_MS) return this.#last.state
    let state: AdminData['status']['smart']
    try {
      const response = await this.#fetch(`${this.#baseUrl}/models`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      await response.body?.cancel()
      state = 'answering'
    } catch {
      state = 'not-answering'
    }
    this.#last = { at: now, state }
    return state
  }
}
