import {
  playsKey,
  soundMapKey,
  soundVectorsKey,
  type CloudPlays,
  type CloudSound,
  type CloudSoundMap,
} from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { CloudStore } from '../bucket/store.js'
import type { CloudRepository } from '../repositories/cloud.js'
import type { SoundMapService } from '../sound/soundMap.js'
import type { SoundService } from '../sound/sound.js'
import { sha256 } from '../util/hash.js'
import type { PlaysArchive } from './playsArchive.js'

/**
 * The bucket's files that each hold something of the whole library rather
 * than of one song (docs/SYNC.md, "The bucket"): every song's sound vector,
 * the sound map, and the months of plays. Sent by each pass of the sync
 * (services/cloudSync.ts) when they have changed, never more often than their
 * hour allows, and never before the files the bucket's snapshot named when
 * its library was taken on have been read back into this server.
 */

/**
 * While songs are still being heard, the sound vectors go up at most this
 * often: each file is the whole library's, a few megabytes, and a song is
 * heard about once a minute on a Pi.
 */
const SOUND_UPLOAD_EVERY_MS = 60 * 60_000

/**
 * This month's plays go up at most this often: every play changes the month,
 * and each new file replaces the last. A past month goes as soon as it
 * changes, which is seldom — a phone's play sent days late.
 */
const PLAYS_UPLOAD_EVERY_MS = 60 * 60_000

/** A month's file in the bucket that would not read: kept as it is, never written over. */
const UNREADABLE_PLAYS = 'unreadable'

/** What the bucket's newest snapshot named of these files when its library was taken on. */
interface NamedLibraryFiles {
  readonly sound: CloudSound | null
  readonly soundMap: CloudSoundMap | null
  readonly plays: readonly CloudPlays[]
}

interface CloudLibraryFilesDeps {
  readonly cloud: CloudRepository
  readonly logger: Logger
  readonly now: () => Date
  /** The sync's own put (`CloudSyncService#putOnce`): a file the bucket has is not sent again. */
  readonly putOnce: (
    store: CloudStore,
    key: string,
    data: Buffer,
    contentType: string,
  ) => Promise<void>
  /** Ask the sync for a pass: what a file waiting for its hour does once the hour is up. */
  readonly kick: () => void
  /** Whether the sync has stopped, so nothing waits for an hour any more. */
  readonly stopped: () => boolean
  /** Absent where vectors are not what is being tested, which then sends none. */
  readonly sound?: Pick<SoundService, 'model' | 'hearing' | 'packSignature' | 'pack' | 'restore'>
  /** Absent where the map is not what is being tested, which then sends none. */
  readonly soundMap?: Pick<SoundMapService, 'file' | 'refresh' | 'adopt'>
  /** Absent where plays are not what is being tested. */
  readonly plays?: PlaysArchive
}

export class CloudLibraryFiles {
  readonly #deps: CloudLibraryFilesDeps
  readonly #logger: Logger
  /**
   * The sound vectors the bucket's newest snapshot named when its library was
   * taken on, until they have been read back (`#readBucketSound`).
   */
  #namedSound: CloudSound | null = null
  /** Likewise the sound map the bucket's snapshot named, until it has been read back. */
  #namedSoundMap: CloudSoundMap | null = null
  /** Likewise the months of plays, until they have been read back (`#readBucketPlays`). */
  #namedPlays: readonly CloudPlays[] | null = null
  /** The pass that sends the vectors once the hour since the last is up. */
  #soundTimer: NodeJS.Timeout | null = null
  /** The pass that sends this month's plays once the hour since the last is up. */
  #playsTimer: NodeJS.Timeout | null = null

  constructor(deps: CloudLibraryFilesDeps) {
    this.#deps = deps
    this.#logger = deps.logger
  }

  /**
   * What the bucket's newest snapshot names, to be read back before anything
   * replaces it; null when there is nothing to read back — no snapshot, or a
   * bucket new or not trusted, whose snapshot is still to be looked at.
   */
  takeOn(named: NamedLibraryFiles | null): void {
    this.#namedSound = named?.sound ?? null
    this.#namedSoundMap = named?.soundMap ?? null
    this.#namedPlays = named?.plays ?? null
  }

  /**
   * What the next snapshot names of these files: the bucket's own until they
   * have been read back, since a snapshot without them would leave them
   * named by nothing.
   */
  forSnapshot(): NamedLibraryFiles {
    const { cloud } = this.#deps
    return {
      sound: this.#namedSound ?? cloud.soundState(),
      soundMap: this.#namedSoundMap ?? cloud.soundMapState(),
      plays: this.#namedPlays ?? cloud.playsStates(),
    }
  }

