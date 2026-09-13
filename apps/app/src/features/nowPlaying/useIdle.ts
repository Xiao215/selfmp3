import { useEffect, useState } from 'react'
import { onUserActivity } from '../../ports/activity'
import { IDLE_MS } from './nowPlaying.model'

/** True once, while `active`, nothing has moved for a few seconds. */
export function useIdle(active: boolean): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    if (!active) return undefined
    let timer = setTimeout(() => setIdle(true), IDLE_MS)
    const stop = onUserActivity(() => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), IDLE_MS)
    })
    return () => {
      clearTimeout(timer)
      stop()
      setIdle(false)
    }
  }, [active])

  return active && idle
}
