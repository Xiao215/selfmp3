/**
 * What to do about a page its service worker is not answering for.
 *
 * A browser's hard reload (Shift-Cmd-R) loads the page around the worker, and
 * by the spec leaves it that way for the page's whole life: the worker is
 * installed, active, and not consulted. In most apps that costs a cache. Here
 * the worker is how a cloud library's songs and covers are fetched at all — an
 * `<audio>` element asks for the app's own `api/stream/<id>`, and only the
 * worker knows that means a file in the bucket (ports/bucketMedia.web.ts). So a
 * hard-reloaded tab asked GitHub Pages for them instead, was handed a 404, and
 * showed a library with every cover missing in which no song would play —
 * "This song is not available offline", about a song that was never offline.
 *
 * The way back is an ordinary reload, which the worker does answer. Once: a
 * browser that will not give this page a controller at all — site data blocked,
 * a private window that refuses workers — must not be reloaded forever, so a
 * second attempt inside the window below is refused and the page is left as it
 * is, which is no worse than before.
 */

/** Long enough that a reload's own load cannot outlast it; short enough that tomorrow's hard reload is a new one. */
export const RELOAD_ONCE_WITHIN_MS = 30_000

/** How long a newly installed worker gets to claim the page before it counts as never coming. */
export const CLAIM_GRACE_MS = 2_000

export function shouldReloadForControl({
  controlled,
  lastReloadAt,
  now,
}: {
  /** Whether the page has a controlling worker now, after the grace period. */
  controlled: boolean
  /** When this tab last reloaded itself for this reason, or null if it never has. */
  lastReloadAt: number | null
  now: number
}): boolean {
  if (controlled) return false
  if (lastReloadAt === null || !Number.isFinite(lastReloadAt)) return true
  return now - lastReloadAt > RELOAD_ONCE_WITHIN_MS
}
