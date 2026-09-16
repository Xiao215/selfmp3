import type { QueueState } from '@selfmp3/shared'

/**
 * What this device was playing, kept so that opening the app again — a browser
 * refresh, or a phone app started fresh — comes back to the same song, paused
 * where it was, instead of "Nothing playing".
 *
 * Other devices' playback comes back through the resume toast; this is this
 * device's own, kept on the device (the prefs port), never on the server. The
 * Now Playing address names the song too (`/now-playing?song=13`), so a link
 * copied from the address bar opens on it.
 */

export const SESSION_KEY = 'player.session'

interface SavedSession {
  readonly queueIds: readonly number[]
  readonly index: number
  /** Seconds into the song at `index`. */
  readonly position: number
  readonly savedAt: number
}

interface LaunchPlayback {
  readonly queueIds: readonly number[]
  readonly index: number
  readonly position: number
}

export function sessionFromQueue(
  queue: QueueState,
  position: number,
  now: number,
): SavedSession | null {
  if (queue.index < 0 || queue.index >= queue.items.length) return null
  return {
    queueIds: [...queue.items],
    index: queue.index,
    position: Math.max(0, position),
    savedAt: now,
  }
}

/** A saved session, or null for anything missing, old-shaped or out of range. */
export function parseSession(raw: string | null): SavedSession | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof SavedSession, unknown>>
    const ids = value.queueIds
    if (!Array.isArray(ids) || ids.length === 0) return null
    if (!ids.every((id): id is number => Number.isInteger(id) && (id as number) > 0)) return null
    const index = value.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= ids.length)
      return null
    const position = typeof value.position === 'number' ? Math.max(0, value.position) : 0
    const savedAt = typeof value.savedAt === 'number' ? value.savedAt : 0
    return { queueIds: ids, index, position, savedAt }
  } catch {
    return null
  }
}

/**
 * What to load, paused, when the app opens.
 *
 * The saved session, trimmed to songs still in the library, while its song is
 * still there. An address naming another song wins, and loads that song on its
 * own from the start: a link opened is asking for that song. Null when there is
 * nothing to come back to.
 */
export function launchPlayback(
  saved: SavedSession | null,
  addressSong: unknown,
  known: ReadonlySet<number>,
): LaunchPlayback | null {
  const named =
    typeof addressSong === 'string' && /^\d+$/.test(addressSong) && known.has(Number(addressSong))
      ? Number(addressSong)
      : null

  const current = saved?.queueIds[saved.index]
  if (
    saved &&
    current !== undefined &&
    known.has(current) &&
    (named === null || named === current)
  ) {
    // Counted rather than found: a song can be in the queue twice.
    const index = saved.queueIds.slice(0, saved.index).filter(id => known.has(id)).length
    return {
      queueIds: saved.queueIds.filter(id => known.has(id)),
      index,
      position: saved.position,
    }
  }
  return named === null ? null : { queueIds: [named], index: 0, position: 0 }
}
