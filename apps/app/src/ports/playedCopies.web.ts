import { isHashNamedCloudKey } from '@selfmp3/shared'
import { onBucketHold, onDoormanTrouble } from '@selfmp3/replica'
import { PLAYED_CACHE, PLAYED_PREFIX } from '../../sw/names'
import { appPath } from './appPath'
import { desktop } from './desktop/bridge'

/**
 * The cloud songs a browser's service worker kept for having played them
 * (sw.ts, `playFromBucket`): the last few, by bucket key.
 *
 * A tab downloads nothing by itself, so these and the songs saved by hand are
 * all it has of its own. They matter on the day the bucket refuses reads: every
 * other song would be tried, refused, retried and skipped in turn, so the
 * player has to know which ones the worker can still answer from here.
 *
 * Read from the cache itself, which the page can open as well as the worker,
 * once on load and again whenever the worker says it kept another
 * (`SW_MESSAGE.played`, src/ports/serviceWorker.web.ts) or the page cleared
 * them at sign-out.
 *
 * The desktop app has no service worker: its shell keeps them instead, as
 * files in its `played` folder (apps/desktop/src/main/stream.ts), named after
 * the key with its slash made a dash. Left out, a capped bucket faded every
 * row on the Mac, the songs that still played from that folder among them.
 * Read on load, and again as a hold begins or the doorman stops answering —
 * the moments they are all that plays.
 */

let kept: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

/** The bucket keys of the songs kept, as last read. */
export function playedKeys(): ReadonlySet<string> {
  return kept
}

/** Hear the kept songs change. */
export function onPlayedKeys(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Read the cache again: the worker kept a song, or the page let them all go. */
export async function refreshPlayed(): Promise<void> {
  try {
    const next = desktop ? await keptByShell() : await keptByWorker()
    if (next === null) return
    if (next.size === kept.size && [...next].every(key => kept.has(key))) return
    kept = next
    for (const listener of listeners) listener()
  } catch {
    // Storage blocked: the tab plays as though it kept nothing, which is how it began.
  }
}

async function keptByWorker(): Promise<Set<string> | null> {
  if (typeof caches === 'undefined') return null
  const prefix = new URL(appPath(PLAYED_PREFIX), location.href).href
  const requests = await (await caches.open(PLAYED_CACHE)).keys()
  return new Set(
    requests.flatMap(({ url }) =>
      url.startsWith(prefix) ? [decodeURIComponent(url.slice(prefix.length))] : [],
    ),
  )
}

async function keptByShell(): Promise<Set<string> | null> {
  if (!desktop) return null
  const files = await desktop.files.list('played')
  return new Set(
    files.flatMap(({ name }) => {
      const key = name.replace('-', '/')
      return isHashNamedCloudKey(key) ? [key] : []
    }),
  )
}

void refreshPlayed()
onBucketHold(hold => {
  if (hold !== null) void refreshPlayed()
})
onDoormanTrouble(trouble => {
  if (trouble?.kind === 'unreachable') void refreshPlayed()
})
