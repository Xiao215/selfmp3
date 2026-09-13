import type { DeviceCommand, DeviceHeartbeat, DeviceList } from '@selfmp3/shared'
import type { DeviceRepository } from '../repositories/devices.js'
import type { Logger } from '../logger.js'
import type { EventHub, EventSink } from './events.js'

/**
 * Presence and remote control.
 *
 * Heartbeats go straight to the table and out to every stream. Beyond that
 * the service runs two small timers: a presence sweep, so a device that
 * simply closed its tab flips to offline on everyone else's screen without
 * anyone having to send anything; and a library-version watch, so a change
 * made from the Mac shows up on the phone without a refetch on focus.
 */

/** How often to check whether anyone dropped off the presence window. */
const SWEEP_MS = 5_000
/** How often to compare the library version. Cheap: it is one integer. */
const VERSION_MS = 1_500
/**
 * Devices unseen for a week are forgotten. Every browser has its own id, kept
 * in its storage for one address, so a month's grace left the list full of the
 * same laptop under old ids. Nothing is lost: a device that comes back simply
 * heartbeats in again, and a state that old is past offering to resume.
 */
const FORGET_AFTER_MS = 7 * 24 * 60 * 60 * 1000
/** How often to look for devices to forget, besides at boot. */
const FORGET_EVERY_MS = 60 * 60 * 1000

export class DeviceService {
  readonly #devices: DeviceRepository
  readonly #hub: EventHub
  readonly #logger: Logger
  readonly #libraryVersion: () => number
  readonly #now: () => number

  #sweep: ReturnType<typeof setInterval> | null = null
  #versionWatch: ReturnType<typeof setInterval> | null = null
  #forgetting: ReturnType<typeof setInterval> | null = null
  #lastOnline = ''
  #lastVersion = -1

  constructor(options: {
    devices: DeviceRepository
    hub: EventHub
    logger: Logger
    libraryVersion: () => number
    /** Injectable clock, for tests. */
    now?: () => number
  }) {
    this.#devices = options.devices
    this.#hub = options.hub
    this.#logger = options.logger
    this.#libraryVersion = options.libraryVersion
    this.#now = options.now ?? Date.now
  }

  start(): void {
    this.forgetStale()
    this.#forgetting = setInterval(() => this.forgetStale(), FORGET_EVERY_MS)
    this.#forgetting.unref()

    this.#lastVersion = this.#libraryVersion()
    this.#sweep = setInterval(() => this.#sweepPresence(), SWEEP_MS)
    this.#sweep.unref()
    this.#versionWatch = setInterval(() => this.#watchVersion(), VERSION_MS)
    this.#versionWatch.unref()
  }

  stop(): void {
    if (this.#sweep) clearInterval(this.#sweep)
    if (this.#versionWatch) clearInterval(this.#versionWatch)
    if (this.#forgetting) clearInterval(this.#forgetting)
    this.#sweep = null
    this.#versionWatch = null
    this.#forgetting = null
    this.#hub.stop()
  }

  /** Forget devices not seen for a week: at boot, and every hour after. */
  forgetStale(): number {
    const forgotten = this.#devices.prune(this.#now() - FORGET_AFTER_MS)
    if (forgotten > 0) this.#logger.info('forgot stale devices', { forgotten })
    return forgotten
  }

  list(): DeviceList {
    const now = this.#now()
    return { devices: this.#devices.all(now), now }
  }

  heartbeat(heartbeat: DeviceHeartbeat): DeviceList {
    this.#devices.upsert(heartbeat, this.#now())
    const list = this.list()
    this.#hub.broadcast({ type: 'devices', ...list })
    this.#lastOnline = onlineKey(list)
    return list
  }

  /**
   * Forward a command. Returns how many live connections received it, or
   * null when no such device exists.
   */
  command(deviceId: string, command: DeviceCommand, fromDeviceId?: string): number | null {
    if (!this.#devices.byId(deviceId, this.#now())) return null
    const delivered = this.#hub.sendTo(deviceId, {
      type: 'command',
      deviceId,
      command,
      ...(fromDeviceId === undefined ? {} : { fromDeviceId }),
    })
    this.#logger.debug('command forwarded', { deviceId, type: command.type, delivered })
    return delivered
  }

  forget(deviceId: string): boolean {
    const removed = this.#devices.remove(deviceId)
    if (removed) this.#hub.broadcast({ type: 'devices', ...this.list() })
    return removed
  }

  /** A new stream: subscribe it and replay the current state so it starts correct. */
  connect(sink: EventSink, deviceId: string | null): () => void {
    const unsubscribe = this.#hub.subscribe(sink, deviceId)
    this.#hub.send(sink, { type: 'devices', ...this.list() })
    this.#hub.send(sink, { type: 'library', version: this.#libraryVersion() })
    return unsubscribe
  }

  #sweepPresence(): void {
    if (this.#hub.size === 0) return
    const list = this.list()
    const key = onlineKey(list)
    if (key === this.#lastOnline) return
    this.#lastOnline = key
    this.#hub.broadcast({ type: 'devices', ...list })
  }

  #watchVersion(): void {
    const version = this.#libraryVersion()
    if (version === this.#lastVersion) return
    this.#lastVersion = version
    this.#hub.broadcast({ type: 'library', version })
  }
}

/** The set of online device ids, as a comparable string. */
function onlineKey(list: DeviceList): string {
  return list.devices
    .filter(device => device.online)
    .map(device => device.id)
    .sort()
    .join(',')
}
