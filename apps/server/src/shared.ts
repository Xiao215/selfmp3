import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { messageOf } from '@selfmp3/shared'
import type { Config } from './config.js'
import type { Logger } from './logger.js'
import { createKeepAwake, type KeepAwakeService } from './services/keepAwake.js'
import { MUSICBRAINZ_PACE_MS, MetadataLookupService } from './services/lookup.js'
import { RateLimiter } from './services/rateLimiter.js'
import { RomanizationService } from './services/romanization.js'
import {
  freshState,
  type YtThrottleService,
  type ThrottleState,
  type ThrottleStore,
} from './services/ytThrottle.js'
import { ServerMetrics } from './services/metrics.js'
import { SoundModelHost } from './sound/sound.js'
import { Gate } from './util/gate.js'

/**
 * What every library on one machine shares (docs/features/shared-server.md).
 *
 * A library is a `Container`: its database, its sync, its import queue. Most
 * of what one holds is about that library alone, but a few things are about
 * the machine instead, and a server working for several accounts must have
 * one of each, not one per account:
 *
 * - the listening model, which is 600 MB loaded;
 * - the Japanese dictionary, loaded once and kept;
 * - MusicBrainz's pace, which is per address: the metadata lookup and the
 *   names artists also go by both ask it;
 * - YouTube's pace, which is per address too: two libraries each keeping
 *   within the budget would together be twice over it, and the block that
 *   follows is the machine's;
 * - staying awake, which is one assertion for the machine;
 * - analysis, one song at a time across every library, so a Pi with three
 *   backlogs does not run three ffmpegs and the model at once;
 * - the server's own name for itself (`serverId`), which every library's
 *   snapshot carries and `/api/health` answers with.
 *
 * A container made without one makes its own, which is what a test or a
 * single library on a laptop wants.
 */
export interface SharedServices {
  readonly soundModel: SoundModelHost
  readonly romanization: RomanizationService
  readonly lookup: MetadataLookupService
  /** One request a second to MusicBrainz, from everything on the machine that asks it. */
  readonly musicBrainzPace: RateLimiter
  /** Null: each library keeps its own pace, in its own database. */
  readonly throttle: YtThrottleService | null
  readonly keepAwake: KeepAwakeService
  readonly analysisGate: Gate
  /** Which server this is: `CloudServerSchema.id`, and `/api/health`'s `serverId`. */
  readonly serverId: string
  /** What the owner's admin page shows, kept beside hub.json (services/metrics.ts). */
  readonly metrics: ServerMetrics
  /** Let go of what is held for the machine: the model, the stay-awake, the counts. */
  close(): Promise<void>
}

export function createShared(
  config: Pick<Config, 'dataDir' | 'sound' | 'publicUrl' | 'cloudDir'>,
  logger: Logger,
  throttle: YtThrottleService | null = null,
): SharedServices {
  const soundModel = new SoundModelHost({ config, logger })
  const keepAwake = createKeepAwake(logger)
  const metrics = new ServerMetrics(config.dataDir, undefined, error => {
    logger.warn('could not count for the admin page', { message: messageOf(error) })
  })
  const musicBrainzPace = new RateLimiter(MUSICBRAINZ_PACE_MS)
  return {
    soundModel,
    romanization: new RomanizationService(logger),
    lookup: new MetadataLookupService(logger, undefined, undefined, musicBrainzPace),
    musicBrainzPace,
    throttle,
    keepAwake,
    analysisGate: new Gate(1),
    serverId: serverIdOf(config),
    metrics,
    close: async () => {
      keepAwake.stop()
      await soundModel.close()
      metrics.close()
    },
  }
}

