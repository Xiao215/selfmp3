import { useEffect, useState } from 'react'
import { failureText, type Api } from '@selfmp3/client'
import { draftFor, patchDraft } from './importDraft'
import { withSearchResults, type DraftSource } from './importDraft.model'

/** How long the box sits still before what is in it is searched for. */
const SETTLE_MS = 350

/**
 * Search for what is typed into Import's box, as it is typed
 * (docs/features/import-sources.md, "Searching").
 *
 * Asked once the typing settles, and only about the latest words: an answer
 * to words since changed is dropped. What is found goes into the draft, under
 * the songs ticked in searches before (`withSearchResults`), so it outlives
 * the page; words already searched for are not asked about again. Until the
 * answer comes the last one stays on screen, rather than a blank list
 * flickering at every letter.
 */
export function useSongSearch(
  api: Pick<Api, 'importSearch'>,
  key: DraftSource,
  query: string | null,
  /** The words the draft's search found songs for, if any. */
  searched: string | null,
): { searching: boolean; error: string | null; retry: () => void } {
  const [failed, setFailed] = useState<{ query: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (query === null || query === searched) return undefined
    let stale = false
    const timer = setTimeout(() => {
      api
        .importSearch(query)
        .then(({ items }) => {
          if (stale) return
          patchDraft(key, { search: withSearchResults(draftFor(key).search, query, items) })
        })
        .catch((reason: unknown) => {
          if (stale) return
          setFailed({ query, message: failureText('Could not search', reason) })
        })
    }, SETTLE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
    // `attempt` is a retry.
  }, [api, key, query, searched, attempt])

  const error = failed !== null && failed.query === query ? failed.message : null
  return {
    searching: query !== null && query !== searched && error === null,
    error,
    retry: () => {
      setFailed(null)
      setAttempt(count => count + 1)
    },
  }
}
