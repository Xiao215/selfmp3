import { useEffect } from 'react'
import { useNavigationContainerRef } from 'expo-router'
import { onLiveKeys, type NavState } from '../shell/historyState.model'

/** What of the navigation container this reaches: its reset, which Back and Forward call. */
interface Container {
  resetRoot: ((state?: NavState) => void) & { onLiveKeys?: true }
  getRootState: () => NavState | undefined
}

/**
 * Back and Forward in a browser restore the pages on the keys they have now
 * (`shell/historyState.model.ts`), so the app's layout and every page still
 * in the stack stay mounted, and the music with them.
 *
 * expo-router steps through history by handing the saved state to the
 * container's `resetRoot`, read off the container each time, so the reset
 * is wrapped there. The container is the same object for the app's life;
 * it is checked again at every change all the same, so a new one would be
 * wrapped as well.
 */
export function useHistoryStepsOnLiveKeys(): void {
  const ref = useNavigationContainerRef()
  useEffect(() => {
    const wrap = (): void => {
      const container = ref.current as unknown as Container | null
      if (!container || container.resetRoot.onLiveKeys) return
      const reset = container.resetRoot
      const onLive: Container['resetRoot'] = state =>
        reset(state ? onLiveKeys(state, container.getRootState()) : state)
      onLive.onLiveKeys = true
      container.resetRoot = onLive
    }
    wrap()
    return ref.addListener('state', wrap)
  }, [ref])
}
