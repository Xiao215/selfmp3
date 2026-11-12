import { youtubeVideoId } from '@selfmp3/shared'
import type { Site } from './anchors.js'
import { VIDEOS_ATTRIBUTE } from './videoIds.js'

/**
 * Which song rows on a page are a song of yours, and where their check goes.
 *
 * Each kind of row is known by its tag, its videos read from what the row
 * carries — a link where it has one, the attribute videoIds.ts writes where
 * it does not — and the check sits where the row already says something
 * small about the song: before the duration, or after the title where a row
 * has no duration. Everything here came from the live pages of 2026-10-31.
 */

interface RowKind {
  readonly selector: string
  /** The videos this row stands for; any one of them being yours is the row being yours. */
  videos(row: Element): string[]
  /** Where the check goes in this row, or null when the row is not drawn enough to say. */
  place(row: Element): { parent: Element; before: Element | null } | null
}

/** The video a row's link opens, from its `href` as written (it may be relative). */
function linked(row: Element, selector: string): string[] {
  const href = row.querySelector(selector)?.getAttribute('href')
  if (!href) return []
  const id = youtubeVideoId(new URL(href, 'https://www.youtube.com/').toString())
  return id ? [id] : []
}

const before = (row: Element, selector: string) => {
  const next = row.querySelector(selector)
  return next?.parentElement ? { parent: next.parentElement, before: next } : null
}

const KINDS: Record<Site, readonly RowKind[]> = {
  music: [
    {
      // Up next, on the player page: no link, only the attribute.
      selector: 'ytmusic-player-queue-item',
      videos: row => (row.getAttribute(VIDEOS_ATTRIBUTE) ?? '').split(' ').filter(Boolean),
      place: row => before(row, ':scope > .duration'),
    },
    {
      // A playlist's, an album's or a search's songs. An artist or an album
      // row is one of these too, but its title links somewhere else.
      selector: 'ytmusic-responsive-list-item-renderer',
      videos: row => linked(row, '.title-column a[href*="watch?v="]'),
      place: row => {
        const durations = row.querySelector(':scope > .fixed-columns')
        if (durations) return { parent: durations, before: durations.firstElementChild }
        const title = row.querySelector('.title-column > .title')
        return title?.parentElement
          ? { parent: title.parentElement, before: title.nextElementSibling }
          : null
      },
    },
  ],
  www: [
    {
      // The playlist beside a watch page, before the row's menu.
      selector: 'ytd-playlist-panel-video-renderer',
      videos: row => linked(row, 'a#wc-endpoint'),
      place: row => before(row, ':scope > #menu'),
    },
  ],
  mobile: [],
}

export interface FoundRow {
  readonly row: Element
  readonly videos: readonly string[]
  readonly kind: RowKind
}

/**
 * Every song row of `site` on the page, with the videos it stands for — none,
 * for a row that is not a song's or not drawn yet, which is still returned:
 * a reused row can be wearing the check of the song it was before.
 */
export function findRows(root: ParentNode, site: Site): FoundRow[] {
  const found: FoundRow[] = []
  for (const kind of KINDS[site]) {
    for (const row of root.querySelectorAll(kind.selector)) {
      found.push({ row, videos: kind.videos(row), kind })
    }
  }
  return found
}

/** Where a found row's check goes. */
export const placeOf = (found: FoundRow) => found.kind.place(found.row)
