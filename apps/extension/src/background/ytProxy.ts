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
          send({ type: 'error', id, message: 'YouTube redirected somewhere else' })
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
          const reader = response.body.getReader()
          let pending = new Uint8Array(0)
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            const joined = new Uint8Array(pending.length + value.length)
            joined.set(pending)
            joined.set(value, pending.length)
            let offset = 0
            for (; joined.length - offset >= YT_PROXY_CHUNK_BYTES; offset += YT_PROXY_CHUNK_BYTES) {
              const data = bytesToBase64(joined.subarray(offset, offset + YT_PROXY_CHUNK_BYTES))
              send({ type: 'chunk', id, data })
            }
            pending = joined.slice(offset)
          }
          if (pending.length > 0) send({ type: 'chunk', id, data: bytesToBase64(pending) })
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
