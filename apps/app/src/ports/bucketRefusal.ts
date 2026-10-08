import { BUCKET_CAP_CODE, bucketHold, holdBucket } from '@selfmp3/replica'
import { streamFailureMessage } from './streamFailure.model'

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
 * downloads wait, rather than each being tried and refused (2026-10-08). While
 * the hold stands nothing is asked; its words are the answer.
 */
export async function askWhyRefused(
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<string | null> {
  const held = bucketHold('read')
  if (held) return held.message
  try {
    const response = await fetch(url, { headers: { ...headers, range: 'bytes=0-0' } })
    if (response.ok || response.status === 206) return null
    const body = await response.text()
    const message = streamFailureMessage(response.status, body)
    if (refusedForTheDay(body)) holdBucket(message, 'read')
    return message
  } catch {
    // No answer at all: nothing to add to what failed.
    return null
  }
}

/** The doorman's word for a bucket past its day's allowance (packages/replica/src/hold.ts). */
function refusedForTheDay(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body)
    return (parsed as { code?: unknown } | null)?.code === BUCKET_CAP_CODE
  } catch {
    return false
  }
}
