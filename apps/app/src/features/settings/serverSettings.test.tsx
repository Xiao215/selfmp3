import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { DEFAULT_SETTINGS, type Settings } from '@selfmp3/shared'
import { configureClient, type Api } from '@selfmp3/client'
import { ImportingPanel } from './ImportingPanel'
import { SmartPanel } from './SmartPanel'

/**
 * The settings a server acts on, changed from a signed-in device (2026-10-14).
 *
 * A cloud library's every call went to this device's copy, which kept the
 * settings on the device: turning smart features off changed nothing the
 * server read. Now the panels find the server the way Import does
 * and read and write its own settings. Faked here is only the network: the
 * server's addresses, as the device's copy of the library names them, and
 * the server behind them.
 */

jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ fromCloud: true, connection: null }),
}))
jest.mock('../../replica', () => ({ library: { markCloudLibraryStale: () => undefined } }))

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

/** The server: its settings table, and every request it was sent. */
let stored: Settings
let up: boolean
/** The server's model address; null is a server with none set up. */
let modelAddress: string | null
let sent: { method: string; path: string; body: unknown; auth: string | null }[]

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  stored = { ...DEFAULT_SETTINGS }
  named = { id: 'the-pi', addresses: ['http://localhost:4600', ADDRESS], token: TOKEN }
  up = true
  modelAddress = 'http://127.0.0.1:8787/v1'
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
    if (url.pathname === '/api/settings' && method === 'GET') return Promise.resolve(json(stored))
    if (url.pathname === '/api/ai') {
      return Promise.resolve(json({ address: modelAddress, models: { fast: 'f', smart: 's' } }))
    }
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

it('turns smart features off on the server itself, with one switch', async () => {
  const { unmount, client } = await draw(<SmartPanel anchor={anchor} />)
  const smart = await screen.findByRole('switch', { name: 'Use smart features' })
  expect(screen.getByRole('switch', { name: 'Use smart features', checked: true })).toBe(smart)
  expect(screen.getAllByRole('switch')).toHaveLength(1)

  await fireEvent.press(smart)
  await waitFor(() => expect(stored.smartFeatures).toBe(false))
  const patches = sent.filter(each => each.method === 'PATCH')
  expect(patches).toEqual([
    {
      method: 'PATCH',
      path: '/api/settings',
      body: { smartFeatures: false },
      auth: `Bearer ${TOKEN}`,
    },
  ])
  await unmount()
  client.clear()
})

it('dims the switch and says so when the server has no model', async () => {
  modelAddress = null
  const { unmount, client } = await draw(<SmartPanel anchor={anchor} />)
  expect(await screen.findByText('Your server has no model set up.')).toBeTruthy()
  expect(screen.getByRole('switch', { name: 'Use smart features', disabled: true })).toBeTruthy()
  await unmount()
  client.clear()
})

it('says the computer is away rather than drawing a switch that goes nowhere', async () => {
  up = false
  const { unmount, client } = await draw(<SmartPanel anchor={anchor} />)
  expect(await screen.findByText('Your library’s computer')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
  await unmount()
  client.clear()
})

it('changes how the server imports', async () => {
  const { unmount, client } = await draw(<ImportingPanel anchor={anchor} />)
  const lyrics = await screen.findByRole('switch', { name: 'Look up lyrics automatically' })

  await fireEvent.press(lyrics)
  await waitFor(() => expect(stored.autoFetchLyrics).toBe(false))
  expect(sent.find(each => each.method === 'PATCH')?.body).toEqual({ autoFetchLyrics: false })
  await unmount()
  client.clear()
})

it('says it cannot reach the server when the library names none', async () => {
  named = null
  const { unmount, client } = await draw(<ImportingPanel anchor={anchor} />)
  // Away, which it is only once the device's copy has answered that it names none.
  expect(await screen.findByRole('button', { name: 'Look again' })).toBeTruthy()
  await unmount()
  client.clear()
})
