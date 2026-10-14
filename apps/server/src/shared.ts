import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { messageOf } from '@selfmp3/shared'
import type { Config } from './config.js'
import type { Logger } from './logger.js'
import { createKeepAwake, type KeepAwakeService } from './services/keepAwake.js'
import { MetadataLookupService } from './services/lookup.js'
import { RomanizationService } from './services/romanization.js'
import {
  freshState,
  type YtThrottleService,
  type ThrottleState,
  type ThrottleStore,
} from './services/ytThrottle.js'
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
 * - metadata lookup, whose MusicBrainz pace is per address;
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
  /** Null: each library keeps its own pace, in its own database. */
  readonly throttle: YtThrottleService | null
  readonly keepAwake: KeepAwakeService
  readonly analysisGate: Gate
  /** Which server this is: `CloudServerSchema.id`, and `/api/health`'s `serverId`. */
  readonly serverId: string
  /** Let go of what is held for the machine: the model, the stay-awake. */
  close(): Promise<void>
}

export function createShared(
  config: Pick<Config, 'dataDir' | 'sound'>,
  logger: Logger,
  throttle: YtThrottleService | null = null,
): SharedServices {
  const soundModel = new SoundModelHost({ config, logger })
  const keepAwake = createKeepAwake(logger)
  return {
    soundModel,
    romanization: new RomanizationService(logger),
    lookup: new MetadataLookupService(logger),
    throttle,
    keepAwake,
    analysisGate: new Gate(1),
    serverId: serverIdIn(config.dataDir),
    close: async () => {
      keepAwake.stop()
      await soundModel.close()
    },
  }
}

/**
 * YouTube's pace kept in a file of its own, for a server with several
 * databases and one address. Read once and written through: nothing else
 * writes it, and a file that is missing or not this shape starts afresh, as a
 * first boot does.
 */
/**
 * This server's name for itself, made on the first boot and kept in
 * `<data>/server-id` from then on.
 *
 * A device finds the server by racing every address its snapshot names
 * (`packages/client/src/connection/reach.ts`), and an address only says where
 * *a* server might be. `http://localhost:4600` is this server on the Pi and the
 * development server on the Mac beside it; a Wi-Fi address at a friend's is
 * whatever they run. So a device keeps only the address whose `/api/health`
 * answers with the id the snapshot named. It is kept rather than made at each
 * boot so a restart does not leave every device holding a snapshot that names a
 * server nobody is any more, until the next one is written.
 *
 * Not a secret: it is said to anyone who asks `/api/health`. It tells servers
 * apart by accident, which is all it is for; the token is what keeps anyone out.
 */
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
