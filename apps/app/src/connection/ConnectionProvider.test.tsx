import { render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGems, useHealth } from '@selfmp3/client'
import type { CloudSession } from '@selfmp3/replica'

import '../api/client'
import { ConnectionProvider } from './ConnectionProvider'

/**
 * Queries wait for the connection to be read before they ask anything.
 *
 * Found on the web in cloud mode: Settings said "Can’t reach the cloud" over a
 * library that had loaded fine. A direct load of /settings asked for health
 * while the cloud session was still being read out of IndexedDB, so the API
 * client had neither a server nor the cloud and answered "no server" — and a
 * query that does not retry kept that answer. The library never showed it
 * because it already waited for `ready`.
 */

let mockSessionArrives: (session: CloudSession | null) => void = () => undefined
const mockCloudRequest = jest.fn((_method: string, path: string): Promise<unknown> => {
  if (path === '/api/health') {
    return Promise.resolve({ ok: true, version: 'web', uptimeSeconds: 0 })
  }
  if (path.startsWith('/api/library/gems')) {
    return Promise.resolve({ songs: [], minDays: 30, total: 0, generatedAt: '2026-10-08' })
  }
  return Promise.reject(new Error(`not under test: ${path}`))
})

jest.mock('../replica', () => ({
  cloudRequest: (method: string, path: string) => mockCloudRequest(method, path),
  library: { onCloudLibraryChanged: () => () => undefined, markCloudLibraryStale: () => undefined },
  session: {
    loadSession: () =>
      new Promise<CloudSession | null>(resolve => {
        mockSessionArrives = resolve
      }),
    refreshSession: (session: CloudSession) => Promise.resolve(session),
  },
}))
jest.mock('./storedConnection', () => ({
  loadConnection: () => Promise.resolve(null),
  saveConnection: () => Promise.resolve(),
  clearConnection: () => Promise.resolve(),
}))
jest.mock('../features/import/importDraft', () => ({ forgetImportDraft: () => undefined }))

const SESSION: CloudSession = {
  doormanUrl: 'https://doorman.test',
  token: 'token',
  me: {
    email: 'sim@example.com',
    name: 'Sim',
    picture: null,
    storage: {
      endpoint: 'https://s3.test',
      region: 'test',
      bucket: 'test',
      prefix: '',
      keyIdHint: 'abcd',
    },
  },
} as CloudSession

function Probe() {
  const health = useHealth()
  const gems = useGems()
  const said = (query: { data?: unknown; isError: boolean; error: Error | null }) =>
    query.data ? 'answered' : query.isError ? `failed: ${query.error?.message}` : 'waiting'
  return (
    <>
      <Text>{health.data ? `self.mp3 ${health.data.version}` : said(health)}</Text>
      <Text>{said(gems)}</Text>
    </>
  )
}

describe('ConnectionProvider', () => {
  it('holds the queries that do not retry until the cloud session is read', async () => {
    // The app's own retry, so a query that does not retry is the one under test.
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, gcTime: Infinity } } })
    await render(
      <QueryClientProvider client={client}>
        <ConnectionProvider>
          <Probe />
        </ConnectionProvider>
      </QueryClientProvider>,
    )

    // Still reading the session: nothing is asked, so nothing can fail.
    expect(screen.getAllByText('waiting')).toHaveLength(2)

    mockSessionArrives(SESSION)

    expect(await screen.findByText('self.mp3 web')).toBeTruthy()
    expect(await screen.findByText('answered')).toBeTruthy()
  })
})
