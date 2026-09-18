import { useMotionReduced } from './motion'

/**
 * Whether this device asks for less motion: Reduce Motion on an iPhone or a
 * Mac, `prefers-reduced-motion` in a browser. One answer for the whole app,
 * kept in `./motion`, which every move goes through.
 */
export function useReducedMotion(): boolean {
  return useMotionReduced()
}
