import { encodeSoundMap, messageOf, parseSoundMap, type SoundMap } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { SoundMapRepository } from '../repositories/soundMap.js'
import { projectSounds } from './map.js'
import type { SoundService } from './sound.js'

/**
 * The sound map (docs/features/sound-map.md): the heard songs folded down to
 * places on a plane (sound/map.ts), kept here as the file the bucket gets.
 *
 * Folded again only when the vectors change — a song heard, heard again or
 * removed — and, while a backlog is still being heard, at most once an hour,
 * as the vectors themselves go up (services/cloudSync.ts). Each fold starts
 * from the last map, so the regions stay where they were.
 */

/** While songs are still being heard, the map is folded again at most this often. */
const FOLD_EVERY_MS = 60 * 60_000

interface SoundMapDeps {
  readonly repo: SoundMapRepository
  readonly sound: Pick<SoundService, 'packSignature' | 'hearing' | 'vectorsInBucket'>
  readonly logger: Logger
  /** A new map was made: the bucket's copy is sent with the next pass. */
  readonly changed: () => void
  readonly now?: () => Date
  /** Between the fold's steps; `setImmediate` unless a test says otherwise. */
  readonly pause?: () => Promise<void>
}

export class SoundMapService {
  readonly #deps: SoundMapDeps
  #folding: Promise<void> | null = null
  #timer: NodeJS.Timeout | null = null
  #stopped = false

  constructor(deps: SoundMapDeps) {
    this.#deps = deps
  }

  /** The map's file, for the bucket; null before the first fold. */
  file(): string | null {
    return this.#deps.repo.get()?.data ?? null
  }

  /** `/api/sound-map`: each placed song by id, and how many are not heard yet. */
  forLibrary(): SoundMap {
    const { repo } = this.#deps
    const stored = repo.get()
    const places = stored ? parseSoundMap(stored.data) : null
    const out: SoundMap['places'] = []
    if (places) {
      for (const { songId, audioKey } of repo.audioKeys()) {
        const place = places.get(audioKey)
        if (place) out.push({ id: songId, x: place.x, y: place.y })
      }
    }
    out.sort((a, b) => a.id - b.id)
    return { places: out, unheard: Math.max(0, repo.songCount() - out.length) }
  }

  /**
   * The bucket's map, when this server has none of its own: the next fold
   * starts from it, so a server starting again from the bucket keeps the map
   * every device has been drawing. Says whether it was taken.
   */
  adopt(data: string): boolean {
    const { repo } = this.#deps
    if (repo.get() || parseSoundMap(data) === null) return false
    repo.save({ sig: '', data, madeAt: this.#now().toISOString() })
    return true
  }

  /**
   * Fold again if the vectors changed since the last map and it is time to.
   * Cheap to call as often as you like. Resolves when the fold it started, or
   * the one already running, is done.
   */
  refresh(): Promise<void> {
    if (this.#stopped) return Promise.resolve()
    if (this.#folding) return this.#folding
    const { repo, sound } = this.#deps
    const sig = sound.packSignature()
    const stored = repo.get()
    if (stored?.sig === sig) return Promise.resolve()
    if (stored && stored.sig !== '' && sound.hearing) {
      const wait = Date.parse(stored.madeAt) + FOLD_EVERY_MS - this.#now().getTime()
      if (wait > 0) {
        this.#later(wait)
        return Promise.resolve()
      }
    }
    this.#folding = this.#fold(sig).finally(() => {
      this.#folding = null
    })
    return this.#folding
  }

  stop(): void {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  async #fold(sig: string): Promise<void> {
    const { repo, sound, logger } = this.#deps
    const vectors = sound.vectorsInBucket()
    if (vectors.size === 0) {
      if (repo.get()) {
        repo.clear()
        this.#deps.changed()
      }
      return
    }
    const stored = repo.get()
    const previous = stored ? (parseSoundMap(stored.data) ?? undefined) : undefined
    const started = Date.now()
    try {
      const places = await projectSounds(vectors, {
        ...(previous ? { previous } : {}),
        pause: this.#deps.pause ?? (() => new Promise<void>(resolve => setImmediate(resolve))),
      })
      if (this.#stopped) return
      repo.save({ sig, data: encodeSoundMap(places), madeAt: this.#now().toISOString() })
      logger.info('made the sound map', { songs: places.size, ms: Date.now() - started })
      this.#deps.changed()
    } catch (error) {
      logger.warn('could not make the sound map', { message: messageOf(error) })
    }
  }

  #later(wait: number): void {
    if (this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.refresh()
    }, wait)
    this.#timer.unref?.()
  }

  #now(): Date {
    return this.#deps.now?.() ?? new Date()
  }
}
