import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type Mutation,
  type NetworkMode,
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

/**
 * Whether the app's requests wait for the network, by where the library is.
 *
 * A server's library is across the network, so offline its edits wait
 * (TanStack Query pauses them, and `waitingEdits.ts` keeps them). A cloud
 * library is this device's copy (`@selfmp3/replica`): an edit lands in it, and
 * in its outbox, at once, stamped when it is made, and the outbox sends it
 * when it can. Paused instead, a cloud edit reached the copy only when the
 * browser said it was online again — stamped then, so an edit made offline
 * an hour ago beat one another device made a minute ago — and meanwhile the
 * library on screen did not show it while the sidebar said All saved. Reads
 * are asked once whatever the network says, for the same reason: the copy
 * answers offline, and only what needs the network fails, then waits.
 */
export function networkModeFor(client: QueryClient, cloud: boolean): void {
  const mode: NetworkMode = cloud ? 'offlineFirst' : 'online'
  const defaults = client.getDefaultOptions()
  client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, networkMode: mode },
    mutations: { ...defaults.mutations, networkMode: mode },
  })
}

/** An edit held back, not sent yet: one that can wait, and is waiting. */
export function isWaitingEdit(mutation: Mutation<unknown, Error, unknown, unknown>): boolean {
  return (
    mutation.state.status === 'pending' &&
    mutation.state.isPaused &&
    isResumableEdit(mutation.options.mutationKey)
  )
}

/** An edit on its way, not answered yet: one that can wait, sent and not back. */
function isSendingEdit(mutation: Mutation<unknown, Error, unknown, unknown>): boolean {
  return mutation.state.status === 'pending' && isResumableEdit(mutation.options.mutationKey)
}

/**
 * What to keep: the waiting edits, for this library.
 *
 * `sending` keeps the edits on their way as well, as the page goes, for a
 * library nothing outlives the page for. A cloud library's edit lands in the
 * device's own outbox (IndexedDB), and a tab closing or reloading cuts that
 * write off however it was begun; a server's is a request marked `keepalive`
 * (`api/client.ts`), which the browser carries on with. Kept as waiting, so
 * the next open sends it again: each says only what it sets, a song on or
 * off a playlist, so one that did land is sent a second time for nothing.
 */
export function keptEdits(
  client: QueryClient,
  library: string,
  { sending = false }: { sending?: boolean } = {},
): Kept {
  const { mutations } = dehydrate(client, {
    shouldDehydrateMutation: sending ? isSendingEdit : isWaitingEdit,
    shouldDehydrateQuery: () => false,
  })
  return {
    library,
    mutations: mutations.map(mutation => ({
      ...mutation,
      state: { ...mutation.state, isPaused: true },
    })),
  }
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
