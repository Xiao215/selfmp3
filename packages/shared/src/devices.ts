import type { Device, PlaybackState } from './schemas/devices.js'

/**
 * Pure rules for presence and resume, shared by the server (which stamps
 * `online` on every listing) and the client (which decides what to offer
 * when the app opens).
 */

/** A device is online if it has heartbeated this recently. */
export const DEVICE_ONLINE_MS = 30_000

/** Clients heartbeat this often while open; a change in state sends one early. */
export const DEVICE_HEARTBEAT_MS = 10_000

/** A state older than this is not worth offering to resume. */
export const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function isDeviceOnline(
  lastSeenAt: number,
  now: number,
  windowMs = DEVICE_ONLINE_MS,
): boolean {
  const age = now - lastSeenAt
  // A heartbeat from the "future" is a clock skew, not a ghost; treat it as fresh.
  return age <= windowMs
}

/**
 * Which device's state to offer on launch.
 *
 * The freshest state that actually has a song wins, preferring a device that
 * was *playing* over one that merely had something loaded — if the phone was
 * paused on song A an hour ago and the Mac is playing song B now, B is what
 * you want to continue. This device's own state is skipped: the local queue
 * is already restored from localStorage, so offering it back is noise.
 */
export function pickResumeState(
  devices: readonly Device[],
  options: { readonly thisDeviceId: string; readonly now: number; readonly maxAgeMs?: number },
): Device | null {
  const maxAge = options.maxAgeMs ?? RESUME_MAX_AGE_MS
  let best: Device | null = null

  for (const device of devices) {
    if (device.id === options.thisDeviceId) continue
    if (device.state.songId === null) continue
    if (options.now - device.lastSeenAt > maxAge) continue

    if (best === null || resumeRank(device) > resumeRank(best)) best = device
  }

  return best
}

/** Playing beats paused; within that, most recently seen wins. */
function resumeRank(device: Device): number {
  return (device.state.playing ? 1e15 : 0) + device.lastSeenAt
}

/**
 * The position a device is at *now*, extrapolated from its last heartbeat.
 * A remote device reports every ten seconds; without this the remote-control
 * scrubber would jump in ten-second steps.
 *
 * `since` is when `state` was observed, and has to be on the same clock as
 * `now`. It defaults to the device's own `updatedAt`, which is right only when
 * `now` comes from that same device: a reader watching *another* device is
 * otherwise subtracting that device's clock from its own, and two clocks a few
 * seconds apart is ordinary. Such a reader should pass the moment it received
 * the heartbeat, by its own clock.
 */
export function extrapolatePosition(
  state: PlaybackState,
  now: number,
  duration?: number,
  since: number = state.updatedAt,
): number {
  if (!state.playing) return state.position
  const elapsed = Math.max(0, (now - since) / 1000)
  const position = state.position + elapsed
  return duration !== undefined && duration > 0 ? Math.min(position, duration) : position
}

/**
 * True when `b` differs from `a` in a way other devices should hear about now
 * rather than at the next scheduled heartbeat.
 *
 * The point of this is to let a client re-check on every render and send only
 * when something real happened — a play, a pause, a track change, a seek —
 * without maintaining a list of fields by hand somewhere else.
 */
export function playbackStateChanged(a: PlaybackState | null, b: PlaybackState): boolean {
  if (a === null) return true
  if (
    a.songId !== b.songId ||
    a.playing !== b.playing ||
    a.queueIndex !== b.queueIndex ||
    a.shuffle !== b.shuffle ||
    a.repeat !== b.repeat ||
    a.queueIds.length !== b.queueIds.length
  ) {
    return true
  }

  // A seek is the position moving by more than the time that actually passed.
  // Only meaningful while playing: a paused position does not move on its own,
  // so comparing it against elapsed wall-clock would report a "seek" every
  // couple of seconds that nothing at all was happening.
  const expected = b.playing ? (b.updatedAt - a.updatedAt) / 1000 : 0
  return Math.abs(b.position - a.position - expected) > 2
}
