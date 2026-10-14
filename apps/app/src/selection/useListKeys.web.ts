import { useCallback, useEffect, useId, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

import type { useListKeys as SameShape } from './useListKeys'
import { isComposing } from '../shell/composing'
import { focusOwnsKey, SONG_ROW, songRowOf } from '../shell/keyOwner'
import { layerOpen } from '../shell/layers'
import { setTabbing, tabbing } from '../shell/tabbing'

/** What the list's keys do, as the hook's other half declares it. */
type ListKeyActions = Parameters<typeof SameShape>[0]

/** See `useListKeys.ts`: here a row is a button the keyboard moves between. */
export const LIST_ROWS_TAKE_KEYS = true

/** The row's press target, which the arrows move focus to: `dataSet={{ rowPress }}`. */
const ROW_PRESS = 'data-row-press'
/** The row's song: `dataSet={{ songId }}`. */
const SONG_ID = 'data-song-id'

/**
 * A song list's keys in a browser and the installed app.
 *
 * One listener on the window, in the capture phase, so it answers before the
 * row's own button: React Native for web's buttons take Space and Enter
 * themselves, and Space reaching the row's button would play the song.
 *
 * - **↑ ↓** on a row (any focus on it, a click's included) move to the row
 *   above or below and show the ring, since the keyboard is now moving focus.
 * - **Space** on a row the keyboard is on ticks it, as its circle does. The
 *   page's play and pause stands aside there (`rowOwnsKey`); after a click,
 *   with no ring, Space still pauses.
 * - **⌘A** selects every song in the list — but not from a text field, where it
 *   selects the words, nor under an open sheet, menu or dialog.
 *
 * Only while this list's page is the one in front (`useFocusEffect`): a page
 * pushed over Library leaves Library mounted underneath, and ⌘A there must
 * not select Library's songs.
 */
export function useListKeys(actions: ListKeyActions): string {
  const listKey = useId()
  const latest = useRef(actions)
  useEffect(() => {
    latest.current = actions
  })

  useFocusEffect(
    useCallback(() => {
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.defaultPrevented || isComposing(event) || event.altKey) return

        if (event.metaKey || event.ctrlKey) {
          // Either one: ⌘ is a Mac's, Ctrl everyone else's, and neither means
          // anything else to a page that is not a text field.
          if (event.metaKey === event.ctrlKey || event.shiftKey) return
          if (event.key.toLowerCase() !== 'a') return
          if (focusOwnsKey(event.target, { typing: true }) || layerOpen()) return
          if (latest.current.selectAll()) event.preventDefault()
          return
        }

        if (event.shiftKey) return
        const key = event.key
        if (key !== ' ' && key !== 'ArrowDown' && key !== 'ArrowUp') return
        const row = songRowOf(event.target)
        if (!row || row.getAttribute(SONG_ROW) !== listKey) return

        if (key === ' ') {
          if (!tabbing()) return
          event.preventDefault()
          event.stopPropagation()
          // A held Space would tick and untick as fast as the keyboard repeats.
          if (event.repeat) return
          const songId = Number(row.getAttribute(SONG_ID))
          if (Number.isFinite(songId)) latest.current.toggle(songId)
          return
        }

        event.preventDefault()
        event.stopPropagation()
        const next = neighbour(row, listKey, key === 'ArrowDown' ? 1 : -1)
        const target = next?.querySelector<HTMLElement>(`[${ROW_PRESS}]`)
        if (!next || !target) return
        setTabbing(true)
        target.focus({ preventScroll: true })
        bringIntoView(next)
      }
      window.addEventListener('keydown', onKeyDown, true)
      return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [listKey]),
  )

  return listKey
}

/**
 * The row `step` rows from `row`, in the list's order, or null at either end.
 * The list draws its rows in order and only some of them — a screenful or
 * several either side of where it is scrolled to — so the row next to a
 * focused one is always drawn, and scrolling it into view draws the ones past
 * it.
 */
function neighbour(row: HTMLElement, listKey: string, step: 1 | -1): HTMLElement | null {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[${SONG_ROW}]`)).filter(
    each => each.getAttribute(SONG_ROW) === listKey,
  )
  const at = rows.indexOf(row)
  return (at === -1 ? undefined : rows[at + step]) ?? null
}

/**
 * Scroll the list just far enough to show `row`, and out from under the
 * selection bar where the bar stays at the top of the list (`SongList`'s
 * `pinned`): the browser's own scrolling counts a row under a sticky bar as
 * shown. What covers the row's top edge, if anything, is that bar's header.
 */
function bringIntoView(row: HTMLElement): void {
  row.scrollIntoView?.({ block: 'nearest' })
  if (typeof document.elementFromPoint !== 'function') return
  const box = row.getBoundingClientRect()
  const over = document.elementFromPoint(box.left + box.width / 2, box.top + 1)
  if (!over || row.contains(over)) return
  // The outermost thing covering it that is not one of the row's own boxes.
  let cover: Element = over
  while (cover.parentElement && !cover.parentElement.contains(row)) cover = cover.parentElement
  const overlap = cover.getBoundingClientRect().bottom - box.top
  if (overlap > 0) scrollerOf(row)?.scrollBy({ top: -overlap })
}

/** The nearest box above `element` that scrolls up and down. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight)
      return at
  }
  return null
}
