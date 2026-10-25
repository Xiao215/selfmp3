import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAccent } from '../ui/accent'
import { SONG_ROW } from './keyOwner'
import { setTabbing, TABBING_SELECTOR } from './tabbing'

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
 * one line in the app's accent, only while someone is moving focus with Tab,
 * so a Tab still shows where you are and a click shows nothing.
 * `:focus-visible` alone is not enough: the browser counts any key as keyboard
 * use, so pressing Space to pause after clicking a song would draw a box round
 * that song's row. Tab turns the ring on; a pointer press turns it off. A text
 * field with a border of its own takes the accent as its border colour instead; a field
 * without one sits in a box that is the visible field, and that box shows
 * focus itself (the library's search turns its border to the accent while its
 * input has focus).
 *
 * A song row's press target lies under its cover and title only, and a ring
 * round that would stop partway along the row, so the row wears it instead,
 * just inside its edge, where the rows above and below cannot cover it. The
 * list's arrows move focus with the keyboard too, so they turn the ring on as
 * Tab does (`useListKeys.web.ts`).
 *
 * Sliders and checkboxes keep what they draw. The colour follows the accent
 * picker, so the rules are rewritten when it moves.
 */

const ID = 'selfmp3-focus'
const TEXT_FIELD = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"])'
/** A song row's press target, which lies under its cover and title: the ring goes round the row. */
const ROW_PRESS = '[data-row-press]'

function css(accent: string): string {
  return `
:focus { outline: none; }
${TABBING_SELECTOR} :focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; }
${TABBING_SELECTOR} ${TEXT_FIELD}:focus-visible, ${TABBING_SELECTOR} textarea:focus-visible { outline: none; }
${TEXT_FIELD}:focus, textarea:focus { border-color: ${accent} !important; }
${TABBING_SELECTOR} ${ROW_PRESS}:focus-visible { outline: none; }
${TABBING_SELECTOR} [${SONG_ROW}]:has(${ROW_PRESS}:focus-visible) { outline: 2px solid ${accent}; outline-offset: -2px; }
${FORCED}
`
}

/** What is chosen, lit or here: the states the app draws with a tone of its own. */
const ON = [
  '[role="option"][aria-selected="true"]',
  '[role="tab"][aria-selected="true"]',
  '[role="radio"][aria-checked="true"]',
  '[role="switch"][aria-checked="true"]',
  '[aria-current="page"]',
  '[aria-pressed="true"]',
]

/**
 * Forced colours (Windows' contrast themes): the browser paints every ground
 * Canvas, so the tones that mark the palette's lit result, the page you are
 * on and a chosen chip all vanish, and the icons, whose fills are the theme's
 * own, stay a pale grey on white. Here what is on is painted in the system's
 * Highlight, and every icon in the text's colour.
 */
const FORCED = `
@media (forced-colors: active) {
  svg [fill]:not([fill="none"]) { fill: CanvasText !important; }
  svg [stroke]:not([stroke="none"]) { stroke: CanvasText !important; }
  ${ON.join(', ')} { forced-color-adjust: none; background-color: Highlight !important; color: HighlightText !important; }
  ${ON.map(on => `${on} *`).join(', ')} { color: HighlightText !important; }
  ${ON.map(on => `${on} svg [fill]:not([fill="none"])`).join(', ')} { fill: HighlightText !important; }
  ${ON.map(on => `${on} svg [stroke]:not([stroke="none"])`).join(', ')} { stroke: HighlightText !important; }
}
`

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') setTabbing(true)
    }
    const onPointerDown = (): void => setTabbing(false)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  return null
}
