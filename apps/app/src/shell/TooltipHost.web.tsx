import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useUnistyles } from 'react-native-unistyles'
import { motion } from '@selfmp3/client'
import { motionMs } from '../ui/motion'
import { EASE_IN_CSS, EASE_OUT_CSS, MOVE_MS } from '../ui/motion.model'
import { floating } from '../ui/surfaces'

/**
 * Hover captions for the whole app, from one `data-tip` attribute.
 *
 * A native `title` is drawn by the operating system: on a Mac it waits about a
 * second and a half, then drops a pale system label onto a dark app. Anything
 * that wants a caption says `data-tip="Up next"` instead (`ui/tip.ts`), and
 * this host — mounted once in the shell — shows it: after a short rest on a
 * mouse, at once when moving along a row of controls, at once on keyboard
 * focus, never on a touch. A trailing `(key)` is drawn as a key cap.
 *
 * The listeners are delegated to the document, so no control needs a wrapper
 * component or a ref to get a caption.
 *
 * It fades up over `MOVE_MS.tooltip` and away again over `motion.fast` — shorter
 * on the way out, as everything in the app is — rather than being taken off the
 * page in the frame the pointer leaves. Both are CSS animations on the one
 * element, so the file's own `prefers-reduced-motion` rule covers the exit as
 * well as the entrance; the timer that drops it is zeroed the same way, through
 * `motionMs`.
 */

/** How long the pointer rests on a control before its caption appears. */
const OPEN_DELAY_MS = 300
/** After one caption closes, the next opens with no delay if it comes within this. */
const WARM_MS = 400
const ANCHOR_GAP = 6
const VIEWPORT_MARGIN = 8
const TOOLTIP_ID = 'app-tooltip'
/**
 * react-native-web's own `System` stack. The caption lives in `document.body`,
 * outside the app's root, so it inherits the browser's default serif instead.
 */
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

/** "Done (Esc)" → a label and a key cap; "(⇧←)" counts too, a parenthesised aside does not. */
const SHORTCUT = /^(.*\S)\s+\(([^()\s]{1,5})\)$/

const KEYFRAMES = `@keyframes selfmp3-tooltip-in { from { opacity: 0; transform: translateY(2px); } }
@keyframes selfmp3-tooltip-in-below { from { opacity: 0; transform: translateY(-2px); } }
@keyframes selfmp3-tooltip-out { to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { #${TOOLTIP_ID} { animation: none !important; } }`

/** `ease.out` and `ease.in` as CSS writes them (`ui/motion.ts`). */

type Shown = { anchor: HTMLElement; text: string }

function tipAnchor(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[data-tip]:not([data-tip=""])') : null
}

/** A caption that only repeats the text already in full view says nothing. */
function isRedundant(anchor: HTMLElement, text: string): boolean {
  return anchor.textContent?.trim() === text && anchor.scrollWidth <= anchor.clientWidth
}

