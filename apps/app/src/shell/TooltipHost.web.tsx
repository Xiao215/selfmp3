import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useUnistyles } from 'react-native-unistyles'
import { radius } from '@selfmp3/client'

/**
 * Hover captions for the whole app, from one `data-tip` attribute: the web
 * app's `Tooltip.tsx`, moved as it was.
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
 */

/** How long the pointer rests on a control before its caption appears. */
const OPEN_DELAY_MS = 300
/** After one caption closes, the next opens with no delay if it comes within this. */
const WARM_MS = 400
const ANCHOR_GAP = 6
const VIEWPORT_MARGIN = 8
const TOOLTIP_ID = 'app-tooltip'

/** "Done (Esc)" → a label and a key cap; "(⇧←)" counts too, a parenthesised aside does not. */
const SHORTCUT = /^(.*\S)\s+\(([^()\s]{1,5})\)$/

const KEYFRAMES = `@keyframes selfmp3-tooltip-in { from { opacity: 0; transform: translateY(2px); } }
@keyframes selfmp3-tooltip-in-below { from { opacity: 0; transform: translateY(-2px); } }
@media (prefers-reduced-motion: reduce) { #${TOOLTIP_ID} { animation: none !important; } }`

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
  const [side, setSide] = useState<'above' | 'below'>('above')
  const layerRef = useRef<HTMLDivElement>(null)

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
      setShown(null)
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
    if (!shown || !layer) return
    const rect = shown.anchor.getBoundingClientRect()
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

    layer.style.top = `${Math.round(top)}px`
    layer.style.left = `${Math.round(left)}px`
    setSide(above ? 'above' : 'below')
  }, [shown])

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
          top: 0,
          left: 0,
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: 'min(320px, calc(100vw - 16px))',
          padding: '4px 8px',
          background: colors.surface3,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: radius.sm,
          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
          color: colors.textPrimary,
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.35,
          pointerEvents: 'none',
          animation: `${side === 'above' ? 'selfmp3-tooltip-in' : 'selfmp3-tooltip-in-below'} 120ms ease-out`,
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
                fontFamily: 'inherit',
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