  /**
   * A song was heard (or given up on, or forgotten). Its vector goes up with
   * the next pass that may send the vectors: now, once every song has been
   * heard, or else when the hour since the last time is up.
   */
  soundChanged(): void {
    const sound = this.#deps.sound
    if (!sound) return
    const state = this.#deps.cloud.soundState()
    const wait = state
      ? Date.parse(state.uploadedAt) + SOUND_UPLOAD_EVERY_MS - this.#deps.now().getTime()
      : 0
    if (!sound.hearing || wait <= 0) this.#deps.kick()
    else this.#soundLater(wait)
  }

  /** Nothing waits for its hour any more. */
  clearTimers(): void {
    if (this.#soundTimer) clearTimeout(this.#soundTimer)
    if (this.#playsTimer) clearTimeout(this.#playsTimer)
    this.#soundTimer = null
    this.#playsTimer = null
  }

  /**
   * Every song's sound vector, as one file in the bucket (sound/pack.ts), when
   * they have changed since the last went up: at most once an hour while songs
   * are still being heard, since each file is the whole library's. Never
   * before the bucket's own file has been read back, so vectors this server
   * does not have are never replaced by a file without them.
   */
  async uploadSound(store: CloudStore): Promise<void> {
    const sound = this.#deps.sound
    if (!sound) return
    const { cloud } = this.#deps
    await this.#readBucketSound(store, sound)

    const state = cloud.soundState()
    const signature = sound.packSignature()
    if (state?.model === sound.model && state.sig === signature) return
    const now = this.#deps.now()
    if (state && sound.hearing) {
      const wait = Date.parse(state.uploadedAt) + SOUND_UPLOAD_EVERY_MS - now.getTime()
      if (wait > 0) {
        this.#soundLater(wait)
        return
      }
    }

    const pack = sound.pack()
    if (!pack) {
      cloud.dropSound()
      return
    }
    const key = soundVectorsKey(sha256(pack))
    await this.#deps.putOnce(store, key, pack, 'application/octet-stream')
    cloud.saveSound({
      model: sound.model,
      key,
      size: pack.length,
      sig: signature,
      uploadedAt: now.toISOString(),
    })
  }

  /**
   * The vectors the bucket's snapshot named when its library was taken on, for
   * the songs here not heard yet: a server starting again from the bucket gets
   * them back rather than hearing every song again. Read once; a bucket that
   * cannot be read right now fails the pass, which tries again later.
   */
  async #readBucketSound(
    store: CloudStore,
    sound: NonNullable<CloudLibraryFilesDeps['sound']>,
  ): Promise<void> {
    const named = this.#namedSound
    if (!named) return
    const { cloud } = this.#deps
    if (cloud.soundState()?.key !== named.key) {
      // Another model's vectors are no use here; the next file this server
      // sends replaces them.
      if (named.model === sound.model) {
        const data = await store.get(named.key)
        const restored = data ? sound.restore(data) : null
        if (restored === null) {
          this.#logger.warn('the sound vectors in the bucket could not be read', {
            key: named.key,
          })
        } else if (restored > 0) {
          this.#logger.info('took the sound vectors back from the bucket', { songs: restored })
        }
      }
      // What is in it is not known here: the next look packs and compares.
      cloud.saveSound({ ...named, sig: '', uploadedAt: this.#deps.now().toISOString() })
    }
    this.#namedSound = null
  }

  /**
   * The sound map's file (sound/soundMap.ts), when it is not the one in the
   * bucket. The fold itself is started here and not waited for: it can take
   * a while on a Pi, and a new map asks for a pass of its own when it is made.
   */
  async uploadSoundMap(store: CloudStore): Promise<void> {
    const soundMap = this.#deps.soundMap
    if (!soundMap) return
    const { cloud } = this.#deps
    await this.#readBucketSoundMap(store, soundMap)
    void soundMap.refresh()
    const file = soundMap.file()
    if (file === null) {
      if (!cloud.soundState()) cloud.dropSoundMap()
      return
    }
    const data = Buffer.from(file)
    const key = soundMapKey(sha256(data))
    if (cloud.soundMapState()?.key === key) return
    await this.#deps.putOnce(store, key, data, 'application/json')
    cloud.saveSoundMap({ key, size: data.length })
  }

  /**
   * The map the bucket's snapshot named when its library was taken on: a
   * server with no map of its own starts its next fold from it, so the map
   * every device has been drawing holds still. Read once.
   */
  async #readBucketSoundMap(
    store: CloudStore,
    soundMap: NonNullable<CloudLibraryFilesDeps['soundMap']>,
  ): Promise<void> {
    const named = this.#namedSoundMap
    if (!named) return
    const { cloud } = this.#deps
    if (cloud.soundMapState()?.key !== named.key) {
      if (soundMap.file() === null) {
        const data = await store.get(named.key)
        if (data && soundMap.adopt(data.toString('utf8'))) {
          this.#logger.info('took the sound map back from the bucket', { key: named.key })
        }
      }
      cloud.saveSoundMap(named)
    }
    this.#namedSoundMap = null
  }

