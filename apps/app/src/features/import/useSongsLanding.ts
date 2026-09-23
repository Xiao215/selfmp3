import { useEffect, useRef } from 'react'
import type { ImportQueue } from '@selfmp3/shared'
import { landed } from '@selfmp3/client'

/** Looks come no closer together than this while a playlist's songs finish one after another. */
const LANDING_GAP_MS = 3_000

/**
 * Ask for the library again as each import finishes, rather than whenever the
 * next look at the bucket happened to be due.
 *
 * A song's row left the queue and the library went without it for twenty
 * seconds and more (Xiao, 2026-09-22). The server marks a job done only once
 * the song and a snapshot naming it are in the bucket (importQueue.ts,
 * cloudSync's `uploadSong`), so the song was there the whole time. What was
 * not there was a reason to look: this device's copy answers the library for
 * FRESH_MS after its last look (replica/library.ts), and nothing about a job
 * finishing asked for one. The only thing that did was the server look-out,
 * every twenty seconds, whose read of the copy set a look going behind it
 * when one was due — so the song arrived on its rhythm, not the import's.
 *
 * `look` is what asking means to whoever holds the queue (importSource.ts).
 * Forty songs of a playlist finish a few seconds apart and each look lists the
 * bucket twice, so looks are no closer together than LANDING_GAP_MS: the first
 * at once, and whatever lands during the gap folded onto one trailing look, so
 * the last song of the forty is never the one missed. `key` says whose queue
 * this is: another server's starts over, with nothing counted as seen.
 */
export function useSongsLanding(
  queue: ImportQueue | undefined,
  key: string,
  look: () => void,
): void {
  const seen = useRef<{ key: string; done: ReadonlySet<string> | null }>({ key, done: null })
  const lastLook = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lookNow = useRef(look)
  useEffect(() => {
    lookNow.current = look
  }, [look])

  useEffect(() => {
    if (!queue) return
    if (seen.current.key !== key) seen.current = { key, done: null }
    const next = landed(seen.current.done, queue.jobs)
    seen.current = { key, done: next.done }
    // A look already on its way takes whatever lands meanwhile with it.
    if (next.landed === 0 || timer.current) return
    const wait = Math.max(0, lastLook.current + LANDING_GAP_MS - Date.now())
    timer.current = setTimeout(() => {
      timer.current = null
      lastLook.current = Date.now()
      lookNow.current()
    }, wait)
  }, [queue, key])

  // Leaving with a look still waiting: it looks now rather than never. It only
  // asks queries to refetch, which is safe to do from an unmounted screen.
  useEffect(
    () => () => {
      if (!timer.current) return
      clearTimeout(timer.current)
      timer.current = null
      lookNow.current()
    },
    [],
  )
}
