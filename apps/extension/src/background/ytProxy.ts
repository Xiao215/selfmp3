import {
  base64ToBytes,
  bytesToBase64,
  isYtProxyPage,
  isYtProxyUrl,
  sapisidHash,
  signsIn,
  YT_PROXY_CHUNK_BYTES,
  YT_PROXY_PORT,
  YtProxyPageMessageSchema,
  type YtProxyExtensionMessage,
  type YtProxyPageMessage,
} from '@selfmp3/shared'

/**
 * The extension carrying the app's requests to YouTube (packages/shared's
 * ytProxy.ts says why it is only that).
 *
 * The page opens a port, sends requests on it, and gets each answer back as a
 * head, the body in chunks, and an end. Everything about what to ask YouTube
 * for is the page's: nothing here reads what it carries.
 */

/** The part of a `chrome.runtime.Port` this uses, so a test can stand in for one. */
export interface ProxyPort {
  readonly name: string
  readonly sender?: { readonly url?: string }
  postMessage(message: YtProxyExtensionMessage): void
  disconnect(): void
  readonly onMessage: { addListener(listener: (message: unknown) => void): void }
  readonly onDisconnect: { addListener(listener: () => void): void }
}

/**
 * The listener for `chrome.runtime.onConnectExternal`.
 *
 * `pages` is checked again here though the manifest already limits who may
 * connect: the manifest is the lock, this is reading the name on the key.
 */
export function ytProxy(deps: {
  fetch: typeof fetch
  /** Where the pages that may connect start (`YT_PROXY_PAGES`). */
  pages: readonly string[]
  /**
   * The `SAPISID` cookie of this browser's YouTube sign-in, when the person
   * has turned "use my YouTube sign-in" on in the options (options.ts), or
   * null. Asked only for a request `signsIn` names.
   */
  signIn?: () => Promise<string | null>
  /** Seconds since the epoch, for the sign-in's hash. */
  now?: () => number
}): (port: ProxyPort) => void {
  return port => {
    if (port.name !== YT_PROXY_PORT) return
    // The page's whole address, not its origin: the app's path, not the site it is on.
    const page = port.sender?.url
    if (!page || !isYtProxyPage(page, deps.pages)) {
      port.disconnect()
      return
    }

    const inFlight = new Map<number, AbortController>()
    let open = true
    port.onDisconnect.addListener(() => {
      open = false
      for (const controller of inFlight.values()) controller.abort()
      inFlight.clear()
    })
    // Posting on a port the page has closed throws; a closed page wants nothing more.
    const send = (message: YtProxyExtensionMessage): void => {
      if (open) port.postMessage(message)
    }

    const carry = async (request: Extract<YtProxyPageMessage, { type: 'request' }>) => {
      const { id } = request
      if (!isYtProxyUrl(request.url)) {
        send({ type: 'error', id, message: 'only YouTube addresses are carried' })
        return
      }
      if (inFlight.has(id)) {
        send({ type: 'error', id, message: 'that request id is already in use' })
        return
      }
      const controller = new AbortController()
      inFlight.set(id, controller)
      try {
        // Signed in only where the person said so, and only for the player
        // request (`signsIn`); everything else goes with no session at all.
        const sapisid = signsIn(request.url) ? ((await deps.signIn?.()) ?? null) : null
        const headers = new Headers(request.headers)
        if (sapisid) {
          const seconds = Math.floor((deps.now?.() ?? Date.now()) / 1000)
          headers.set('Authorization', await sapisidHash(sapisid, seconds))
          headers.set('X-Goog-AuthUser', '0')
        }
        const response = await deps.fetch(request.url, {
          method: request.method,
          headers,
          ...(request.body === null ? {} : { body: base64ToBytes(request.body) }),
          credentials: sapisid ? 'include' : 'omit',
          signal: controller.signal,
        })
        // A redirect is followed before anything here sees it; one that led
        // off YouTube is not read, let alone handed back.
        if (response.url && !isYtProxyUrl(response.url)) {
          controller.abort()
          // Google's "unusual traffic" page is a refusal for rate, and is said as one (`isRateLimited`).
          const sorry = new URL(response.url).pathname.startsWith('/sorry/')
          const message = sorry
            ? 'YouTube redirected to /sorry/ (unusual traffic)'
            : 'YouTube redirected somewhere else'
          send({ type: 'error', id, message })
          return
        }
        send({
          type: 'head',
          id,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers],
        })
        if (response.body) {
          // Reads come in whatever sizes the network gave; messages go out in
          // chunks of at most YT_PROXY_CHUNK_BYTES.
          // What has come is kept as the parts it came in, and joined once per chunk sent.
          const reader = response.body.getReader()
          let parts: Uint8Array[] = []
          let pending = 0
          const flush = (size: number): void => {
            const out = new Uint8Array(size)
            let filled = 0
            while (filled < size) {
              const part = parts[0]
              if (!part) break
              const take = Math.min(part.length, size - filled)
              out.set(part.subarray(0, take), filled)
              filled += take
              if (take === part.length) parts.shift()
              else parts[0] = part.subarray(take)
            }
            pending -= size
            send({ type: 'chunk', id, data: bytesToBase64(out) })
          }
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            parts.push(value)
            pending += value.length
            while (pending >= YT_PROXY_CHUNK_BYTES) flush(YT_PROXY_CHUNK_BYTES)
          }
          if (pending > 0) flush(pending)
          parts = []
        }
        send({ type: 'end', id })
      } catch (error) {
        // Aborted by the page, which is no longer waiting for an answer.
        if (controller.signal.aborted) return
        send({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
      } finally {
        inFlight.delete(id)
      }
    }

    port.onMessage.addListener(raw => {
      const parsed = YtProxyPageMessageSchema.safeParse(raw)
      // A message that is not the protocol has no id to answer to.
      if (!parsed.success) return
      const message = parsed.data
      if (message.type === 'abort') {
        inFlight.get(message.id)?.abort()
        return
      }
      void carry(message)
    })
  }
}
