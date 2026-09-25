import type { PillState } from '../bridge.js'
import { NOTE_PATH } from '../ui/mark.js'

/**
 * The pill itself: one element, its own shadow root, and nothing of YouTube's
 * styling reaching in or ours leaking out.
 *
 * It is a plain element, not a custom element: `customElements` is null in a
 * content script's world, so `define` is not available. The layout properties
 * are inline on the outer element because YouTube's page CSS beats a `:host`
 * rule (docs/features/browser-extension.md, "What the spike settled", question 4).
 *
 * It is drawn as `E4` draws it — the accent pill with the note mark while it
 * offers itself, and a raised control after — from the same generated tokens
 * as the popup. Those arrive as the `theme` stylesheet, whose custom properties
 * sit on `:host`: the page's CSS never sets our names, so they reach the
 * shadow root intact. The system face, not the display face: a font cannot be
 * declared from inside a shadow root, and this sits among YouTube's own buttons.
 */

export const PILL_TAG = 'selfmp3-pill'

const OUTER_STYLE = 'display:inline-flex;flex:0 0 auto;width:auto;align-self:center;margin:0 8px'

const SHADOW_CSS = `
  :host { all: initial }
  button {
    display: inline-flex; align-items: center; gap: 7px;
    height: 36px; padding: 0 14px 0 11px; border: 0; border-radius: var(--radius-pill);
    background: var(--surface-3); color: var(--text-primary);
    font: 600 13px/1 -apple-system, BlinkMacSystemFont, 'Roboto', system-ui, sans-serif;
    cursor: pointer; white-space: nowrap;
    /* A failure's reason can be a sentence; the pill sits among the player's
       own controls and must not push them aside. The words are cut, and the
       whole reason is the tooltip. */
    max-width: min(320px, 30vw);
  }
  .words { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
  button.offer { background: var(--accent); color: var(--on-accent) }
  button.offer:hover { background: var(--accent-strong) }
  button.queued { color: var(--accent) }
  button.added { color: var(--good) }
  button.have { color: var(--text-secondary) }
  button.waiting { color: var(--warning) }
  button.failed { color: var(--danger) }
  button[disabled] { cursor: default }
  svg { flex: none }
  .spin {
    width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%;
    border: 2px solid var(--accent); border-right-color: transparent;
    animation: spin 0.9s linear infinite;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor }
  @keyframes spin { to { transform: rotate(360deg) } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none } }
`

/** What stands before the words: the note, a turning ring, a check, or a dot. */
type PillMark = 'note' | 'spin' | 'check' | 'dot' | 'none'

export interface PillHandles {
  readonly element: HTMLElement
  /** The video the pill is about; read at click time, never from the page. */
  videoId: string
  draw(state: PillState): void
}

/** What the pill says for each state it can be in: `E4`'s five faces, the queue, and a failure. */
export function pillLabel(state: PillState): {
  text: string
  className: string
  mark: PillMark
  busy: boolean
} {
  switch (state.state) {
    case 'have':
      return { text: 'In library', className: 'have', mark: 'check', busy: true }
    // Its turn is coming: the pill says so and the page can be left, since
    // the badge counts it and a notification says when it is in.
    case 'queued':
      return { text: 'In the queue', className: 'queued', mark: 'check', busy: true }
    case 'importing':
      return {
        text: state.progress === null ? 'Importing' : `Importing ${Math.round(state.progress)}%`,
        className: 'importing',
        mark: 'spin',
        busy: true,
      }
    // Left in the bucket: the server has not taken it yet, and there is no
    // percentage to show because nothing is downloading anywhere.
    case 'waiting':
      return { text: 'Waiting for your server', className: 'waiting', mark: 'dot', busy: true }
    // Undo is not built yet, so the pill does not offer it: once the song is
    // in, there is nothing here left to press.
    case 'added':
      return { text: 'Added', className: 'added', mark: 'check', busy: true }
    case 'failed':
      return {
        text: state.message ?? 'Could not import',
        className: 'failed',
        mark: 'none',
        busy: false,
      }
    default:
      return { text: 'self.mp3', className: 'offer', mark: 'note', busy: false }
  }
}

/** What hovering a song on its way says: the page need not stay open. */
const LEAVE_HINT =
  'You can leave this page. The badge counts it, and a notification says when it’s in.'

const SVG = 'http://www.w3.org/2000/svg'

/** The mark, built as elements: the page's Trusted Types policy may refuse `innerHTML`. */
function markElement(document: Document, mark: PillMark): Element | null {
  if (mark === 'none') return null
  if (mark === 'spin' || mark === 'dot') {
    const span = document.createElement('span')
    span.className = mark
    return span
  }
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', mark === 'note' ? '15' : '14')
  svg.setAttribute('height', mark === 'note' ? '15' : '14')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG, 'path')
  if (mark === 'note') {
    path.setAttribute('d', NOTE_PATH)
    path.setAttribute('fill', 'currentColor')
  } else {
    path.setAttribute('d', 'm5 12 5 5L20 7')
    const stroke: readonly (readonly [string, string])[] = [
      ['fill', 'none'],
      ['stroke', 'currentColor'],
      ['stroke-width', '3'],
      ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
    ]
    for (const [name, value] of stroke) path.setAttribute(name, value)
  }
  svg.append(path)
  return svg
}

export function createPill(
  document: Document,
  videoId: string,
  onClick: (pill: PillHandles) => void,
  /** The generated tokens (`src/ui/theme.css`), as text. */
  theme: string,
): PillHandles {
  const element = document.createElement(PILL_TAG)
  element.setAttribute('style', OUTER_STYLE)
  const shadow = element.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = theme + SHADOW_CSS
  const button = document.createElement('button')
  button.type = 'button'
  shadow.append(style, button)

  const pill: PillHandles = {
    element,
    videoId,
    draw(state) {
      const label = pillLabel(state)
      const mark = markElement(document, label.mark)
      const words = document.createElement('span')
      words.className = 'words'
      words.textContent = label.text
      button.replaceChildren(...(mark ? [mark] : []), words)
      button.className = label.className
      // The reason for a failure, whole, where the pill had to cut it; and
      // while a song is on its way, that there is no need to stay.
      button.title =
        state.state === 'failed'
          ? label.text
          : state.state === 'queued' || state.state === 'importing'
            ? LEAVE_HINT
            : ''
      // Nothing to press while it is going, or once the song is yours.
      button.disabled = label.busy
      button.setAttribute('aria-label', `${label.text} — self.mp3`)
      // On the host, where the page cannot reach the shadow root's contents and
      // an end-to-end spec cannot either: this is what both can see.
      element.setAttribute('data-state', state.state)
    },
  }
  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    onClick(pill)
  })
  pill.draw({ state: 'idle', progress: null, jobId: null, message: null })
  return pill
}
