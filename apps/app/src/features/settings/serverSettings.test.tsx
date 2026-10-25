import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { DEFAULT_SETTINGS, type Library, type Settings } from '@selfmp3/shared'
import { configureClient, type Api } from '@selfmp3/client'
import * as Clipboard from 'expo-clipboard'
import { currentToasts, dismissToast } from '../../ui/toast'
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
// The clipboard itself, under the app's port (ports/clipboard).
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }))

const ADDRESS = 'https://music.example.com'
/** The library's token, as the snapshot carries it to every device of theirs. */
const TOKEN = 'kq3x0Vb7wJr2-library-token-of-the-pi-Ab3x'
/** What this device's copy of the library says of its server: none, when null. */
let named: { id: string; addresses: string[]; token: string } | null
configureClient({
  api: {
    cloudServer: () => Promise.resolve({ server: named }),
    onCloudLibraryChanged: () => () => undefined,
  } as unknown as Api,
} as Parameters<typeof configureClient>[0])

const serverLibrary: Library = {
  songs: [],
  // The server's numbering: tag 7 there is "night drive", whatever it is here.
  tags: [{ id: 7, name: 'night drive', hue: 200, songCount: 0 }],
  playlists: [],
  artistNames: {},
  spellings: {},
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
  named = { id: 'the-pi', addresses: ['http://localhost:4600', ADDRESS], token: TOKEN }
  up = true
  jest.mocked(Clipboard.setStringAsync).mockClear()
  for (const toast of currentToasts()) dismissToast(toast.id)
  sent = []
  global.fetch = jest.fn((input: string, init: RequestInit = {}) => {
    if (!up) return Promise.reject(new TypeError('Network request failed'))
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    sent.push({ method, path: url.pathname, body, auth: headers.get('authorization') })
    if (url.origin !== ADDRESS) return Promise.reject(new TypeError('no such host'))
    if (url.pathname === '/api/health') {
      return Promise.resolve(json({ ok: true, version: '1', serverId: 'the-pi', uptimeSeconds: 1 }))
    }
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
  // Nothing is collected on a timer: a query or a saved setting left to be
  // collected in five minutes keeps jest from exiting.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  })
  const drawn = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>,
  )
  return { ...drawn, client }
}

const anchor = (): void => undefined

it('turns a smart feature off on the server itself, with no web switch of its own', async () => {
  const { unmount, client } = await draw(<SmartPanel anchor={anchor} />)
  const ask = await screen.findByRole('switch', { name: 'Ask in Search' })
  expect(screen.getByRole('switch', { name: 'Ask in Search', checked: true })).toBe(ask)
  expect(screen.queryByRole('switch', { name: 'Search the web' })).toBeNull()

  await fireEvent.press(ask)
  await waitFor(() => expect(stored.smartAsk).toBe(false))
  const patches = sent.filter(each => each.method === 'PATCH')
  expect(patches).toEqual([
    { method: 'PATCH', path: '/api/settings', body: { smartAsk: false }, auth: `Bearer ${TOKEN}` },
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

/*
 * The token for an iOS Shortcut or the extension given an address by hand
 * (docs/features/share-to-import.md). Those are not devices of the library, so
 * the bucket never hands it to them; on a server holding several libraries it
 * lived only in the server's data/hub.json. Every signed-in device has it.
 */
it('copies the server’s token, showing only its address and the token’s end', async () => {
  const { unmount, client } = await draw(<ImportingPanel anchor={anchor} />)
  const copy = await screen.findByRole('button', { name: 'Copy token' })
  // The address the internet reaches, not localhost; the token never whole.
  expect(screen.getByText(`${ADDRESS} · token ending Ab3x`)).toBeTruthy()
  expect(screen.queryByText(new RegExp(TOKEN))).toBeNull()

  await fireEvent.press(copy)
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(TOKEN))
  await waitFor(() => expect(currentToasts().map(toast => toast.text)).toEqual(['Token copied']))
  await unmount()
  client.clear()
})

/*
 * The Shortcut needs the address as well, and a long ts.net address typed on
 * a phone is where it goes wrong: the one the row shows can be copied too.
 */
it('copies the address it shows, beside the token', async () => {
  const { unmount, client } = await draw(<ImportingPanel anchor={anchor} />)
  await fireEvent.press(await screen.findByRole('button', { name: 'Copy address' }))
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(ADDRESS))
  await waitFor(() => expect(currentToasts().map(toast => toast.text)).toEqual(['Address copied']))
  expect(Clipboard.setStringAsync).not.toHaveBeenCalledWith(TOKEN)
  await unmount()
  client.clear()
})

it('offers no address to copy when it shows none', async () => {
  // Only the server talking to itself: nothing a phone elsewhere could use.
  named = { id: 'the-pi', addresses: ['http://localhost:4600'], token: TOKEN }
  up = false
  const { unmount, client } = await draw(<ImportingPanel anchor={anchor} />)
  expect(await screen.findByRole('button', { name: 'Copy token' })).toBeTruthy()
  expect(screen.getByText('token ending Ab3x')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Copy address' })).toBeNull()
  await unmount()
  client.clear()
})

it('offers the token while the server is away: copying it needs nothing from the server', async () => {
  up = false
  const { unmount, client } = await draw(<ImportingPanel anchor={anchor} />)
  expect(await screen.findByText('Your library’s computer')).toBeTruthy()
  await fireEvent.press(await screen.findByRole('button', { name: 'Copy token' }))
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(TOKEN))
  await unmount()
  client.clear()
})

it('has no token row when the library names no server', async () => {
  named = null
  const { unmount, client } = await draw(<ImportingPanel anchor={anchor} />)
  // Away, which it is only once the device's copy has answered that it names none.
  expect(await screen.findByRole('button', { name: 'Look again' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Copy token' })).toBeNull()
  await unmount()
  client.clear()
})
