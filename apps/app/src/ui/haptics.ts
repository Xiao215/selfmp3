import { lightTap } from '../ports/haptics'

/**
 * The light tap that goes with a move (docs/ui-mock `M1`, 2 and `M2`, 6):
 * play becoming pause, a carried row dropping. What the tap is on each
 * platform is the port's business (`ports/haptics`).
 */
export function tap(): void {
  lightTap()
}
