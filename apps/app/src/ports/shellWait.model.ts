/**
 * How long the service worker waits on the network for the app's page before
 * it answers with the copy it keeps (sw/sw.ts, `handleShell`).
 *
 * The page is asked for first so a deploy shows up on the next open. But a
 * connection that hangs rather than fails — a captive portal, Wi-Fi with no
 * internet behind it, a train in a tunnel — never throws, and waiting on it
 * left the installed app a white page for as long as the browser cared to
 * wait (40 s and more). Past this, the kept page is the answer, and the
 * network's, if it ever comes, is kept for next time.
 */
export const SHELL_WAIT_MS = 3_000

/**
 * The network's answer if it comes within `waitMs`, else `kept`.
 *
 * With nothing kept there is nothing better to give, so the network is waited
 * on for as long as it takes. A network that fails outright is `kept` at once.
 */
export async function answerWithin<T>(
  network: Promise<T>,
  kept: T | undefined,
  waitMs: number,
): Promise<T> {
  if (kept === undefined) return network
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(kept), waitMs)
  })
  try {
    return await Promise.race([network.catch(() => kept), late])
  } finally {
    clearTimeout(timer)
  }
}
