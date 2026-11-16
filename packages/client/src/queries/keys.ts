import type { StatsRange, WrappedRange } from '@selfmp3/shared'

/**
 * Where each answer is kept in the query cache, for the reads (queries.ts)
 * and the writes that reach them (mutations.ts).
 *
 * Keys carry no server address: the cache is cleared when the address changes
 * (`queryClient.clear()`), and every query is gated on having an address at
 * all, which is `ClientState.ready`. The exceptions are what is asked of a
 * library's server directly rather than of whatever answers this device
 * (`devicesThrough`, `settings` and the rest), which carry its address.
 */

/**
 * Every playlist's members live under this prefix, so an edit that may have
 * reached any of them (`refetchLivePlaylists`) can ask for all of them again
 * without knowing which.
 */
const playlistsKey = ['playlist'] as const

export const queryKeys = {
  cloudImports: ['cloud-imports'] as const,
  cloudServer: ['cloud-server'] as const,
  serverGrants: ['cloud-grants'] as const,
  library: ['library'] as const,
  /**
   * What only a library's server keeps — its settings — asked of that server directly (`useServerApi` in the
   * app), and so kept by its address. A device's cache is cleared when its own
   * address changes, but a cloud library reaching one server and then another
   * (a refused one passed over, a shared library joined, a new name) keeps the
   * same cache, and one server's answer would stand in for the next's.
   */
  settings: (baseUrl: string | null) => ['settings', baseUrl] as const,
  /** Everything about importing, what a change to the queue invalidates in one go. */
  importRoot: ['import'] as const,
  importQueue: ['import', 'queue'] as const,
  importHistory: ['import', 'history'] as const,
  importTools: ['import', 'tools'] as const,
  /** Everything counted: what a played song invalidates, in one go. */
  statsRoot: ['stats'] as const,
  stats: (range: StatsRange) => ['stats', range] as const,
  wrapped: (range: WrappedRange) => ['stats', 'wrapped', range] as const,
  /*
   * Its own namespace, deliberately not under `library`.
   *
   * Invalidation matches by prefix, so nesting it there had every library
   * mutation — a tag, a love, an edit — refetch the gems, and the server
   * re-ranks them with a little randomness on every request. The row reshuffled
   * under the pointer as you tagged, which is the one thing `staleTime:
   * Infinity` on it is there to prevent. A different handful each time you open
   * the library; the same handful while you are looking at it.
   */
  gems: (limit: number) => ['gems', limit] as const,
  /** One song's history (`SongHistory`), under stats so a play's refresh of them reaches it. */
  songHistory: (songId: number) => ['stats', 'song', songId] as const,
  usualHours: (zone: string) => ['usual', zone] as const,
  playlists: playlistsKey,
  playlistSongs: (id: number) => [...playlistsKey, id, 'songs'] as const,
  /** Where a members hook with no playlist to ask about sits, asking nothing. */
  noPlaylist: [...playlistsKey, 'none'] as const,
  /** The phone's, for the two it asks for that a browser instead reads from `library`. */
  manifest: ['manifest'] as const,
  lyrics: (id: number) => ['lyrics', id] as const,
  motion: (id: number) => ['motion', id] as const,
  health: ['health'] as const,
  metadataLookup: (songId: number) => ['metadata', 'lookup', songId] as const,
  lyricsSearch: (query: string) => ['lyrics', 'search', query] as const,
  /** The limit is in the key: a different count is a different answer. */
  similar: (id: number | null, limit: number) => ['similar', id ?? 'none', limit] as const,
  soundMap: ['sound-map'] as const,
  devices: ['devices'] as const,
  /**
   * The device list as a server reached directly from a cloud library tells
   * it: presence and Settings › Devices ask the same server the same question
   * and share the answer.
   */
  devicesThrough: (baseUrl: string | null) => ['devices', 'through', baseUrl] as const,
  cloud: ['cloud'] as const,
  /** The stored doorman session's account, read on the device itself. */
  cloudSession: ['cloud-session'] as const,
  /** How much room the account's Google Drive has (`useStorageSpace`). */
  storageSpace: ['storage-space'] as const,
  /** A library's uids: `which` is this device's copy or the server being asked. */
  cloudUids: (which: 'device' | 'via-server', baseUrl?: string) =>
    ['cloud-uids', which, baseUrl] as const,
}
