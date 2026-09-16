/**
 * Where the pill goes, on each of the three sites (B1).
 *
 * The list per site is in order, and the first *visible* match wins: when you
 * leave a watch page YouTube keeps the old one in the DOM, hidden, so a match
 * is not the same thing as a place on screen. Everything here came from trying
 * it against the live pages (docs/EXTENSION.md, Phase 0, question 4).
 *
 * Two anchors are deliberately absent. Anything positioned as a sibling of
 * `#actions-inner` or `#menu` is stretched to about 500 px by YouTube's own
 * CSS, and YouTube Music's `.content-info-wrapper` sits on top of the title.
 */

export type Site = 'www' | 'mobile' | 'music'

export interface Anchor {
  readonly selector: string
  readonly where: 'prepend' | 'append'
  /** What it is, for the test that reads these back. */
  readonly what: string
}

export const ANCHORS: Record<Site, readonly Anchor[]> = {
  www: [
    {
      selector: 'ytd-watch-metadata #top-level-buttons-computed',
      where: 'prepend',
      // YouTube redraws this row about a second after each navigation, so a
      // pill here has to be put back; the observer in youtube.ts does that.
      what: 'the button row, left of Like',
    },
    { selector: 'ytd-watch-metadata #owner', where: 'append', what: 'after Subscribe' },
    { selector: 'ytd-watch-metadata #top-row', where: 'append', what: 'the end of the top row' },
  ],
  mobile: [
    {
      selector: 'ytm-slim-video-action-bar-renderer .slim-video-action-bar-actions',
      where: 'prepend',
      what: 'the action bar',
    },
    {
      selector: 'ytm-slim-video-action-bar-renderer',
      where: 'prepend',
      what: 'the action bar itself',
    },
  ],
  music: [
    {
      selector: 'ytmusic-player-bar .right-controls-buttons',
      where: 'prepend',
      // Visible during an ad and at 800px, where the middle buttons are not.
      what: 'before the volume and repeat buttons',
    },
    {
      selector: 'ytmusic-player-bar .middle-controls-buttons',
      where: 'prepend',
      what: 'next to Like',
    },
  ],
}

/** Which of the three sites a host is, or null for anywhere else. */
export function siteOf(host: string): Site | null {
  const name = host.toLowerCase()
  if (name === 'music.youtube.com') return 'music'
  if (name === 'm.youtube.com') return 'mobile'
  if (name === 'www.youtube.com' || name === 'youtube.com') return 'www'
  return null
}

/**
 * Whether an element is really on screen. jsdom has no layout, so the tests
 * hand in their own answer rather than pretending `getBoundingClientRect` works.
 */
export type IsVisible = (element: Element) => boolean

export const onScreen: IsVisible = element =>
  !element.closest('[hidden]') && element.getBoundingClientRect().width > 0

/** The first anchor of `site` that is present and visible. */
export function findAnchor(
  root: ParentNode,
  site: Site,
  isVisible: IsVisible = onScreen,
): { element: Element; anchor: Anchor } | null {
  for (const anchor of ANCHORS[site]) {
    for (const element of root.querySelectorAll(anchor.selector)) {
      if (isVisible(element)) return { element, anchor }
    }
  }
  return null
}
