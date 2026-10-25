import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { windowGroundSchema } from '@selfmp3/desktop-bridge'
import { NATIVE_BACKGROUND } from '@selfmp3/shared'

import { writeFileAtomicSync } from './writeAtomic.js'

/**
 * The window's own colour: what shows before the page first paints, and at
 * the window's edges while it is being resized, ahead of the page catching up.
 *
 * It had always been the dark ground, so a Paper window was edged in black as
 * it was resized. Now it is the ground of the theme the page shows, told by
 * the page whenever that changes (`setWindowGround`), and kept in
 * `userData/ground.txt` so the next launch opens in it rather than flashing
 * the other theme's.
 */
function file(): string {
  return join(app.getPath('userData'), 'ground.txt')
}

/** The colour to open the window in: the last one the page asked for, or the dark ground. */
export function openingGround(): string {
  try {
    const kept = windowGroundSchema.safeParse(readFileSync(file(), 'utf8').trim())
    return kept.success ? kept.data : NATIVE_BACKGROUND
  } catch {
    // No file yet: a first launch, which is dark until the page says.
    return NATIVE_BACKGROUND
  }
}

let told: string | null = null

/** Called by the `setWindowGround` handler: the window takes the colour now, and keeps it. */
export function setWindowGround(window_: BrowserWindow | null, colour: string): void {
  window_?.setBackgroundColor(colour)
  if (colour === told) return
  told = colour
  try {
    writeFileAtomicSync(file(), colour)
  } catch {
    // A launch in the old colour is all a failed write costs.
  }
}
