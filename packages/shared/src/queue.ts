import type { Song } from './schemas/song.js'

/**
 * Queue mechanics, as pure functions.
 *
 * Keeping this out of the React provider means every tricky ordering rule —
 * shuffle that preserves the current track, "play next" versus "add to queue",
 * restoring the original order when shuffle is turned off — can be tested
 * directly, without mounting a component or touching an audio element.
 *
 * It lives in `shared` rather than the web app because it is pure and
 * framework-free, and the native app needs exactly the same rules. Duplicating
 * them would guarantee the two clients eventually disagree about what "next"
 * means.
 */

export interface QueueState {
  /** Song ids in play order. */
  readonly items: readonly number[]
  /** Index into `items`, or -1 when nothing is loaded. */
  readonly index: number
  /** Pre-shuffle order, so turning shuffle off can restore it. */
  readonly original: readonly number[]
  readonly shuffle: boolean
  readonly repeat: 'off' | 'all' | 'one'
}

export const EMPTY_QUEUE: QueueState = {
  items: [],
  index: -1,
  original: [],
  shuffle: false,
  repeat: 'off',
}

/**
 * Fisher-Yates. Takes a random source so tests can be deterministic.
 */
export function shuffleArray<T>(input: readonly T[], random: () => number = Math.random): T[] {
  const array = [...input]
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = array[i]
    const b = array[j]
    if (a === undefined || b === undefined) continue
    array[i] = b
    array[j] = a
  }
  return array
}

/**
 * Start playing a list from a given position.
 *
 * With shuffle on, the chosen track stays first and everything else is
 * shuffled behind it — pressing shuffle on a song you just picked should play
 * *that* song, not a random one.
 */
export function playFrom(
  state: QueueState,
  songIds: readonly number[],
  startIndex: number,
  random?: () => number,
): QueueState {
  if (songIds.length === 0) return { ...state, items: [], index: -1, original: [] }

  const safeIndex = Math.max(0, Math.min(startIndex, songIds.length - 1))

  if (!state.shuffle) {
    return { ...state, items: [...songIds], index: safeIndex, original: [...songIds] }
  }

  const chosen = songIds[safeIndex]
  if (chosen === undefined) return { ...state, items: [...songIds], index: safeIndex, original: [...songIds] }

  const rest = songIds.filter((_, i) => i !== safeIndex)
  return {
    ...state,
    items: [chosen, ...shuffleArray(rest, random)],
    index: 0,
    original: [...songIds],
  }
}

/** Toggle shuffle without interrupting what is currently playing. */
export function setShuffle(state: QueueState, shuffle: boolean, random?: () => number): QueueState {
  if (shuffle === state.shuffle) return state

  const current = state.items[state.index]
  if (current === undefined) return { ...state, shuffle }

  if (shuffle) {
    const rest = state.items.filter(id => id !== current)
    return {
      ...state,
      shuffle: true,
      original: state.items.length > 0 ? [...state.items] : state.original,
      items: [current, ...shuffleArray(rest, random)],
      index: 0,
    }
  }

  // Turning shuffle off: go back to the original order, keeping the current
  // track playing rather than jumping.
  const restored = state.original.length > 0 ? [...state.original] : [...state.items]
  const restoredIndex = restored.indexOf(current)
  return {
    ...state,
    shuffle: false,
    items: restored,
    index: restoredIndex >= 0 ? restoredIndex : 0,
  }
}

/**
 * Advance the queue.
 *
 * `auto` distinguishes a track ending on its own from the user pressing next.
 * At the end of the queue with repeat off, the first stops playback and the
 * second wraps to the start — which is what both gestures mean in practice.
 */
export function advance(state: QueueState, auto: boolean): { state: QueueState; stop: boolean } {
  if (state.items.length === 0) return { state, stop: true }

  if (state.repeat === 'one' && auto) return { state, stop: false }

  const nextIndex = state.index + 1

  if (nextIndex < state.items.length) {
    return { state: { ...state, index: nextIndex }, stop: false }
  }

  if (state.repeat === 'all') return { state: { ...state, index: 0 }, stop: false }
  if (auto) return { state, stop: true }
  return { state: { ...state, index: 0 }, stop: false }
}

