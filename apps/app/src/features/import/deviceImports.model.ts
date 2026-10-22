import {
  freshState,
  isRateLimited,
  penalize,
  PERSON_MAY_BORROW,
  spend,
  waitMs,
  type ImportDeviceFileMeta,
  type ImportDeviceLease,
  type ImportJob,
  type ThrottleState,
} from '@selfmp3/shared'

/**
 * Songs this device downloads itself, for its server to add
 * (docs/features/client-download.md).
 *
 * An import that asked for it comes back with a lease on its YouTube songs.
 * This downloads them one at a time, in the order they were asked for, paced
 * by the same budget a server keeps (ytBudget.ts) — the device is an address
 * YouTube counts, as the server's is — and sends each file to the server,
 * which adds it as it would a download of its own. The lease is renewed
 * while there is work left on it, and the server's answer is what decides:
 * a song the server no longer holds for this device (cancelled, removed, or
 * taken back) is let go here too.
 *
 * Whatever this cannot download is handed back to the server, never failed:
 * the server can always fetch it the old way. A refusal for rate hands back
 * everything still waiting, since this device will not be let back in for a
 * while and the server may be.
 */

/** A song's file, as `packages/ytclient`'s downloader gives it. */
export interface DeviceFile {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly sha256: string
  readonly meta: ImportDeviceFileMeta
}

export interface DeviceDownloader {
  download(
    url: string,
    options: { onProgress: (percent: number) => void; signal: AbortSignal },
  ): Promise<DeviceFile>
  /** Whether the song is downloaded already — heard in the review — and costs YouTube nothing. */
  has(url: string): boolean
}

/** The calls on the server this needs: its API's, narrowed. */
export interface DeviceImportsApi {
  importDeviceRenew(
    lease: string,
    progress: readonly { id: string; percent: number }[],
  ): Promise<{ held: string[] }>
  importDeviceStart(lease: string, id: string): Promise<unknown>
  importDeviceRelease(lease: string, id: string, reason: string): Promise<unknown>
  importDeviceFileTarget(
    id: string,
    lease: string,
  ): { url: string; headers: Record<string, string> } | null
}

interface DeviceImportsDeps {
  /** This device's downloader, or null when it has none (no extension, no browser). */
  readonly downloader: () => Promise<DeviceDownloader | null>
  /** Send a file to where the server said; the status it answered, and its words. */
  readonly upload: (
    target: { url: string; headers: Record<string, string> },
    file: DeviceFile,
  ) => Promise<{ status: number; message: string }>
  /** Where this device's budget at YouTube is kept between visits. */
  readonly budget: { get(): ThrottleState | null; save(state: ThrottleState): void }
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  /** Renew every `ms` until the returned function is called. */
  readonly every: (ms: number, tick: () => void) => () => void
  readonly log: (message: string, details?: Record<string, unknown>) => void
  /**
   * Whether a refusal for rate hands what is left to the server (the device's
   * setting, devicePrefs.ts). Off, the song goes back to the front of the line
   * and waits the refusal out here, on a lease kept alive meanwhile.
   */
  readonly handBack: () => boolean
}

/** How often a lease is renewed: well inside the server's five minutes, even in a background tab. */
const RENEW_MS = 60_000

/** A device asks YouTube signed out: the extension carries no cookies. */
const SIGNED_IN = false

interface Batch {
  readonly api: DeviceImportsApi
  readonly lease: string
  readonly jobs: ReadonlyMap<string, ImportJob>
  /** What is still to download, in the order it was asked for. */
  readonly waiting: string[]
  /** The download under way, and how to stop it. */
  active: { id: string; percent: number; stop: AbortController } | null
  stopRenewing: () => void
}

export class DeviceImports {
  readonly #deps: DeviceImportsDeps
  readonly #batches: Batch[] = []
  #running: Promise<void> | null = null

  constructor(deps: DeviceImportsDeps) {
    this.#deps = deps
  }

  /** Whether anything is still to download here, or downloading. */
  get busy(): boolean {
    return this.#batches.length > 0
  }

