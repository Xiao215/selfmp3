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
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text)
      const error = (parsed as { error?: unknown } | null)?.error
      return typeof error === 'string' && error.trim() ? error.trim() : plain
    } catch {
      // Not JSON after all: read as words below.
    }
  }
  if (text && text.length <= 300 && !text.startsWith('<')) return text.replace(/\.$/, '')
  return plain
}
