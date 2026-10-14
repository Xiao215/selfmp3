import { useCallback, useEffect, useId, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

import type { useListKeys as SameShape } from './useListKeys'
import { isComposing } from '../shell/composing'
import { focusOwnsKey } from '../shell/keyOwner'
import { layerOpen } from '../shell/layers'
import { setTabbing, tabbing } from '../shell/tabbing'
import {
  bringIntoView,
  controlsOf,
  entryRow,
  listRowOf,
  lostFocus,
  neighbour,
  nothingFocused,
  placeStop,
  pressOf,
  ROW_MORE,
  songOf,
} from './listRows'

/** What the list's keys do, as the hook's other half declares it. */
type ListKeyActions = Parameters<typeof SameShape>[0]

/** See `useListKeys.ts`: here a row is a button the keyboard moves between. */
export const LIST_ROWS_TAKE_KEYS = true

/**
 * How long an arrow waits for the list to draw the row it moves to, in
 * frames: half a second, longer than a list takes to draw the next batch
 * of rows, and short enough that a press at the end of the list is forgotten
 * before the next one.
 */
const RETRY_FRAMES = 30

/**
 * A song list's keys in a browser and the installed app.
 *
 * The list is one Tab stop, as a grid is (WAI-ARIA's roving tabindex): every
 * control in every row is out of Tab's way (`SongRow` renders them at
 * `tabIndex` -1), and one row's press target is put back in it.
 *
 * - **Tab** comes into the list on the row the keyboard or a click was last
 *   on, or the first row in view (`entryRow`), and from anywhere in a row
 *   goes on past the list; Shift+Tab the same, backwards.
 * - **↑ ↓** on a row (any focus on it, a click's included) move to the row
 *   above or below and show the ring, since the keyboard is now moving focus.
 * - **← →** move between a row's own controls: its circle, ▶, the row
 *   itself, its tags and +, its ⋯ (`controlsOf`).
 * - **Space** on a row the keyboard is on ticks it, as its circle does. The
 *   page's play and pause stands aside there (`rowOwnsKey`); after a click,
 *   with no ring, Space still pauses.
 * - **⇧F10** opens the row's menu from its ⋯, as a right-click does at the
 *   pointer. A keyboard's menu key is a right-click already.
 * - **⌘A** selects every song in the list — but not from a text field, where it
 *   selects the words, nor under an open sheet, menu or dialog.
 *
 * One listener on the window, in the capture phase, so it answers before the
 * row's own button: React Native for web's buttons take Space and Enter
 * themselves, and Space reaching the row's button would play the song.
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
  useEffect(() => () => void lostFocus.delete(listKey), [listKey])

  /** The song whose row the keyboard or a click was last on: where Tab comes back in. */
  const active = useRef<number | null>(null)

  useFocusEffect(
    useCallback(() => {
      /** A move waiting for the list to draw the row it goes to. */
      let pending = 0
      /** Focus the row `step` from `row`, if it is drawn. */
      const moveFrom = (row: HTMLElement, step: 1 | -1): boolean => {
        const next = neighbour(row, listKey, step)
        const target = next ? pressOf(next) : null
        if (!next || !target) return false
        target.focus({ preventScroll: true })
        bringIntoView(next)
        return true
      }

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

        const key = event.key
        if (key === 'Tab') {
          onTab(event)
          return
        }

        const row = listRowOf(event.target, listKey)
        if (!row) {
          // The focused row scrolled away and took focus with it: the arrows
          // pick up from the first row in view.
          if ((key === 'ArrowDown' || key === 'ArrowUp') && !event.shiftKey) {
            if (!lostFocus.has(listKey) || !nothingFocused()) return
            const landing = entryRow(listKey, null)
            const target = landing ? pressOf(landing) : null
            if (!landing || !target) return
            event.preventDefault()
            setTabbing(true)
            target.focus({ preventScroll: true })
            bringIntoView(landing)
          }
          return
        }

        if (event.shiftKey) {
          if (key !== 'F10') return
          const more = row.querySelector<HTMLElement>(`[${ROW_MORE}]`)
          if (!more) return
          event.preventDefault()
          event.stopPropagation()
          more.click()
          return
        }

        if (key === ' ') {
          if (!tabbing()) return
          event.preventDefault()
          event.stopPropagation()
          // A held Space would tick and untick as fast as the keyboard repeats.
          if (event.repeat) return
          const songId = songOf(row)
          if (songId !== null) latest.current.toggle(songId)
          return
        }

        if (key === 'Enter') {
          // The control is the browser's to press. One that goes as it is
          // pressed (a row's ▶, gone once its song plays) would take focus
          // with it, to nothing: the row has it back instead.
          const control = event.target instanceof HTMLElement ? event.target : null
          if (!control || control === pressOf(row)) return
          setTimeout(() => {
            if (control.isConnected || !nothingFocused() || !row.isConnected) return
            pressOf(row)?.focus({ preventScroll: true })
          })
          return
        }

        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          event.preventDefault()
          event.stopPropagation()
          // From the control that has focus, or the row's own target when
          // focus is on something in the row that is not one.
          const controls = controlsOf(row)
          const at = controls.findIndex(control => control === event.target)
          const from = at === -1 ? controls.findIndex(control => control === pressOf(row)) : at
          const next = controls[from + (key === 'ArrowRight' ? 1 : -1)]
          if (from === -1 || !next) return
          setTabbing(true)
          next.focus({ preventScroll: true })
          return
        }

        if (key !== 'ArrowDown' && key !== 'ArrowUp') return
        event.preventDefault()
        event.stopPropagation()
        setTabbing(true)
        const step = key === 'ArrowDown' ? 1 : -1
        if (moveFrom(row, step)) return
        // The row is the last one drawn — scrolled to after the list drew
        // around where it was, or at the end. Brought into view, the list
        // draws the rows past it; then the move is made, or there is none.
        bringIntoView(row)
        let frames = 0
        const retry = (): void => {
          pending = 0
          if (document.activeElement !== event.target || moveFrom(row, step)) return
          if ((frames += 1) < RETRY_FRAMES) pending = requestAnimationFrame(retry)
        }
        cancelAnimationFrame(pending)
        pending = requestAnimationFrame(retry)
      }

      /*
       * Tab is the browser's to move: this only says which of the list's rows
       * it may land on, just before it does. From inside the list, none, so it
       * goes on past the list rather than to the row's own target; the row it
       * left is the stop again once it has gone. From outside, the row it
       * should come in on, and once there, out from under a pinned bar.
       */
      const onTab = (event: KeyboardEvent): void => {
        const inside = listRowOf(event.target, listKey) !== null
        placeStop(listKey, inside ? null : entryRow(listKey, active.current))
        setTimeout(() => {
          if (inside) {
            placeStop(listKey, entryRow(listKey, active.current))
            return
          }
          const arrived = listRowOf(document.activeElement, listKey)
          if (arrived) bringIntoView(arrived)
        })
      }

      const onFocusIn = (event: FocusEvent): void => {
        const row = listRowOf(event.target, listKey)
        if (row) active.current = songOf(row)
        // Focus is somewhere, so a row that lost it no longer gets it back.
        lostFocus.delete(listKey)
      }
      const onPointerDown = (): void => void lostFocus.delete(listKey)

      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('focusin', onFocusIn, true)
      window.addEventListener('pointerdown', onPointerDown, true)
      return () => {
        cancelAnimationFrame(pending)
        window.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('focusin', onFocusIn, true)
        window.removeEventListener('pointerdown', onPointerDown, true)
        // A page behind another keeps no stop of its own.
        placeStop(listKey, null)
      }
    }, [listKey]),
  )

  return listKey
}
