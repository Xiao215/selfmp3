import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  YT_PROXY_CHUNK_BYTES,
  YT_PROXY_PAGES,
  YT_PROXY_PORT,
  type YtProxyExtensionMessage,
} from '@selfmp3/shared'
import { ytProxy, type ProxyPort } from './ytProxy.js'

const APP = 'http://localhost:4602/'

function fakePort(options: { name?: string; page?: string } = {}) {
  const sent: YtProxyExtensionMessage[] = []
  let onMessage: (message: unknown) => void = () => undefined
  let onDisconnect: () => void = () => undefined
  const port: ProxyPort & { disconnected: boolean } = {
    name: options.name ?? YT_PROXY_PORT,
    sender: { url: options.page ?? `${APP}index.html` },
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
    ytProxy({ fetch, pages: [APP] })(port)

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
    ytProxy({ fetch, pages: [APP] })(port)

    send(request(2, 'https://accounts.google.com/'))
    await settled(sent, 2)

    expect(fetch).not.toHaveBeenCalled()
    expect(sent).toEqual([{ type: 'error', id: 2, message: expect.any(String) }])
  })

  it('does not hand back an answer that was redirected off YouTube', async () => {
    const answer = new Response('secret')
    Object.defineProperty(answer, 'url', { value: 'https://example.com/' })
    const { port, sent, send } = fakePort()
    ytProxy({ fetch: () => Promise.resolve(answer), pages: [APP] })(port)

    send(request(3, 'https://www.youtube.com/redirect'))
    await settled(sent, 3)

    expect(sent).toEqual([{ type: 'error', id: 3, message: expect.any(String) }])
  })

  it('hangs up on a page it was not told to serve', () => {
    const { port } = fakePort({ page: 'https://example.com/' })
    ytProxy({ fetch: vi.fn(), pages: [APP] })(port)
    expect(port.disconnected).toBe(true)
  })

  it('hangs up on another page of the same site', () => {
    const { port } = fakePort({ page: 'https://xiao215.github.io/someone-else/' })
    ytProxy({ fetch: vi.fn(), pages: ['https://xiao215.github.io/selfmp3/'] })(port)
    expect(port.disconnected).toBe(true)
  })

  it('leaves a port by another name alone', () => {
    const { port } = fakePort({ name: 'something-else', page: 'https://example.com/' })
    ytProxy({ fetch: vi.fn(), pages: [APP] })(port)
    expect(port.disconnected).toBe(false)
  })

  it('stops a request when the page closes the port', async () => {
    let signal: AbortSignal | undefined
    const fetch = vi.fn((_: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => undefined)
    })
    const { port, send, close } = fakePort()
    ytProxy({ fetch, pages: [APP] })(port)

    send(request(4, 'https://rr1---sn-x.googlevideo.com/videoplayback'))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    close()

    expect(signal?.aborted).toBe(true)
  })
})

describe('ytProxy, signed in', () => {
  /** What the proxy asked `fetch` for, by request id. */
  async function carried(signIn: () => Promise<string | null>, url: string) {
    const fetch = vi.fn(() => Promise.resolve(new Response('ok')))
    const { port, sent, send } = fakePort()
    ytProxy({ fetch, pages: [APP], signIn, now: () => 1_700_000_000_000 })(port)
    send(request(1, url, { method: 'POST', headers: [['x-a', '1']] }))
    await settled(sent, 1)
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    return { init, headers: new Headers(init.headers) }
  }

  const PLAYER = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'

  it('sends the player request with the sign-in, when the person turned it on', async () => {
    const { init, headers } = await carried(() => Promise.resolve('abc'), PLAYER)
    expect(init.credentials).toBe('include')
    expect(headers.get('authorization')).toMatch(/^SAPISIDHASH 1700000000_[0-9a-f]{40}$/)
    expect(headers.get('x-goog-authuser')).toBe('0')
    expect(headers.get('x-a')).toBe('1')
  })

  it('sends nothing else signed in, whatever the option', async () => {
    const signIn = vi.fn(() => Promise.resolve('abc'))
    const { init, headers } = await carried(signIn, 'https://www.youtube.com/youtubei/v1/like/like')
    expect(init.credentials).toBe('omit')
    expect(headers.has('authorization')).toBe(false)
    // Not even asked: the option is read only for what may go signed in.
    expect(signIn).not.toHaveBeenCalled()
  })

  it('sends the player request with no sign-in while the option is off', async () => {
    const { init, headers } = await carried(() => Promise.resolve(null), PLAYER)
    expect(init.credentials).toBe('omit')
    expect(headers.has('authorization')).toBe(false)
  })
})

describe('the manifest', () => {
  it('lets in exactly the pages the proxy serves', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'),
    ) as { externally_connectable: { matches: string[] } }
    expect(manifest.externally_connectable.matches).toEqual(YT_PROXY_PAGES.map(page => `${page}*`))
  })

  it('asks for the cookies only when the person turns the sign-in on', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'),
    ) as { permissions: string[]; optional_permissions: string[] }
    expect(manifest.permissions).not.toContain('cookies')
    expect(manifest.optional_permissions).toEqual(['cookies'])
  })
})
