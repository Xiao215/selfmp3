import { act, renderHook } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CONFIRM_AWAY_MS, configureClient, LOOK_AGAIN_MS, type Api } from '@selfmp3/client'
import type { ReactNode } from 'react'
import { useServerDirect } from './useServerDirect'

/*
 * "Server unavailable" for a server that was answering a moment before
 * (2026-10-13): one look that missed — a network blip, the server restarting
 * into an update — said away until the next look twenty seconds later. A
 * server that was answering now keeps its answer through one miss.
 */

jest.mock('../replica', () => ({ library: { markCloudLibraryStale: () => undefined } }))

const server = { id: 'the-pi', addresses: ['https://music.example.com'], token: 't' }
configureClient({
  api: { cloudServer: () => Promise.resolve({ server }) } as unknown as Api,
} as Parameters<typeof configureClient>[0])

/**
 * Whether `/api/health` answers, one entry per look; past the end it does.
 * A string is a server answering under that id: a different one than the
 * snapshot named.
 */
let answers: (boolean | string)[] = []
const health = jest.fn(() => {
  const answer = answers.shift() ?? true
  if (answer === false) return Promise.reject(new TypeError('Network request failed'))
  const serverId = answer === true ? server.id : answer
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, version: '1', serverId, uptimeSeconds: 1 }),
  } as Response)
})

beforeEach(() => {
  jest.useFakeTimers()
  answers = []
  health.mockClear()
  global.fetch = health as unknown as typeof fetch
})

afterEach(() => jest.useRealTimers())

const draw = async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = await renderHook(() => useServerDirect(), { wrapper })
  await settle()
  return hook
}

/** TanStack Query tells its observers on a zero timer, after the answer lands. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(() => jest.advanceTimersByTimeAsync(1))
}

const after = async (ms: number) => {
  await act(() => jest.advanceTimersByTimeAsync(ms))
  await settle()
}

it('keeps a server that was answering through one missed look', async () => {
  const { result } = await draw()
  expect(result.current.state).toBe('reachable')

  answers = [false, true]
  await after(LOOK_AGAIN_MS)
  expect(result.current.state).toBe('reachable')
  await after(CONFIRM_AWAY_MS)
  expect(result.current.state).toBe('reachable')
  expect(health).toHaveBeenCalledTimes(3)
})

it('says away once a second look misses too', async () => {
  const { result } = await draw()
  expect(result.current.state).toBe('reachable')

  answers = [false, false]
  await after(LOOK_AGAIN_MS)
  expect(result.current.state).toBe('reachable')
  await after(CONFIRM_AWAY_MS)
  expect(result.current).toMatchObject({ state: 'away', said: true })
})

it('says a server that never answered is away at the first miss', async () => {
  answers = [false]
  const { result } = await draw()
  expect(result.current).toMatchObject({ state: 'away', said: true })
  expect(health).toHaveBeenCalledTimes(1)
})

it('is away when the server answering at the address is a different one', async () => {
  // `localhost` on a computer running a development server (2026-10-14).
  answers = ['a-development-server']
  const { result } = await draw()
  expect(result.current).toMatchObject({ state: 'away', said: true })
})
