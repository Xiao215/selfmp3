import { renderHook, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DEFAULT_SETTINGS } from '@selfmp3/shared'
import type { ServerConnection } from '@selfmp3/client'
import { PresenceConnection } from '../devices/presenceConnection'
import { useSmartSwitches } from './useSmartSwitches'

/**
 * The switches are the server's settings (2026-10-14): a feature turned off on
 * one device is not drawn on another, and nothing asks the server but what
 * presence has already found.
 */

const SERVER: ServerConnection = { baseUrl: 'https://music.example.com', token: 't' }

beforeEach(() => {
  global.fetch = jest.fn((input: string) =>
    input === `${SERVER.baseUrl}/api/settings`
      ? Promise.resolve(
          new Response(JSON.stringify({ ...DEFAULT_SETTINGS, smartAsk: false }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      : Promise.reject(new TypeError('Network request failed')),
  ) as unknown as typeof fetch
})

const wrapperFor = (server: ServerConnection | null) => {
  const client = new QueryClient()
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PresenceConnection.Provider value={server}>{children}</PresenceConnection.Provider>
      </QueryClientProvider>
    )
  }
}

it('reads the switches from the server presence found', async () => {
  const { result } = await renderHook(() => useSmartSwitches(), { wrapper: wrapperFor(SERVER) })
  await waitFor(() => expect(result.current.ask).toBe(false))
  expect(result.current.tidy).toBe(true)
})

it('counts every feature on, and asks nothing, while no server is found', async () => {
  const { result } = await renderHook(() => useSmartSwitches(), { wrapper: wrapperFor(null) })
  expect(result.current).toEqual({
    ask: true,
    tidy: true,
    tags: true,
    written: true,
    metadata: true,
  })
  expect(global.fetch).not.toHaveBeenCalled()
})
