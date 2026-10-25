import { leading, type TypeStep } from '@selfmp3/client'
import { useWindowValue } from '../shell/useLayout'

/**
 * How the app meets the system's text size (iOS Dynamic Type, Android's font
 * scale), AM1 (2026-10-25). A browser reports 1 and zooms the whole page
 * instead, so none of this changes a tab.
 *
 * Song titles, page titles and reading text scale fully: they are what the
 * setting is for. Controls stop at `CONTROL_SCALE` — tab bar labels, chips,
 * small badges, the mini player — whose icons do not grow with them, so they
 * crowded first. A big number shrinks to fit its card (`FIT_FIGURE`) rather
 * than being cut to "18h…".
 */

/** Where a control's words stop growing: about 1.3×, as `maxFontSizeMultiplier`. */
export const CONTROL_SCALE = 1.3

/**
 * Text this size and up is one of iOS's Accessibility sizes (AX Medium is
 * about 1.6): a stat card takes the full width rather than half of it.
 */
const LARGE_TEXT = 1.6

/** One line, set smaller until it fits the room it has, rather than cut. */
export const FIT_LINE = {
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.4,
} as const

/**
 * A big number: one line that fits (`FIT_LINE`), and grows no more than about
 * 1.75×, as iOS grows its own large titles — already big, it would otherwise
 * stand three times as tall, and be shrunk back to fit a box that tall.
 */
export const FIT_FIGURE = { ...FIT_LINE, maxFontSizeMultiplier: 1.75 } as const

/** The system's text size, as a multiple of the default. */
export function useFontScale(): number {
  return useWindowValue(window => window.fontScale || 1)
}

/** Whether the text is at one of the largest sizes (`LARGE_TEXT`). */
export function useLargeText(): boolean {
  return useWindowValue(window => (window.fontScale || 1) >= LARGE_TEXT)
}

/**
 * How many lines a laid-out text of one step takes, from its height. Its line
 * height grows with the text size, and `headroom`'s pad above the first line
 * does not.
 */
export function linesAt(height: number, step: TypeStep, fontScale: number, pad = 0): number {
  return Math.max(1, Math.round((height - pad) / (leading[step] * fontScale)))
}
