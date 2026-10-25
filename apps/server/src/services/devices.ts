import {
  DAY_MS,
  playbackStateChanged,
  sharedQueue,
  type DeviceCommand,
  type DeviceHeartbeat,
  type DeviceList,
} from '@selfmp3/shared'
import type { DeviceRepository } from '../repositories/devices.js'
import type { Logger } from '../logger.js'
import type { EventHub, EventSink } from './events.js'

/**
 * Presence and handoff.
 *
 * Heartbeats go straight to the table and out to every stream. Beyond that
 * the service runs two small timers: a presence sweep, so a device that
 * simply closed its tab flips to offline on everyone else's screen without
 * anyone having to send anything; and, while any stream is open, a
 * library-version watch, so a change made from the server shows up on the
 * phone without a refetch on focus.
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
const FORGET_AFTER_MS = 7 * DAY_MS
/** How often to look for devices to forget, besides at boot. */
const FORGET_EVERY_MS = 60 * 60 * 1000
/**
 * The most devices kept: the least recently seen go past this. Nothing else
 * bounded the list, and every listing goes to every stream — a flood of
 * made-up ids made each heartbeat's answer megabytes. A household has a few.
 */
export const MAX_DEVICES = 50
/**
 * A heartbeat that changes nothing anyone would act on — the same song, still
 * playing, at the position the clock says — goes to the other streams at most
 * this often. Each device beats every ten seconds; telling every stream every
 * time was most of what the streams carried.
 */
export const QUIET_BROADCAST_MS = 60_000

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
  /** When each device's state last went out to the streams. */
  readonly #lastTold = new Map<string, number>()
  #lastVersion = -1
  #started = false

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

    this.#sweep = setInterval(() => this.#sweepPresence(), SWEEP_MS)
    this.#sweep.unref()
    this.#started = true
  }

  stop(): void {
    this.#started = false
    if (this.#sweep) clearInterval(this.#sweep)
    if (this.#forgetting) clearInterval(this.#forgetting)
    this.#sweep = null
    this.#forgetting = null
    this.#stopVersionWatch()
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
    const now = this.#now()
    const before = this.#devices.byId(heartbeat.deviceId, now)
    const state = sharedQueue(heartbeat.state)
    this.#devices.upsert({ ...heartbeat, state }, now)
    if (!before && this.#devices.keepNewest(MAX_DEVICES) > 0) {
      this.#logger.info('forgot the least recently seen devices', { kept: MAX_DEVICES })
    }
    const list = this.list()
    const news =
      !before ||
      !before.online ||
      before.name !== heartbeat.name ||
      before.kind !== heartbeat.kind ||
      playbackStateChanged(before.state, state) ||
      now - (this.#lastTold.get(heartbeat.deviceId) ?? 0) >= QUIET_BROADCAST_MS
    if (this.#lastTold.size > MAX_DEVICES) {
      const kept = new Set(list.devices.map(device => device.id))
      for (const id of this.#lastTold.keys()) if (!kept.has(id)) this.#lastTold.delete(id)
    }
    if (news) {
      this.#lastTold.set(heartbeat.deviceId, now)
      this.#hub.broadcast({ type: 'devices', ...list })
      this.#lastOnline = onlineKey(list)
    }
    return list
  }

  /**
   * Forward a command. Returns how many live connections received it, or
   * null when no such device exists.
   */
  command(deviceId: string, command: DeviceCommand): number | null {
    if (!this.#devices.byId(deviceId, this.#now())) return null
    const delivered = this.#hub.sendTo(deviceId, { type: 'command', deviceId, command })
    this.#logger.debug('command forwarded', { deviceId, type: command.type, delivered })
    return delivered
  }

  forget(deviceId: string): boolean {
    this.#lastTold.delete(deviceId)
    const removed = this.#devices.remove(deviceId)
    if (removed) this.#hub.broadcast({ type: 'devices', ...this.list() })
    return removed
  }

  /**
   * A new stream: subscribe it and replay the current state so it starts
   * correct. The version watch runs only while some stream is open — with
   * none, there is nobody to tell, and the next to open is sent the version
   * here.
   */
  connect(sink: EventSink, deviceId: string | null): () => void {
    const unsubscribe = this.#hub.subscribe(sink, deviceId)
    this.#hub.send(sink, { type: 'devices', ...this.list() })
    const version = this.#libraryVersion()
    this.#hub.send(sink, { type: 'library', version })
    if (this.#started && !this.#versionWatch) {
      this.#lastVersion = version
      this.#versionWatch = setInterval(() => this.#watchVersion(), VERSION_MS)
      this.#versionWatch.unref()
    }
    return () => {
      unsubscribe()
      if (this.#hub.size === 0) this.#stopVersionWatch()
    }
  }

  #stopVersionWatch(): void {
    if (this.#versionWatch) clearInterval(this.#versionWatch)
    this.#versionWatch = null
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