export function TooltipHost(): ReactNode {
  const { theme } = useUnistyles()
  const [shown, setShown] = useState<Shown | null>(null)
  // Where it sits, in state rather than written onto the node: a caption on its
  // way out is re-rendered with nothing left to measure, and a position React
  // owns survives that render instead of being reset to the top left corner.
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  // Still drawn, on its way out. The caption itself is kept so the text and the
  // place it was in do not change while it fades.
  const [leaving, setLeaving] = useState(false)
  const [side, setSide] = useState<'above' | 'below'>('above')
  const layerRef = useRef<HTMLDivElement>(null)

  // Dropped once the fade has played out. Zero under Reduce Motion, where the
  // media rule has already taken the animation away.
  useEffect(() => {
    if (!leaving) return undefined
    const timer = window.setTimeout(() => {
      setShown(null)
      setLeaving(false)
    }, motionMs(motion.fast))
    return () => window.clearTimeout(timer)
  }, [leaving])

  useEffect(() => {
    let timer = 0
    let warmUntil = 0
    /** The control whose caption is showing or about to. */
    let current: HTMLElement | null = null
    let visible = false
    /** Clicked: its caption stays away until the pointer leaves it. */
    let suppressed: HTMLElement | null = null
    /** Set only when this host added the link, so it only ever removes its own. */
    let described: HTMLElement | null = null
    // While a caption is up, its control can change its text or leave the DOM
    // underneath it; follow the one and close on the other.
    const observer = new MutationObserver(() => {
      if (!current || !visible) return
      const text = current.getAttribute('data-tip')
      if (!current.isConnected || !text) {
        hide()
        return
      }
      setShown(previous => (previous && previous.text !== text ? { ...previous, text } : previous))
    })

    const hide = (): void => {
      window.clearTimeout(timer)
      if (visible) warmUntil = performance.now() + WARM_MS
      observer.disconnect()
      described?.removeAttribute('aria-describedby')
      described = null
      current = null
      visible = false
      // Kept on the page for the length of its fade; the effect above drops it.
      setLeaving(true)
    }

    const open = (anchor: HTMLElement): void => {
      const text = anchor.getAttribute('data-tip')
      if (!text || !anchor.isConnected || isRedundant(anchor, text)) return
      visible = true
      if (!anchor.hasAttribute('aria-describedby')) {
        anchor.setAttribute('aria-describedby', TOOLTIP_ID)
        described = anchor
      }
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-tip'],
      })
      setLeaving(false)
      setShown({ anchor, text })
    }

    const show = (anchor: HTMLElement, delay: number): void => {
      window.clearTimeout(timer)
      current = anchor
      if (delay <= 0) open(anchor)
      else timer = window.setTimeout(() => open(anchor), delay)
    }

    const onPointerOver = (event: PointerEvent): void => {
      // A tap is not a hover, and a caption left behind by one never goes away.
      if (event.pointerType === 'touch') return
      const anchor = tipAnchor(event.target)
      if (anchor !== suppressed) suppressed = null
      if (anchor === current) return
      if (current) hide()
      if (!anchor || anchor === suppressed) return
      show(anchor, performance.now() < warmUntil ? 0 : OPEN_DELAY_MS)
    }

    const onPointerOut = (event: PointerEvent): void => {
      if (event.relatedTarget === null) hide()
    }

    const onPointerDown = (event: PointerEvent): void => {
      suppressed = tipAnchor(event.target)
      hide()
    }

    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target
      // Keyboard focus only: a clicked button is focused too, and has said enough.
      if (!(target instanceof Element) || !target.matches(':focus-visible')) return
      const anchor = tipAnchor(target)
      if (!anchor || anchor === current) return
      if (current) hide()
      show(anchor, 0)
    }

    const onFocusOut = (event: FocusEvent): void => {
      if (current && event.target instanceof Node && current.contains(event.target)) hide()
    }

    // Any key — a hotkey can change what the caption says, and Escape means go away.
    const onKeyDown = (): void => {
      if (current) hide()
    }

    const onDismiss = (): void => {
      if (current) hide()
    }

    // Only a scroll that carries the control away: synced lyrics scroll their
    // panel on their own all the time, and must not blink the player's captions.
    const onScroll = (event: Event): void => {
      const target = event.target
      if (
        current &&
        (target === document || (target instanceof Node && target.contains(current)))
      ) {
        hide()
      }
    }

    document.addEventListener('pointerover', onPointerOver)
    document.addEventListener('pointerout', onPointerOut)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
    return () => {
      hide()
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('blur', onDismiss)
    }
  }, [])

  // Above the control, centred, flipped below when the top of the window is in
  // the way, and never past either side.
  useLayoutEffect(() => {
    const layer = layerRef.current
    // Not while it is leaving: its control may already be gone, and where it was
    // is where it should stay.
    if (!shown || leaving || !layer) return
    // An icon button's box is wider than its symbol; measured from the box, the
    // caption sits nearer whatever is above than the symbol it names.
    // A control can name the part its caption belongs over (`tipTarget`): the
    // player bar's cover, rather than the middle of the cover and title together.
    const target = shown.anchor.querySelector<HTMLElement>('[data-tip-target]')
    const icon =
      target ?? (shown.anchor.textContent?.trim() ? null : shown.anchor.querySelector('svg'))
    const rect = (icon ?? shown.anchor).getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const width = layer.offsetWidth
    const height = layer.offsetHeight

    const above = rect.top - ANCHOR_GAP - height >= VIEWPORT_MARGIN
    const top = above ? rect.top - ANCHOR_GAP - height : rect.bottom + ANCHOR_GAP
    const centred = rect.left + rect.width / 2 - width / 2
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(centred, viewportWidth - VIEWPORT_MARGIN - width),
    )

    setAt({ top: Math.round(top), left: Math.round(left) })
    setSide(above ? 'above' : 'below')
  }, [shown, leaving])

  if (!shown) return null

  const shortcut = SHORTCUT.exec(shown.text)
  const { colors } = theme
  return createPortal(
    <>
      <style>{KEYFRAMES}</style>
      <div
        ref={layerRef}
        id={TOOLTIP_ID}
        role="tooltip"
        style={{
          position: 'fixed',
          top: at.top,
          left: at.left,
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: 'min(320px, calc(100vw - 16px))',
          padding: '4px 8px',
          // A raised control's tone and the floating shadow; no edge.
          background: colors.surface3,
          borderRadius: 12,
          ...floating(colors),
          color: colors.textSecondary,
          fontFamily: FONT_STACK,
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.35,
          pointerEvents: 'none',
          animation: leaving
            ? `selfmp3-tooltip-out ${motion.fast}ms ${EASE_IN_CSS} forwards`
            : `${side === 'above' ? 'selfmp3-tooltip-in' : 'selfmp3-tooltip-in-below'} ${MOVE_MS.tooltip}ms ${EASE_OUT_CSS}`,
        }}
      >
        {shortcut ? (
          <>
            {shortcut[1]}
            <kbd
              style={{
                flexShrink: 0,
                background: colors.surface2,
                color: colors.textSecondary,
                padding: '0 5px',
                fontSize: 10.5,
                lineHeight: '16px',
                borderRadius: 4,
                fontFamily: FONT_STACK,
              }}
            >
              {shortcut[2]}
            </kbd>
          </>
        ) : (
          shown.text
        )}
      </div>
    </>,
    document.body,
  )
}
