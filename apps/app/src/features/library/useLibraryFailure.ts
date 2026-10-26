import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

/**
 * Why the library did not come, kept while it is asked for again; null once
 * it has come, or while it never failed.
 *
 * A query with nothing to show that is asked again — the retry every half
 * minute, Try again — is set back to loading, its error and all, until the
 * asking ends: with a server answering errors, seconds, each answer asked for
 * twice more. The card saying why went, and "Loading…" or an empty "Your
 * tags" stood there meanwhile. What failed stays said until something else is
 * known. (Opening a page does not ask again: `useLibrary`, `retryOnMount`.)
 */
export function useLibraryFailure(query: UseQueryResult<unknown>): Error | null {
  const [kept, setKept] = useState<Error | null>(null)
  if (query.error !== null && query.error !== kept) setKept(query.error)
  if (query.data !== undefined && query.error === null && kept !== null) setKept(null)
  if (query.error !== null) return query.error
  return query.data === undefined && query.isFetching ? kept : null
}
