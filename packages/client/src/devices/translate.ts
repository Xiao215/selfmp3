import type { DeviceCommand, PlaybackState } from '@selfmp3/shared'

/**
 * Song ids, translated at the edge of the devices wire.
 *
 * Presence and handoff travel through the server: a heartbeat carries what
 * this device is playing, and a command carries what another device should
 * play. Both are song *ids*, and a device signed in to the cloud numbers songs
 * its own way — its copy of the library hands out ids as uids arrive from the
 * bucket, so the same song is 47 on a phone, 812 on the server and 3 on a
 * laptop that synced in a different order.
 *
 * **The server's numbering is the one the wire speaks.** A cloud device
 * translates on the way out and back again through `/api/cloud/uids`
 * (connection/serverIds.ts), and a device talking to its own server needs no
 * translation at all. That is what makes two cloud devices agree without
 * either knowing the other exists: both translate through the same third
 * numbering, so a uid that means one song here means that song there.
 *
 * ## The rule that matters
 *
 * **A song that cannot be translated is never guessed at.** Landing on the
 * wrong song is a silent failure — the handoff works, the music plays, and it
 * is the wrong music — and it is exactly what happens if an untranslatable id
 * is passed through, or if a missing entry falls back to "position 0 of the
 * queue". So:
 *
 * - A state whose song has no translation is blanked: the device is still
 *   there, still online, and simply cannot say what it is playing.
 * - A command whose song has no translation is refused outright — `null`, and
 *   the caller sends or executes nothing.
 * - A queue entry with no translation is dropped, and the index is carried
 *   across positionally rather than recomputed, so a queue with a duplicate
 *   song still points at the copy it pointed at.
 *
 * Not-ready is the same as not-translatable: `songIds` answers `undefined` for
 * everything until both lists are in, so nothing goes out in the meantime.
 */

/**
 * One library's number for a song in the other's numbering, or nothing when
 * that song is not in both.
 *
 * `null` means there is nothing to translate — this device and the wire
 * already number songs the same way — and everything below then passes its
 * argument straight through.
 */
export type SongIdMap = ((songId: number) => number | undefined) | null

/** A state with nothing anyone can act on, which is what a blanked one is. */
function unnamed(state: PlaybackState): PlaybackState {
  return { ...state, songId: null, queueIds: [], queueIndex: -1 }
}

/**
 * A playback state in the other library's numbering.
 *
 * `playing`, `position` and the rest are numbers about this device, not about
 * any song, so they cross unchanged: a device playing something the other
 * library has never heard of is still a device that is playing.
 */
export function translateState(state: PlaybackState, into: SongIdMap): PlaybackState {
  if (into === null) return state
  if (state.songId === null) return unnamed(state)

  const songId = into(state.songId)
  if (songId === undefined) return unnamed(state)

  const queueIds: number[] = []
  let queueIndex = -1
  for (const [position, id] of state.queueIds.entries()) {
    const there = into(id)
    if (there === undefined) continue
    if (position === state.queueIndex) queueIndex = queueIds.length
    queueIds.push(there)
  }

  return { ...state, songId, queueIds, queueIndex }
}

/**
 * A command in the other library's numbering, or `null` when it cannot be
 * expressed there and must not be sent or obeyed.
 *
 * Only `playSong` carries a song. `transfer` carries a device id, and the
 * state it goes on to read has already been translated by the time it is read.
 */
export function translateCommand(command: DeviceCommand, into: SongIdMap): DeviceCommand | null {
  if (into === null) return command
  if (command.type !== 'playSong') return command

  const songId = into(command.songId)
  if (songId === undefined) return null

  if (command.queueIds === undefined) return { ...command, songId }

  const queueIds: number[] = []
  let queueIndex: number | undefined
  for (const [position, id] of command.queueIds.entries()) {
    const there = into(id)
    if (there === undefined) continue
    if (position === command.queueIndex) queueIndex = queueIds.length
    queueIds.push(there)
  }

  /*
   * The index is dropped rather than sent as something that fits the schema
   * but points elsewhere: it is optional, and the executor falls back to
   * finding `songId` in the queue — which is the authority anyway. Deleting it
   * off the copy rather than rebuilding the command by hand keeps any field
   * added to the schema later travelling by default.
   */
  const translated = { ...command, songId, queueIds }
  delete translated.queueIndex
  if (queueIndex !== undefined) translated.queueIndex = queueIndex
  return translated
}
