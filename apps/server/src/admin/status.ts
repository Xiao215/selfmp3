import fs from 'node:fs'
import os from 'node:os'
import type { AdminServer } from '@selfmp3/shared'

/** How full the disk holding the data folder is; null where it cannot be asked. */
export function diskOf(dir: string): AdminServer['disk'] {
  try {
    const stats = fs.statfsSync(dir)
    return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize }
  } catch {
    return null
  }
}

/**
 * Memory in use. On Linux, what the kernel says is available rather than free:
 * the page cache counts as free memory here, and on a Pi it is most of it.
 */
export function memoryOf(): AdminServer['memory'] {
  const totalBytes = os.totalmem()
  let availableBytes = os.freemem()
  try {
    const match = /^MemAvailable:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'))
    if (match?.[1]) availableBytes = Number(match[1]) * 1024
  } catch {
    // Not Linux: os.freemem() is the closest there is.
  }
  return { usedBytes: Math.max(0, totalBytes - availableBytes), totalBytes }
}

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
  #last: { at: number; state: AdminServer['smart'] } | null = null

  constructor(baseUrl: string | null | undefined, fetcher: typeof fetch = fetch) {
    this.#baseUrl = (baseUrl ?? '').replace(/\/+$/, '')
    this.#fetch = fetcher
  }

  async state(now = Date.now()): Promise<AdminServer['smart']> {
    if (!this.#baseUrl) return 'off'
    if (this.#last && now - this.#last.at < PROBE_TTL_MS) return this.#last.state
    let state: AdminServer['smart']
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
