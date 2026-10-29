import { BUCKET_CAP_CODE, LENDER_CAP_CODE, parseDoormanRefusal } from '@selfmp3/shared'
import { bucketHold, holdBucket } from '@selfmp3/replica'
import { streamFailureMessage } from './streamFailure.model'
import { thisPlace } from './place'

/**
 * Why a file from the bucket would not come, asked of the doorman, or null
 * when it answers after all.
 *
 * The phone's player and its downloads fetch bucket files themselves, with the
 * bearer as a header (ports/bucketMedia.ts), so the doorman's refusal never
 * reaches the app's own requests: a player says only that it failed, a
 * download only that it did not finish. One byte of the same address is asked
 * for, and its answer is the reason. A bucket past its day's allowance is
 * then held for the whole app (`@selfmp3/replica`'s `bucketHold`): the songs
 * lined up after are passed over for the ones on this phone, and the
 * downloads wait, rather than each being tried and refused. While
 * the hold stands nothing is asked; its words are the answer.
 */
export async function askWhyRefused(
  url: string,
  headers: Readonly<Record<string, string>>,
  /** What to say when nothing answers; null says nothing, leaving what failed to speak. */
  noAnswer: string | null = null,
): Promise<string | null> {
  const held = bucketHold('read')
  if (held) return held.message
  try {
    const response = await fetch(url, { headers: { ...headers, range: 'bytes=0-0' } })
    if (response.ok || response.status === 206) return null
    const body = await response.text()
    const message = streamFailureMessage(response.status, body, thisPlace())
    noteRefusal(body, message)
    return message
  } catch {
    // No answer at all: nothing to add to what failed, unless the caller has words for it.
    return noAnswer
  }
}

/**
 * Act on a refusal a song's address answered with: this bucket's day held for
 * the whole app, or a friend's remembered (`noteLenderCap`). The browser's
 * engine reads its own answers (engine.web.ts, `#explainSource`) and tells them
 * here, so a tab's player passes over the songs it would have to fetch at once,
 * not after its service worker's word of the same refusal arrives.
 */
export function noteRefusal(body: string, message: string): void {
  if (parseDoormanRefusal(body)?.code === BUCKET_CAP_CODE) holdBucket(message, 'read')
  noteLenderCap(body, message)
}

/** The words of every lent song's refusal for its owner's day (`LENDER_CAP_CODE`) heard this session. */
const lenderCaps = new Set<string>()

/**
 * Remember a refusal that is a friend's bucket out of reads for the day: the
 * player says its words as they are ("Whoever sent it has run out of their
 * daily quota"), rather than its own "Couldn't play", and does not try again.
 * Nothing is held: it is their bucket, not this device's.
 */
function noteLenderCap(body: string, message: string): void {
  if (parseDoormanRefusal(body)?.code === LENDER_CAP_CODE) lenderCaps.add(message)
}

/** Whether an engine's error is a lent song's owner out of reads for the day. */
export function isLenderCap(error: string | null): error is string {
  return error !== null && lenderCaps.has(error)
}
