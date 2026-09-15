/**
 * The one error type every screen already knows how to read.
 *
 * `isOffline` in particular decides what the UI says, so this is written once
 * rather than duplicated per platform, where drifting would have been a real
 * bug rather than an untidiness.
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

/**
 * A failed edit in words: what did not happen, then why. Not reaching the
 * library is said as that, rather than as whatever the network layer threw.
 */
export function failureText(failure: string, error: unknown): string {
  if (error instanceof ApiError && error.isOffline)
    return `${failure}: the library can’t be reached`
  const reason = error instanceof Error && error.message ? error.message : 'something went wrong'
  return `${failure}: ${reason}`
}
