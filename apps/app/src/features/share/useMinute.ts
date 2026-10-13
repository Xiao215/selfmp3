import { useEffect, useState } from 'react'

/**
 * The time, moved on once a minute: a link's last day, and its end, arrive
 * on a page left open (docs/features/share-links.md). Read in render, where
 * the clock itself may not be.
 */
export function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
