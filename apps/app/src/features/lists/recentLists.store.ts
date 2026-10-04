import { useEffect, useRef, useSyncExternalStore } from 'react'
import { usePlayer } from '../../player/PlayerProvider'
import { prefs } from '../../ports/prefs'
import { answerShowing } from '../smart/answers.store'
import {
  parseRecentLists,
  sourceKey,
  withListStarted,
  withListRenamed,
  withSongPlayed,
  type ListSource,
  type RecentList,
} from './lists.model'

/**
 * Recently played's lists (docs/features/lists.md, A1): what this device
 * played, kept across launches.
 *
 * On this device, like the tags it reached for last: a list is a way of
 * listening here, and the songs each list played still reach every device
 * through the server's plays. The rules are `lists.model.ts`'s.
 */

const RECENT_LISTS_KEY = 'lists.recent'

let lists: readonly RecentList[] | null = null
const listeners = new Set<() => void>()

function snapshot(): readonly RecentList[] {
  lists ??= parseRecentLists(prefs.get(RECENT_LISTS_KEY))
  return lists
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function write(next: readonly RecentList[]): void {
  if (next === snapshot()) return
  lists = next
  prefs.set(RECENT_LISTS_KEY, JSON.stringify(next))
  for (const listener of listeners) listener()
}

/** The remembered list Up next is playing now, which a Save renames. */
let playingKey: string | null = null

/**
 * What plays was saved as a playlist: its tile in Recently played is that
 * playlist from now on, so playing it again does not offer Save again.
 */
export function noteListSaved(saved: ListSource): void {
  const key = sourceKey(saved, [])
  if (playingKey === null || key === null) return
  const from = playingKey
  playingKey = key
  write(withListRenamed(snapshot(), from, key, saved))
}

export function useRecentLists(): readonly RecentList[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Keeps Recently played as things play: a list remembered as it starts, and
 * each of its songs noted as it plays, so the songs show as the list's tile
 * rather than tiles of their own. Mounted once, beside the playback memory.
 */
export function useRecordRecentLists(): void {
  const player = usePlayer()
  const source = player.source
  const original = player.queue.original
  const items = player.queue.items
  const songId = player.current?.id ?? null
  // What was last remembered as starting, so a re-render, a song added to Up
  // next or a Save that renames what plays is not taken for a new start.
  const started = useRef<{ source: unknown; original: unknown; key: string | null } | null>(null)

  useEffect(() => {
    const last = started.current
    if (last && (last.source === source || last.original === original)) {
      started.current = { ...last, source, original, key: playingKey }
      return
    }
    const songs = original.length > 0 ? original : items
    const key = source ? sourceKey(source, songs) : null
    started.current = { source, original, key }
    playingKey = key
    // An answer is kept with its own answer, so its page can open again later.
    const answer =
      source?.kind === 'answer' && source.answerId
        ? (answerShowing(source.answerId) ?? undefined)
        : undefined
    if (source && key !== null) {
      write(withListStarted(snapshot(), source, songs, Date.now(), answer))
    }
  }, [source, original, items])

  useEffect(() => {
    const key = started.current?.key ?? null
    if (key === null || songId === null) return
    write(withSongPlayed(snapshot(), key, songId, Date.now()))
  }, [source, songId])
}
