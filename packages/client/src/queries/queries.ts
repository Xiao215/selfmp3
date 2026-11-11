import { useEffect } from 'react'
import {
  hashKey,
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseQueryResult,
} from '@tanstack/react-query'
import type {
  Health,
  CloudStatus,
  DeviceList,
  DoormanGrants,
  Library,
  Settings,
  Stats,
  StatsRange,
  Wrapped,
  WrappedRange,
  ForgottenGems,
  ImportQueue,
  SongHistory,
  UsualHours,
  CloudUids,
  SimilarSongs,
  SoundMap,
  ToolStatus,
  LyricsResponse,
  Motion,
  PlaylistSongs,
  SyncManifest,
} from '@selfmp3/shared'
import { API_ERROR } from '@selfmp3/shared'
import { isPendingRequest, type ImportRequestList } from '@selfmp3/replica'
import { ApiError } from '../api/error.js'
import type { Api } from '../api/api.js'
import {
  clientApi,
  librarySnapshot,
  lyricsSnapshot,
  motionSnapshot,
  playlistSnapshot,
  runLater,
  serverOf,
} from '../runtime.js'
import { decodeMotion, type MotionCurve } from '../motion/motion.js'
import { useClientState } from './context.js'
import { queryKeys } from './keys.js'
import { createLibrarySnapshotWrites, type LibrarySnapshotWrites } from './librarySnapshotWrites.js'
import { STALE } from './stale.js'

/**
 * Server state, handled by TanStack Query.
 *
 * The rule this file and mutations.ts follow: a component never holds a copy
 * of server data in `useState`. It reads from a query here and writes through
 * a mutation there, and the cache invalidation lives in them rather than being
 * sprinkled across components. That is what keeps two open tabs — or a phone
 * and a laptop — consistent. Where each answer is kept is keys.ts.
 */

/**
 * Listening for the cloud library changing behind an answer, once per query
 * client however many screens hold the library.
 */
const cloudListeners = new WeakMap<QueryClient, { holders: number; stop: () => void }>()

/**
 * The cloud library answers from this device's copy first and looks at the
 * bucket afterwards (`@selfmp3/replica`'s loadCloudLibrary). When that look finds
 * something, everything read from the copy is asked for again — from the copy,
 * so no request leaves the device.
 */
function useCloudLibraryChanges(client: QueryClient): void {
  useEffect(() => {
    let entry = cloudListeners.get(client)
    if (!entry) {
      const stop = clientApi().onCloudLibraryChanged(() => {
        void client.invalidateQueries({ queryKey: queryKeys.library })
        void client.invalidateQueries({ queryKey: queryKeys.playlists })
        void client.invalidateQueries({ queryKey: queryKeys.manifest })
        void client.invalidateQueries({ queryKey: queryKeys.cloudImports })
        // A newer snapshot may name a newer map, and the one before is deleted.
        void client.invalidateQueries({ queryKey: queryKeys.soundMap })
      })
      entry = { holders: 0, stop }
      cloudListeners.set(client, entry)
    }
    const held = entry
    held.holders++
    return () => {
      held.holders--
      if (held.holders === 0) {
        held.stop()
        cloudListeners.delete(client)
      }
    }
  }, [client])
}

const snapshotWrites = new WeakMap<QueryClient, LibrarySnapshotWrites>()

/**
 * The offline library's writer for one query client (librarySnapshotWrites.ts).
 *
 * One per client, because what it holds back belongs to the library that
 * client holds: when the client lets the library go — `clear()` on a switch of
 * server, a sign-in or a sign-out — the answer waiting for its turn is the
 * wrong library to save, so it is dropped and the next answer is saved at once.
 */
function snapshotWritesFor(client: QueryClient): LibrarySnapshotWrites {
  let writes = snapshotWrites.get(client)
  if (!writes) {
    const created = createLibrarySnapshotWrites(
      library => {
        // Fire-and-forget: a failed mirror write must not fail anything.
        void librarySnapshot()?.write(library)
      },
      { later: runLater() },
    )
    const libraryHash = hashKey(queryKeys.library)
    client.getQueryCache().subscribe(event => {
      if (event.type === 'removed' && event.query.queryHash === libraryHash) created.forget()
    })
    snapshotWrites.set(client, created)
    writes = created
  }
  return writes
}

/**
 * The library, with an offline fallback.
 *
 * When the request fails because the server is asleep, the last snapshot saved
 * on this device is returned instead — so the app opens and plays cached music
 * rather than showing an error screen. Answers are saved as that snapshot at
 * once when the library's version moved, and otherwise at most every few
 * minutes (`snapshotWritesFor`).
 */
