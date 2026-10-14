import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { DEFAULT_SETTINGS, type Library, type Settings } from '@selfmp3/shared'
import { configureClient, type Api } from '@selfmp3/client'
import { ImportingPanel } from './ImportingPanel'
import { SmartPanel } from './SmartPanel'

/**
 * The settings a server acts on, changed from a signed-in device (2026-10-14).
 *
 * A cloud library's every call went to this device's copy, which kept the
 * settings on the device: turning Ask off, or Search the web on, changed
 * nothing the server read. Now the panels find the server the way Import does
 * and read and write its own settings. Faked here is only the network: the
 * server's addresses, as the device's copy of the library names them, and
 * the server behind them.
 */

jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ fromCloud: true, connection: null }),
}))
jest.mock('../../replica', () => ({ library: { markCloudLibraryStale: () => undefined } }))

const ADDRESS = 'https://music.example.com'
configureClient({
  api: {
    cloudServer: () => Promise.resolve({ server: { addresses: [ADDRESS], token: 't' } }),
    onCloudLibraryChanged: () => () => undefined,
  } as unknown as Api,
} as Parameters<typeof configureClient>[0])

const serverLibrary: Library = {
  songs: [],
  // The server's numbering: tag 7 there is "night drive", whatever it is here.
  tags: [{ id: 7, name: 'night drive', hue: 200, songCount: 0 }],
  playlists: [],
  version: 1,
  generatedAt: '2026-10-14T00:00:00.000Z',
}

/** The server: its settings table, and every request it was sent. */
let stored: Settings
let up: boolean
let sent: { method: string; path: string; body: unknown; auth: string | null }[]

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  stored = { ...DEFAULT_SETTINGS, defaultImportTagIds: [7] }
  up = true
  sent = []
  global.fetch = jest.fn((input: string, init: RequestInit = {}) => {
    if (!up) return Promise.reject(new TypeError('Network request failed'))
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    sent.push({ method, path: url.pathname, body, auth: headers.get('authorization') })
    if (url.origin !== ADDRESS) return Promise.reject(new TypeError('no such host'))
    if (url.pathname === '/api/health') return Promise.resolve(json({ ok: true }))
    if (url.pathname === '/api/library') return Promise.resolve(json(serverLibrary))
    if (url.pathname === '/api/settings' && method === 'GET') return Promise.resolve(json(stored))
    if (url.pathname === '/api/settings' && method === 'PATCH') {
      stored = { ...stored, ...(body as Partial<Settings>) }
      return Promise.resolve(json(stored))
    }
    return Promise.resolve(new Response('{}', { status: 404 }))
  }) as unknown as typeof fetch
})

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const draw = async (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const drawn = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>,
  )
  return { ...drawn, client }
}

const anchor = (): void => undefined

it('turns a smart feature off, and the web search on, on the server itself', async () => {
  const { unmount, client } = await draw(<SmartPanel anchor={anchor} />)
  const web = await screen.findByRole('switch', { name: 'Search the web' })
  const ask = screen.getByRole('switch', { name: 'Ask in Search' })
  expect(screen.getByRole('switch', { name: 'Search the web', checked: false })).toBe(web)
  expect(screen.getByRole('switch', { name: 'Ask in Search', checked: true })).toBe(ask)

  await fireEvent.press(web)
  await fireEvent.press(ask)
  await waitFor(() => expect(stored.smartAsk).toBe(false))
  expect(stored.smartWeb).toBe(true)
  const patches = sent.filter(each => each.method === 'PATCH')
  expect(patches).toEqual([
    { method: 'PATCH', path: '/api/settings', body: { smartWeb: true }, auth: 'Bearer t' },
    { method: 'PATCH', path: '/api/settings', body: { smartAsk: false }, auth: 'Bearer t' },
  ])
  await unmount()
  client.clear()
})

it('says the computer is away rather than drawing switches that go nowhere', async () => {
  up = false
  const { unmount, client } = await draw(<SmartPanel anchor={anchor} />)
  expect(await screen.findByText('Your library’s computer')).toBeTruthy()
  expect(screen.queryByRole('switch', { name: 'Search the web' })).toBeNull()
  await unmount()
  client.clear()
})

it('changes how the server imports, and shows the tags it adds by its own names', async () => {
  const { unmount, client } = await draw(<ImportingPanel anchor={anchor} />)
  const lyrics = await screen.findByRole('switch', { name: 'Look up lyrics automatically' })
  // Tag 7 is the server's "night drive": read from the server, not this device.
  expect(await screen.findByText('night drive')).toBeTruthy()

  await fireEvent.press(lyrics)
  await waitFor(() => expect(stored.autoFetchLyrics).toBe(false))
  expect(sent.find(each => each.method === 'PATCH')?.body).toEqual({ autoFetchLyrics: false })
  await unmount()
  client.clear()
})
