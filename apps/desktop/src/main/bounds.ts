import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'

import { writeFileAtomicSync } from './writeAtomic.js'

/**
 * Where the window was, and whether it is still somewhere that exists.
 *
 * Kept in `userData/window.json` rather than in the page: the page is a web
 * build shared with the browser, and a browser has no business knowing about
 * window frames. It is written on move and resize, debounced, at once when the
 * window closes, and read once before the window is made.
 *
 * The clamping is the part that matters. A window remembered on a monitor that
 * is now unplugged opens at coordinates no display covers, which on macOS is a
 * window you cannot see and cannot reach — the app looks like it failed to
 * start. So a remembered frame is only used if it overlaps a display that is
 * there now, and otherwise the window opens where a new one would.
 */

const BoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
})
export type Bounds = Readonly<z.infer<typeof BoundsSchema>>

/** The size the reference captures were taken at, and the floor below them. */
const DEFAULT_SIZE = { width: 1280, height: 800 }
export const MINIMUM_SIZE = { width: 480, height: 480 }

function file(): string {
  return join(app.getPath('userData'), 'window.json')
}

/**
 * True when enough of the frame lands on a display to grab. "Enough" is a
 * strip along the top: that is where the title bar is, and a window whose title
 * bar is off-screen is one that cannot be moved back.
 */
export function onSomeDisplay(bounds: Bounds, displays: readonly Electron.Display[]): boolean {
  const MARGIN = 80
  return displays.some(display => {
    const area = display.workArea
    const overlapX =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapY = Math.min(bounds.y + MARGIN, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapX >= MARGIN && overlapY > 0
  })
}

/** What the window should open at: what was kept, if it is still reachable. */
export function openingBounds(displays: readonly Electron.Display[]): Partial<Bounds> {
  try {
    const parsed = BoundsSchema.safeParse(JSON.parse(readFileSync(file(), 'utf8')))
    if (!parsed.success) return DEFAULT_SIZE
    const kept = parsed.data
    const bounds: Bounds = {
      x: Math.round(kept.x),
      y: Math.round(kept.y),
      width: Math.max(MINIMUM_SIZE.width, Math.round(kept.width)),
      height: Math.max(MINIMUM_SIZE.height, Math.round(kept.height)),
    }
    return onSomeDisplay(bounds, displays) ? bounds : { width: bounds.width, height: bounds.height }
  } catch {
    // No file, or nothing readable in it. A first launch is the common case.
    return DEFAULT_SIZE
  }
}

/** How long a window has to stay still before its frame is written. */
const SAVE_DEBOUNCE_MS = 400

/**
 * Keep the frame as it changes. Debounced, because dragging a window fires
 * `move` on every frame and this writes to disk — but written at once on
 * `close`: on the way out there are no 400 ms left for a timer to fire in, and
 * a debounce restarted by the close itself would lose the last move too.
 */
export function rememberBounds(window_: BrowserWindow): void {
  let pending: NodeJS.Timeout | null = null
  const write = (): void => {
    if (pending) clearTimeout(pending)
    pending = null
    // A full-screen or maximised frame is the display's, not the window's:
    // keeping it would open a plain window the size of the screen next time.
    if (window_.isDestroyed() || window_.isFullScreen() || window_.isMaximized()) return
    try {
      writeFileAtomicSync(file(), JSON.stringify(window_.getNormalBounds()))
    } catch {
      // A window that cannot be remembered is not worth a crash on quit.
    }
  }
  const later = (): void => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(write, SAVE_DEBOUNCE_MS)
  }
  window_.on('move', later)
  window_.on('resize', later)
  window_.on('close', write)
}
