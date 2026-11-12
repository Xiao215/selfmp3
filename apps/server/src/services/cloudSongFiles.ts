import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  audioKey,
  coverKey,
  detectLyricsLanguage,
  isSynced,
  lyricTextLines,
  motionKey,
  parseLyrics,
  wordsKey,
  type CloudLyrics,
  type CloudWords,
} from '@selfmp3/shared'
import type { CloudStore } from '../bucket/store.js'
import type { KeptCloudFiles } from '../bucket/kept.js'
import type { CloudRepository, CloudSongState, SongFileInfo } from '../repositories/cloud.js'
import type { StorageDriver } from '../storage/index.js'
import { sha256 } from '../util/hash.js'
import { audioSignature, NO_FILE_SIGNATURE, tagsLyricsSignature } from './cloudSignatures.js'
import type { CoverService } from './covers.js'
import type { LyricsService } from './lyrics.js'
import type { MetadataService } from './metadata.js'
import type { MotionStore } from './motionStore.js'

/**
 * One song's files in the bucket (docs/SYNC.md, "The bucket"): what its audio,
 * cover, words and motion curve look like here, in terms that change exactly
 * when a file does, and sending whichever of them the bucket does not have
 * yet. Used by each pass of the sync (services/cloudSync.ts) and by an
 * import's own upload, which decide when.
 */

export interface Signatures {
  readonly audio: string
  readonly cover: string
  readonly lyrics: string
  /** The motion curve file's size and time, or `none` before analysis has made one. */
  readonly motion: string
  /** Whether the audio is on this disk: what a changed audio signature needs to be sent from. */
  readonly audioHere: boolean
  /** Whether a lyric sidecar is on this disk beside it. */
  readonly sidecarHere: boolean
}

/** A song's words file in the bucket: the text and its romanized lines (`wordsKey`). */
interface UploadedLyrics {
  readonly key: string
  readonly size: number
  readonly kind: CloudLyrics['kind']
}

/** Whether a lyric text is Chinese or Japanese: words that should have romanized lines. */
function wantsRomanized(text: string): boolean {
  const parsed = parseLyrics(text)
  const lines = lyricTextLines(parsed)
  return detectLyricsLanguage(lines) !== 'none'
}

interface CloudSongFilesDeps {
  readonly cloud: CloudRepository
  readonly storage: StorageDriver
  readonly covers: CoverService
  readonly lyrics: LyricsService
  readonly metadata: MetadataService
  /** The sync's own put (`CloudSyncService#putOnce`): a file the bucket has is not sent again. */
  readonly putOnce: (
    store: CloudStore,
    key: string,
    data: Buffer,
    contentType: string,
  ) => Promise<void>
  /** `CloudSyncDeps.romanize`: absent, no romanized lines are sent. */
  readonly romanize?: (songId: number, text: string) => Promise<string[] | null>
  /** `CloudSyncDeps.motion`: absent, no curves are sent. */
  readonly motion?: Pick<MotionStore, 'stat' | 'bytes'>
  /** `CloudSyncDeps.kept`: the words sent are kept on this disk too. */
  readonly kept?: KeptCloudFiles
}

export class CloudSongFiles {
  readonly #deps: CloudSongFilesDeps

  constructor(deps: CloudSongFilesDeps) {
    this.#deps = deps
  }

