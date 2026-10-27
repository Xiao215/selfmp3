import { useCallback, useEffect, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

import { registerKey } from '../shell/keyRegistry'
import { layerOpen } from '../shell/layers'

/** What a list's keys do to its songs. */
interface ListKeyActions {
  /** Space on a row the keyboard is on: tick or untick that song. */
  readonly toggle: (songId: number) => void
  /** ⌘A or Ctrl+A: select every song in the list. False when there is none to select. */
  readonly selectAll: () => boolean
  /**
   * Tab coming back to a row the list no longer draws: scroll the list to that
   * song, so that it draws the row. False when the song is not in the list
   * any more (removed, filtered out), or the list cannot scroll to it.
   */
  readonly reveal: (songId: number) => boolean
  /**
   * Whether `songId` is the list's last song (`step` 1) or its first (-1): an
   * arrow past it is the page's, to go on to what is beyond the list — the
   * Ask under a search's one song (R2-m13).
   */
  readonly endsAt: (songId: number, step: 1 | -1) => boolean
}

/**
 * Whether a list's arrows, Space and Enter work here: rows the keyboard moves
 * between. Only on the web, where a row is a focusable button; Settings lists
 * those keys only where they work.
 */
export const LIST_ROWS_TAKE_KEYS = false

/**
 * A song list's keys. On a computer the list is one Tab stop, ↑ and ↓ move
 * between rows and ← and → along a row's controls, Space ticks the row the
 * keyboard is on, ⇧F10 opens its menu and ⌘A selects every song
 * (`useListKeys.web.ts`).
 *
 * On an iPad or an iPhone with a hardware keyboard, ⌘A alone: a row there is no
 * place the keyboard can be, so there is no row for the arrows to move to or
 * for Space to tick. ⌘A is a key command (`keyRegistry`) while this list's page
 * is the one in front, not while a field is being typed in (where it selects
 * the words) nor under an open sheet, menu or dialog. Escape is the
 * selection's (`useSelection`).
 *
 * What it returns is the list's name, which each row carries (`SongRow`'s
 * `listKey`) so the web's keys find their own rows; here there is none.
 */
export function useListKeys(actions: ListKeyActions): string | undefined {
  const latest = useRef(actions)
  useEffect(() => {
    latest.current = actions
  })

  useFocusEffect(
    useCallback(
      () =>
        registerKey({
          combination: 'meta+a',
          title: 'Select all songs',
          whileTyping: false,
          run: () => !layerOpen() && latest.current.selectAll(),
        }),
      [],
    ),
  )

  return undefined
}
