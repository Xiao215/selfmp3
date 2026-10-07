import { useEffect, useState } from 'react'
import { failureText, lookingFor, type Api, type Review } from '@selfmp3/client'
import { draftFor, foundIn } from './importDraft'
import type { DraftSource } from './importDraft.model'

/** Songs asked about in one request: a few seconds' work for the server, well inside a phone's patience. */
const BATCH = 8

/**
 * Find a review's songs on YouTube while it is open, a few at a time.
 *
 * A Spotify list, a list of names, or the VIP songs of a 网易云 one arrive
 * with names and no link (importPreview.ts); asked about all at once, a long
 * list would keep the whole review waiting, and past a phone's fifteen
 * seconds it would never come. So the review shows at once, and each answer
 * goes into the draft as it comes — which also means a review left half
 * found carries on where it stopped when it is opened again.
 *
 * One request at a time, then the next: the server looks for each batch's
 * songs side by side already (youtubeMatch.ts). A request that fails stops
 * the search and says so, and `retry` starts it again.
 */
export function useFindSongs(
  api: Pick<Api, 'importFind'>,
  key: DraftSource,
  review: Review | null,
): { error: string | null; retry: () => void } {
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const next = review ? lookingFor(review).slice(0, BATCH) : []
  // What is being asked about, as a value: the effect runs again only when it changes.
  const asking = review
    ? next.map(index => `${index}:${review.items[index]?.title}:${review.items[index]?.artist}`)
    : []
  const question = asking.join('\n')

  useEffect(() => {
    if (question === '' || error !== null) return undefined
    const current = draftFor(key).review
    if (!current) return undefined
    const asked = lookingFor(current)
      .slice(0, BATCH)
      .flatMap(index => {
        const item = current.items[index]
        return item ? [{ index, title: item.title, artist: item.artist, item }] : []
      })
    if (asked.length === 0) return undefined
    let stale = false
    api
      .importFind(
        asked.map(({ item }) => ({
          title: item.title.trim() || 'Untitled',
          artist: item.artist,
          album: item.album,
          duration: item.duration,
        })),
      )
      .then(({ found }) => {
        if (stale) return
        foundIn(
          key,
          asked.map(({ index, title, artist }) => ({ index, title, artist })),
          found,
        )
      })
      .catch((reason: unknown) => {
        if (stale) return
        setError(failureText('Could not look for the rest on YouTube', reason))
      })
    return () => {
      stale = true
    }
    // `question` stands for the rows asked about; `attempt` is a retry.
  }, [api, key, question, error, attempt])

  return {
    error,
    retry: () => {
      setError(null)
      setAttempt(count => count + 1)
    },
  }
}
