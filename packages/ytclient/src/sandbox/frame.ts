// First of all: that this is the sandbox the app made, and not the same page framed by anyone else.
import './guard.js'
// Then, before youtubei.js runs a line: it reads storage as it loads.
import './storage.js'
import { createYouTubeCore } from '../downloader.js'
import type { YtFetch } from '../transport.js'
import { isMessage, NULL_BODY, type FrameMessage, type PageMessage } from './protocol.js'

/**
 * The sandbox frame (protocol.ts): youtubei.js, YouTube's player script and
 * BotGuard, run where they cannot reach the app's page. Bundled on its own
 * into the app's `public/yt-sandbox.js` and loaded by `yt-sandbox.html`.
 *
 * Every request goes through the page (`relayFetch`), which hands it to the
 * extension; nothing here can reach YouTube, or anything else, by itself.
 * Messages are taken from the page that made this frame and from nothing
 * else, and answers go only to it.
 */

const page = window.parent
const send = (message: FrameMessage, transfer: Transferable[] = []): void => {
  // The page's origin is not this frame's to know; what goes to it is YouTube's own answers.
  page.postMessage(message, '*', transfer)
}

let nextFetch = 0
const fetches = new Map<
  number,
  { resolve: (response: Response) => void; reject: (error: Error) => void }
>()

/** A `fetch` that asks the page, which asks the extension. */
const relayFetch: YtFetch = async (input, init) => {
  const request = new Request(input, init)
  const id = nextFetch++
  const body =
    request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer()
  request.signal.throwIfAborted()
  return new Promise<Response>((resolve, reject) => {
    fetches.set(id, { resolve, reject })
    request.signal.addEventListener(
      'abort',
      () => {
        if (!fetches.delete(id)) return
        send({ kind: 'abortFetch', id })
        reject(new DOMException('The request was aborted', 'AbortError'))
      },
      { once: true },
    )
    send(
      {
        kind: 'fetch',
        id,
        url: request.url,
        method: request.method,
        headers: [...request.headers],
        body,
      },
      body ? [body] : [],
    )
  })
}

let nextMint = 0
const mints = new Map<
  number,
  { resolve: (token: string) => void; reject: (error: Error) => void }
>()

/**
 * How long a token from the page may take: BotGuard's first run is a few
 * requests, each given up on after two minutes in the page; past this one the
 * session is not left waiting for good.
 */
const MINT_MS = 5 * 60_000

/** PO tokens from the page, which runs BotGuard where it can attest (protocol.ts). */
const pageMinter = {
  mint: (binding: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const id = nextMint++
      const timer = setTimeout(() => {
        if (mints.delete(id)) reject(new Error('the page made no PO token in time'))
      }, MINT_MS)
      mints.set(id, {
        resolve: token => {
          clearTimeout(timer)
          resolve(token)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
      send({ kind: 'mint', id, binding })
    }),
}

const youtube = createYouTubeCore(relayFetch, { minter: pageMinter })

async function answer(message: Extract<PageMessage, { kind: 'describe' | 'download' }>) {
  const { id } = message
  try {
    if (message.kind === 'describe') {
      send({ kind: 'described', id, facts: await youtube.describe(message.url) })
      return
    }
    const file = await youtube.download(message.url, percent => {
      send({ kind: 'progress', id, percent })
    })
    send({ kind: 'downloaded', id, file }, [file.bytes.buffer])
  } catch (error) {
    send({ kind: 'failed', id, message: error instanceof Error ? error.message : String(error) })
  }
}

window.addEventListener('message', event => {
  if (event.source !== page || !isMessage(event.data)) return
  const message = event.data as PageMessage
  switch (message.kind) {
    case 'describe':
    case 'download':
      void answer(message)
      return
    case 'fetched': {
      const pending = fetches.get(message.id)
      if (!pending) return
      fetches.delete(message.id)
      pending.resolve(
        new Response(NULL_BODY.has(message.status) ? null : message.body, {
          status: message.status,
          statusText: message.statusText,
          headers: message.headers.map(([name, value]): [string, string] => [name, value]),
        }),
      )
      return
    }
    case 'fetchFailed': {
      const pending = fetches.get(message.id)
      if (!pending) return
      fetches.delete(message.id)
      pending.reject(new TypeError(message.message))
      return
    }
    case 'minted':
    case 'mintFailed': {
      const pending = mints.get(message.id)
      if (!pending) return
      mints.delete(message.id)
      if (message.kind === 'minted') pending.resolve(message.token)
      else pending.reject(new Error(message.message))
      return
    }
  }
})

send({ kind: 'ready' })
