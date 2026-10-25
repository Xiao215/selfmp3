import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { configureClient, createApi, type Api } from '@selfmp3/client'
import type { Library, Song } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'
import { currentToasts } from '../../ui/toast'

/**
 * The network the smart reviews' Undo is tested against (CopiesReview.test,
 * TidyReview.test): a library's computer that keeps its songs in memory and
 * answers the few routes the reviews send, through the app's real API client.
 * Everything else is the app's own.
 */

/** A song as the library sends it. */
export function songOf(id: number, title: string, more: Partial<Song> = {}): Song {
  return {
    id,
    path: `${id}.m4a`,
    title,
    artist: 'YOASOBI',
    album: '',
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: 261,
    sizeBytes: 1000,
    mime: 'audio/mp4',
    hasArt: false,
    rev: '1',
    coverTone: null,
    lyricsKind: 'none',
    instrumental: false,
    playCount: 0,
    loved: false,
    lovedAt: null,
    sourceUrl: null,
    lastPlayedAt: null,
    addedAt: '2026-10-01 10:00:00',
    tagIds: [],
    audioFeatures: null,
    ...more,
  }
}

interface FakeLibrary {
  songs: Song[]
  /** Every request the library's computer was sent but for the library itself: `METHOD /path`, and its body. */
  readonly sent: { readonly at: string; readonly body: unknown }[]
  readonly api: Api
}

const answer = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

/** A library's computer holding `songs`, made the app's one client. */
export function fakeLibrary(songs: Song[]): FakeLibrary {
  const net: FakeLibrary = {
    songs,
    sent: [],
    api: createApi({
      context: () => ({
        transport: { url: path => `https://library.test${path}` },
        fromCloud: false,
      }),
      fetch: (url, init) => {
        const path = url.replace('https://library.test', '')
        const method = init?.method ?? 'GET'
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        if (method === 'GET' && path === '/api/library') {
          const library: Library = {
            songs: net.songs,
            tags: [],
            playlists: [],
            artistNames: {},
            spellings: {},
            version: 1,
            generatedAt: '2026-10-14T10:00:00.000Z',
          }
          return Promise.resolve(answer(library))
        }
        net.sent.push({ at: `${method} ${path}`, body })
        const song = (id: number): Song | undefined => net.songs.find(each => each.id === id)
        const cover = /^\/api\/songs\/(\d+)\/(apply-metadata|cover)$/.exec(path)
        if (cover) {
          const id = Number(cover[1])
          net.songs = net.songs.map(each =>
            each.id === id ? { ...each, hasArt: method === 'POST' } : each,
          )
          return Promise.resolve(
            answer(method === 'POST' ? { ok: true, artworkSaved: true } : { ok: true }),
          )
        }
        if (path === '/api/songs/merge') {
          const { keep, songIds } = body as { keep: number; songIds: number[] }
          const merged = song(keep) ? songIds.filter(id => song(id)) : []
          net.songs = net.songs.filter(each => !merged.includes(each.id))
          return Promise.resolve(answer({ merged: merged.length }))
        }
        if (path === '/api/songs/bulk/edit') {
          const { edits } = body as { edits: { songId: number; patch: Partial<Song> }[] }
          net.songs = net.songs.map(each => {
            const edit = edits.find(one => one.songId === each.id)
            return edit ? { ...each, ...edit.patch } : each
          })
          return Promise.resolve(answer({ affected: edits.length }))
        }
        return Promise.reject(new TypeError('Network request failed'))
      },
    }),
  }
  configureClient({ api: net.api })
  return net
}

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

/** Draws a review the way the Ask box does, with the query client it reads the library through. */
export async function drawReview(review: ReactNode): Promise<QueryClient> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })
  const page = (): ReactElement => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <OverlayProvider>{review}</OverlayProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
  await render(page())
  return client
}

/** Presses a word in the newest message, as the toast host does: the message goes, then the action. */
export function pressToast(label: string): void {
  const action = currentToasts()
    .at(-1)
    ?.actions.find(each => each.label === label)
  if (!action) throw new Error(`no ${label} in the newest message`)
  action.onPress()
}
