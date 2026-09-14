/**
 * No scrollbars in a browser, as on a phone.
 *
 * A browser draws its own bar down anything that scrolls: on a Mac with a mouse
 * plugged in that is a white gutter beside the song list, the queue and every
 * panel, the same kind of system furniture on a dark app that `Select` and
 * `data-tip` replaced. React Native's `showsVerticalScrollIndicator={false}`
 * reaches only the lists that remember to say it, so the rule is set once for
 * the page. Wheels, trackpads, keys and touch scroll exactly as before.
 */

const STYLE_ID = 'selfmp3-no-scrollbars'

const CSS = `
* { scrollbar-width: none; }
*::-webkit-scrollbar { display: none; width: 0; height: 0; }
`

export function hideScrollbars(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
