import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../lib/hooks.js'

/**
 * The floating-layer shell every menu, popover and dropdown in the app sits in.
 *
 * There is exactly one copy of the fiddly parts — portalling out of whatever
 * `overflow: hidden` container the trigger happens to live in, measuring the
 * anchor, flipping above when there is no room below, dismissing on Escape and
 * on a click outside, and putting focus back on the trigger afterwards. Every
 * popover used to carry its own half of that list, which is how the rule
 * builder ended up with menus clipped by their own scroll container and how
 * clicking a trigger twice could leave a menu open.
 *
 * What a popover *contains* is still entirely up to the caller: this is a
 * shell, not a menu framework.
 */

/** Gap between the anchor and the layer floating under (or over) it. */
const ANCHOR_GAP = 6
/** Floating layers never come closer than this to the edge of the viewport. */
const VIEWPORT_MARGIN = 8
/** Below this a flip is worth it even if the other side is not roomy either. */
const MIN_LAYER_HEIGHT = 140

/** `auto` prefers below, `above` prefers above; both flip when space runs out. */
export type LayerPlacement = 'auto' | 'above'
/** Which edge of the layer lines up with the matching edge of the anchor. */
export type LayerAlign = 'start' | 'end'

export type LayerOptions = {
  placement?: LayerPlacement
  align?: LayerAlign
  /** Make the layer at least as wide as its anchor — dropdowns want this. */
  matchAnchorWidth?: boolean
  /** Off while the layer is presented as a bottom sheet, which CSS positions. */
  enabled?: boolean
}

type LayerState = { style: React.CSSProperties; placedAbove: boolean }

/*
 * The pre-measurement frame. Hidden with opacity rather than `visibility`,
 * because a `visibility: hidden` element cannot take focus — a menu that
 * focuses its first item on open would silently fail to.
 */
const HIDDEN: LayerState = {
  style: { position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none' },
  placedAbove: false,
}

/**
 * Position a portalled layer against an anchor element.
 *
 * Returns a `position: fixed` style. The first frame is rendered hidden so the
 * layer can be measured at its natural size; the measurement then decides the
 * side, the clamped left edge and the max height.
 */
export function useAnchoredLayer(
  anchorRef: React.RefObject<HTMLElement | null>,
  layerRef: React.RefObject<HTMLElement | null>,
  {
    placement = 'auto',
    align = 'start',
    matchAnchorWidth = false,
    enabled = true,
  }: LayerOptions = {},
): LayerState {
  const [state, setState] = useState<LayerState>(HIDDEN)
  const lastKey = useRef('')

  const measure = useCallback((): void => {
    const anchor = anchorRef.current
    const layer = layerRef.current
    if (!enabled || !anchor || !layer) return

    const rect = anchor.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight

    // Measure at the natural size: max-height from a previous pass would
    // otherwise make the layer look like it fits wherever it was last put.
    const previousMaxHeight = layer.style.maxHeight
    layer.style.maxHeight = ''
    if (matchAnchorWidth) layer.style.minWidth = `${rect.width}px`
    const needed = layer.offsetHeight
    const width = layer.offsetWidth
    layer.style.maxHeight = previousMaxHeight

    const spaceBelow = viewportHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN
    const spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN

    const prefersAbove = placement === 'above'
    const roomOnPreferred = prefersAbove ? spaceAbove : spaceBelow
    const roomOnOther = prefersAbove ? spaceBelow : spaceAbove
    // Flip only when the preferred side genuinely cannot hold the layer and
    // the other side is roomier — a flip on every near-miss is worse than a
    // scroll.
    const flip = needed > roomOnPreferred && roomOnOther > roomOnPreferred
    const placedAbove = flip ? !prefersAbove : prefersAbove

    const room = placedAbove ? spaceAbove : spaceBelow
    const maxHeight = Math.round(Math.max(MIN_LAYER_HEIGHT, room))

    const wanted = align === 'end' ? rect.right - width : rect.left
    const left = Math.round(
      Math.max(VIEWPORT_MARGIN, Math.min(wanted, viewportWidth - VIEWPORT_MARGIN - width)),
    )

    const style: React.CSSProperties = {
      position: 'fixed',
      left,
      maxHeight,
      maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
      ...(placedAbove
        ? { bottom: Math.round(viewportHeight - rect.top + ANCHOR_GAP) }
        : { top: Math.round(rect.bottom + ANCHOR_GAP) }),
      ...(matchAnchorWidth ? { minWidth: Math.round(rect.width) } : {}),
    }

    const key = JSON.stringify([style, placedAbove])
    if (key === lastKey.current) return
    lastKey.current = key
    setState({ style, placedAbove })
  }, [anchorRef, layerRef, placement, align, matchAnchorWidth, enabled])

  useLayoutEffect(() => {
    if (!enabled) {
      lastKey.current = ''
      setState(HIDDEN)
      return
    }
    measure()
  }, [measure, enabled])

  useEffect(() => {
    if (!enabled) return
    const onChange = (): void => measure()
    window.addEventListener('resize', onChange)
    // Capture, so a scroll in any container the anchor sits in is seen too.
    window.addEventListener('scroll', onChange, true)

    const layer = layerRef.current
    const observer = layer ? new ResizeObserver(onChange) : null
    if (layer && observer) observer.observe(layer)

    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
      observer?.disconnect()
    }
  }, [measure, enabled, layerRef])

  return state
}