/**
 * This server's name for itself: `CloudServerSchema.id`, which `/api/health`
 * answers with.
 *
 * A device finds the server by racing every address its snapshot names
 * (`packages/client/src/connection/reach.ts`), and an address only says where
 * *a* server might be. `http://localhost:4600` is this server on the Pi and the
 * development server on the Mac beside it; a Wi-Fi address at a friend's is
 * whatever they run. So a device keeps only the address whose `/api/health`
 * answers with the id the snapshot named.
 *
 * A server with a public address (`SELFMP3_PUBLIC_URL`) is named by that
 * address, so the name outlives its data folder. A Pi rebuilt on a new SD card
 * comes back at the same addresses, and has to come back as the same server:
 * a new name there would have every device see "some other server" where the
 * snapshot's server was, and wait for it forever (2026-10-14). Named as
 * before, it answers as itself and refuses the token it no longer holds, and a
 * device joins it again as it would any server that lost the library
 * (docs/features/shared-server.md, "A server that no longer works for a
 * library"). Two servers given the same public address answer as one, and the
 * token still tells them apart: an address is taken only when it takes the
 * library's token.
 *
 * Any other server makes a name at random on its first boot and keeps it in
 * `<data>/server-id`, so a restart does not leave every device holding a
 * snapshot that names a server nobody is any more. That is the development
 * server, a test's, the verify lanes': each is its own server, and none of
 * them answers as the real one. A server on a folder bucket
 * (`SELFMP3_CLOUD_DIR`: the dev profile, the verify lanes) is one of those
 * even with a public address, so a development server that picks one up from
 * `.env` is still not the server that address belongs to.
 *
 * Not a secret: it is said to anyone who asks `/api/health`. It tells servers
 * apart by accident, which is all it is for; the token is what keeps anyone out.
 */
function serverIdOf(config: Pick<Config, 'dataDir' | 'publicUrl' | 'cloudDir'>): string {
  if (config.publicUrl && config.cloudDir === null) return idOfAddress(config.publicUrl)
  return serverIdIn(config.dataDir)
}

/** A name for the server at a public address: the same address, the same name, every time. */
function idOfAddress(url: string): string {
  const address = new URL(url).href.replace(/\/+$/, '')
  return crypto
    .createHash('sha256')
    .update(`selfmp3 server at ${address}`)
    .digest('base64url')
    .slice(0, 22)
}

/** A name made once for this data folder, and kept in it. */
function serverIdIn(dataDir: string): string {
  const file = path.join(dataDir, 'server-id')
  const read = (): string | null => {
    try {
      return fs.readFileSync(file, 'utf8').trim() || null
    } catch {
      return null
    }
  }
  const existing = read()
  if (existing) return existing
  const made = crypto.randomBytes(16).toString('base64url')
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    // `wx`: two processes booting on one folder agree on the first one's.
    fs.writeFileSync(file, made, { flag: 'wx' })
    return made
  } catch {
    return read() ?? made
  }
}

/**
 * YouTube's pace kept in a file of its own, for a server with several
 * databases and one address. Read once and written through: nothing else
 * writes it, and a file that is missing or not this shape starts afresh, as a
 * first boot does.
 */
export class FileThrottleStore implements ThrottleStore {
  readonly #file: string
  readonly #logger: Logger
  #state: ThrottleState | null = null

  constructor(dataDir: string, logger: Logger) {
    this.#file = path.join(dataDir, 'yt-throttle.json')
    this.#logger = logger
  }

  get(now: number): ThrottleState {
    if (this.#state) return this.#state
    try {
      const read = JSON.parse(fs.readFileSync(this.#file, 'utf8')) as Partial<ThrottleState>
      const fields = ['tokens', 'ratchet', 'updatedAt', 'pausedUntil', 'limitedAt'] as const
      if (fields.every(field => typeof read[field] === 'number')) {
        this.#state = read as ThrottleState
        return this.#state
      }
    } catch {
      // No file yet, or not one of ours: start as a first boot does.
    }
    this.#state = freshState(now)
    return this.#state
  }

  save(state: ThrottleState): void {
    this.#state = state
    try {
      fs.writeFileSync(this.#file, JSON.stringify(state))
    } catch (error) {
      this.#logger.warn('could not keep YouTube’s pace', { message: messageOf(error) })
    }
  }
}
