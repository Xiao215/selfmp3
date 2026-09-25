import { youtubeWatchUrl } from '@selfmp3/shared'
import { pageKind } from '../pageKind.js'
// The generated tokens (scripts/theme.mjs), as text for the pill's shadow root.
import THEME from '../ui/theme.css'
import { findAnchor, siteOf } from './anchors.js'
import { askPage } from './ask.js'
import { createPill, PILL_TAG, type PillHandles } from './pill.js'

/**
 * The pill on YouTube, YouTube Music and m.youtube.com (B1).
 *
 * The page's kind comes from the address alone — only a watch page gets a pill —
 * and the video id is read from the address at click time, because for about a
 * second after an in-page navigation the row still belongs to the last video.
 *
 * Three things learned from trying this on the live pages (docs/features/browser-extension.md,
 * "What the spike settled", question 4):
 *   - the Navigation API fires within 10 ms of every URL change, on all three
 *     sites and on Back, where `yt-navigate-finish` exists only on www;
 *   - YouTube redraws its button row a second or so after each navigation and
 *     throws away whatever was in it, so the pill is put back by an observer;
 *   - below about 600 px YouTube Music has no player bar at all, so "no visible
 *     anchor" has to mean "no pill" rather than "look again forever".
 */

const LOOK_FOR_MS = 5_000
const LOOK_EVERY_MS = 100
const SETTLE_MS = 200
/** Per address: enough to survive YouTube's redraws, few enough to stop a loop. */
const REPAIRS = 5

let pill: PillHandles | null = null
let repairs = 0
let seenUrl = ''
let polling = false

const site = siteOf(location.hostname)

function videoIdNow(): string | null {
  const kind = pageKind(location.href)
  return kind.kind === 'song' ? kind.videoId : null
}

function removePills(): void {
  for (const old of document.querySelectorAll(PILL_TAG)) old.remove()
  pill = null
}

/** Ask what the pill should say, and draw it. */
async function refresh(videoId: string): Promise<void> {
  const reply = await askPage({
    type: 'pillState',
    url: youtubeWatchUrl(videoId),
  })
  if (!pill || pill.videoId !== videoId) return
  if (reply.ok) pill.draw(reply.value)
}

/** While an import of ours is going, keep the pill's percentage moving. */
function follow(videoId: string): void {
  if (polling) return
  polling = true
  const again = (): void => {
    void (async () => {
      const current = videoIdNow()
      if (!pill || current !== videoId) {
        polling = false
        return
      }
      const reply = await askPage({
        type: 'pillState',
        url: youtubeWatchUrl(videoId),
      })
      if (reply.ok && pill.videoId === videoId) pill.draw(reply.value)
      // Closely while it downloads, for the percentage; a song waiting its
      // turn in a long queue is asked after every so often.
      if (reply.ok && reply.value.state === 'importing') setTimeout(again, 1_500)
      else if (reply.ok && reply.value.state === 'queued') setTimeout(again, 10_000)
      else polling = false
    })()
  }
  setTimeout(again, 1_000)
}

function clicked(clickedPill: PillHandles): void {
  const videoId = videoIdNow()
  if (!videoId) return
  clickedPill.draw({ state: 'queued', progress: null, jobId: null, message: null })
  void (async () => {
    const reply = await askPage({
      type: 'pillImport',
      url: youtubeWatchUrl(videoId),
    })
    if (!pill || pill.videoId !== videoId) return
    if (reply.ok) {
      pill.draw(reply.value)
      if (reply.value.state === 'importing' || reply.value.state === 'queued') follow(videoId)
    } else {
      pill.draw({ state: 'failed', progress: null, jobId: null, message: reply.message })
    }
  })()
}

/** Put the pill where it belongs, or take it away. Never throws into the page. */
function ensure(): void {
  try {
    if (!site) return
    const videoId = videoIdNow()
    if (!videoId) {
      removePills()
      return
    }
    if (location.href !== seenUrl) {
      seenUrl = location.href
      repairs = 0
    }

    const found = findAnchor(document, site)
    if (!found) return

    const placed = pill?.element
    if (placed?.isConnected && placed.parentElement === found.element) {
      if (pill && pill.videoId !== videoId) {
        pill.videoId = videoId
        void refresh(videoId)
      }
      return
    }
    if (placed?.isConnected && repairs >= REPAIRS) return

    removePills()
    if (repairs >= REPAIRS) return
    repairs++
    const next = createPill(document, videoId, clicked, THEME)
    if (found.anchor.where === 'prepend') found.element.prepend(next.element)
    else found.element.append(next.element)
    pill = next
    void refresh(videoId)
  } catch {
    // A pill that cannot be drawn is not worth breaking a page over.
  }
}

/** Look for the anchor for a few seconds: the row is drawn well after the page. */
function ensureSoon(): void {
  const until = Date.now() + LOOK_FOR_MS
  const again = (): void => {
    ensure()
    if (!pill?.element.isConnected && Date.now() < until) setTimeout(again, LOOK_EVERY_MS)
  }
  again()
}

function start(): void {
  if (!site) return
  ensureSoon()

  // The one signal all three sites have, Back included.
  const navigation = (globalThis as { navigation?: EventTarget }).navigation
  navigation?.addEventListener('currententrychange', ensureSoon)
  // www only, and cheap: a second chance once the new page's data has landed.
  document.addEventListener('yt-navigate-finish', ensureSoon)

  let settling: ReturnType<typeof setTimeout> | null = null
  new MutationObserver(() => {
    if (!videoIdNow()) return
    if (settling) clearTimeout(settling)
    settling = setTimeout(ensure, SETTLE_MS)
  }).observe(document.body, { childList: true, subtree: true })
}

start()
