import {
  BUCKET_CAP_CODE,
  BUCKET_HOLD_MS,
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  STREAM_RELAYED_HEADERS,
  isCloudFileKey,
  parseDoormanRefusal,
  relayedRange,
} from '@selfmp3/shared'
import type { StreamSession } from '@selfmp3/desktop-bridge'

/**
 * A song in the bucket, streamed: `app://selfmp3/_stream/<key>`.
 *
 * The doorman reads a bearer header and nothing else, and the window's
 * `<audio>` element cannot send one. A tab has its service worker attach it
 * (apps/app/sw/sw.ts, `fetchFromBucket`) and a phone's player sends it with
 * each track; here the main process does, which is the same branch in Node.
 * The page points the element at this address
 * (apps/app/src/ports/desktop/bucketMedia.desktop.ts), and every request the
 * element makes — the first, a seek, the next song preloaded — is asked of the doorman with the session's header and the
 * element's own `Range:`, and the doorman's answer comes back as it is: a 206
 * with its `Content-Range`, so a song plays and seeks while it arrives.
 *
 * Only a range, never the whole song held here: the bytes are passed straight
 * on. Keeping the songs that were played is the page's business, through the
 * shell's `recent` folder (ports/desktop/recentCopies.desktop.ts), as on a phone.
 *
 * The session is the page's, handed over with `bucket.use` and kept in this
 * process's memory alone: the page keeps it beside the replica, where the main
 * process cannot read it. It is never logged and never sent anywhere but the
 * doorman it names.
 */

/** What answers the doorman's address: Electron's `net.fetch`, or a test's doorman. */
type Fetch = (url: string, init: { method: string; headers: Headers }) => Promise<Response>

interface StreamProxyOptions {
  readonly fetch: Fetch
  /** The bucket refused for the day: told to the page, so its own reads hold off and it says why. */
  readonly onCapped: (message: string) => void
  readonly now?: () => number
}

export interface StreamProxy {
  use(session: StreamSession): void
  /**
   * The answer to a request for `key`. `allowOrigin` is the origin the CORS
   * pair names — the caller's to decide, as for a file on disk (`protocol.ts`).
   */
  serve(request: Request, key: string, allowOrigin: string): Promise<Response>
}

export function createStreamProxy({
  fetch,
  onCapped,
  now = () => Date.now(),
}: StreamProxyOptions): StreamProxy {
  let session: StreamSession = null

  /*
   * The bucket refusing for the day (docs/SYNC.md, "Caps"), as the service
   * worker keeps it: for as long as the page's own hold lasts nothing is
   * asked, and every range the player wants is answered with the doorman's
   * refusal from here; then one real request finds out whether it is over.
   */
  let capped: { readonly until: number; readonly body: string } | null = null

  async function ask(request: Request, key: string, current: NonNullable<StreamSession>) {
    if (capped !== null) {
      if (now() < capped.until) return refused(502, capped.body)
      capped = null
    }
    const headers = new Headers({ Authorization: `Bearer ${current.token}` })
    const range = relayedRange(request.headers.get('Range'))
    if (range !== null) headers.set('Range', range)

    let upstream: Response
    try {
      upstream = await fetch(`${current.doormanUrl}${DOORMAN_PATHS.file(key)}`, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
      })
    } catch {
      return new Response('This song is not on this device, and your storage cannot be reached.', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    if (!upstream.ok) {
      // A refusal is small JSON, read whole: a cap is the one worth holding,
      // and a 401 — the session over — goes back as the doorman said it, for
      // the player to explain (ports/streamFailure.model.ts).
      const body = await upstream.text().catch(() => '')
      const refusal = parseDoormanRefusal(body)
      if (upstream.status === 502 && refusal?.code === BUCKET_CAP_CODE) {
        capped = { until: now() + BUCKET_HOLD_MS, body }
        onCapped(refusal.error)
      }
      const answer = refused(upstream.status, body)
      const contentRange = upstream.headers.get('content-range')
      if (contentRange) answer.headers.set('Content-Range', contentRange)
      return answer
    }

    const answer = new Headers()
    for (const name of [...STREAM_RELAYED_HEADERS, 'etag', 'last-modified']) {
      const value = upstream.headers.get(name)
      if (value !== null) answer.set(name, value)
    }
    // The whole file is the one its hash names, for good; a slice is the
    // player's business while it plays, and no cache's.
    answer.set(
      'Cache-Control',
      upstream.status === 206 ? 'no-store' : 'private, max-age=31536000, immutable',
    )
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: answer,
    })
  }

  return {
    use(next) {
      // Another session may be another bucket, with a day of its own.
      if (next?.token !== session?.token || next?.doormanUrl !== session?.doormanUrl) capped = null
      session = next
    },

    async serve(request, key, allowOrigin) {
      const answer = await (async () => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
        }
        // Only what the doorman would let a device read: never a path the page made up.
        if (!isCloudFileKey(key)) return new Response('not found', { status: 404 })
        const current = session
        if (current === null) {
          return refused(
            401,
            JSON.stringify({ error: 'Signed out', code: DOORMAN_ERROR.unauthorized }),
          )
        }
        return ask(request, key, current)
      })()
      // The engine asks with credentials so the analyser may read the samples,
      // and that mode wants an origin named rather than `*` (protocol.ts).
      answer.headers.set('Access-Control-Allow-Origin', allowOrigin)
      answer.headers.set('Access-Control-Allow-Credentials', 'true')
      return answer
    },
  }
}

function refused(status: number, body: string): Response {
  return new Response(body === '' ? null : body, {
    status,
    headers: {
      'Content-Type': body.startsWith('{') ? 'application/json' : 'text/plain',
      'Cache-Control': 'no-store',
    },
  })
}
