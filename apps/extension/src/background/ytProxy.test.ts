import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  YT_PROXY_CHUNK_BYTES,
  YT_PROXY_ORIGINS,
  YT_PROXY_PORT,
  type YtProxyExtensionMessage,
} from '@selfmp3/shared'
import { ytProxy, type ProxyPort } from './ytProxy.js'

const APP = 'http://localhost:4602'

function fakePort(options: { name?: string; origin?: string } = {}) {
  const sent: YtProxyExtensionMessage[] = []
  let onMessage: (message: unknown) => void = () => undefined
  let onDisconnect: () => void = () => undefined
  const port: ProxyPort & { disconnected: boolean } = {
    name: options.name ?? YT_PROXY_PORT,
    sender: { origin: options.origin ?? APP },
    disconnected: false,
    postMessage: message => sent.push(message),
    disconnect: () => {
      port.disconnected = true
    },
    onMessage: { addListener: listener => (onMessage = listener) },
    onDisconnect: { addListener: listener => (onDisconnect = listener) },
  }
  return {
    port,
    sent,
    send: (message: unknown) => onMessage(message),
    close: () => onDisconnect(),
  }
}

const request = (id: number, url: string, extra: object = {}) => ({
  type: 'request',
  id,
  url,
  method: 'GET',
  headers: [],
  body: null,
  ...extra,
})

/** Until the proxy has said its last word on a request. */
async function settled(sent: YtProxyExtensionMessage[], id: number): Promise<void> {
  await vi.waitFor(() => {
    expect(sent.some(m => m.id === id && (m.type === 'end' || m.type === 'error'))).toBe(true)
  })
}

describe('ytProxy', () => {
  it('carries a request and hands the answer back as head, chunks and end', async () => {
    const body = new Uint8Array(YT_PROXY_CHUNK_BYTES + 10).map((_, i) => i % 251)
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(body, { status: 206, statusText: 'Partial', headers: { 'x-a': '1' } }),
      ),
    )
    const { port, sent, send } = fakePort()
    ytProxy({ fetch, origins: [APP] })(port)

    send(
      request(1, 'https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: [['content-type', 'application/json']],
        body: bytesToBase64(new TextEncoder().encode('{"a":1}')),
      }),
    )
    await settled(sent, 1)

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://www.youtube.com/youtubei/v1/player')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('{"a":1}')

    const head = sent[0]
    expect(head).toMatchObject({ type: 'head', id: 1, status: 206, statusText: 'Partial' })
    const chunks = sent.filter(m => m.type === 'chunk')
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    // Compared as buffers: a deep equal over a megabyte of numbers is seconds.
    const joined = Buffer.concat(chunks.map(m => base64ToBytes(m.type === 'chunk' ? m.data : '')))
    expect(joined.equals(body)).toBe(true)
    expect(sent.at(-1)).toEqual({ type: 'end', id: 1 })
  })

  it('refuses an address that is not YouTube without fetching it', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const { port, sent, send } = fakePort()
    ytProxy({ fetch, origins: [APP] })(port)

    send(request(2, 'https://accounts.google.com/'))
    await settled(sent, 2)

    expect(fetch).not.toHaveBeenCalled()
    expect(sent).toEqual([{ type: 'error', id: 2, message: expect.any(String) }])
  })

  it('does not hand back an answer that was redirected off YouTube', async () => {
    const answer = new Response('secret')
    Object.defineProperty(answer, 'url', { value: 'https://example.com/' })
    const { port, sent, send } = fakePort()
    ytProxy({ fetch: () => Promise.resolve(answer), origins: [APP] })(port)

    send(request(3, 'https://www.youtube.com/redirect'))
    await settled(sent, 3)

    expect(sent).toEqual([{ type: 'error', id: 3, message: expect.any(String) }])
  })

  it('hangs up on a page it was not told to serve', () => {
    const { port } = fakePort({ origin: 'https://example.com' })
    ytProxy({ fetch: vi.fn(), origins: [APP] })(port)
    expect(port.disconnected).toBe(true)
  })

  it('leaves a port by another name alone', () => {
    const { port } = fakePort({ name: 'something-else', origin: 'https://example.com' })
    ytProxy({ fetch: vi.fn(), origins: [APP] })(port)
    expect(port.disconnected).toBe(false)
  })

  it('stops a request when the page closes the port', async () => {
    let signal: AbortSignal | undefined
    const fetch = vi.fn((_: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => undefined)
    })
    const { port, send, close } = fakePort()
    ytProxy({ fetch, origins: [APP] })(port)

    send(request(4, 'https://rr1---sn-x.googlevideo.com/videoplayback'))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    close()

    expect(signal?.aborted).toBe(true)
  })
})

describe('the manifest', () => {
  it('lets in exactly the pages the proxy serves', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'),
    ) as { externally_connectable: { matches: string[] } }
    expect(manifest.externally_connectable.matches).toEqual(
      YT_PROXY_ORIGINS.map(origin => `${origin}/*`),
    )
  })
})
