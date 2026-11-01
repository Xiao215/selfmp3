import type { Site } from './anchors.js'
import { findRows, placeOf, type FoundRow } from './rows.js'

/**
 * The green check on each song row that is already yours (D1).
 *
 * Asked of the worker a page's worth of videos at a time, and remembered for a
 * few minutes, so a queue scrolling past is one question rather than one per
 * row. A video asked about again after that is asked again: a song imported
 * from the app, or removed there, shows here within that time. One imported
 * from this page's own pill shows at once (`markOwned`).
 *
 * Like the pill, each check is its own element with a closed shadow root, so
 * nothing of the page's styling reaches it. Its state is the element being
 * there at all, which is what an end-to-end spec reads.
 */

export const CHECK_TAG = 'selfmp3-check'

/** How long an answer is trusted before the row asks again. */
const REMEMBER_MS = 5 * 60_000
/** The most the worker takes in one question (bridge.ts). */
const BATCH = 500
const VIDEO_ID = /^[\w-]{11}$/

const OUTER_STYLE = 'display:inline-flex;align-items:center;flex:0 0 auto;margin:0 8px'
const LABEL = 'In your self.mp3 library'

const SHADOW_CSS = `
  :host { all: initial }
  svg { display: block; color: var(--good) }
`

const SVG = 'http://www.w3.org/2000/svg'

/** The check, built as elements: the page's Trusted Types policy may refuse `innerHTML`. */
function createCheck(document: Document, theme: string): HTMLElement {
  const element = document.createElement(CHECK_TAG)
  element.setAttribute('style', OUTER_STYLE)
  element.setAttribute('role', 'img')
  element.setAttribute('aria-label', LABEL)
  element.title = LABEL
  const shadow = element.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = theme + SHADOW_CSS
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG, 'path')
  // The pill's check, so "In library" and a row's mark are the same mark.
  path.setAttribute('d', 'm5 12 5 5L20 7')
  const stroke: readonly (readonly [string, string])[] = [
    ['fill', 'none'],
    ['stroke', 'currentColor'],
    ['stroke-width', '3'],
    ['stroke-linecap', 'round'],
    ['stroke-linejoin', 'round'],
  ]
  for (const [name, value] of stroke) path.setAttribute(name, value)
  svg.append(path)
  shadow.append(style, svg)
  return element
}

/** Put the check on a row that is yours, and take it off one that is not (any more). */
function draw(document: Document, found: FoundRow, owned: boolean, theme: string): void {
  const existing = found.row.querySelector(CHECK_TAG)
  if (!owned) {
    existing?.remove()
    return
  }
  const place = placeOf(found)
  if (!place) return
  if (existing?.parentElement === place.parent) return
  existing?.remove()
  place.parent.insertBefore(createCheck(document, theme), place.before)
}

interface Checks {
  /** Look at every row on the page, asking about the videos not known yet. */
  scan(): void
  /** A video this page just imported: its rows are yours now, without asking. */
  markOwned(videoId: string): void
}

export function createChecks(options: {
  readonly document: Document
  readonly site: Site
  /** The worker's answer: which of these are yours, or null when it could not say. */
  readonly ask: (videoIds: string[]) => Promise<readonly string[] | null>
  /** The generated tokens (`src/ui/theme.css`), as text. */
  readonly theme: string
  readonly now?: () => number
}): Checks {
  const { document, site, ask, theme } = options
  const now = options.now ?? Date.now
  const known = new Map<string, { owned: boolean; at: number }>()
  const asking = new Set<string>()

  function askAbout(videoIds: string[]): void {
    for (const id of videoIds) asking.add(id)
    void ask(videoIds).then(
      owned => {
        const yours = new Set(owned ?? [])
        const at = now()
        // A question that could not be answered is remembered as "not yours"
        // for as long as an answer would be: no server is no reason to ask
        // again on every change the page makes.
        for (const id of videoIds) {
          asking.delete(id)
          known.set(id, { owned: yours.has(id), at })
        }
        scan()
      },
      () => {
        for (const id of videoIds) asking.delete(id)
      },
    )
  }

  function scan(): void {
    const unknown = new Set<string>()
    for (const found of findRows(document, site)) {
      const videos = found.videos.filter(id => VIDEO_ID.test(id))
      for (const id of videos) {
        const answer = known.get(id)
        if ((!answer || now() - answer.at >= REMEMBER_MS) && !asking.has(id)) unknown.add(id)
      }
      // What was last known while it is asked again, so a check does not
      // blink off and on every few minutes.
      draw(
        document,
        found,
        videos.some(id => known.get(id)?.owned === true),
        theme,
      )
    }
    const ids = [...unknown]
    for (let start = 0; start < ids.length; start += BATCH) {
      askAbout(ids.slice(start, start + BATCH))
    }
  }

  return {
    scan,
    markOwned(videoId) {
      known.set(videoId, { owned: true, at: now() })
      scan()
    },
  }
}
