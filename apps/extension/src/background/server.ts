import {
  createApi,
  serverTransport,
  type Api,
  type ClientFetch,
  type ServerConnection,
} from '@selfmp3/client/core'

/** How long an ordinary request waits before the server is called asleep. */
export const REQUEST_TIMEOUT_MS = 15_000

/**
 * A fetch that gives up. An address nothing answers at — a Wi-Fi address from
 * another network, a Mac asleep — can hang for a minute, and the popup would sit
 * on "Reading the link" all that time.
 */
function timedFetch(fetchImpl: typeof fetch, ms: number): ClientFetch {
  return async (url, init) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try {
      return await fetchImpl(url, {
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
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
