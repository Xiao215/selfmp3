import { parseDoormanRefusal } from '@selfmp3/shared'

/**
 * Why a song would not play, from what its stream address answers.
 *
 * An `<audio>` element that cannot use its source says only that — the same
 * "not supported" for a bucket past its day's allowance, a doorman that is
 * down, and a song that was never saved on this device — and the player
 * said "not available offline" for all three. The address itself says which:
 * asked for one byte, it answers with the service worker's words (a 503 in
 * plain text) or the doorman's (a 502 in JSON, with `error`).
 */
export function streamFailureMessage(status: number, body: string): string {
  const text = body.trim()
  const plain =
    status === 404 || status === 503
      ? 'This song is not available offline'
      : 'Could not play this song'
  // JSON is the doorman's, or nothing worth repeating.
  if (text.startsWith('{')) return parseDoormanRefusal(text)?.error.trim() || plain
  if (text && text.length <= 300 && !text.startsWith('<')) return text.replace(/\.$/, '')
  return plain
}
