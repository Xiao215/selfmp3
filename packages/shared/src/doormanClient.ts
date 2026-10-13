import {
  DOORMAN_ERROR,
  parseDoormanRefusal,
  refusalWords,
  type DoormanErrorCode,
} from './doormanWire.js'

/**
 * Asking the doorman, from anywhere: the server (apps/server/src/bucket/
 * doorman.ts), a device's replica (packages/replica/src/session.ts), and a
 * device in a room or a shared playlist (packages/client/src/room/).
 *
 * Each of them had its own: three ways to attach a session and a JSON body,
 * three readings of a refusal, and two `DoormanError` classes that took their
 * arguments in opposite orders. This is the one. It is given its `fetch`, as
 * everything here is, so a test can hand it the real doorman (apps/doorman's
 * `harness()`) and a browser its own.
 *
 * The shapes are structural and as small as the reading needs: a browser's
 * `fetch`, Node's, React Native's and a test's all satisfy them by being
 * themselves, and each caller gets back its own kind of response.
 */

/** As much of a response as the client reads. Callers get their own, whole. */
export interface DoormanResponse {
  readonly ok: boolean
  readonly status: number
  text(): Promise<string>
}

export interface DoormanRequestInit<Signal> {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  signal?: Signal
}

export type DoormanFetch<Answer extends DoormanResponse = DoormanResponse, Signal = never> = (
  url: string,
  init: DoormanRequestInit<Signal>,
) => Promise<Answer>

/**
 * A doorman request that failed: status 0 for no answer at all, else the
 * status it was refused with, and always a code from `DOORMAN_ERROR` — the
 * doorman's own, or `unreachable`, `no_doorman` and `unexpected` for what it
 * never said.
 */
export class DoormanError extends Error {
  readonly status: number
  readonly code: DoormanErrorCode

  constructor(status: number, code: DoormanErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DoormanError'
    this.status = status
    this.code = code
  }

  /**
   * A room or shared playlist that is over for this member: it ended, was
   * forgotten, or they were taken out of it.
   */
  get gone(): boolean {
    return this.status === 410 || this.status === 404 || this.code === DOORMAN_ERROR.roomLeft
  }
}

export interface DoormanCall<Signal = never> {
  readonly method?: string
  /** The session, sent as `Authorization: Bearer`. */
  readonly token?: string | null
  /** A body sent as JSON, with its Content-Type. */
  readonly json?: unknown
  /** A body sent as it is: a file's bytes. */
  readonly body?: Uint8Array
  readonly headers?: Record<string, string>
  /** Answers besides 2xx that are the caller's to read, not failures: 404 is "no such file". */
  readonly allowStatus?: readonly number[]
  /** Call the request off: the player that asked for a range has moved on. */
  readonly signal?: Signal
}

export type DoormanRequest<Answer extends DoormanResponse, Signal = never> = (
  path: string,
  call?: DoormanCall<Signal>,
) => Promise<Answer>

/**
 * One request at a time to the doorman at `doormanUrl`: a path from
 * `DOORMAN_PATHS`, and the answer when it is a yes (or one of `allowStatus`).
 * Anything else throws a `DoormanError` with the doorman's own code and
 * words; no answer at all throws one with status 0, the failure as its cause.
 */
export function doormanRequest<Answer extends DoormanResponse, Signal = never>(
  doormanUrl: string,
  fetch: DoormanFetch<Answer, Signal>,
): DoormanRequest<Answer, Signal> {
  const base = doormanUrl.replace(/\/+$/, '')
  return async (path, call = {}) => {
    if (!base) {
      throw new DoormanError(
        0,
        DOORMAN_ERROR.noDoorman,
        'This app is not connected to a doorman yet.',
      )
    }
    const headers: Record<string, string> = { ...call.headers }
    if (call.token) headers['authorization'] = `Bearer ${call.token}`
    let body: string | Uint8Array | undefined
    if (call.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(call.json)
    } else if (call.body !== undefined) {
      // No Content-Length of our own: fetch sends one for a byte body, and on
      // Node 22 its copy and ours reach undici's Agent as two, which it
      // refuses outright ("invalid content-length header").
      body = call.body
    }

    let answer: Answer
    try {
      answer = await fetch(`${base}${path}`, {
        method: call.method ?? 'GET',
        headers,
        ...(body === undefined ? {} : { body }),
        ...(call.signal === undefined ? {} : { signal: call.signal }),
      })
    } catch (error) {
      throw new DoormanError(0, DOORMAN_ERROR.unreachable, whyFetchFailed(error), { cause: error })
    }
    if (answer.ok || call.allowStatus?.includes(answer.status)) return answer
    throw await refusalOf(answer)
  }
}

/** A refused answer, as the error it is. */
export async function refusalOf(answer: DoormanResponse): Promise<DoormanError> {
  const text = await answer.text().catch(() => '')
  const refusal = parseDoormanRefusal(text)
  if (refusal) {
    // A code this build does not know yet is still the doorman's own words.
    const code = isDoormanErrorCode(refusal.code) ? refusal.code : DOORMAN_ERROR.unexpected
    return new DoormanError(answer.status, code, refusal.error)
  }
  const words = refusalWords(text)
  return new DoormanError(
    answer.status,
    DOORMAN_ERROR.unexpected,
    words
      ? `the doorman answered ${answer.status}: ${words}`
      : `the doorman answered ${answer.status}`,
  )
}

const CODES: ReadonlySet<string> = new Set(Object.values(DOORMAN_ERROR))

function isDoormanErrorCode(code: string): code is DoormanErrorCode {
  return CODES.has(code)
}

/**
 * fetch's own word is "fetch failed"; why is one level down. A doorman that
 * answered everyone else once looked unreachable because nothing said "The
 * session has been destroyed".
 */
function whyFetchFailed(error: unknown): string {
  const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error
  if (reason instanceof Error) return reason.message
  return typeof reason === 'string' ? reason : 'network unavailable'
}