export function useLibrary(): UseQueryResult<Library, Error> {
  const { ready } = useClientState()
  const client = useQueryClient()
  useCloudLibraryChanges(client)

  return useQuery({
    queryKey: queryKeys.library,
    enabled: ready,
    queryFn: async (): Promise<Library> => {
      const api = clientApi()
      // Let go of meanwhile — `clear()` on a switch of server, a sign-in or a
      // sign-out — whatever this asking finds is the last library's, and is
      // neither saved nor put in the cache.
      const cache = client.getQueryCache()
      const asking = cache.find({ queryKey: queryKeys.library, exact: true })
      const letGo = (): boolean =>
        cache.find({ queryKey: queryKeys.library, exact: true }) !== asking
      // The cloud library is its own saved copy, kept on the device already and
      // answered from it first: saving the answer again is the whole library
      // written twice, and reading the old copy first is slower than the answer.
      const fromCloud = api.answersFromCloud()
      let answered = false
      /** The saved copy, read once: shown while the server is asked, and kept if it fails. */
      let saved: Promise<Library | null> | undefined
      if (!fromCloud && client.getQueryData(queryKeys.library) === undefined) {
        // Opening the app: a server can take seconds to answer, or never (asleep,
        // fifteen seconds), and the saved copy is on this device. It is shown
        // meanwhile — dated 0, so it counts as stale and says it is not an
        // answer — and replaced by the answer, or kept beside the error, below.
        saved = librarySnapshot()
          ?.read()
          .catch(() => null)
        void saved?.then(copy => {
          if (
            copy &&
            !answered &&
            !letGo() &&
            client.getQueryData(queryKeys.library) === undefined
          ) {
            client.setQueryData(queryKeys.library, copy, { updatedAt: 0 })
          }
        })
      }
      try {
        const library = await api.library()
        answered = true
        if (!fromCloud && !letGo()) snapshotWritesFor(client).offer(library)
        return library
      } catch (error) {
        answered = true
        // Any failure, not just an unreachable server. A music library is not a
        // dashboard: you open it to play something, and a library a few hours
        // stale is still your library where an error screen is nothing. The
        // only thing the stale copy hides is a song added since the last fetch,
        // and one song missing beats all of them missing.
        //
        // The copy is put in the cache and the error is still thrown, so a
        // screen gets both: `data` to draw, and `isError` to say the server is
        // not there. Returning the copy as the answer would hide the failure — a
        // phone saying "13 songs" beside covers that will not load and
        // playlists that come back empty, with nothing on it to say why.
        //
        // Only a server's: the saved copy is a server's library, never the
        // bucket's, and nothing to read when the cache already has one.
        if (!fromCloud && !letGo() && !client.getQueryData(queryKeys.library)) {
          const cached = await (saved ??
            librarySnapshot()
              ?.read()
              .catch(() => null))
          if (cached && !letGo() && !client.getQueryData(queryKeys.library)) {
            client.setQueryData(queryKeys.library, cached)
          }
        }
        throw error
      }
    },
    staleTime: STALE.halfMinute,
    // Asked again on coming back to the app, once it is that old. Off for the
    // app as a whole; the library is what a return is for.
    refetchOnWindowFocus: true,
    // Keep showing the old library while a refetch runs, so the list does not
    // flash empty every time the app regains focus.
    placeholderData: previous => previous,
    // A page opened over a library that failed says so at once, rather than
    // asking again first: asked again, a query with nothing to show is set
    // back to loading, error and all, and Home showed an empty "Your tags"
    // for the seconds a server's errors took. What failed is asked again on
    // its own (the app's retry of failed queries), and by Try again.
    retryOnMount: false,
    // Offline, or the bucket's daily allowance used up: asking again at once
    // gets the same answer, and the screen should say why without the wait.
    retry: (failureCount, error) =>
      error instanceof ApiError && (error.isOffline || error.isBucketCapped)
        ? false
        : failureCount < 2,
  })
}

/**
 * Whether whatever answers this device is there: the server, or the doorman in
 * front of a cloud library. Asked once and not again, so it waits for `ready`
 * like every query here — asked before the connection was read, it failed
 * with "no server" and kept saying so for a cloud library that loaded fine.
 */
export function useHealth(): UseQueryResult<Health, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.health,
    enabled: ready,
    queryFn: () => clientApi().health(),
    retry: false,
    staleTime: STALE.minute,
  })
}

/**
 * The library's settings, which only its server keeps and acts on
 * (`SettingsSchema`). `api` is that server — reached directly from a cloud
 * library (`useServerApi` in the app) — or null while it is away, and
 * `baseUrl` its address, which the answer is kept by (`queryKeys.settings`).
 */
