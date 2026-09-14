import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAccent } from '../ui/accent'

/**
 * Focus, drawn by the app rather than the browser.
 *
 * Left alone, a browser draws its own ring round whatever has keyboard focus:
 * on a Mac a two-tone one in the system's accent colour, orange and white
 * against a dark app, and a second box inside any field that already sits in
 * a box of ours, like the library's search. It appears on the last thing
 * clicked the moment any key is pressed — Caps Lock included — since that is
 * what the browser takes for keyboard use.
 *
 * So the browser's ring is turned off, once, here, and drawn again as ours:
 * one line in the app's accent, only for keyboard focus (`:focus-visible`), so
 * a Tab still shows where you are and a click shows nothing. A text field with
 * a border of its own takes the accent as its border colour instead; a field
 * without one sits in a box that is the visible field, and that box shows
 * focus itself (the library's search turns its border to the accent while its
 * input has focus).
 *
 * Sliders and checkboxes keep what they draw. The colour follows the accent
 * picker, so the rules are rewritten when it moves.
 */

const ID = 'selfmp3-focus'
const TEXT_FIELD = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"])'

function css(accent: string): string {
  return `
:focus { outline: none; }
:focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; }
${TEXT_FIELD}:focus-visible, textarea:focus-visible { outline: none; }
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
