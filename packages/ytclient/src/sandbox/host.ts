import { isYtProxyUrl, messageOf } from '@selfmp3/shared'
import type { DeviceFile, VideoFacts, YouTubeCore } from '../keptSongs.js'
import { createPoMinter, keptUntilStale, minterLifetimeMs } from '../poToken.js'
import { withTimeout, YOUTUBE_REQUEST_MS, type YtFetch } from '../transport.js'
import { isMessage, type FrameMessage, type PageMessage } from './protocol.js'

/**
 * The page's side of the sandbox frame (protocol.ts): make the frame, carry
 * its requests to YouTube through `fetch` — the extension's — and ask it to
 * describe and download. Nothing the frame sends is run here; what it asks to
 * fetch is held to YouTube's hosts before it goes anywhere, as the extension
 * holds it again.
 */

interface Call {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (percent: number) => void
}

/**
 * The frame at `src`, ready: a hidden iframe with `sandbox="allow-scripts"`
 * and nothing more. Rejects when it has not said it is ready in `timeoutMs`.
 */
export function openSandbox(options: {
  src: string
  fetch: YtFetch
  timeoutMs?: number
}): Promise<YouTubeCore> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.title = 'self.mp3 YouTube sandbox'
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
  frame.src = options.src

  const post = (message: PageMessage, transfer: Transferable[] = []): void => {
    // The frame's origin is opaque, so `*`: the window, not an origin, is who it is.
    frame.contentWindow?.postMessage(message, '*', transfer)
  }

  let nextCall = 0
  const calls = new Map<number, Call>()
  const fetching = new Map<number, AbortController>()

  /*
   * BotGuard, run here and not in the frame: YouTube issues no integrity
   * token to a frame with no origin of its own. Started the first time the
   * frame asks, kept for every song after; one that failed to start is let go.
   */
  // Run again once its tokens stop being worth anything (`minterLifetimeMs`); BotGuard's
  // requests are given up on as every other is, since one that stalls would hold every song up.
  const minter = keptUntilStale(
    () => createPoMinter(withTimeout(options.fetch, YOUTUBE_REQUEST_MS)),
    made => minterLifetimeMs(made),
    made => void made.close(),
  )
  const mint = async (message: Extract<FrameMessage, { kind: 'mint' }>): Promise<void> => {
    try {
      post({ kind: 'minted', id: message.id, token: await (await minter()).mint(message.binding) })
    } catch (error) {
      post({
        kind: 'mintFailed',
        id: message.id,
        message: messageOf(error),
      })
    }
  }

  const carry = async (message: Extract<FrameMessage, { kind: 'fetch' }>): Promise<void> => {
    const { id } = message
    if (!isYtProxyUrl(message.url)) {
      post({ kind: 'fetchFailed', id, message: 'only YouTube addresses are carried' })
      return
    }
    const stop = new AbortController()
    fetching.set(id, stop)
    try {
      const response = await options.fetch(message.url, {
        method: message.method,
        headers: message.headers.map(([name, value]): [string, string] => [name, value]),
        ...(message.body ? { body: message.body } : {}),
        signal: stop.signal,
      })
      const body = response.body ? await response.arrayBuffer() : null
      post(
        {
          kind: 'fetched',
          id,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers],
          body,
        },
        body ? [body] : [],
      )
    } catch (error) {
      if (stop.signal.aborted) return
      post({
        kind: 'fetchFailed',
        id,
        message: messageOf(error),
      })
    } finally {
      fetching.delete(id)
    }
  }

  return new Promise<YouTubeCore>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage)
      frame.remove()
      reject(new Error('the YouTube sandbox did not start'))
    }, options.timeoutMs ?? 15_000)

    function onMessage(event: MessageEvent): void {
      if (event.source !== frame.contentWindow || !isMessage(event.data)) return
      const message = event.data as FrameMessage
      switch (message.kind) {
        case 'ready':
          clearTimeout(timer)
          resolve(core)
          return
        case 'fetch':
          void carry(message)
          return
        case 'abortFetch':
          fetching.get(message.id)?.abort()
          return
        case 'mint':
          void mint(message)
          return
        case 'progress':
          calls.get(message.id)?.onProgress?.(message.percent)
          return
        case 'described':
        case 'downloaded':
        case 'failed': {
          const call = calls.get(message.id)
          if (!call) return
          calls.delete(message.id)
          if (message.kind === 'failed') call.reject(new Error(message.message))
          else call.resolve(message.kind === 'described' ? message.facts : message.file)
          return
        }
      }
    }
    window.addEventListener('message', onMessage)

    const ask = <T>(
      kind: 'describe' | 'download',
      url: string,
      onProgress?: (percent: number) => void,
    ): Promise<T> =>
      new Promise<T>((resolveCall, rejectCall) => {
        const id = nextCall++
        calls.set(id, {
          resolve: value => resolveCall(value as T),
          reject: rejectCall,
          ...(onProgress ? { onProgress } : {}),
        })
        post({ kind, id, url })
      })

    const core: YouTubeCore = {
      describe: url => ask<VideoFacts>('describe', url),
      download: (url, onProgress) => ask<DeviceFile>('download', url, onProgress),
    }

    document.body.appendChild(frame)
  })
}
