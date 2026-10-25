import { useEffect, useLayoutEffect, useRef } from 'react'

import type { useLayerFocus as SameShape, useLayerKeys as SameKeys } from './layerFocus'

/** What Tab may land on: the browser's own controls, and anything with a tab stop of its own. */
const TAB_STOP =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The items a menu or a list of choices walks with the arrows. */
const ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]'

/**
 * What focus was on before each of the last few moves, newest last: where a
 * layer gives it back to. A field that focuses itself as its layer opens (the
 * palette's search) has moved focus before the layer can look, so the layer
 * takes the one before. `null` is focus let go of, onto the page itself.
 */
const history: (HTMLElement | null)[] = []
const HISTORY = 8

function remember(element: HTMLElement | null): void {
  history.push(element)
  if (history.length > HISTORY) history.shift()
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    event => remember(event.target instanceof HTMLElement ? event.target : null),
    true,
  )
  document.addEventListener(
    'focusout',
    event => {
      if (event.relatedTarget === null) remember(null)
    },
    true,
  )
}

function asElement(node: unknown): HTMLElement | null {
  return node instanceof HTMLElement ? node : null
}

function visible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 || element === document.activeElement
}

/** The tab stops inside `root`, in order. */
function tabStopsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TAB_STOP)].filter(
    // A button taken out of Tab's way (a dim, a catcher) keeps its own tag.
    element =>
      element.tabIndex >= 0 && !element.closest('[aria-hidden="true"]') && visible(element),
  )
}

/**
 * Where focus goes as a layer opens: a list's chosen option; else a menu's
 * first item, past the song's heart and tags at the head of its menu; else
 * its first stop — a form's first field, ahead of its colours; else the panel
 * itself.
 */
function landingIn(root: HTMLElement): HTMLElement | null {
  const chosen = root.querySelector<HTMLElement>(
    '[role="option"][aria-selected="true"], [role="menuitemradio"][aria-checked="true"]',
  )
  if (chosen && chosen.tabIndex >= 0) return chosen
  const item = root.querySelector<HTMLElement>(`[role="menu"] :is(${ITEM})`)
  if (item && item.tabIndex >= 0) return item
  return tabStopsIn(root)[0] ?? root.querySelector<HTMLElement>('[aria-modal="true"]')
}

/** The element focus was on before it came into `root`. */
function openerOutside(root: HTMLElement): HTMLElement | null {
  const now = asElement(document.activeElement)
  if (now && now !== document.body && !root.contains(now)) return now
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const element = history[index] ?? null
    if (element === null) return null
    if (!root.contains(element)) return element
  }
  return null
}

/**
 * A modal layer takes focus as it opens and gives it back as it closes.
 *
 * Opening, focus goes into the layer — to the choice already made in a list
 * of choices, or else to the first thing that takes it — unless something in
 * it took focus for itself. Closing, it goes back to whatever had it before:
 * the button that opened a menu, the row a menu was opened from. Only if it
 * is still in the layer or nowhere: a layer closed by a click on the page
 * leaves focus where that click put it.
 *
 * Both in a layout effect, in the commit that opens or closes the layer, so
 * the page is hidden from a screen reader (`OverlayProvider`) only once focus
 * has left it, and shown again before focus comes back. Giving it back is the
 * effect's own run when the layer stops being modal, not its cleanup: a
 * cleanup runs among React's DOM changes, after which React puts focus back
 * where it was if that is still on the page — and a layer is, for as long as
 * it takes to fade out, so the option just chosen took focus again and then
 * went with its panel. A layer taken away while still modal gives focus back
 * as it goes, when what had focus has gone with it.
 */
export const useLayerFocus: typeof SameShape = (ref, modal) => {
  const opener = useRef<HTMLElement | null>(null)

  const giveBack = (root: HTMLElement | null): void => {
    const back = opener.current
    opener.current = null
    if (!back?.isConnected) return
    const focused = asElement(document.activeElement)
    if (focused && focused !== document.body && !root?.contains(focused)) return
    back.focus({ preventScroll: true })
  }
  const latestGiveBack = useRef(giveBack)
  useLayoutEffect(() => {
    latestGiveBack.current = giveBack
  })

  useLayoutEffect(() => {
    const root = asElement(ref.current)
    if (!root) return
    if (!modal) {
      latestGiveBack.current(root)
      return
    }
    opener.current = openerOutside(root)
    const now = asElement(document.activeElement)
    if (!now || !root.contains(now)) landingIn(root)?.focus({ preventScroll: true })
  }, [ref, modal])

  useLayoutEffect(() => {
    const node = ref.current
    return () => latestGiveBack.current(asElement(node))
  }, [ref])
}

/**
 * The keys of the topmost modal layer: Tab goes round the layer rather than
 * out into the page under it, and the arrows walk a menu's items or a list's
 * choices — Home and End to the ends — wrapping at either end.
 */
export const useLayerKeys: typeof SameKeys = top => {
  const latest = useRef(top)
  useEffect(() => {
    latest.current = top
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      const root = asElement(latest.current())
      if (!root) return
      const key = event.key
      if (key === 'Tab') {
        if (event.metaKey || event.ctrlKey || event.altKey) return
        const stops = tabStopsIn(root)
        const now = asElement(document.activeElement)
        const at = now ? stops.indexOf(now) : -1
        const inside = now !== null && root.contains(now)
        const first = stops[0]
        const last = stops[stops.length - 1]
        if (!first || !last) {
          event.preventDefault()
          return
        }
        if (!inside || (event.shiftKey ? at <= 0 : at === stops.length - 1)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus({ preventScroll: true })
        }
        return
      }
      if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const now = asElement(event.target)
      if (!now || !root.contains(now) || !now.matches(ITEM)) return
      const items = [...root.querySelectorAll<HTMLElement>(ITEM)].filter(
        item => item.getAttribute('aria-disabled') !== 'true' && visible(item),
      )
      const at = items.indexOf(now)
      if (at === -1) return
      const next =
        key === 'Home'
          ? items[0]
          : key === 'End'
            ? items[items.length - 1]
            : items[(at + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
      event.preventDefault()
      event.stopPropagation()
      next?.focus({ preventScroll: true })
      next?.scrollIntoView?.({ block: 'nearest' })
    }
    // On the document, after the window's own listeners (a list's keys), which stand aside for a layer.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
