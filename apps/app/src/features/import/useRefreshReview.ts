import { useEffect } from 'react'
import { refreshAlreadyHave, type Api } from '@selfmp3/client'
import { draftFor, patchDraft } from './importDraft'
import type { DraftSource } from './importDraft.model'

/**
 * How long the songs must sit still before the server is asked.
 *
 * The songs change in runs — a row switched between 网易云 and YouTube, then
 * the next; each batch of names found — and each change asked again at once.
 * The question costs the server its whole library per song, and a run of them
 * held it up long enough that its health check timed out and the page said it
 * could not reach the server (Xiao, 2026-10-05). Asked once the run is over,
 * it is one question.
 */
const SETTLE_MS = 500

/**
 * Ask the server again which of a kept review's songs the library has.
 *
 * The draft outlives the page and its reload (importDraft.store.ts), so a
 * review can be days old: its "In library" is from when the link was
 * looked up, and a library that lost those songs since — every one of them,
 * one evening — still said so. Asked once per review, by the songs in it, the
 * moment a page shows it; the answer goes into the draft, which every page
 * reads, and an unchanged answer changes nothing. Asked again when the songs
 * change, once they have stopped changing (`SETTLE_MS`).
 */
export function useRefreshReview(
  api: Pick<Api, 'importAlreadyHave'>,
  key: DraftSource,
  urls: string | null,
): void {
  useEffect(() => {
    if (urls === null) return undefined
    let stale = false
    const timer = setTimeout(() => {
      const review = draftFor(key).review
      if (!review || review.items.length === 0) return
      api
        .importAlreadyHave(review.items)
        .then(({ have, waiting, queued }) => {
          if (stale) return
          // Against the draft as it is now: a tick taken off meanwhile stays off.
          const current = draftFor(key).review
          if (!current) return
          const next = refreshAlreadyHave(current, have, waiting, queued)
          if (next !== current) patchDraft(key, { review: next })
        })
        .catch(() => undefined)
    }, SETTLE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [api, key, urls])
}

/** What identifies a review for the refresh: the songs in it, in order. */
export function reviewUrls(review: { items: readonly { url: string }[] } | null): string | null {
  return review && review.items.length > 0 ? review.items.map(item => item.url).join('\n') : null
}
