import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Small hooks used across the app.
 */

/** Delay a rapidly-changing value — search boxes, mostly. */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

/** State backed by localStorage, for device-specific preferences. */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? initial : (JSON.parse(stored) as T)
    } catch {
      return initial
    }
  })

  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Private browsing; the value just will not persist.
      }
    },
    [key],
  )

  return [value, update]
}

/**
 * Global keyboard shortcuts.
 *
 * Handlers are held in a ref so the listener is attached exactly once —
 * re-binding on every render would be both wasteful and a source of missed
 * keystrokes during a re-render.
 */
export function useHotkeys(handlers: Record<string, (event: KeyboardEvent) => void>): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      // Never hijack keys while the user is typing — or while a dropdown or a
      // menu has the keyboard. Those run their own arrow keys and type-ahead,
      // exactly as the native <select> this list used to name did.
      if (target instanceof HTMLElement) {
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('[role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]') !==
            null
        ) {
          // Escape is the one exception: it should always be able to close things.
          if (event.key !== 'Escape') return
        }
      }

      const parts: string[] = []
      if (event.metaKey) parts.push('meta')
      if (event.ctrlKey) parts.push('ctrl')
      if (event.altKey) parts.push('alt')
      if (event.shiftKey && event.key.length > 1) parts.push('shift')
      parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key)

      const handler = handlersRef.current[parts.join('+')]
      if (handler) {
        event.preventDefault()
        handler(event)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** Run a callback when a click lands outside the referenced element. */
export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  const callbackRef = useRef(onOutside)
  callbackRef.current = onOutside

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const element = ref.current
      if (element && event.target instanceof Node && !element.contains(event.target)) {
        callbackRef.current()
      }
    }
    // Capture phase, so it fires before a click handler inside a portal can
    // stop propagation.
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  return ref
}

/**
 * Something that animates out as well as in.
 *
 * `value` is what should be showing, or null for nothing. When it goes null,
 * `shown` keeps the last value and `leaving` turns true, so the element can
 * stay mounted and play its way out; it calls `exited` when that is done.
 * Opening it again part-way out just brings it back.
 */
export function usePresence<T>(value: T | null): {
  shown: T | null
  leaving: boolean
  exited: () => void
} {
  const [last, setLast] = useState(value)
  // Adjusted during render rather than in an effect, so an opening element
  // mounts in the same frame instead of one behind.
  if (value !== null && value !== last) setLast(value)
  const exited = useCallback(() => setLast(null), [])
  return { shown: value ?? last, leaving: value === null && last !== null, exited }
}

/**
 * For the root of something `usePresence` keeps up. On the way out it takes
 * no clicks or focus, so what is under it is usable at once, and it reports
 * when its own exit animation ends — not one of its children's, which bubble
 * up to it too.
 */
export function exitProps(leaving: boolean, onExited: () => void) {
  return {
    inert: leaving,
    onAnimationEnd: (event: React.AnimationEvent<HTMLElement>) => {
      if (leaving && event.target === event.currentTarget) onExited()
    },
  }
}

/** True when the viewport is phone-sized. Drives the mobile layout switch. */
export function useIsMobile(breakpoint = 820): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  )

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = (event: MediaQueryListEvent): void => setIsMobile(event.matches)
    setIsMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [breakpoint])

  return isMobile
}

/**
 * Pointer-based drag reordering.
 *
 * Uses pointer events rather than HTML5 drag-and-drop specifically because
 * HTML5 DnD does not work on touch devices at all — and reordering a queue on
 * a phone is one of the main reasons the queue UI exists.
 */
export function useDragReorder(onReorder: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const onReorderRef = useRef(onReorder)
  onReorderRef.current = onReorder

  const start = useCallback((index: number, event: React.PointerEvent) => {
    // Ignore secondary buttons; only a primary press starts a drag.
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(index)
    setOver(index)
  }, [])

  const enter = useCallback(
    (index: number) => {
      setOver(current => (dragging === null ? current : index))
    },
    [dragging],
  )

  const end = useCallback(() => {
    if (dragging !== null && over !== null && dragging !== over) {
      onReorderRef.current(dragging, over)
    }
    setDragging(null)
    setOver(null)
  }, [dragging, over])

  return { dragging, over, start, enter, end }
}
