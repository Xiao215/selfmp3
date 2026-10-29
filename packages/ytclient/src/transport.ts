import {
  base64ToBytes,
  bytesToBase64,
  EXTENSION_ID,
  YT_PROXY_PORT,
  YtProxyExtensionMessageSchema,
  type YtProxyExtensionMessage,
  type YtProxyPageMessage,
} from '@selfmp3/shared'

/**
 * How the page's requests reach YouTube.
 *
 * A page cannot ask YouTube for anything itself — CORS — so something that
 * can carries the requests for it, and youtubei.js is handed a `fetch` that
 * goes through that. The extension is one such carrier (`extensionFetch`); the
 * desktop shell, or a userscript, would be others with the same shape.
 */
export type YtFetch = typeof fetch

/**
 * How long one request to YouTube may take, its body included: a megabyte
 * on a slow phone connection is well inside it, a connection that stalled
 * without being reset is not.
 */
export const YOUTUBE_REQUEST_MS = 120_000

/** `fetch`, each request of it stopped after `ms` — and whenever its caller stops it. */
export function withTimeout(fetch: YtFetch, ms: number): YtFetch {
  return (input, init = {}) => {
    const stop = new AbortController()
    const timer = setTimeout(() => {
      stop.abort(new Error(`YouTube did not answer within ${Math.round(ms / 1000)} seconds`))
    }, ms)
    const outer = init.signal
    if (outer?.aborted) stop.abort(outer.reason)
    else outer?.addEventListener('abort', () => stop.abort(outer.reason), { once: true })
    // The timer outlives the answer on purpose: the body is read after it, and stopping a read done is nothing.
    return fetch(input, { ...init, signal: stop.signal }).catch((error: unknown) => {
      clearTimeout(timer)
      throw error
    })
  }
}

/** The part of a `chrome.runtime.Port` the page uses. */
export interface PagePort {
  postMessage(message: YtProxyPageMessage): void
  disconnect(): void
  readonly onMessage: { addListener(listener: (message: unknown) => void): void }
  readonly onDisconnect: { addListener(listener: () => void): void }
}

interface Pending {
  head(message: Extract<YtProxyExtensionMessage, { type: 'head' }>): void
  chunk(bytes: Uint8Array): void
  end(): void
  fail(error: Error): void
}

/** Statuses whose response may not have a body, which `new Response` enforces. */
const NULL_BODY = new Set([101, 103, 204, 205, 304])

/**
 * A `fetch` that sends each request down a port opened by `connect`.
 *
 * One port carries every request, each by its own id; a port that closes —
 * the extension reloaded, or its worker stopped — fails what was on it, and
 * the next request opens another.
 */
export function portFetch(connect: () => PagePort): YtFetch {
  let port: PagePort | null = null
  let nextId = 0
  const pending = new Map<number, Pending>()

  const open = (): PagePort => {
    if (port) return port
    const opened = connect()
    port = opened
    opened.onMessage.addListener(raw => {
      const parsed = YtProxyExtensionMessageSchema.safeParse(raw)
      if (!parsed.success) return
      const message = parsed.data
      const request = pending.get(message.id)
      if (!request) return
      switch (message.type) {
        case 'head':
          request.head(message)
          return
        case 'chunk':
          request.chunk(base64ToBytes(message.data))
          return
        case 'end':
          pending.delete(message.id)
          request.end()
          return
        case 'error':
          pending.delete(message.id)
          request.fail(new TypeError(`the extension could not fetch that: ${message.message}`))
          return
      }
    })
    opened.onDisconnect.addListener(() => {
      if (port === opened) port = null
      for (const request of pending.values()) {
        request.fail(new TypeError('the extension closed the connection'))
      }
      pending.clear()
    })
    return opened
  }

  return async (input, init) => {
    const request = new Request(input, init)
    const id = nextId++
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? null
        : bytesToBase64(new Uint8Array(await request.arrayBuffer()))
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      throw new TypeError(`the extension does not carry ${method} requests`)
    }
    request.signal.throwIfAborted()

    return new Promise<Response>((resolve, reject) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null
      let answered = false
      const stream = new ReadableStream<Uint8Array>({
        start: c => {
          controller = c
        },
        cancel: () => {
          pending.delete(id)
          port?.postMessage({ type: 'abort', id })
        },
      })

      const fail = (error: Error): void => {
        if (!answered) reject(error)
        else controller?.error(error)
      }

      pending.set(id, {
        head: message => {
          answered = true
          resolve(
            new Response(NULL_BODY.has(message.status) ? null : stream, {
              status: message.status,
              statusText: message.statusText,
              headers: message.headers,
            }),
          )
        },
        chunk: bytes => controller?.enqueue(bytes),
        end: () => controller?.close(),
        fail,
      })

      request.signal.addEventListener(
        'abort',
        () => {
          if (!pending.delete(id)) return
          port?.postMessage({ type: 'abort', id })
          fail(new DOMException('The request was aborted', 'AbortError'))
        },
        { once: true },
      )

      try {
        open().postMessage({
          type: 'request',
          id,
          url: request.url,
          method,
          headers: [...request.headers],
          body,
        })
      } catch (error) {
        pending.delete(id)
        reject(error instanceof Error ? error : new TypeError(String(error)))
      }
    })
  }
}

/** What Chrome puts on a page an extension has said it will talk to. */
interface ChromeRuntime {
  connect(extensionId: string, options: { name: string }): PagePort
}

/**
 * The extension's carrier, or null when this page has no way to it: another
 * browser, the extension not installed, or a page it does not list in
 * `externally_connectable` — Chrome only gives `chrome.runtime` to those.
 */
export function extensionFetch(extensionId: string = EXTENSION_ID): YtFetch | null {
  const runtime = (globalThis as { chrome?: { runtime?: Partial<ChromeRuntime> } }).chrome?.runtime
  const connect = runtime?.connect
  if (typeof connect !== 'function') return null
  return portFetch(() => connect.call(runtime, extensionId, { name: YT_PROXY_PORT }))
}

/**
 * Whether the carrier answers at all. Chrome gives a page `chrome.runtime`
 * when any extension says it will talk to the page, and a port to one that is
 * not installed is closed only once it is opened — so this asks for YouTube's
 * empty page (`generate_204`), which is no video and costs YouTube nothing,
 * and gives up after `timeoutMs`.
 */
export async function carrierAnswers(fetch: YtFetch, timeoutMs = 3000): Promise<boolean> {
  try {
    const response = await fetch('https://www.youtube.com/generate_204', {
      signal: AbortSignal.timeout(timeoutMs),
    })
    await response.body?.cancel()
    return response.status === 204 || response.ok
  } catch {
    return false
  }
}
