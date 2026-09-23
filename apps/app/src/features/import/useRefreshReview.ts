import { useEffect } from 'react'
import { refreshAlreadyHave, type Api } from '@selfmp3/client'
import { draftFor, patchDraft } from './importDraft'
import type { DraftSource } from './importDraft.model'

/**
 * Ask the server again which of a kept review's songs the library has.
 *
 * The draft outlives the page and its reload (importDraft.store.ts), so a
 * review can be days old: its "Yours already" is from when the link was
 * looked up, and a library that lost those songs since — every one of them,
 * one evening — still said so. Asked once per review, by the songs in it, the
 * moment a page shows it; the answer goes into the draft, which every page
 * reads, and an unchanged answer changes nothing.
 */
export function useRefreshReview(
  api: Pick<Api, 'importAlreadyHave'>,
  key: DraftSource,
  urls: string | null,
): void {
  useEffect(() => {
    if (urls === null) return undefined
    let stale = false
    const review = draftFor(key).review
    if (!review || review.items.length === 0) return undefined
    api
      .importAlreadyHave(review.items)
      .then(({ have }) => {
        if (stale) return
        // Against the draft as it is now: a tick taken off meanwhile stays off.
        const current = draftFor(key).review
        if (!current) return
        const next = refreshAlreadyHave(current, have)
        if (next !== current) patchDraft(key, { review: next })
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [api, key, urls])
}

/** What identifies a review for the refresh: the songs in it, in order. */
export function reviewUrls(review: { items: readonly { url: string }[] } | null): string | null {
  return review && review.items.length > 0 ? review.items.map(item => item.url).join('\n') : null
}
