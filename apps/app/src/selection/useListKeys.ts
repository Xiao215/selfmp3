/** What a list's keys do to its songs. */
interface ListKeyActions {
  /** Space on a row the keyboard is on: tick or untick that song. */
  readonly toggle: (songId: number) => void
  /** ⌘A or Ctrl+A: select every song in the list. False when there is none to select. */
  readonly selectAll: () => boolean
}

/**
 * A song list's keys, on a computer: the list is one Tab stop, ↑ and ↓ move
 * between rows and ← and → along a row's controls, Space ticks the row the
 * keyboard is on, ⇧F10 opens its menu, ⌘A selects every song. Enter on a row
 * is its press, which the row's button already answers; Escape is the
 * selection's (`useSelection`).
 *
 * A phone has no keyboard to speak of, so here this does nothing and names no
 * list; the browser's half is `useListKeys.web.ts`. What it returns is the
 * list's name, which each row carries (`SongRow`'s `listKey`) so the keys find
 * their own rows and no other list's.
 */
export function useListKeys(_actions: ListKeyActions): string | undefined {
  return undefined
}
