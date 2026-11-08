import { useEffect, useEffectEvent, useState, type RefObject } from 'react'
import type { View, ViewProps, ViewStyle } from 'react-native'
import { plural } from '@selfmp3/shared'
import { isComposing } from '../../shell/composing'
import { focusOwnsKey, OWNS_SPACE } from '../../shell/keyOwner'
import { FOCUS_OVER, setTabbing, tabbing } from '../../shell/tabbing'
import type { FieldAccess, FieldWheel } from './fieldInput'
import type { FieldKey } from './fieldKeys.model'
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
 * The browser's wheel over the field zooms the map, whatever sends it: a
 * mouse's wheel, a trackpad's two fingers, or a trackpad pinch (which the
 * browser sends as a wheel with Ctrl held). A drag or the arrow keys move it
 * (Xiao, 2026-11-01: two fingers moved it, and zooming took ⌘). Which it was
 * (`wheelSource`) decides only how a step zooms. Sideways scrolling is left
 * alone. Listened to directly, not passively, so the page does not scroll or
 * zoom as well.
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
      if (event.deltaY === 0) return
      const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1
      const rect = node.getBoundingClientRect()
      // A browser sends a trackpad pinch as a wheel with Ctrl held.
      const pinch = event.ctrlKey && !event.metaKey
      const mouse = last.source === 'mouse' && !pinch
      handle({
        dy: mouse ? mousePoints(sample) : event.deltaY * unit,
        from: pinch ? 'pinch' : mouse ? 'notch' : 'scroll',
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      })
    }
    node.addEventListener('wheel', listener, { passive: false })
    return () => node.removeEventListener('wheel', listener)
  }, [ref])
}

const ARROWS: Readonly<Record<string, { x: number; y: number }>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

/**
 * The arrow keys held down, as one direction (two held at once go
 * diagonally), told each time it changes: the map moves that way while they
 * are held. Not while someone is typing, or a menu or dialog has the keys,
 * nor with ⌘, Ctrl or ⌥ held, which are the browser's and the app's. All let
 * go of when the window loses focus, or a key released elsewhere would leave
 * the map sliding.
 */
export function useFieldKeys(onKeys: (direction: { x: number; y: number }) => void): void {
  const handle = useEffectEvent(onKeys)
  useEffect(() => {
    const held = new Set<string>()
    const tell = (): void => {
      let x = 0
      let y = 0
      for (const key of held) {
        x += ARROWS[key]?.x ?? 0
        y += ARROWS[key]?.y ?? 0
      }
      handle({ x, y })
    }
    const down = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (!(event.key in ARROWS) || event.metaKey || event.ctrlKey || event.altKey) return
      if (isComposing(event) || focusOwnsKey(event.target, { typing: true })) return
      event.preventDefault()
      if (held.has(event.key)) return
      held.add(event.key)
      tell()
    }
    const up = (event: KeyboardEvent): void => {
      if (!held.delete(event.key)) return
      tell()
    }
    const off = (): void => {
      if (held.size === 0) return
      held.clear()
      tell()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
      off()
    }
  }, [])
}

/** The keys the field answers while it has focus, as what they ask of the map. */
function fieldKeyOf(event: KeyboardEvent): FieldKey | null {
  const arrow = ARROWS[event.key]
  if (arrow) return { key: 'arrow', direction: arrow }
  switch (event.key) {
    case 'Enter':
    case ' ':
      return { key: 'enter' }
    case 'Escape':
      return { key: 'escape' }
    case '+':
    case '=':
      return { key: 'in' }
    case '-':
    case '_':
      return { key: 'out' }
    default:
      return null
  }
}

/**
 * The field's own keys, while it has focus (`answerKey`): told each key with
 * whether Shift is held, which arms a line, and answering whether it was the
 * map's. One it takes is kept from the page, whose arrows would move the map
 * and whose Escape would let go of the tray; one it leaves goes on to them.
 * A key it takes moves focus with the keyboard, so it turns the focus ring
 * on, as a list's arrows do.
 *
 * Told too when the field gains focus, and whether the keyboard brought it
 * there, which is when it chooses a song (a click leaves focus behind
 * without one), and when it loses focus within the window rather than to
 * another window, which lets go of the song.
 */
export function useFieldFocus(
  ref: RefObject<View | null>,
  on: {
    key: (key: FieldKey, shift: boolean) => boolean
    focus: (keyboard: boolean) => void
    blur: () => void
  },
): void {
  const key = useEffectEvent(on.key)
  const focus = useEffectEvent(on.focus)
  const blur = useEffectEvent(on.blur)
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null
    if (!node) return
    const down = (event: KeyboardEvent): void => {
      if (event.target !== node || event.defaultPrevented || isComposing(event)) return
      // The gesture handler takes Enter and Space on the field as a tap at its
      // middle, which would play what is there and let go of the tray: the
      // field answers them itself, and none reaches it.
      if (event.key === 'Enter' || event.key === ' ') event.stopImmediatePropagation()
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const asked = fieldKeyOf(event)
      if (!asked) return
      // A held Enter would play, or start and end a line, as fast as the keyboard repeats.
      const handled = event.repeat && asked.key === 'enter' ? true : key(asked, event.shiftKey)
      if (!handled) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setTabbing(true)
    }
    const gained = (event: FocusEvent): void => {
      if (event.target === node) focus(tabbing())
    }
    const lost = (event: FocusEvent): void => {
      if (event.target === node && document.hasFocus()) blur()
    }
    // In the capture phase, so it answers before the gesture handler's own
    // listener on the same element.
    node.addEventListener('keydown', down, true)
    node.addEventListener('focus', gained)
    node.addEventListener('blur', lost)
    return () => {
      node.removeEventListener('keydown', down, true)
      node.removeEventListener('focus', gained)
      node.removeEventListener('blur', lost)
    }
  }, [ref])
}

/** A browser speaks the song chosen from a live region of the field's own (`SoundField`). */
export const SPEAKS_CHOICE = true

/**
 * The field to a browser: one Tab stop that runs its own keys, as an
 * application does, named with what is on it and what the keys do (the
 * page's hint says what a pointer does). While a song is chosen Space plays
 * it rather than pausing the page's music (`OWNS_SPACE`). Its focus ring is
 * drawn over the sky (`FOCUS_OVER`), round the whole map, and the song chosen
 * wears one of its own.
 */
export function fieldAccess({ songs, chosen }: FieldAccess): ViewProps {
  return {
    role: 'application',
    tabIndex: 0,
    accessibilityLabel: `Sound map, ${plural(songs, 'song', 'songs')}. ${KEYS_SAID}`,
    // Its focus ring is drawn over the sky, and while a song is chosen Space plays it.
    ...{
      dataSet: { ...FOCUS_OVER.dataSet, ...(chosen === null ? null : OWNS_SPACE.dataSet) },
    },
  }
}

const KEYS_SAID =
  'The arrow keys go from song to song, and Enter plays one. Shift+Enter starts a line, the arrows carry it, and Enter ends it. Escape lets go of the song, and then the arrows move the map. Plus and minus zoom.'

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
