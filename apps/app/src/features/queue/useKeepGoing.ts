import { useEffect, useRef } from 'react'
import { packedVector, type QueueState } from '@selfmp3/shared'
import { useLibrary } from '@selfmp3/client'
import { library as cloudLibrary, session as cloudSession } from '../../replica'
import { usePlayer } from '../../player/PlayerProvider'
import { useRoom } from '../room/room.store'
import { keepGoingDue, keepGoingSongs } from './keepGoing.model'
import { useKeepGoingOn } from './keepGoingPref'

/**
 * Keep going, at work (docs/features/lists.md): while it is on and the song
 * playing is the last in Up next, songs that sound like the last few are
 * added after it, two at a time, so the music carries on and Auto-mix has a
 * next song to fade into. Never in a room, whose own Autoplay keeps its list.
 */
export function useKeepGoing(): void {
  const on = useKeepGoingOn()
  const { queue, isPlaying, addToQueue } = usePlayer()
  const inRoom = useRoom().state !== null
  const { data: library } = useLibrary()
  const queueNow = useRef(queue)
  useEffect(() => {
    queueNow.current = queue
  }, [queue])
  const askedFor = useRef<QueueState | null>(null)

  useEffect(() => {
    if (!on || inRoom || !library) return
    if (!keepGoingDue(queue, isPlaying) || askedFor.current === queue) return
    askedFor.current = queue
    void (async () => {
      const vectorOf = await soundOnThisDevice().catch(() => NO_SOUND)
      const picks = keepGoingSongs({ queue, songs: library.songs, vectorOf })
      // Onto the Up next it was asked for: a Play meanwhile is a list of its own.
      if (picks.length > 0 && queueNow.current === queue) addToQueue(picks)
    })()
  }, [on, inRoom, library, queue, isPlaying, addToQueue])
}

const NO_SOUND = (): Int8Array | null => null

/** Each pack's vectors as the room packs them, by song id, made once per pack. */
const packedByPack = new WeakMap<object, Map<number, Int8Array | null>>()

/**
 * How this device's songs sound, from the bucket's sound pack beside its copy
 * of the library: what a room's Autoplay ranks your songs by. Nothing where
 * there is no pack, and Keep going then picks in no particular order, as the
 * room does.
 */
async function soundOnThisDevice(): Promise<(songId: number) => Int8Array | null> {
  const session = await cloudSession.loadSession()
  const pack = session ? await cloudLibrary.cloudSoundVectors(session) : null
  if (!pack) return NO_SOUND
  const packed = packedByPack.get(pack) ?? new Map<number, Int8Array | null>()
  packedByPack.set(pack, packed)
  return songId => {
    const known = packed.get(songId)
    if (known !== undefined) return known
    const key = cloudLibrary.cloudAudioKeyNow(songId)
    const vector = key ? pack.vectors.get(key) : undefined
    const out = vector ? packedVector(vector) : null
    packed.set(songId, out)
    return out
  }
}
