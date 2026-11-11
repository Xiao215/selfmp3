import { DOORMAN_ERROR, DoormanError, formatZodError, type ErrorBody } from '@selfmp3/shared'
import type { ZodType, ZodTypeDef } from 'zod'
import { fromUtf8 } from './encoding.js'

/**
 * The plumbing every route shares, and one error type for the whole doorman:
 * the same `DoormanError` its clients read back (packages/shared's
 * doormanClient.ts), so a code is spelled once from the throw to the screen.
 *
 * Handlers throw a `DoormanError` and the router turns it into a response, so
 * every error a device sees has the shape of `ErrorBodySchema`. The message is
 * always written here, by the doorman: nothing a caller sent, and nothing
 * secret, is ever echoed back in one.
 */

export const badRequest = (message: string): DoormanError =>
  new DoormanError(400, DOORMAN_ERROR.badRequest, message)

export const unauthorized = (message = 'sign in first'): DoormanError =>
  new DoormanError(401, DOORMAN_ERROR.unauthorized, message)

export const forbidden = (message: string): DoormanError =>
  new DoormanError(403, DOORMAN_ERROR.forbidden, message)

export const notFound = (message = 'no such endpoint'): DoormanError =>
  new DoormanError(404, DOORMAN_ERROR.notFound, message)

export const unprocessable = (message: string): DoormanError =>
  new DoormanError(422, DOORMAN_ERROR.unprocessable, message)

/** Something the owner has to fix in the Worker's settings, not the caller. */
export const notSetUp = (message: string): DoormanError =>
  new DoormanError(500, DOORMAN_ERROR.notSetUp, message)

/** JSON, never cached: every answer the API gives is about one person, now. */
/** What every JSON answer of the doorman's says about itself. */
export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
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
    new DoormanError(
      405,
      DOORMAN_ERROR.methodNotAllowed,
      `use ${allow.replace(/, (?=[^,]*$)/, ' or ')}`,
    ),
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
  /** Larger only for a body that has to be: a room's sound vectors. */
  maxBytes: number = MAX_JSON_BYTES,
): Promise<Output> {
  const type = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/i.test(type)) {
    throw new DoormanError(
      415,
      DOORMAN_ERROR.unsupportedMediaType,
      'send JSON, as application/json',
    )
  }
  const bytes = await readBytes(request.body, maxBytes + 1)
  if (bytes.length > maxBytes) {
    throw new DoormanError(413, DOORMAN_ERROR.tooLarge, 'that body is too big')
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

/** `localhost` or `127.0.0.1`: this computer, as an address names it. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/**
 * An address that is not on the public internet, as a URL's hostname names it:
 * this computer, a home or office network, a tailnet's 100.64/10, a link-local
 * or cloud metadata address, or a name only a local network answers. Only
 * literal addresses and those names are known here; a public name that a
 * local resolver points somewhere private is not (a Worker cannot reach one).
 * The URL parser has already turned `2130706433` and `0x7f.1` into
 * `127.0.0.1`, and wraps IPv6 in brackets.
 */
function isPrivateHost(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '')
  if (name.startsWith('[')) return isPrivateIPv6(name.slice(1, -1))
  const v4 = ipv4(name)
  if (v4) return isPrivateIPv4(...v4)
  // A name with no dot only a local network can answer.
  return (
    !name.includes('.') ||
    name === 'localhost' ||
    /\.(localhost|local|internal|lan|home\.arpa)$/.test(name)
  )
}

/**
 * Whether the doorman may send a request to a host someone else chose: a
 * grant's server, a bucket's endpoint, a room host's server. Anywhere on the
 * public internet, and this computer too under `wrangler dev --env dev` (DEV);
 * never an address off it, which anyone signed in could otherwise make the
 * doorman knock on.
 */
export function mayReach(hostname: string, dev: boolean): boolean {
  return !isPrivateHost(hostname) || (dev && isLoopbackHost(hostname))
}

/** A dotted IPv4 address's first two bytes, which are all its private ranges need. */
function ipv4(text: string): [number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!match || match.slice(1).some(part => Number(part) > 255)) return null
  return [Number(match[1]), Number(match[2])]
}

function isPrivateIPv4(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateIPv6(text: string): boolean {
  const address = text.toLowerCase()
  if (address === '::' || address === '::1') return true
  // An IPv4 address written as IPv6 (`::ffff:7f00:1`) is judged as that address.
  const mapped = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(address)
  if (mapped) {
    const high = parseInt(mapped[1] ?? '', 16)
    return isPrivateIPv4(high >> 8, high & 255)
  }
  return /^(f[cd]|fe[89ab]|ff)/.test(address)
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
