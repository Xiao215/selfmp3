import { renderHook, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DEFAULT_SETTINGS } from '@selfmp3/shared'
import type { ServerConnection } from '@selfmp3/client'
import { PresenceConnection } from '../devices/presenceConnection'
import { useSmartOn } from './useSmartOn'

/**
 * The switch is the server's setting (2026-10-14): smart features turned off
 * on one device are not drawn on another, and nothing asks the server but
 * what presence has already found.
 */

const SERVER: ServerConnection = { baseUrl: 'https://music.example.com', token: 't' }

beforeEach(() => {
  global.fetch = jest.fn((input: string) =>
    input === `${SERVER.baseUrl}/api/settings`
      ? Promise.resolve(
          new Response(JSON.stringify({ ...DEFAULT_SETTINGS, smartFeatures: false }), {
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

it('reads the switch from the server presence found', async () => {
  const { result } = await renderHook(() => useSmartOn(), { wrapper: wrapperFor(SERVER) })
  await waitFor(() => expect(result.current).toBe(false))
})

it('counts smart features on, and asks nothing, while no server is found', async () => {
  const { result } = await renderHook(() => useSmartOn(), { wrapper: wrapperFor(null) })
  expect(result.current).toBe(true)
  expect(global.fetch).not.toHaveBeenCalled()
})
