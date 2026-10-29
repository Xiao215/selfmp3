import { useEffect, useEffectEvent, useState, type RefObject } from 'react'
import type { View, ViewStyle } from 'react-native'
import type { FieldWheel } from './fieldInput'
import { mousePoints, wheelSource, type WheelSource } from './wheel.model'

export type { FieldWheel } from './fieldInput'

/** A hand where a drag moves the map, a crosshair where it draws. React Native's types leave the value out. */
export function fieldCursor(armed: boolean): ViewStyle {
  return { cursor: armed ? 'crosshair' : 'grab' } as unknown as ViewStyle
}

/** A wheel's lines and pages, in points, as a browser scrolls them. */
const LINE = 16
const PAGE = 400

/**
 * The browser's wheel over the field: a trackpad's two fingers move the map,
 * and a mouse's wheel zooms it, as a map's does (`wheelSource`); a trackpad
 * pinch (which the browser sends as a wheel with Ctrl held) or a wheel with
 * ⌘ or Ctrl held zooms either way. Listened to directly, not passively, so
 * the page does not scroll or zoom as well.
 */
export function useFieldWheel(
  ref: RefObject<View | null>,
  onWheel: (wheel: FieldWheel) => void,
): void {
  const handle = useEffectEvent(onWheel)
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null
    if (!node) return
    let last: { source: WheelSource; at: number } | null = null
    const listener = (event: WheelEvent): void => {
      event.preventDefault()
      const sample = {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        wheelDeltaY: (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY,
        at: event.timeStamp,
      }
      last = { source: wheelSource(sample, last), at: event.timeStamp }
      const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1
      const rect = node.getBoundingClientRect()
      const mouse = last.source === 'mouse' && !event.ctrlKey
      handle({
        dx: mouse ? 0 : event.deltaX * unit,
        dy: mouse ? mousePoints(sample) : event.deltaY * unit,
        // A browser sends a trackpad pinch as a wheel with Ctrl held.
        zoom: event.ctrlKey && !event.metaKey ? 'pinch' : mouse || event.metaKey ? 'wheel' : null,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      })
    }
    node.addEventListener('wheel', listener, { passive: false })
    return () => node.removeEventListener('wheel', listener)
  }, [ref])
}

/**
 * Shift held down: a drag draws rather than moves, as the pen does for one
 * stroke. Let go of when the window loses focus too, or a Shift released in
 * another window would leave it stuck.
 */
export function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const key = (event: KeyboardEvent): void => setHeld(event.shiftKey)
    const off = (): void => setHeld(false)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
      window.removeEventListener('blur', off)
    }
  }, [])
  return held
}

/**
 * The pointer over the field, a frame at a time at most, and null as it
 * leaves: what names the star under it. A mouse only; a touch has no hover.
 */
export function useFieldPointer(
  ref: RefObject<View | null>,
  onPointer: (point: { x: number; y: number } | null) => void,
): void {
  const handle = useEffectEvent(onPointer)
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null
    if (!node) return
    let frame: number | null = null
    let last: PointerEvent | null = null
    const move = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return
      last = event
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        if (!last) return
        // A button held is a drag, not a look.
        if (last.buttons !== 0) return handle(null)
        const rect = node.getBoundingClientRect()
        handle({ x: last.clientX - rect.left, y: last.clientY - rect.top })
      })
    }
    const leave = (): void => {
      last = null
      handle(null)
    }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerleave', leave)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerleave', leave)
    }
  }, [ref])
}
