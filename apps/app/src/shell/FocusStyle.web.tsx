import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAccent } from '../ui/accent'

/**
 * A focused text field, drawn by the app rather than the browser.
 *
 * Left alone, a browser draws its own ring round every focused field: on a Mac
 * a two-tone one in the system's accent colour, orange and white against a
 * dark app, and a second box inside any field that already sits in a box of
 * ours, like the library's search. So the browser's ring is turned off for
 * text fields, once, here, and a field with a border of its own takes the
 * accent as its border colour instead. A field without one sits in a box that
 * is the visible field, and that box shows focus itself (the library's search
 * turns its border to the accent while its input has focus).
 *
 * Sliders and checkboxes are not text fields and keep what they draw. The
 * colour follows the accent picker, so the rules are rewritten when it moves.
 */

const ID = 'selfmp3-focus'
const TEXT_FIELD = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"])'

function css(accent: string): string {
  return `
${TEXT_FIELD}, textarea { outline: none; }
${TEXT_FIELD}:focus, textarea:focus { border-color: ${accent} !important; }
`
}

export function FocusStyle(): ReactNode {
  const { accent } = useAccent()

  useEffect(() => {
    let style = document.getElementById(ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = ID
      document.head.appendChild(style)
    }
    style.textContent = css(accent)
  }, [accent])

  return null
}
