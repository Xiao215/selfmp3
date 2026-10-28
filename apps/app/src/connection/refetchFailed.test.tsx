import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query'
import { ApiError } from '@selfmp3/client'
import { ASKS_MODEL, refetchFailed } from './refetchFailed'

/** A query watched as a screen watches it, whose every ask fails with `error`. */
function failing(client: QueryClient, key: string, error: Error, asksModel: boolean) {
  const queryFn = jest.fn(() => Promise.reject(error))
  const observer = new QueryObserver(client, {
    queryKey: [key],
    queryFn,
    ...(asksModel ? ASKS_MODEL : { retry: false }),
  })
  const stop = observer.subscribe(() => undefined)
  return { queryFn, observer, stop }
}

/** Until every query has settled: nothing is fetching. */
async function settled(client: QueryClient): Promise<void> {
  while (client.isFetching() > 0) await new Promise(resolve => setTimeout(resolve, 0))
}

describe('asking again for what failed', () => {
  let client: QueryClient
  beforeEach(() => {
    client = new QueryClient()
  })
  afterEach(() => {
    client.clear()
    onlineManager.setOnline(true)
  })

  it('asks the library again, but never a question to the model', async () => {
    const unanswered = new ApiError(502, 'The model did not answer')
    const library = failing(client, 'library', unanswered, false)
    const ask = failing(client, 'ask', unanswered, true)
    await settled(client)
    expect(library.queryFn).toHaveBeenCalledTimes(1)
    expect(ask.queryFn).toHaveBeenCalledTimes(1)

    refetchFailed(client)
    await settled(client)

    expect(library.queryFn).toHaveBeenCalledTimes(2)
    // A failed turn stays failed until Try again.
    expect(ask.queryFn).toHaveBeenCalledTimes(1)
    expect(ask.observer.getCurrentResult().isError).toBe(true)

    await ask.observer.refetch()
    expect(ask.queryFn).toHaveBeenCalledTimes(2)
    library.stop()
    ask.stop()
  })

  it('leaves a refusal alone: asking again would only hear it again', async () => {
    const library = failing(client, 'library', new ApiError(404, 'Not there'), false)
    await settled(client)
    refetchFailed(client)
    await settled(client)
    expect(library.queryFn).toHaveBeenCalledTimes(1)
    library.stop()
  })

  it('does not ask the model again when the network comes back or the turn is drawn again', async () => {
    const ask = failing(client, 'ask', new ApiError(0, 'Offline'), true)
    await settled(client)

    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
    await settled(client)
    expect(ask.queryFn).toHaveBeenCalledTimes(1)

    // Back from its list: the same turn is watched again.
    ask.stop()
    const again = new QueryObserver(client, {
      queryKey: ['ask'],
      queryFn: ask.queryFn,
      ...ASKS_MODEL,
    })
    const stop = again.subscribe(() => undefined)
    await settled(client)
    expect(ask.queryFn).toHaveBeenCalledTimes(1)
    stop()
  })
})
