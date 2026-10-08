import {
  createApi,
  serverTransport,
  type Api,
  type ClientFetch,
  type ServerConnection,
} from '@selfmp3/client/core'

/** How long an ordinary request waits before the server is called asleep. */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * A fetch that gives up. An address nothing answers at — a Wi-Fi address from
 * another network, a Mac asleep — can hang for a minute, and the popup would sit
 * on "Reading the link" all that time.
 *
 * A signal the caller brought still aborts it too: it is the browser's own
 * `AbortSignal`, of which `ClientSignal` names only the part the package reads.
 */
function timedFetch(fetchImpl: typeof fetch, ms: number): ClientFetch {
  return (url, init) => {
    const timeout = AbortSignal.timeout(ms)
    const signal = init?.signal ? AbortSignal.any([init.signal as AbortSignal, timeout]) : timeout
    return fetchImpl(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal,
    })
  }
}

/** The API client for one server, answered by that server alone. */
export function serverApi(
  connection: ServerConnection,
  fetchImpl: typeof fetch,
  ms = REQUEST_TIMEOUT_MS,
): Api {
  return createApi({
    context: () => ({ transport: serverTransport(connection), fromCloud: false }),
    fetch: timedFetch(fetchImpl, ms),
  })
}