/** The id the engine should preload, or null at the end of the queue. */
export function peekNext(state: QueueState): number | null {
  if (state.items.length === 0) return null
  if (state.repeat === 'one') return state.items[state.index] ?? null

  const nextIndex = state.index + 1
  if (nextIndex < state.items.length) return state.items[nextIndex] ?? null
  if (state.repeat === 'all') return state.items[0] ?? null
  return null
}

export function previous(state: QueueState): QueueState {
  if (state.index <= 0) return state
  return { ...state, index: state.index - 1 }
}

/**
 * Insert directly after the current track.
 *
 * The playing track stays put even when it is among the ids: "play next" on
 * what is already playing means the rest of the selection follows it, not that
 * it starts again from a second copy of itself.
 */
export function playNext(state: QueueState, songIds: readonly number[]): QueueState {
  if (songIds.length === 0) return state

  // Remove any existing copies first so "play next" moves rather than
  // duplicates — a duplicate in a queue is almost never what was meant.
  const current = state.index < 0 ? undefined : state.items[state.index]
  const incoming = new Set(songIds)
  const inserted = songIds.filter(id => id !== current)
  if (inserted.length === 0) return state

  const filtered = state.items.filter((id, i) => i === state.index || !incoming.has(id))
  const currentIndex = current === undefined ? -1 : filtered.indexOf(current)
  const at = currentIndex + 1

  return {
    ...state,
    items: [...filtered.slice(0, at), ...inserted, ...filtered.slice(at)],
    original: withOriginal(state, inserted),
    index: currentIndex < 0 ? state.index : currentIndex,
  }
}

/** Append to the end of the queue. */
export function enqueue(state: QueueState, songIds: readonly number[]): QueueState {
  if (songIds.length === 0) return state
  const existing = new Set(state.items)
  const fresh = songIds.filter(id => !existing.has(id))
  if (fresh.length === 0) return state
  return { ...state, items: [...state.items, ...fresh], original: withOriginal(state, fresh) }
}

/** Remove one entry, keeping the currently playing track pointed at correctly. */
export function removeAt(state: QueueState, position: number): QueueState {
  if (position < 0 || position >= state.items.length) return state

  const gone = state.items[position]
  const items = state.items.filter((_, i) => i !== position)
  let index = state.index

  if (position < state.index) index -= 1
  else if (position === state.index) index = Math.min(state.index, items.length - 1)

  return { ...state, items, original: state.original.filter(id => id !== gone), index }
}

/**
 * `original` with these ids appended.
 *
 * Every queue edit has to reach `original` as well as `items`, because turning
 * shuffle off replays `original` wholesale. Leave it behind and the two drift:
 * a song added while shuffled disappears the moment shuffle goes off, and one
 * removed while shuffled comes back.
 */
function withOriginal(state: QueueState, added: readonly number[]): readonly number[] {
  if (state.original.length === 0) return state.original
  const existing = new Set(state.original)
  const fresh = added.filter(id => !existing.has(id))
  return fresh.length === 0 ? state.original : [...state.original, ...fresh]
}

/** Drag-and-drop reordering. */
export function moveItem(state: QueueState, from: number, to: number): QueueState {
  if (from === to) return state
  if (from < 0 || from >= state.items.length) return state

  const items = [...state.items]
  const [moved] = items.splice(from, 1)
  if (moved === undefined) return state

  const target = Math.max(0, Math.min(to, items.length))
  items.splice(target, 0, moved)

  // Follow the currently playing track to its new position.
  const current = state.items[state.index]
  const index = current === undefined ? state.index : items.indexOf(current)

  return { ...state, items, index }
}

export function cycleRepeat(mode: QueueState['repeat']): QueueState['repeat'] {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'
}

/** Resolve queue ids back to song objects, skipping any that vanished. */
export function resolveQueue(
  state: QueueState,
  byId: ReadonlyMap<number, Song>,
): { songs: Song[]; current: Song | null } {
  const songs: Song[] = []
  for (const id of state.items) {
    const song = byId.get(id)
    if (song) songs.push(song)
  }
  const currentId = state.items[state.index]
  return { songs, current: currentId === undefined ? null : (byId.get(currentId) ?? null) }
}
