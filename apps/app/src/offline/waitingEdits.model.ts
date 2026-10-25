import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type Mutation,
  type QueryClient,
} from '@tanstack/react-query'
import { isResumableEdit, queryKeys, resumableEdits } from '@selfmp3/client'

/**
 * The rules for edits kept while the library is out of reach
 * (`waitingEdits.ts` keeps them): which are kept, how, and how they go out
 * again after a reload.
 */

interface Kept {
  /** The library they were made for: the server's address, or `cloud`. */
  readonly library: string
  readonly mutations: DehydratedState['mutations']
}

/** An edit held back, not sent yet: one that can wait, and is waiting. */
export function isWaitingEdit(mutation: Mutation<unknown, Error, unknown, unknown>): boolean {
  return (
    mutation.state.status === 'pending' &&
    mutation.state.isPaused &&
    isResumableEdit(mutation.options.mutationKey)
  )
}

/** What to keep: the waiting edits, for this library. */
export function keptEdits(client: QueryClient, library: string): Kept {
  const { mutations } = dehydrate(client, {
    shouldDehydrateMutation: isWaitingEdit,
    shouldDehydrateQuery: () => false,
  })
  return { library, mutations }
}

export function parseKept(raw: string | null): Kept | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Kept>
    if (typeof parsed.library !== 'string' || !Array.isArray(parsed.mutations)) return null
    return { library: parsed.library, mutations: parsed.mutations }
  } catch {
    return null
  }
}

/**
 * Put kept edits back in the client and send them — at once if online, and
 * otherwise when it comes online, as edits held in memory are. The library and
 * the lists are asked for again once they have gone: the screens that made
 * them are long gone, and none of their own follow-up runs.
 */
export function restoreEdits(client: QueryClient, kept: Kept | null, library: string): void {
  if (!kept || kept.library !== library || kept.mutations.length === 0) return
  resumableEdits(client)
  hydrate(client, { mutations: kept.mutations, queries: [] })
  void client.resumePausedMutations().then(() => {
    void client.invalidateQueries({ queryKey: queryKeys.library })
    void client.invalidateQueries({ queryKey: queryKeys.playlists })
  })
}