  /**
   * What a song's files look like now, in terms that change exactly when a
   * file does: the audio file's size and mtime (from its row — no disk access),
   * the cover's revision, the lyric sidecar's size and mtime, and the motion
   * curve's. Lyrics kept in the audio file's own tags change when the audio
   * file does. The curve is compared by a stat rather than by hashing it, as
   * the sidecar is: it is written whole and renamed into place, so a new curve
   * is always a new time, and a pass over an unchanged library reads no file.
   *
   * With neither a sidecar nor the audio here — the ordinary state, once the
   * pass has let both go — nothing here can have changed the words, and their
   * signature is whatever was sent: the bucket's words stand. The one thing
   * that can still change them is the row saying there are none (the words
   * were cleared by hand), which is `none`, and sends the song up without them.
   */
  async signatures(file: SongFileInfo, state: CloudSongState | null = null): Promise<Signatures> {
    const audio = audioSignature(file.sizeBytes, file.mtimeMs)
    const cover = file.hasArt ? `art-${file.artRev}` : NO_FILE_SIGNATURE
    const curve = (await this.#deps.motion?.stat(file.id)) ?? null
    const motion = curve ? `motion-${curve.size}-${Math.round(curve.mtimeMs)}` : NO_FILE_SIGNATURE
    const audioHere = await this.#deps.storage.exists(file.path)
    const sidecar = await this.#deps.lyrics.findSidecar(file.path)
    if (!sidecar) {
      const lyrics = audioHere
        ? tagsLyricsSignature(audio)
        : file.lyricsKind === 'none'
          ? NO_FILE_SIGNATURE
          : (state?.lyricsSig ?? NO_FILE_SIGNATURE)
      return { audio, cover, lyrics, motion, audioHere, sidecarHere: false }
    }
    const stat = await this.#deps.storage.stat(sidecar.key)
    const lyrics = stat
      ? `sidecar${sidecar.extension}-${stat.sizeBytes}-${stat.modifiedAt.getTime()}`
      : tagsLyricsSignature(audio)
    return { audio, cover, lyrics, motion, audioHere, sidecarHere: true }
  }

  /** Upload whatever of one song's files the bucket does not have yet. */
  async upload(
    store: CloudStore,
    file: SongFileInfo,
    state: CloudSongState | null,
    known?: Signatures,
  ): Promise<void> {
    const signatures = known ?? (await this.signatures(file, state))

    let audio: { key: string; size: number }
    if (state && state.audioSig === signatures.audio) {
      audio = { key: state.audioKey, size: state.audioSize }
    } else {
      const data = await this.#deps.storage.read(file.path)
      // What was read is the song as the sweep read it, or it is not sent:
      // the row's size and time are what every later look compares with.
      const after = await this.#deps.storage.stat(file.path)
      if (
        data.length !== file.sizeBytes ||
        !after ||
        after.sizeBytes !== file.sizeBytes ||
        Math.floor(after.modifiedAt.getTime()) !== file.mtimeMs
      ) {
        throw new CopyChanged(file.path)
      }
      const key = audioKey(sha256(data), path.extname(file.path))
      await this.#deps.putOnce(store, key, data, file.mime)
      audio = { key, size: data.length }
    }

    let cover: { key: string; size: number } | null
    if (state && state.coverSig === signatures.cover) {
      cover = state.coverKey !== null ? { key: state.coverKey, size: state.coverSize ?? 0 } : null
    } else {
      cover = await this.#uploadCover(store, file)
    }

    let lyrics: UploadedLyrics | null
    let lyricsSig = signatures.lyrics
    if (state && state.lyricsSig === signatures.lyrics) {
      lyrics =
        state.lyricsKey !== null && state.lyricsKind !== null
          ? { key: state.lyricsKey, size: state.lyricsSize ?? 0, kind: state.lyricsKind }
          : null
    } else {
      const uploaded = await this.#uploadLyrics(store, file)
      lyrics = uploaded?.lyrics ?? null
      // Chinese or Japanese words that got no romaji this time are not done:
      // an empty signature never matches, so the next pass tries again.
      if (uploaded?.romanizedMissing) lyricsSig = ''
    }

    let motion: string | null
    if (state && state.motionSig === signatures.motion) {
      motion = state.motionKey
    } else {
      motion = await this.#uploadMotion(store, file)
    }

    this.#deps.cloud.saveState({
      songId: file.id,
      audioKey: audio.key,
      audioSize: audio.size,
      audioSig: signatures.audio,
      coverKey: cover?.key ?? null,
      coverSize: cover?.size ?? null,
      coverSig: signatures.cover,
      lyricsKey: lyrics?.key ?? null,
      lyricsSize: lyrics?.size ?? null,
      lyricsKind: lyrics?.kind ?? null,
      lyricsSig,
      motionKey: motion,
      motionSig: signatures.motion,
    })
  }

  async #uploadCover(
    store: CloudStore,
    file: SongFileInfo,
  ): Promise<{ key: string; size: number } | null> {
    if (!file.hasArt) return null
    const found = await this.#deps.covers.find(file.id)
    if (!found) return null
    const data = await fsp.readFile(found.path)
    const key = coverKey(sha256(data), path.extname(found.path))
    await this.#deps.putOnce(store, key, data, found.contentType)
    return { key, size: data.length }
  }

  /**
   * The words — the sidecar if there is one, else the audio file's own tags —
   * put up with their romanized lines, as the server's own lyrics answer
   * carries them. `romanizedMissing` says the words are Chinese or Japanese
   * and no romaji could be made this time.
   */
  async #uploadLyrics(
    store: CloudStore,
    file: SongFileInfo,
  ): Promise<{ lyrics: UploadedLyrics; romanizedMissing: boolean } | null> {
    let text: string | null = null
    let kind: CloudLyrics['kind'] = 'plain'

    const sidecar = await this.#deps.lyrics.readSidecar(file.path)
    if (sidecar && sidecar.kind !== 'none') {
      text = sidecar.text
      kind = sidecar.kind
    } else {
      const embedded = (await this.#deps.metadata.read(file.path)).embeddedLyrics
      if (embedded?.trim()) {
        text = embedded
        kind = isSynced(embedded) ? 'synced' : 'plain'
      }
    }
    if (!text?.trim()) return null

    // One file, the text and its romanized lines together, so a device reads
    // both with one call to the bucket.
    const romanize = this.#deps.romanize
    const romanized = romanize ? await romanize(file.id, text).catch(() => null) : null
    const words: CloudWords = { text, romanized }
    const data = Buffer.from(JSON.stringify(words), 'utf8')
    const key = wordsKey(sha256(data))
    await this.#deps.putOnce(store, key, data, 'application/json')
    // Read from here once the sidecar is let go, rather than from the bucket.
    await this.#deps.kept?.keep(key, data)
    return {
      lyrics: { key, size: data.length, kind },
      romanizedMissing: romanize !== undefined && romanized === null && wantsRomanized(text),
    }
  }

  /**
   * The song's motion curve, as the server's own motion answer carries it, in
   * `lyrics/` under the hash of its JSON: the doorman already lets devices read
   * that folder, so no doorman has to be redeployed for it. Null before
   * analysis has made one.
   */
  async #uploadMotion(store: CloudStore, file: SongFileInfo): Promise<string | null> {
    const data = (await this.#deps.motion?.bytes(file.id)) ?? null
    if (!data || data.length === 0) return null
    const key = motionKey(sha256(data))
    await this.#deps.putOnce(store, key, data, 'application/json')
    return key
  }
}

/** A copy here written to since the sweep read it: what was read is not the song any more. */
export class CopyChanged extends Error {
  constructor(key: string) {
    super(`changed since it was read: ${key}`)
    this.name = 'CopyChanged'
  }
}
