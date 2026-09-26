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
    /* A state is a colour as much as it is words: the fill, the words' colour
       and a hover all slide over the shortest length instead of cutting, so
       the pill changes rather than being swapped for another pill. */
    transition:
      background-color var(--motion-fast) var(--ease-out),
      border-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out),
      opacity var(--motion-fast) var(--ease-out);
    /* The entrance. YouTube draws its button row well after the page, and
       throws it away and redraws it after every navigation, so the pill
       arrives in a row someone is already looking at: it grows in rather than
       popping. It sits on this element and not on the host, whose properties
       the page's own CSS and our inline layout style can take; and it is the
       rule itself rather than a class, because \`draw\` writes the whole class
       list and would wipe one. It starts when the row is first drawn: an
       element in no document has nothing to animate yet. */
    animation: pill-in var(--motion-base) var(--ease-out) both;
  }
  /* And the exit, shorter than the entrance, as an exit is: played by \`leave\`. */
  button.leaving {
    animation: pill-out var(--motion-fast) var(--ease-in) both;
    pointer-events: none;
  }
  @keyframes pill-in { from { opacity: 0; transform: scale(0.9) } }
  @keyframes pill-out { to { opacity: 0; transform: scale(0.9) } }
  /* \`all: initial\` on the host takes the focus ring with it; this is base.css's. */
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
  .words { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
  /* The words and the mark of a new state fade in over the shortest length
     while the fill slides under them, so the three do not snap together.
     \`draw\` asks for this only when the state itself changed: a percentage
     ticking inside "Importing" is a counter, and a counter that fades every
     second and a half is a flicker. */
  .swap { animation: swap-in var(--motion-fast) var(--ease-out) both }
  @keyframes swap-in { from { opacity: 0 } }
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
  /* A ring that is fading in is still a ring that turns. */
  .spin.swap {
    animation: spin 0.9s linear infinite, swap-in var(--motion-fast) var(--ease-out) both;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor }
  @keyframes spin { to { transform: rotate(360deg) } }
  @media (prefers-reduced-motion: reduce) {
    button, button.leaving, .swap, .spin.swap { animation: none }
    button { transition: none }
    /*
     * The ring cannot turn, and three quarters of a ring standing still reads
     * as a progress that has stalled rather than as work going on. A whole
     * ring at half strength says "working" without pretending to measure
     * anything, which is how the popup's bar answers the same setting.
     */
    .spin { animation: none; border-right-color: var(--accent); opacity: 0.5 }
  }
`

/** What stands before the words: the note, a turning ring, a check, or a dot. */
type PillMark = 'note' | 'spin' | 'check' | 'dot' | 'none'

export interface PillHandles {
  readonly element: HTMLElement
  /** The video the pill is about; read at click time, never from the page. */
  videoId: string
  draw(state: PillState): void
  /**
   * Play the exit and take the element away when it lands: for the pill that
   * is leaving for good, because the page it was on is no longer a song's.
   * A pill being replaced by another one goes at once instead — two pills in
   * the row, even for a tenth of a second, is worse than a missing fade.
   */
  leave(): void
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

  /** The state the pill is wearing, to tell a new one from a moving percentage. */
  let worn: string | null = null

  const pill: PillHandles = {
    element,
    videoId,
    draw(state) {
      const label = pillLabel(state)
      const mark = markElement(document, label.mark)
      const words = document.createElement('span')
      words.className = 'words'
      words.textContent = label.text
      // A new state's words and mark fade in; the first draw does not, because
      // the whole pill is arriving and that is the entrance's business.
      if (worn !== null && worn !== label.className) {
        words.classList.add('swap')
        mark?.classList.add('swap')
      }
      worn = label.className
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
    leave() {
      // On the host as well, so the content script can tell a pill on its way
      // out from one it should take away now.
      element.setAttribute('data-leaving', '')
      button.classList.add('leaving')
      // Whatever the stylesheet says the exit is, and gone when it lands —
      // which under Reduce Motion is no animation at all, so this is one frame.
      const playing = button.getAnimations()
      const gone = (): void => element.remove()
      if (playing.length === 0) gone()
      else void Promise.all(playing.map(animation => animation.finished)).then(gone, gone)
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