export function useSettings(
  api: Api | null,
  baseUrl: string | null,
): UseQueryResult<Settings, Error> {
  return useQuery({
    queryKey: queryKeys.settings(baseUrl),
    enabled: api !== null,
    queryFn: () => serverOf(api).settings(),
    staleTime: STALE.fiveMinutes,
  })
}

/**
 * `enabled` is here for the same reason as the import queue's: a cloud library
 * whose server is within reach asks that server directly instead (the Stats
 * page's `statsSource.ts`), and this one would only fetch a 501 to throw away.
 */
export function useStats(range: StatsRange, enabled = true): UseQueryResult<Stats, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.stats(range),
    queryFn: () => clientApi().stats(range),
    enabled: ready && enabled,
    staleTime: STALE.minute,
  })
}

export function useWrapped(range: WrappedRange, enabled = true): UseQueryResult<Wrapped, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.wrapped(range),
    queryFn: () => clientApi().wrapped(range),
    enabled: ready && enabled,
    staleTime: STALE.minute,
  })
}

/** How many forgotten gems a shelf shows, unless it asks for more. */
const GEMS_LIMIT = 12

/** How many neighbours a song's page shows, unless it asks otherwise. */
const SIMILAR_LIMIT = 12

/**
 * Forgotten gems.
 *
 * `staleTime: Infinity` on purpose: the server shuffles the ranking on every
 * request, so a background refetch would silently rearrange the row under the
 * user's finger. It reloads when the page is opened again, which is the only
 * time a different set is welcome.
 */
export function useGems(limit = GEMS_LIMIT): UseQueryResult<ForgottenGems, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.gems(limit),
    enabled: ready,
    queryFn: () => clientApi().gems(limit),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

/**
 * One song's every play and who handed it over, for its page. Only a server
 * answers it; `enabled` is false where this device's client is a cloud
 * library's copy, which knows only the count and the last play.
 */
export function useSongHistory(songId: number, enabled = true): UseQueryResult<SongHistory, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.songHistory(songId),
    queryFn: () => clientApi().songHistory(songId),
    enabled: ready && enabled,
    staleTime: STALE.minute,
    retry: false,
  })
}

/**
 * What you usually play at each hour, for Home's hour tile, asked of this
 * device's own client: a server answers, a cloud library's copy does not
 * (the app asks that library's server directly, and keeps the answer).
 * `zone` is this device's time zone (`readerTimeZone`), which the request
 * sends and the answer is kept under.
 */
export function useUsualHours(zone: string, enabled = true): UseQueryResult<UsualHours, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.usualHours(zone),
    queryFn: () => clientApi().usualHours(),
    enabled: ready && enabled,
    retry: false,
    staleTime: STALE.fiveMinutes,
  })
}

/** This device's songs and the uids they are known by everywhere (`/api/cloud/uids`). */
export function useDeviceUids(): UseQueryResult<CloudUids, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.cloudUids('device'),
    queryFn: () => clientApi().cloudUids(),
    enabled: ready,
    staleTime: STALE.minute,
  })
}

/**
 * The import queue, polled only while something is actually happening.
 *
 * Polling a finished queue every second forever would keep the phone's radio
 * awake for nothing, so the interval switches off once the queue is idle.
 */
export function useImportQueue(enabled: boolean): UseQueryResult<ImportQueue, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.importQueue,
    queryFn: () => clientApi().importQueue(),
    enabled: ready && enabled,
    refetchInterval: query => {
      const data = query.state.data
      if (!data) return false
      return data.active > 0 || data.queued > 0 ? 1_000 : false
    },
  })
}

/** How many finished imports "Show all" reads: the server's most. */
export const HISTORY_LIMIT = 500

/**
 * The queue's whole history, for "Show all": read once when asked for, never
 * polled. The polled queue carries only the newest few finished jobs, since
 * a big day's history a second at a time was most of what the poll moved.
 */
export function useImportHistory(enabled: boolean): UseQueryResult<ImportQueue, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.importHistory,
    queryFn: () => clientApi().importQueue(HISTORY_LIMIT),
    enabled: ready && enabled,
    staleTime: STALE.halfMinute,
  })
}

export function useImportTools(enabled = true): UseQueryResult<ToolStatus, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.importTools,
    queryFn: () => clientApi().importTools(),
    enabled: ready && enabled,
    staleTime: STALE.minute,
    retry: false,
  })
}

