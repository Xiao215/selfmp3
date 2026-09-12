/**
 * The one error type every screen already knows how to read.
 *
 * Moved verbatim from `apps/web/src/lib/api.ts`, which had a byte-identical
 * copy in `apps/mobile/src/api/client.ts`. `isOffline` in particular decides
 * what the UI says, so the two having drifted would have been a real bug rather
 * than an untidiness.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  /** True when the request failed because the device is offline. */
  get isOffline(): boolean {
    return this.status === 0
  }
}
