/**
 * Which covers changed, gathered onto one frame.
 *
 * Shared by offline/covers.ts and its web twin. Saying which songs changed,
 * rather than only that covers did, lets a screen render for the covers it
 * drew; otherwise one playlist tile's picture renders the whole library list.
 */
interface CoverChanges {
  /** A song's cover arrived or moved; heard with any others on the next frame. */
  readonly changed: (songId: number) => void
  /** Bumped once per frame that carried a change, so a reader can tell it missed one. */
  readonly version: () => number
  readonly subscribe: (listener: (changed: ReadonlySet<number>) => void) => () => void
}

/**
 * One screen's interest in covers, shaped for `useSyncExternalStore`: the
 * songs it has drawn, and a number that moves only when one of theirs changes.
 */
interface CoverWatch {
  /** Note a song this screen draws. Cheap enough to call from a render. */
  readonly ask: (songId: number) => void
  readonly subscribe: (onChange: () => void) => () => void
  /** The snapshot: the announcement this screen last had reason to render for. */
  readonly seen: () => number
}

export function watchCovers(changes: Pick<CoverChanges, 'subscribe' | 'version'>): CoverWatch {
  // Songs are never forgotten: a screen that memoizes on the resolver asks
  // only when it recomputes, and must still hear about the songs it asked
  // for before.
  const asked = new Set<number>()
  let seen = changes.version()
  // Where announcements stood at the first render, before anyone listened.
  const created = changes.version()
  return {
    ask: songId => {
      asked.add(songId)
    },
    subscribe: onChange => {
      const stop = changes.subscribe(changed => {
        for (const songId of changed) {
          if (!asked.has(songId)) continue
          seen = changes.version()
          onChange()
          return
        }
      })
      // A cover announced between the first render and now was heard by
      // nobody here. Which songs it named is gone, so assume ours: one render
      // too many beats a letter tile left over a cover that has arrived.
      if (changes.version() !== created) seen = changes.version()
      return stop
    },
    seen: () => seen,
  }
}

export function createCoverChanges(frameMs = 16): CoverChanges {
  let version = 0
  let pending = new Set<number>()
  let scheduled = false
  const listeners = new Set<(changed: ReadonlySet<number>) => void>()

  return {
    changed: songId => {
      pending.add(songId)
      // Thirteen covers arriving from disk at launch are otherwise thirteen
      // renders of every list, back to back.
      if (scheduled) return
      scheduled = true
      setTimeout(() => {
        scheduled = false
        const changed = pending
        pending = new Set()
        version++
        for (const listener of listeners) listener(changed)
      }, frameMs)
    },
    version: () => version,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