/**
 * The copy kept on this device, put in the cache beside an answer that failed
 * unless the cache holds one already. The error is still thrown, as
 * `useLibrary` does: the screen draws the copy and knows it is one.
 */
async function keepCopy(
  client: QueryClient,
  key: QueryKey,
  kept: Promise<unknown> | undefined,
): Promise<void> {
  const cached = (await kept) ?? null
  if (cached && !client.getQueryData(key)) client.setQueryData(key, cached)
}

/** Ask the server for a playlist's members, and keep the answer for when it does not answer. */
async function fetchPlaylistSongs(client: QueryClient, playlistId: number): Promise<PlaylistSongs> {
  try {
    const songs = await clientApi().playlistSongs(playlistId)
    void playlistSnapshot()?.write(songs)
    return songs
  } catch (error) {
    await keepCopy(
      client,
      queryKeys.playlistSongs(playlistId),
      playlistSnapshot()?.read(playlistId),
    )
    throw error
  }
}

/**
 * A playlist's members, as one query whoever asks: the cover mosaics, an Ask
 * answer's list and the playlist's own page read the same cache entry.
 * `staleTime` is the asker's: see the two below.
 */
function usePlaylistMembers(
  playlistId: number | null,
  staleTime: number,
): UseQueryResult<PlaylistSongs, Error> {
  const { ready } = useClientState()
  const client = useQueryClient()
  return useQuery({
    queryKey: playlistId === null ? queryKeys.noPlaylist : queryKeys.playlistSongs(playlistId),
    enabled: ready && playlistId !== null,
    staleTime,
    queryFn: () => fetchPlaylistSongs(client, playlistId ?? 0),
  })
}

/**
 * The members for a cover mosaic, which there is one of per playlist tile and
 * per tag row — so a short stale time meant every tile refetching on every
 * visit to the tab. Freshness does not depend on this number: an edit to one
 * playlist invalidates its own list, and one that may reach any list — a song
 * edit with a live playlist present, a delete, a scan — invalidates the
 * `queryKeys.playlists` prefix (`refetchLivePlaylists`, `useLibraryMutation`).
 */
export const usePlaylistSongIds = (
  playlistId: number | null,
): UseQueryResult<PlaylistSongs, Error> => usePlaylistMembers(playlistId, STALE.fiveMinutes)

// --- metadata polish --------------------------------------------------------

/**
 * Candidates for one song. Cached client-side too; the server caches for a day.
 *
 * `enabled` for the same reason as `useStats`': a cloud library within reach of
 * its server asks that server directly instead (`metadataSource.ts`).
 */
export function useMetadataLookup(songId: number, enabled = true) {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.metadataLookup(songId),
    queryFn: () => clientApi().lookupMetadata(songId),
    enabled: ready && enabled,
    staleTime: STALE.tenMinutes,
    retry: false,
  })
}

/** Every heard song's place on the sound map (docs/features/sound-map.md). */
export function useSoundMap(): UseQueryResult<SoundMap, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.soundMap,
    queryFn: () => clientApi().soundMap(),
    enabled: ready,
    staleTime: STALE.minute,
    placeholderData: keepPreviousData,
  })
}

/**
 * Nearest neighbours of a song. Cheap on the server, so cached only briefly.
 *
 * The last song's answer is kept while the next one's is being fetched, and
 * says so through `isPlaceholderData`. Not to draw — the phone's shelf shows
 * nothing rather than another song's neighbours — but so that a page laid out
 * around "this song has neighbours" does not spend the moment between two
 * songs laid out around "it has none" and rearrange itself when the answer
 * lands.
 */
export function useSimilar(
  songId: number | null,
  limit = SIMILAR_LIMIT,
): UseQueryResult<SimilarSongs, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.similar(songId, limit),
    queryFn: () => clientApi().similar(songId ?? 0, limit),
    enabled: ready && songId !== null,
    staleTime: STALE.minute,
    placeholderData: keepPreviousData,
  })
}

// --- devices ----------------------------------------------------------------

/**
 * Other devices and what they are playing. The event stream keeps this fresh
 * by writing into the same cache entry; the interval is only the fallback for
 * when the stream is down, and it stops entirely in a hidden tab.
 */
export function useDevices(streamConnected: boolean): UseQueryResult<DeviceList, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.devices,
    enabled: ready,
    queryFn: () => clientApi().devices(),
    staleTime: STALE.tenSeconds,
    refetchInterval: streamConnected ? false : 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

/**
 * This server's connection to the cloud bucket. Polled quickly while a pass is
 * uploading, so the progress bar moves, and slowly otherwise, so a pass the
 * server starts by itself after an import still shows up.
 */
