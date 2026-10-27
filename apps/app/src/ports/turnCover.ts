import { useEffect } from 'react'
import { requireOptionalNativeModule } from 'expo'

import type { Size } from '../shell/layoutSize.model'

interface TurnCoverModule {
  setGround(color: string): void
  drawnAt(width: number, height: number): void
}

/**
 * The cover over an iPad's window while it turns: the app's own module,
 * `apps/app/modules/turn-cover`. UIKit lays the views out again at the new
 * size inside the turn, before JavaScript has heard of it, so the computer's
 * layout was drawn squeezed into the upright window until the phone's was
 * ready (r1 m43, R2-m17). The module puts a cover up as the turn starts —
 * the old frame fading into the page's ground — and takes it down once it
 * is told the page has been drawn for the new size.
 *
 * `null` on Android, where the module is not built.
 */
const turnCover = requireOptionalNativeModule<TurnCoverModule>('TurnCover')

/** Tells the cover the size the page has just been drawn for, and the ground it wears. */
export function useTurnCover(size: Size, ground: string): void {
  useEffect(() => {
    turnCover?.setGround(ground)
  }, [ground])
  useEffect(() => {
    turnCover?.drawnAt(size.width, size.height)
  }, [size.width, size.height])
}
