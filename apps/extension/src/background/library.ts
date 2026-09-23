import type { Api, ServerConnection } from '@selfmp3/client/core'
import { TagSchema, youtubeVideoId, type Song } from '@selfmp3/shared'
import { z } from 'zod'
import { SongHitSchema, type SongHit } from '../bridge.js'
import type { KeyValueStore } from './store.js'

/**
 * The songs you already have, by the video they came from.
 *
 * "Is this one mine?" is answered from the link alone, before yt-dlp is asked
 * anything: each song's `sourceUrl`, keyed by video id, so a youtu.be link, a
 * music.youtube.com one and a watch page with a playlist on it are one song.
 */
export function linkIndex(songs: readonly Song[]): Record<string, SongHit> {
  const links: Record<string, SongHit> = {}
  for (const song of songs) {
    const id = youtubeVideoId(song.sourceUrl)
    if (!id || links[id]) continue
    links[id] = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      addedAt: song.addedAt,
      playCount: song.playCount,
    }
  }
  return links
}

const SnapshotSchema = z.object({
  baseUrl: z.string(),
  version: z.number(),
  songCount: z.number(),
  links: z.record(SongHitSchema),
  tags: z.array(TagSchema),
})
type LibrarySnapshot = z.infer<typeof SnapshotSchema>

const KEY = 'library'

/**
 * The library as the popup needs it — the link index and the tags — kept across worker restarts and fetched again only when the
 * server says it changed.
 *
 * The server's version is a counter that starts again when the server does, so
 * a restarted server could land back on the number that was kept; the song
 * count is compared with it.
 */
export class LibraryCache {
  readonly #store: KeyValueStore
  #memory: LibrarySnapshot | null = null

  constructor(store: KeyValueStore) {
    this.#store = store
  }

  async get(server: ServerConnection, api: Api): Promise<LibrarySnapshot> {
    if (!this.#memory) {
      const stored = SnapshotSchema.safeParse(await this.#store.read(KEY))
      this.#memory = stored.success ? stored.data : null
    }
    const { version, songCount } = await api.libraryVersion()
    const kept = this.#memory
    if (
      kept &&
      kept.baseUrl === server.baseUrl &&
      kept.version === version &&
      kept.songCount === songCount
    ) {
      return kept
    }
    const library = await api.library()
    const next: LibrarySnapshot = {
      baseUrl: server.baseUrl,
      version,
      songCount,
      links: linkIndex(library.songs),
      tags: library.tags,
    }
    this.#memory = next
    await this.#store.write(KEY, next)
    return next
  }

  async forget(): Promise<void> {
    this.#memory = null
    await this.#store.remove(KEY)
  }
}
