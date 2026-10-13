/**
 * A bucket's refusal, in terms of what to do about it — the one reading of an
 * S3 error for the doorman (apps/doorman/src/bucket.ts, which reads the XML
 * itself) and the server (apps/server/src/bucket/store.ts, which gets the
 * SDK's error), so the two say the same thing about the same answer.
 *
 * Written twice, they had drifted: the server named no bucket in a refused
 * key's message and repeated the bucket's words with the key still in them;
 * the doorman did both.
 *
 * - `auth`: the key is wrong, or not allowed this bucket.
 * - `network`: the bucket could not be reached.
 * - `missing`: there is no such bucket.
 * - `cap`: the account's allowance for the day is used up, so nothing else will
 *   get through either.
 * - `other`: anything else, in the bucket's own words.
 */
export type BucketRefusalKind = 'auth' | 'network' | 'missing' | 'cap' | 'other'

export interface BucketRefusal {
  readonly kind: BucketRefusalKind
  readonly message: string
}

/** S3's codes for a key that is not let in. */
const AUTH_CODES: ReadonlySet<string> = new Set([
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'AccessDenied',
  'Unauthorized',
  'Forbidden',
])

/** How much of the bucket's own words is repeated. */
const SAID_CHARACTERS = 240

export function classifyBucketRefusal(
  answer: {
    /** Absent when the SDK gave none. */
    readonly status: number | undefined
    /** S3's error code: `<Code>` in the XML, the SDK error's `name`. */
    readonly code: string | null
    /** What the bucket said: `<Message>`, the SDK error's message. */
    readonly message: string | null
  },
  where: {
    readonly bucket: string
    /** `s3.us-west-004.backblazeb2.com`, for messages. */
    readonly host: string
    /** The key's two halves, taken out of anything repeated. */
    readonly secrets: readonly string[]
  },
): BucketRefusal {
  const { status, code } = answer
  const said = describe(answer, where.secrets)

  if (code === 'NoSuchBucket') {
    return {
      kind: 'missing',
      message: `There is no bucket called “${where.bucket}” at ${where.host}.`,
    }
  }
  if (status === 401 || status === 403 || (code !== null && AUTH_CODES.has(code))) {
    // Backblaze answers a used-up cap with the same 403 a wrong key gets,
    // and says which only in its message: "Transaction cap exceeded". Read
    // as a refused key, a day's worth of imports looked like a lost key.
    if (answer.message && /cap exceeded/i.test(answer.message)) {
      return {
        kind: 'cap',
        message:
          `Backblaze says “${describe({ ...answer, code: null }, where.secrets)}”: the bucket's ` +
          'allowance for today is used up. Raise it under Caps & Alerts at backblaze.com, or ' +
          'wait — caps reset at midnight GMT, 5 pm Pacific.',
      }
    }
    const words = answer.message?.trim()
      ? ` Backblaze said “${describe({ ...answer, code: null }, where.secrets)}”.`
      : ''
    return {
      kind: 'auth',
      message:
        `The bucket refused the key${code ? ` (${code})` : ''}. Check the key ID and the ` +
        `application key, and that the key is allowed to use “${where.bucket}”.${words}`,
    }
  }
  return { kind: 'other', message: `${where.host}: ${said}` }
}

/** No answer from the bucket at all. */
export function bucketUnreachable(host: string): BucketRefusal {
  return { kind: 'network', message: `Could not reach ${host}.` }
}

/**
 * The bucket's own words, when it gave some: they are usually the useful part
 * ("the region 'us-east-1' is wrong; expecting 'eu-central-003'"). Trimmed,
 * and with anything that could be the key taken out.
 */
function describe(
  answer: { status: number | undefined; code: string | null; message: string | null },
  secrets: readonly string[],
): string {
  const message = answer.message?.trim()
  let text = message || answer.code || `it answered ${answer.status ?? 'nothing'}`
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('…')
  }
  if (text.length > SAID_CHARACTERS) text = `${text.slice(0, SAID_CHARACTERS)}…`
  return message && answer.code ? `${text} (${answer.code})` : text
}
