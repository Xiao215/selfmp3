import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'

/**
 * Whether Now Playing has started up over the window, on a computer.
 *
 * The sidebar lies over the page's column and fades away as Now Playing comes
 * up over it (`Shell.tsx`), and the fade has to start when the page starts.
 * The address is the wrong clock for that: on an iPad it changes a quarter of
 * a second before the native stack begins its slide, and a sidebar that went
 * by the address had faded out over an empty column before the page moved
 * (measured frame by frame, 2026-09-21). So the page says when it is on its
 * way — from the navigator's own `transitionStart` where there is one, and as
 * it mounts where the page brings itself up (`NowPlayingStage`).
 *
 * Outside React, as the shell's other one-flag stores are: the page that
 * knows and the shell that draws are not each other's parent.
 */

const arriving = createValueStore(false)

export const setStageArriving = arriving.set

export function useStageArriving(): boolean {
  return useValueStore(arriving)
}
