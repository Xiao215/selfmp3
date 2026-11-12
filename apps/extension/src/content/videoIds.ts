/**
 * The one script that runs in YouTube Music's own world: it writes each Up
 * next row's video onto the row, where the content script can read it.
 *
 * Those rows carry no link — a queue item's video is only in the data Polymer
 * hands it, a property the page's JavaScript sets and a content script, in its
 * own world, cannot see. So this reads it there and puts it on an attribute,
 * which both worlds share. It reads and writes nothing else, asks nothing of
 * the extension and holds nothing of yours: the worker is reached only from
 * the content script.
 *
 * A row with a Song/Video switch is two videos of one song, the album track
 * and the music video, and either being yours is the song being yours; both
 * ids go on the row, space-separated.
 *
 * Polymer reuses the rows as the queue changes, so the attribute is written
 * again after every change the page makes, and only where it differs.
 */

export const VIDEOS_ATTRIBUTE = 'data-selfmp3-videos'

const QUEUE_ITEM = 'ytmusic-player-queue-item'
const SWITCH_WRAPPER = 'ytmusic-playlist-panel-video-wrapper-renderer'
const SETTLE_MS = 200
/** A wrapper's data holds both renderers a few levels down; nothing worth reading is deeper. */
const MAX_DEPTH = 6

/** A YouTube video id. The content script and the worker check with this too. */
export const VIDEO_ID = /^[\w-]{11}$/

/** Every `videoId` in a renderer's data, near enough to the top to be the row's own. */
function collect(value: unknown, into: Set<string>, depth: number): void {
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const each of value) collect(each, into, depth + 1)
    return
  }
  for (const [key, each] of Object.entries(value)) {
    if (key === 'videoId' && typeof each === 'string' && VIDEO_ID.test(each)) into.add(each)
    else collect(each, into, depth + 1)
  }
}

const dataOf = (element: Element | null): unknown => (element as { data?: unknown } | null)?.data

/** The videos a queue row stands for: its own, and its other half's behind a switch. */
export function videosOf(item: Element): string[] {
  const ids = new Set<string>()
  const own = (dataOf(item) as { videoId?: unknown } | undefined)?.videoId
  if (typeof own === 'string' && VIDEO_ID.test(own)) ids.add(own)
  collect(dataOf(item.closest(SWITCH_WRAPPER)), ids, 0)
  return [...ids]
}

export function stamp(root: ParentNode): void {
  for (const item of root.querySelectorAll(QUEUE_ITEM)) {
    const value = videosOf(item).join(' ')
    if (item.getAttribute(VIDEOS_ATTRIBUTE) === value) continue
    if (value) item.setAttribute(VIDEOS_ATTRIBUTE, value)
    else item.removeAttribute(VIDEOS_ATTRIBUTE)
  }
}

/** Stamp now, and again after every change the page makes. */
export function start(): void {
  let settling: ReturnType<typeof setTimeout> | null = null
  const soon = (): void => {
    if (settling) clearTimeout(settling)
    settling = setTimeout(() => {
      try {
        stamp(document)
      } catch {
        // Nothing here is worth an error in YouTube's console.
      }
    }, SETTLE_MS)
  }
  soon()
  // A reused row changes only its text, so the text is watched as well.
  new MutationObserver(soon).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  })
}