export function useCloudStatus(enabled = true): UseQueryResult<CloudStatus, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.cloud,
    queryFn: () => clientApi().cloudStatus(),
    enabled: ready && enabled,
    // Quickly while something is moving — an upload, or Google finishing a
    // sign-in in another tab — and slowly otherwise.
    refetchInterval: query =>
      query.state.data?.state === 'syncing' || query.state.data?.signingIn ? 1_000 : 10_000,
    refetchIntervalInBackground: false,
  })
}

/**
 * A cloud library's imports: links asked of the server through the bucket. Looked at
 * again every half minute while one is still waiting or downloading.
 */
export function useCloudImports(): UseQueryResult<ImportRequestList, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.cloudImports,
    enabled: ready,
    queryFn: () => clientApi().cloudImports(),
    refetchInterval: query => (query.state.data?.imports.some(isPendingRequest) ? 30_000 : false),
  })
}

// --- the shared computer (docs/features/shared-server.md) ---------------------

/** The servers this account has let into its bucket. */
export function useServerGrants(enabled = true): UseQueryResult<DoormanGrants, Error> {
  const { ready } = useClientState()
  return useQuery({
    queryKey: queryKeys.serverGrants,
    enabled: ready && enabled,
    staleTime: STALE.minute,
    queryFn: () => clientApi().serverGrants(),
  })
}

// --- downloads, a playlist's page, and what a playing song brings ------------

/** The manifest: what this device should keep for automatic downloads, and at what size. */
export function useManifest(): UseQueryResult<SyncManifest, Error> {
  const { ready } = useClientState()

  return useQuery({
    queryKey: queryKeys.manifest,
    enabled: ready,
    staleTime: STALE.minute,
    queryFn: (): Promise<SyncManifest> => clientApi().manifest(),
  })
}

/** A playlist's songs in playlist order, for its own page, which is asked again sooner. */
export const usePlaylistSongs = (playlistId: number | null): UseQueryResult<PlaylistSongs, Error> =>
  usePlaylistMembers(playlistId, STALE.halfMinute)

/** Lyrics for a song, which do not change unless someone edits them. */
export function useLyrics(songId: number | null): UseQueryResult<LyricsResponse, Error> {
  const { ready } = useClientState()
  const client = useQueryClient()

  return useQuery({
    queryKey: queryKeys.lyrics(songId ?? 0),
    enabled: ready && songId !== null,
    staleTime: STALE.fiveMinutes,
    // A song with no lyrics is a 404 and will stay one; retrying is three more
    // requests for the same answer.
    retry: false,
    queryFn: async (): Promise<LyricsResponse> => {
      if (songId === null) throw new Error('no song')
      try {
        const lyrics = await clientApi().lyrics(songId)
        void lyricsSnapshot()?.write(songId, lyrics)
        return lyrics
      } catch (error) {
        // Only when the question went unanswered: a 404 means the words are
        // gone, and a kept copy would be a stale answer to a fresh question.
        if (error instanceof ApiError && error.isUnanswered) {
          await keepCopy(client, queryKeys.lyrics(songId), lyricsSnapshot()?.read(songId))
        }
        throw error
      }
    },
  })
}

/**
 * A song's motion curve, decoded, for the visuals to sample every frame; null
 * until there is one (not analysed yet, or never fetched and offline).
 *
 * The curve only changes when the song is analysed again, so it is fresh for
 * an hour and a 404 is not asked again three times. `select` is a module
 * function, so React Query decodes each answer once and hands every render the
 * same bytes. The raw answer is what is kept offline, as the server sent it.
 */
export function useMotion(songId: number | null): MotionCurve | null {
  const { ready } = useClientState()
  const client = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.motion(songId ?? 0),
    enabled: ready && songId !== null,
    staleTime: STALE.hour,
    // A song not analysed yet is a 404 until it is, and a device offline is
    // answered from its copy below; only a server stumbling is worth another go.
    retry: (failures, error) =>
      failures < 1 &&
      error instanceof ApiError &&
      error.status >= 500 &&
      error.code !== API_ERROR.contractMismatch,
    select: decodeMotion,
    queryFn: async (): Promise<Motion> => {
      if (songId === null) throw new Error('no song')
      try {
        const motion = await clientApi().motion(songId)
        void motionSnapshot()?.write(songId, motion)
        return motion
      } catch (error) {
        // As for lyrics: only when the question went unanswered.
        if (error instanceof ApiError && error.isUnanswered) {
          await keepCopy(client, queryKeys.motion(songId), motionSnapshot()?.read(songId))
        }
        throw error
      }
    },
  })

  return songId === null ? null : (query.data ?? null)
}