/**
 * Everything inside `root` that a Tab or an arrow key could land on.
 *
 * Visibility is judged by `getClientRects()`, not `offsetParent`: every layer
 * here is `position: fixed`, and inside a fixed ancestor `offsetParent` is
 * null for perfectly visible elements.
 */
export function focusableItems(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    element => element.getClientRects().length > 0 || element === document.activeElement,
  )
}

export type PopoverProps = {
  /** The trigger. Used for positioning and for handing focus back on close. */
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  children: React.ReactNode
  className?: string
  /** `menu` for action lists, `dialog` for anything with its own controls. */
  role?: 'menu' | 'dialog' | 'listbox'
  label?: string
  labelledBy?: string
  id?: string
  placement?: LayerPlacement
  align?: LayerAlign
  matchAnchorWidth?: boolean
  /**
   * `first` moves focus into the layer, `trap` also keeps Tab inside it, and
   * `none` leaves focus on the trigger (what a combobox wants).
   */
  focus?: 'first' | 'trap' | 'none'
  /** Up/Down/Home/End move between the items — menu behaviour. */
  roving?: boolean
  /** Present as a full-width bottom sheet at phone width. */
  sheet?: boolean
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

export function Popover({
  anchorRef,
  onClose,
  children,
  className = '',
  role = 'menu',
  label,
  labelledBy,
  id,
  placement = 'auto',
  align = 'end',
  matchAnchorWidth = false,
  focus = 'first',
  roving = false,
  sheet = false,
  onKeyDown,
}: PopoverProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const asSheet = sheet && isMobile

  const { style, placedAbove } = useAnchoredLayer(anchorRef, layerRef, {
    placement,
    align,
    matchAnchorWidth,
    enabled: !asSheet,
  })

  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Focus: into the layer on open, back to the trigger on close. The guard
  // stops us stealing focus back from wherever the user deliberately sent it.
  useEffect(() => {
    const layer = layerRef.current
    const previous = document.activeElement as HTMLElement | null

    if (focus !== 'none' && layer) {
      const first = focusableItems(layer)[0]
      if (first) first.focus()
      else layer.focus()
    }

    return () => {
      const active = document.activeElement
      const cameFromLayer = !active || active === document.body || layer?.contains(active)
      if (!cameFromLayer) return
      const target = anchorRef.current ?? previous
      if (target && document.contains(target)) target.focus()
    }
  }, [anchorRef, focus])

  // A safety net for the cases where focus is not inside the layer — a click
  // that landed on the panel's own padding, say. React's own Escape handling
  // below stops the event, so this never fires twice for one keypress.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return

    if (event.key === 'Escape') {
      event.preventDefault()
      // Do not also close the dialog or view underneath.
      event.stopPropagation()
      closeRef.current()
      return
    }

    if (event.key === 'Tab') {
      const layer = layerRef.current
      if (focus === 'trap' && layer) {
        const items = focusableItems(layer)
        const first = items[0]
        const last = items[items.length - 1]
        if (!first || !last) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      event.preventDefault()
      closeRef.current()
      return
    }

    if (!roving) return
    const layer = layerRef.current
    if (!layer) return
    const items = focusableItems(layer)
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    const focusAt = (index: number): void => {
      items[((index % items.length) + items.length) % items.length]?.focus()
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      focusAt(current === -1 ? (step === 1 ? 0 : items.length - 1) : current + step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(items.length - 1)
    }
  }

  return createPortal(
    <>
      {/*
        A transparent backdrop rather than a document-level listener: it also
        swallows the click, so dismissing a menu never activates whatever was
        underneath it, and clicking the trigger again closes rather than
        closing-then-reopening.
      */}
      <div
        className={`popover-backdrop ${asSheet ? 'is-scrim' : ''}`}
        onPointerDown={event => {
          event.preventDefault()
          onClose()
        }}
      />
      <div
        ref={layerRef}
        id={id}
        role={role}
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={[
          'popover',
          placedAbove && !asSheet ? 'popover-up' : '',
          asSheet ? 'popover-sheet' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={asSheet ? undefined : style}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}