  /** Start on the jobs an import left this device (`ImportEnqueueResult.device`). */
  take(api: DeviceImportsApi, lease: ImportDeviceLease, jobs: readonly ImportJob[]): void {
    const held = new Set(lease.jobIds)
    const batch: Batch = {
      api,
      lease: lease.lease,
      jobs: new Map(jobs.filter(job => held.has(job.id)).map(job => [job.id, job])),
      waiting: lease.jobIds.filter(id => jobs.some(job => job.id === id)),
      active: null,
      stopRenewing: () => undefined,
    }
    if (batch.waiting.length === 0) return
    batch.stopRenewing = this.#deps.every(RENEW_MS, () => void this.#renew(batch))
    this.#batches.push(batch)
    this.#running ??= this.#work().finally(() => {
      this.#running = null
    })
  }

  /** For a test: until everything taken so far is done with. */
  async settled(): Promise<void> {
    while (this.#running) await this.#running
  }

  async #work(): Promise<void> {
    for (;;) {
      const batch = this.#batches.find(each => each.waiting.length > 0)
      if (!batch) return
      const id = batch.waiting.shift()
      if (id !== undefined) await this.#one(batch, id)
      this.#finishIfDone(batch)
    }
  }

  async #one(batch: Batch, id: string): Promise<void> {
    const job = batch.jobs.get(id)
    const downloader = await this.#deps.downloader()
    if (!job || !downloader) {
      await this.#release(batch, id, 'this device can no longer download from YouTube')
      return
    }
    // A song heard in the review is here already, and asks YouTube for nothing.
    if (!downloader.has(job.url)) await this.#pace()

    try {
      await batch.api.importDeviceStart(batch.lease, id)
    } catch {
      // Not held any more — cancelled or taken back while it waited. Nothing to do.
      return
    }

    const stop = new AbortController()
    batch.active = { id, percent: 0, stop }
    try {
      const file = await downloader.download(job.url, {
        signal: stop.signal,
        onProgress: percent => {
          if (batch.active?.id === id) batch.active.percent = percent
        },
      })
      stop.signal.throwIfAborted()
      const target = batch.api.importDeviceFileTarget(id, batch.lease)
      if (!target) throw new Error('there is no server to send the file to')
      const answer = await this.#deps.upload(target, file)
      if (answer.status !== 202) {
        throw new Error(`the server did not take the file (${answer.status}): ${answer.message}`)
      }
      this.#deps.log('downloaded on this device', { id, title: job.title })
    } catch (error) {
      // Taken from this device mid-download: the server has it, or nobody wants it.
      if (stop.signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      if (isRateLimited(message)) {
        this.#deps.budget.save(penalize(this.#budget(), this.#deps.now()))
        if (!this.#deps.handBack()) {
          this.#deps.log('YouTube refused this device for rate; it waits, and goes on', {
            message,
          })
          batch.waiting.unshift(id)
          return
        }
        this.#deps.log('YouTube refused this device for rate; the server takes the rest', {
          message,
        })
        await this.#release(batch, id, message)
        await this.#releaseEverything(message)
        return
      }
      this.#deps.log('could not download on this device', { id, message })
      await this.#release(batch, id, message)
    } finally {
      batch.active = null
    }
  }

  /**
   * Wait for a turn at YouTube, as the server's queue does (ytBudget.ts) —
   * but as a person's request: a few may go on turns the bucket has not
   * filled yet (`PERSON_MAY_BORROW`), so the first songs of an import on a
   * device that has never downloaded do not wait out an empty bucket.
   */
  async #pace(): Promise<void> {
    for (;;) {
      const now = this.#deps.now()
      const next = spend(this.#budget(), SIGNED_IN, now, PERSON_MAY_BORROW)
      if (next) {
        this.#deps.budget.save(next)
        return
      }
      const wait = waitMs(this.#budget(), SIGNED_IN, now, PERSON_MAY_BORROW)
      await this.#deps.sleep(Math.max(250, wait))
    }
  }

  #budget(): ThrottleState {
    return this.#deps.budget.get() ?? freshState(this.#deps.now())
  }

  /** Keep the lease, and drop whatever the server says this device no longer holds. */
  async #renew(batch: Batch): Promise<void> {
    const active = batch.active
    let held: Set<string>
    try {
      const answer = await batch.api.importDeviceRenew(
        batch.lease,
        active ? [{ id: active.id, percent: Math.min(99, active.percent) }] : [],
      )
      held = new Set(answer.held)
    } catch {
      // The server did not answer this once; the lease outlasts a few of these.
      return
    }
    for (let index = batch.waiting.length - 1; index >= 0; index--) {
      if (!held.has(batch.waiting[index] ?? '')) batch.waiting.splice(index, 1)
    }
    if (active && !held.has(active.id)) active.stop.abort()
    this.#finishIfDone(batch)
  }

  async #release(batch: Batch, id: string, reason: string): Promise<void> {
    try {
      await batch.api.importDeviceRelease(batch.lease, id, reason)
    } catch {
      // Gone already, or the server is away: either way the lease runs out and it is the server's.
    }
  }

  async #releaseEverything(reason: string): Promise<void> {
    for (const batch of this.#batches) {
      const waiting = batch.waiting.splice(0)
      for (const id of waiting) await this.#release(batch, id, reason)
    }
  }

  #finishIfDone(batch: Batch): void {
    if (batch.waiting.length > 0 || batch.active) return
    batch.stopRenewing()
    const index = this.#batches.indexOf(batch)
    if (index !== -1) this.#batches.splice(index, 1)
  }
}
