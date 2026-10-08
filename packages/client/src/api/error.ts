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

  /**
   * True when the question was never answered: the device offline, or the
   * library's side having a moment — a server erroring, the bucket refusing
   * for the day (`bucket_cap_exceeded`). A copy kept from before is not stale
   * against an answer like that, and "nothing found" is not what it said.
   */
  get isUnanswered(): boolean {
    return this.status === 0 || this.status >= 500
  }

  /**
   * True when the bucket refused because its daily allowance is used up
   * (Backblaze's cap). Everything is reachable; downloads come back when the
   * cap resets at midnight GMT, or once it is raised.
   */
  get isBucketCapped(): boolean {
    return this.code === 'bucket_cap_exceeded'
  }
}

/**
 * A failed edit in words: what did not happen, then — only when it helps —
 * why, said plainly.
 *
 * Not reaching the library is said as that, and a used-up storage allowance
 * as that, rather than as whatever the network layer threw. A refusal the
 * server worded for people ("a tag called “chill” already exists") is kept.
 * Everything else — a 500, an answer of the wrong shape, a request the
 * server could not read, an exception from the platform — is a detail for
 * whoever is debugging, not for the person who pressed the button, and the
 * sentence stops at what did not happen. The app's toast logs the detail.
 */
export function failureText(failure: string, error: unknown): string {
  if (error instanceof ApiError && error.isOffline)
    return `${failure}, your library isn’t reachable right now`
  if (error instanceof ApiError && error.isBucketCapped)
    return `${failure}, your storage’s allowance for today is used up`
  if (error instanceof ApiError && saidForPeople(error)) return `${failure}: ${error.message}`
  return failure
}

/**
 * A refusal the server put into words for the person: a 4xx it explained.
 * Not a 400, which is a request it could not read (a zod message), and not
 * one whose body it never sent (`code` left at `error`, the message being
 * "POST /api/… failed (404)").
 */
function saidForPeople(error: ApiError): boolean {
  return (
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 400 &&
    error.code !== 'error' &&
    error.message.length > 0
  )
}