  /**
   * Each month of plays whose plays have changed since its file went up, as a
   * file of its own: this month at most once an hour, a past one at once.
   * Never before the bucket's own months have been read back, so plays this
   * server does not have are never replaced by a file without them.
   *
   * Says whether every play here is now in the bucket: false while this
   * month's file waits for its hour.
   */
  async uploadPlays(store: CloudStore): Promise<boolean> {
    const plays = this.#deps.plays
    if (!plays) return true
    const { cloud } = this.#deps
    await this.#readBucketPlays(store, plays)

    const states = new Map(cloud.playsStates().map(state => [state.month, state]))
    const now = this.#deps.now()
    const thisMonth = now.toISOString().slice(0, 7)
    let allUp = true
    for (const { month, sig } of plays.months()) {
      const state = states.get(month)
      states.delete(month)
      if (state?.sig === sig || state?.sig === UNREADABLE_PLAYS) continue
      if (state && month === thisMonth) {
        const wait = Date.parse(state.uploadedAt) + PLAYS_UPLOAD_EVERY_MS - now.getTime()
        if (wait > 0) {
          this.#playsLater(wait)
          allUp = false
          continue
        }
      }
      const file = plays.file(month)
      const key = playsKey(sha256(file.body))
      await this.#deps.putOnce(store, key, file.body, 'application/gzip')
      cloud.savePlays({
        month,
        key,
        size: file.body.length,
        count: file.count,
        sig,
        uploadedAt: now.toISOString(),
      })
    }
    // A month whose plays have all gone, with the songs they were of.
    for (const [month, state] of states) {
      if (state.sig !== UNREADABLE_PLAYS) cloud.dropPlays(month)
    }
    return allUp
  }

  /**
   * The months of plays the bucket's snapshot named when its library was taken
   * on, read into this library: a server starting again from the bucket has
   * its Stats back. Read once; a bucket that cannot be read right now fails
   * the pass, which tries again later.
   */
  async #readBucketPlays(store: CloudStore, plays: PlaysArchive): Promise<void> {
    const named = this.#namedPlays
    if (!named) return
    const { cloud } = this.#deps
    const known = new Map(cloud.playsStates().map(state => [state.month, state.key]))
    let restored = 0
    for (const entry of named) {
      if (known.get(entry.month) === entry.key) continue
      const data = await store.get(entry.key)
      if (!data) {
        this.#logger.warn('a month of plays the snapshot names is not in the bucket', {
          month: entry.month,
        })
        continue
      }
      const read = plays.restore(data)
      const uploadedAt = this.#deps.now().toISOString()
      if (!read) {
        this.#logger.warn('a month of plays in the bucket could not be read; leaving it be', {
          key: entry.key,
        })
        cloud.savePlays({ ...entry, sig: UNREADABLE_PLAYS, uploadedAt })
        continue
      }
      restored += read.restored
      // Signed as the plays here now are, when they are the file's and no
      // more; otherwise unknown, so the next look sends what this has.
      const here = plays.months().find(month => month.month === entry.month)
      cloud.savePlays({
        ...entry,
        sig: here?.count === entry.count ? here.sig : '',
        uploadedAt,
      })
    }
    if (restored > 0) this.#logger.info('took the plays back from the bucket', { plays: restored })
    this.#namedPlays = null
  }

  #playsLater(wait: number): void {
    if (this.#playsTimer || this.#deps.stopped()) return
    this.#playsTimer = setTimeout(() => {
      this.#playsTimer = null
      this.#deps.kick()
    }, wait)
    this.#playsTimer.unref()
  }

  #soundLater(wait: number): void {
    if (this.#soundTimer || this.#deps.stopped()) return
    this.#soundTimer = setTimeout(() => {
      this.#soundTimer = null
      this.#deps.kick()
    }, wait)
    this.#soundTimer.unref()
  }
}
