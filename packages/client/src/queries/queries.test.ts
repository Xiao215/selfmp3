// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Library, Playlist, PlaylistSongs, Song } from '@selfmp3/shared'
import type { Api } from '../api/api.js'
import { configureClient } from '../runtime.js'
import {
  queryKeys,
  useBulkDeleteSongs,
  useCreateTag,
  useLibrary,
  useSetSongTags,
} from './queries.js'

/*
 * What an edit asks for again, checked at the cache: a playlist's member list
 * is either marked stale by the edit or it is not, and a screen holding it
 * refetches on exactly that mark. The server is a stub that answers as it
 * would; nothing here is rendered beyond the hook itself.
 */

// React's `act` only settles its work without a warning when told this is a test.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const song = (id: number, overrides: Partial<Song> = {}): Song =>
  ({
    id,
    title: `Song ${id}`,
    artist: 'Aurora Lane',
    loved: false,
    tagIds: [],
    ...overrides,
  }) as Song

const playlist = (id: number, overrides: Partial<Playlist> = {}): Playlist =>
  ({
    id,
    name: `list ${id}`,
    kind: 'manual',
    rules: null,
    songCount: 1,
    pinned: false,
    ...overrides,
  }) as Playlist

const library = (playlists: Playlist[]): Library =>
  ({
    songs: [song(1, { tagIds: [10] }), song(2)],
    tags: [
      { id: 10, name: 'tag 10', hue: 100, songCount: 1 },
      { id: 11, name: 'tag 11', hue: 200, songCount: 0 },
    ],
    playlists,
    version: 3,
    generatedAt: '2026-09-14T10:00:00.000Z',
  }) as Library

const live = playlist(20, {
  kind: 'live',
  rules: { match: 'all', rules: [], orderBy: 'addedAt', order: 'desc', limit: null },
})
const manual = playlist(21)

/** What the stub server answers `GET /api/library` with, and every offline copy saved. */
let serverLibrary: Library
const savedCopies: Library[] = []

configureClient({
  api: {
    library: () => Promise.resolve(serverLibrary),
    setSongTags: (id: number, tagIds: number[]) => Promise.resolve(song(id, { tagIds })),
    bulkDeleteSongs: () => Promise.resolve({ removed: 1, failed: [] }),
    createTag: ({ name }: { name: string }) =>
      Promise.resolve({ id: 12, name, hue: 0, songCount: 0 }),
    onCloudLibraryChanged: () => () => undefined,
    answersFromCloud: () => false,
  } as unknown as Api,
  librarySnapshot: {
    read: () => Promise.resolve(null),
    write: library => {
      savedCopies.push(library)
      return Promise.resolve()
    },
  },
})

const roots: Root[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
})

/** A query client holding a library and one playlist's members, as an open page would. */
function seeded(playlists: Playlist[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(queryKeys.library, library(playlists))
  for (const each of playlists) {
    client.setQueryData<PlaylistSongs>(queryKeys.playlistSongs(each.id), {
      playlistId: each.id,
      songIds: [1],
    } as PlaylistSongs)
  }
  return client
}

/** Render a hook inside the client, and hand back whatever it last returned. */
function mount<T>(client: QueryClient, hook: () => T): () => T {
  let latest: T | undefined
  function Probe(): null {
    latest = hook()
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  act(() => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe)))
  })
  return () => latest as T
}

const invalidated = (client: QueryClient, key: readonly unknown[]): boolean =>
  client.getQueryState(key)?.isInvalidated === true

describe('useSetSongTags', () => {
  it('asks for the members again when a live playlist may have changed', async () => {
    const client = seeded([live, manual])
    const mutation = mount(client, useSetSongTags)

    await act(() => mutation().mutateAsync({ songId: 1, tagIds: [11] }))

    expect(invalidated(client, queryKeys.playlistSongs(live.id))).toBe(true)
    expect(invalidated(client, queryKeys.playlistSongs(manual.id))).toBe(true)
    // The library itself is still patched in place first, and asked for after.
    expect(client.getQueryData<Library>(queryKeys.library)?.songs[0]?.tagIds).toEqual([11])
    expect(invalidated(client, queryKeys.library)).toBe(true)
  })

  it('leaves the members alone when no playlist is live', async () => {
    const client = seeded([manual])
    const mutation = mount(client, useSetSongTags)

    await act(() => mutation().mutateAsync({ songId: 1, tagIds: [11] }))

    expect(invalidated(client, queryKeys.playlistSongs(manual.id))).toBe(false)
    // The cheap path, untouched: the answer went in, and nothing was asked for.
    expect(client.getQueryData<Library>(queryKeys.library)?.songs[0]?.tagIds).toEqual([11])
    expect(invalidated(client, queryKeys.library)).toBe(false)
  })
})

describe('useBulkDeleteSongs', () => {
  it('asks for the members again whether or not a playlist is live', async () => {
    const client = seeded([manual])
    const mutation = mount(client, useBulkDeleteSongs)

    await act(() => mutation().mutateAsync({ songIds: [1] }))

    expect(invalidated(client, queryKeys.playlistSongs(manual.id))).toBe(true)
    expect(invalidated(client, queryKeys.library)).toBe(true)
  })
})

describe('useCreateTag', () => {
  it('reaches no list, so asks for none again', async () => {
    const client = seeded([live])
    const mutation = mount(client, useCreateTag)

    await act(() => mutation().mutateAsync({ name: 'new' }))

    expect(invalidated(client, queryKeys.playlistSongs(live.id))).toBe(false)
    expect(invalidated(client, queryKeys.library)).toBe(true)
  })
})

describe('useLibrary', () => {
  it('saves the offline copy when the version moves, not on every answer', async () => {
    savedCopies.length = 0
    serverLibrary = library([manual])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mount(client, useLibrary)
    await vi.waitFor(() => expect(savedCopies).toHaveLength(1))

    // Asked again with nothing edited: a play may have changed the counts, but
    // that waits for the interval rather than rewriting the whole copy now.
    serverLibrary = { ...library([manual]), generatedAt: '2026-09-14T10:00:30.000Z' }
    await act(() => client.refetchQueries({ queryKey: queryKeys.library }))
    expect(savedCopies).toHaveLength(1)

    serverLibrary = { ...library([manual]), version: 4 }
    await act(() => client.refetchQueries({ queryKey: queryKeys.library }))
    expect(savedCopies.map(copy => copy.version)).toEqual([3, 4])
  })

  it('saves the first answer after the library held is let go, whatever its version', async () => {
    savedCopies.length = 0
    serverLibrary = library([manual])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mount(client, useLibrary)
    await vi.waitFor(() => expect(savedCopies).toHaveLength(1))

    // Another server, say, whose library happens to be at the same version.
    act(() => client.clear())
    serverLibrary = { ...library([live]), version: 3 }
    mount(client, useLibrary)
    await vi.waitFor(() => expect(savedCopies).toHaveLength(2))
    expect(savedCopies.map(copy => copy.playlists[0]?.id)).toEqual([manual.id, live.id])
  })
})
