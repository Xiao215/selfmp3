import { act, renderHook } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configureClient, type Api } from '@selfmp3/client'
import type { ReactNode } from 'react'
import { useLibrarySearch } from './useLibrarySearch'

/*
 * Lyric search on a signed-in device (2026-10-14): the index is the server's,
 * and a cloud library never asked it, so Search and the palette showed no
 * lines of lyrics on any real device. It now asks the server behind the cloud
 * library directly, the way Stats does, and renumbers what it finds as this
 * device numbers those songs.
 *
 * Only the edges are faked: this device's copy of the library (its addresses
 * for the server, its uids) and the network the server answers on.
 */

jest.mock('../../replica', () => ({ library: { markCloudLibraryStale: () => undefined } }))
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ fromCloud: true }),
}))

const uid = (n: number): string => n.toString(16).padStart(32, '0')

const server = { id: 'the-pi', addresses: ['https://music.example.com'], token: 'workspace-token' }
configureClient({
  api: {
    cloudServer: () => Promise.resolve({ server }),
    // This device's copy numbers the songs its own way.
    cloudUids: () =>
      Promise.resolve({
        songs: [
          { id: 1, uid: uid(1) },
          { id: 2, uid: uid(2) },
        ],
      }),
  } as unknown as Api,
} as Parameters<typeof configureClient>[0])

const hit = (songId: number, title: string, line: string) => ({
  songId,
  title,
  artist: 'YOASOBI',
  hasArt: true,
  line,
  before: '',
  match: line,
  after: '',
})

/** Whether the server answers at all. */
let reachable = true
const asked: string[] = []
const network = jest.fn((url: string, init?: { headers?: Record<string, string> }) => {
  asked.push(url)
  if (!reachable) return Promise.reject(new TypeError('Network request failed'))
  const { pathname } = new URL(url)
  const answer = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
  if (pathname === '/api/health') {
    return answer({ ok: true, version: '1', serverId: server.id, uptimeSeconds: 1 })
  }
  expect(init?.headers?.['Authorization']).toBe('Bearer workspace-token')
  // The server's own numbers: 812 is this device's 2, and 900 is a song it has not got yet.
  if (pathname === '/api/cloud/uids') {
    return answer({
      songs: [
        { id: 811, uid: uid(1) },
        { id: 812, uid: uid(2) },
        { id: 900, uid: uid(3) },
      ],
    })
  }
  if (pathname === '/api/lyrics/search') {
    return answer({
      hits: [hit(812, 'Monster', 'in the night'), hit(900, 'Not here yet', 'into the night')],
    })
  }
  throw new Error(`nothing fakes ${url}`)
})

beforeEach(() => {
  jest.useFakeTimers()
  reachable = true
  asked.length = 0
  network.mockClear()
  global.fetch = network as unknown as typeof fetch
})

afterEach(() => jest.useRealTimers())

const settle = async () => {
  for (let i = 0; i < 10; i++) await act(() => jest.advanceTimersByTimeAsync(50))
}

const draw = async (query: string) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = await renderHook(
    () =>
      useLibrarySearch(query, {
        search: () => [],
        matches: (_found, lyricHits) => lyricHits,
      }),
    { wrapper },
  )
  await settle()
  return hook
}

it('finds lines of lyrics on the server behind a cloud library, as this device numbers the songs', async () => {
  const { result } = await draw('the night')

  expect(asked.some(url => url.startsWith('https://music.example.com/api/lyrics/search'))).toBe(
    true,
  )
  expect(result.current.lyricsAway).toBe(false)
  // The server's 812 is song 2 here; a song this device has not got is left out.
  expect(result.current.lyricHits).toEqual([hit(2, 'Monster', 'in the night')])
})

it('has no lines and says nothing when the server is out of reach', async () => {
  reachable = false
  const { result } = await draw('the night')

  expect(result.current.lyricsAway).toBe(true)
  expect(result.current.lyricHits).toEqual([])
  // Only the look for the server: no lyric search is sent anywhere.
  expect(asked.every(url => new URL(url).pathname === '/api/health')).toBe(true)
})
