import fsp from 'node:fs/promises'
import { coverKey, coverPackKey, messageOf, type CloudCoverPack } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { CloudError, type CloudStore } from '../bucket/store.js'
import type { CloudArtistState, CloudRepository } from '../repositories/cloud.js'
import { sha256 } from '../util/hash.js'
import type { ArtistBackdropService } from './artistBackdrops.js'
import { planCoverPacks } from './coverPacks.js'
import type { CoverService } from './covers.js'

/**
 * Artists' pictures and the packs of covers in the bucket (docs/SYNC.md, "The
 * bucket"): sent by each pass of the sync (services/cloudSync.ts) once the
 * pass has sent its songs, each song's own cover with them.
 */

interface CloudPicturesDeps {
  readonly cloud: CloudRepository
  readonly covers: Pick<CoverService, 'find'>
  readonly logger: Logger
  /** The sync's own put (`CloudSyncService#putOnce`): a file the bucket has is not sent again. */
  readonly putOnce: (
    store: CloudStore,
    key: string,
    data: Buffer,
    contentType: string,
  ) => Promise<void>
  /** Whether the sync has stopped: a pass stops between pictures. */
  readonly stopped: () => boolean
  /** Absent where pictures are not what is being tested, which then sends none. */
  readonly artists?: Pick<ArtistBackdropService, 'artists' | 'keptPair'>
}

export class CloudPictures {
  readonly #deps: CloudPicturesDeps
  readonly #logger: Logger
  /**
   * Pictures named in the library whose bytes this server does not have, as
   * the last look for them found: not looked for again every pass. A cover
   * that changes has a new key, and is looked for under that.
   */
  readonly #unpackable = new Set<string>()

  constructor(deps: CloudPicturesDeps) {
    this.#deps = deps
    this.#logger = deps.logger
  }

  /**
   * The bucket's packs of covers, for a server that has none of its own yet:
   * it may not have the covers to make them again (a library taken on from
   * the bucket has none here), and without them every device would be back
   * to a read per cover. Only those the bucket still has, as its listing said.
   */
  takeOnCoverPacks(packs: readonly CloudCoverPack[]): void {
    const { cloud } = this.#deps
    if (cloud.coverPacks().length > 0) return
    const present = packs.filter(pack => cloud.hasFile(pack.key))
    if (present.length > 0) cloud.saveCoverPacks(present)
  }

  /**
   * Each artist's picture this server keeps, in the bucket beside the covers;
   * an artist the library no longer has, or no longer has a picture of, has
   * theirs put in the trash. A picture already up as it is kept costs a look
   * at the kept file's time.
   */
  async uploadArtists(store: CloudStore): Promise<void> {
    const pictures = this.#deps.artists
    if (!pictures) return
    const { cloud } = this.#deps
    const states = cloud.artistStates()
    const kept = new Set<string>()
    for (const artist of pictures.artists()) {
      if (this.#deps.stopped()) return
      const pair = await pictures.keptPair(artist.key)
      if (!pair) continue
      kept.add(artist.key)
      if (states.get(artist.key)?.sig === pair.rev) continue
      try {
        const [banner, portrait] = await Promise.all([
          fsp.readFile(pair.banner),
          fsp.readFile(pair.portrait),
        ])
        const bannerKey = coverKey(sha256(banner), '.jpg')
        const portraitKey = coverKey(sha256(portrait), '.jpg')
        await this.#deps.putOnce(store, bannerKey, banner, 'image/jpeg')
        await this.#deps.putOnce(store, portraitKey, portrait, 'image/jpeg')
        cloud.saveArtist({
          artist: artist.key,
          bannerKey,
          bannerSize: banner.length,
          portraitKey,
          portraitSize: portrait.length,
          sig: pair.rev,
        })
      } catch (error) {
        if (error instanceof CloudError && error.kind !== 'other') throw error
        // Deleted between the look and the read, most likely: the next pass sends it.
        this.#logger.warn('could not upload an artist’s picture', {
          artist: artist.name,
          message: messageOf(error),
        })
      }
    }
    for (const artist of states.keys()) if (!kept.has(artist)) cloud.dropArtist(artist)
  }

  /**
   * The covers and artists' pictures, packed a few megabytes to a file
   * (services/coverPacks.ts), so a device with none of them reads a file per
   * pack rather than one per picture. A pack replaced goes in the trash with
   * the pass that replaced it; a library already packed costs a look at the
   * database.
   */
  async uploadCoverPacks(store: CloudStore): Promise<void> {
    const { cloud } = this.#deps
    const live = new Map<string, number>()
    for (const state of cloud.states().values()) {
      if (state.coverKey !== null) live.set(state.coverKey, state.coverSize ?? 0)
    }
    const artists = cloud.artistStates()
    for (const artist of artists.values()) {
      live.set(artist.bannerKey, artist.bannerSize)
      live.set(artist.portraitKey, artist.portraitSize)
    }
    const packs = cloud.coverPacks()
    // First as if every picture not known to be missing were here: when that
    // packs nothing, nothing is looked for on the disk.
    const hoped = planCoverPacks(live, packs, key => !this.#unpackable.has(key))
    if (hoped.groups.length === 0) {
      if (hoped.kept.length !== packs.length) cloud.saveCoverPacks(hoped.kept)
      return
    }

    const sources = await this.#pictureSources(artists)
    for (const key of live.keys()) if (!sources.has(key)) this.#unpackable.add(key)
    const plan = planCoverPacks(live, packs, key => sources.has(key))
    const made: CloudCoverPack[] = []
    for (const group of plan.groups) {
      if (this.#deps.stopped()) return
      const parts: Buffer[] = []
      const covers: [string, number][] = []
      for (const { key } of group) {
        const data = await fsp.readFile(sources.get(key) ?? '').catch(() => null)
        // Changed since it went up: the cover's next upload names it anew.
        if (!data || !key.includes(`/${sha256(data)}.`)) {
          this.#unpackable.add(key)
          continue
        }
        parts.push(data)
        covers.push([key, data.length])
      }
      if (covers.length === 0) continue
      const bytes = Buffer.concat(parts)
      const key = coverPackKey(sha256(bytes))
      await this.#deps.putOnce(store, key, bytes, 'application/octet-stream')
      made.push({ key, size: bytes.length, covers })
    }
    const next = [...plan.kept, ...made]
    const before = packs.map(pack => pack.key).join()
    if (next.map(pack => pack.key).join() !== before) {
      cloud.saveCoverPacks(next)
      this.#logger.debug('covers packed', {
        packs: next.length,
        covers: next.reduce((sum, pack) => sum + pack.covers.length, 0),
      })
    }
  }

  /** Where this server keeps each picture the bucket has of its library, by key. */
  async #pictureSources(
    artists: ReadonlyMap<string, CloudArtistState>,
  ): Promise<Map<string, string>> {
    const { cloud, covers } = this.#deps
    const sources = new Map<string, string>()
    for (const [songId, state] of cloud.states()) {
      if (state.coverKey === null || sources.has(state.coverKey)) continue
      if (this.#unpackable.has(state.coverKey)) continue
      const found = await covers.find(songId)
      if (found) sources.set(state.coverKey, found.path)
    }
    const pictures = this.#deps.artists
    if (pictures) {
      for (const [artist, state] of artists) {
        if (this.#unpackable.has(state.bannerKey) && this.#unpackable.has(state.portraitKey)) {
          continue
        }
        const pair = await pictures.keptPair(artist)
        if (!pair) continue
        sources.set(state.bannerKey, pair.banner)
        sources.set(state.portraitKey, pair.portrait)
      }
    }
    return sources
  }
}
