import type { ErrorBody } from '@selfmp3/shared'
import type { ZodError, ZodType, ZodTypeDef } from 'zod'
import { fromUtf8 } from './encoding.js'

/**
 * One error type for the whole doorman, and the plumbing every route shares.
 *
 * Handlers throw a `DoormanError` and the router turns it into a response, so
 * every error a device sees has the shape of `ErrorBodySchema`. The message is
 * always written here, by the doorman: nothing a caller sent, and nothing
 * secret, is ever echoed back in one.
 */
export class DoormanError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'DoormanError'
    this.status = status
    this.code = code
  }
}

export const badRequest = (message: string): DoormanError =>
  new DoormanError(400, 'bad_request', message)

export const unauthorized = (message = 'sign in first'): DoormanError =>
  new DoormanError(401, 'unauthorized', message)

export const forbidden = (message: string): DoormanError =>
  new DoormanError(403, 'forbidden', message)

export const notFound = (message = 'no such endpoint'): DoormanError =>
  new DoormanError(404, 'not_found', message)

export const unprocessable = (message: string): DoormanError =>
  new DoormanError(422, 'unprocessable', message)

/** Something the owner has to fix in the Worker's settings, not the caller. */
export const notSetUp = (message: string): DoormanError =>
  new DoormanError(500, 'not_set_up', message)

/** JSON, never cached: every answer the API gives is about one person, now. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function errorResponse(error: DoormanError): Response {
  const body: ErrorBody = { error: error.message, code: error.code }
  return json(body, error.status)
}

/**
 * `405`, with the `Allow` header the status is meaningless without.
 *
 * A response rather than a `DoormanError`, because only the caller knows which
 * methods this particular path takes, and that list has to reach the header.
 */
export function methodNotAllowed(allowed: readonly string[]): Response {
  const allow = allowed.join(', ')
  const response = errorResponse(
    new DoormanError(405, 'method_not_allowed', `use ${allow.replace(/, (?=[^,]*$)/, ' or ')}`),
  )
  response.headers.set('allow', allow)
  return response
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

/** JSON bodies are a few hundred bytes: a `CloudConnect`, a sign-in attempt. */
const MAX_JSON_BYTES = 16 * 1024

/**
 * A JSON body, checked against its schema.
 *
 * `Content-Type: application/json` is required rather than assumed: a browser
 * will only send it cross-origin after a CORS preflight, which a page on some
 * other address does not pass. So no form on another site can post here.
 */
export async function readJson<Output>(
  request: Request,
  schema: ZodType<Output, ZodTypeDef, unknown>,
): Promise<Output> {
  const type = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/i.test(type)) {
    throw new DoormanError(415, 'unsupported_media_type', 'send JSON, as application/json')
  }
  const bytes = await readBytes(request.body, MAX_JSON_BYTES + 1)
  if (bytes.length > MAX_JSON_BYTES) {
    throw new DoormanError(413, 'too_large', 'that body is too big')
  }

  let data: unknown
  try {
    data = JSON.parse(fromUtf8(bytes))
  } catch {
    throw badRequest('the body is not JSON')
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw badRequest(formatZodError(parsed.error))
  return parsed.data
}

/** The same wording the server uses for a request that fails its schema. */
export function formatZodError(error: ZodError): string {
  return error.issues
    .map(issue => {
      const where = issue.path.join('.')
      return where ? `${where}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/**
 * Up to `limit` bytes of a body, and the rest left unread. For bodies the
 * doorman reads itself — small JSON, the bucket's XML — so that an answer
 * far bigger than it should be costs nothing but the first few kilobytes.
 */
export async function readBytes(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < limit) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    if (total >= limit) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  const out = new Uint8Array(Math.min(total, limit))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, out.length - offset)
    out.set(part, offset)
    offset += part.length
    if (offset >= out.length) break
  }
  return out
}

/** Let go of a body nobody is going to read, so its connection is freed. */
export async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

/**
 * Text on its way to the log, with anything that could be a credential taken
 * out: an Authorization header, a request signature, a bearer token. An
 * error from the runtime can quote the header it choked on, and the log is
 * read in a dashboard, far from where the value belongs.
 */
export function redact(text: string): string {
  return text
    .replace(/AWS4-HMAC-SHA256[^\r\n]*/gi, 'AWS4-HMAC-SHA256 …')
    .replace(
      /\b(X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|Signature)=[^\s&,]*/gi,
      '$1=…',
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer …')
    .replace(/\b(authorization)\s*[:=]\s*[^\r\n]*/gi, '$1: …')
}
