import type { PillState } from '../bridge.js'

/**
 * The pill itself: one element, its own shadow root, and nothing of YouTube's
 * styling reaching in or ours leaking out.
 *
 * It is a plain element, not a custom element: `customElements` is null in a
 * content script's world, so `define` is not available. The layout properties
 * are inline on the outer element because YouTube's page CSS beats a `:host`
 * rule (docs/EXTENSION.md, Phase 0, question 4).
 */

export const PILL_TAG = 'selfmp3-pill'

const OUTER_STYLE = 'display:inline-flex;flex:0 0 auto;width:auto;align-self:center;margin:0 8px'

const SHADOW_CSS = `
  :host { all: initial }
  button {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 0 12px; height: 32px; border: 0; border-radius: 999px;
    background: color-mix(in oklab, rgb(124 118 232) 22%, transparent);
    color: rgb(168 164 245);
    font: 500 12px/1 -apple-system, BlinkMacSystemFont, 'Roboto', system-ui, sans-serif;
    cursor: pointer; white-space: nowrap;
  }
  button:hover { background: color-mix(in oklab, rgb(124 118 232) 34%, transparent) }
  button[disabled] { cursor: default }
  button.have { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.72) }
  button.failed { background: rgba(212,80,63,0.18); color: rgb(240 150 140) }
  .undo { text-decoration: underline }
`

export interface PillHandles {
  readonly element: HTMLElement
  /** The video the pill is about; read at click time, never from the page. */
  videoId: string
  draw(state: PillState): void
}

/** What the pill says for each state it can be in. */
export function pillLabel(state: PillState): { text: string; className: string; busy: boolean } {
  switch (state.state) {
    case 'have':
      return { text: 'In library', className: 'have', busy: true }
    case 'importing':
      return {
        text: state.progress === null ? 'Importing' : `Importing ${Math.round(state.progress)}%`,
        className: '',
        busy: true,
      }
    // Undo is not built yet, so the pill does not offer it: once the song is
    // in, there is nothing here left to press.
    case 'added':
      return { text: 'Added', className: 'have', busy: true }
    case 'failed':
      return { text: state.message ?? 'Could not import', className: 'failed', busy: false }
    default:
      return { text: 'self.mp3', className: '', busy: false }
  }
}

export function createPill(
  document: Document,
  videoId: string,
  onClick: (pill: PillHandles) => void,
): PillHandles {
  const element = document.createElement(PILL_TAG)
  element.setAttribute('style', OUTER_STYLE)
  const shadow = element.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = SHADOW_CSS
  const button = document.createElement('button')
  button.type = 'button'
  shadow.append(style, button)

  const pill: PillHandles = {
    element,
    videoId,
    draw(state) {
      const label = pillLabel(state)
      button.textContent = label.text
      button.className = label.className
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
