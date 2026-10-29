import { extrapolatePosition, type Device } from '@selfmp3/shared'

/**
 * Turning one device's reported state into playable arguments.
 *
 * Kept pure and separate from React because the awkward cases are all data
 * cases: a queue that was never populated, a `queueIndex` that disagrees with
 * `songId` because the heartbeat caught a track change mid-flight, or a state
 * that has been sitting on a sleeping phone for an hour. Getting any of those
 * wrong means a handoff starts the wrong song, which is exactly the kind of
 * bug that is miserable to reproduce with two real devices.
 */

interface HandoffTarget {
  readonly queueIds: readonly number[]
  readonly index: number
  /** Seconds into `queueIds[index]`. */
  readonly position: number
}

/**
 * When this device got a devices list: the server's clock as the list says it
 * (`DeviceList.now`), and this device's own clock at the moment it arrived.
 *
 * The pair is what lets a reader measure time without ever subtracting one
 * device's clock from another's. Everything in a list is on the server's clock
 * — each device's `lastSeenAt` is when the server received its heartbeat —
 * and everything after the list arrived is on this device's.
 */
export interface ListHeard {
  readonly serverNow: number
  readonly receivedAt: number
}

/**
 * When `lastSeenAt` happened, on this device's clock: the time between that
 * heartbeat and the list is server minus server, and it is laid back from the
 * moment the list arrived here. Off by the list's one-way trip and nothing
 * else, however far apart the clocks are.
 */
export function heardAt(lastSeenAt: number, heard: ListHeard): number {
  return heard.receivedAt - Math.max(0, heard.serverNow - lastSeenAt)
}

/** The server's clock at `now` on this device, as of the last list. */
export function serverTime(heard: ListHeard, now: number): number {
  return heard.serverNow + (now - heard.receivedAt)
}

/**
 * What to hand to `playQueue` to continue what `device` reported.
 *
 * `songId` is the authority on *what* is playing, not `queueIndex`: the index
 * is only meaningful against the queue it was captured with. When the two
 * disagree the song wins and the index is corrected; when the song is not in
 * the queue at all the queue is discarded and the song plays alone.
 *
 * *Where* in the song is the reported position plus the time since: a device
 * captures its state as it sends a heartbeat, so that moment is `lastSeenAt`,
 * brought onto this device's clock by `heard` (see `heardAt`). `now` is this
 * device's clock.
 */
export function handoffTarget(
  device: Pick<Device, 'state' | 'lastSeenAt'>,
  heard: ListHeard,
  now: number,
): HandoffTarget | null {
  const { state } = device
  if (state.songId === null) return null

  const position = Math.max(0, extrapolatePosition(state, now, heardAt(device.lastSeenAt, heard)))
  // The index where it agrees, so a song queued twice resumes at the copy that
  // was playing rather than the first.
  const found =
    state.queueIds[state.queueIndex] === state.songId
      ? state.queueIndex
      : state.queueIds.indexOf(state.songId)

  if (found === -1) return { queueIds: [state.songId], index: 0, position }
  return { queueIds: state.queueIds, index: found, position }
}

/** "iPhone · Safari" → "iPhone". Enough to label a button without wrapping. */
export function shortDeviceName(name: string): string {
  const [first] = name.split('·')
  return (first ?? name).trim() || name
}

/**
 * What to call each device on one list, by id: short where that is enough,
 * and told apart where it is not.
 *
 * Every browser is called "Mac · Chrome" until it is renamed, and its other
 * tabs "Mac · Chrome · tab 2", so the short names alone made every row of
 * Play on… read "Mac" (R3-m2). A short name another row shares keeps its
 * browser and tab; a whole name two devices share is numbered after the
 * first by id, so every device numbers them alike.
 */
export function deviceLabels(
  devices: readonly Pick<Device, 'id' | 'name'>[],
): ReadonlyMap<string, string> {
  const short = (device: Pick<Device, 'name'>): string => shortDeviceName(device.name)
  const whole = (device: Pick<Device, 'name'>): string => device.name.trim() || device.name
  const labels = new Map<string, string>()
  for (const device of devices) {
    const shared = devices.filter(other => short(other) === short(device))
    if (shared.length === 1) {
      labels.set(device.id, short(device))
      continue
    }
    const same = shared
      .filter(other => whole(other) === whole(device))
      .map(other => other.id)
      .sort()
    const at = same.indexOf(device.id)
    labels.set(device.id, at === 0 ? whole(device) : `${whole(device)} ${at + 1}`)
  }
  return labels
}
