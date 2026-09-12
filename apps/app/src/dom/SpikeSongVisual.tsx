'use dom'

/**
 * Spike harness for check 5: a `'use dom'` component draws the song visual on
 * iOS.
 *
 * The drawing itself is `apps/web/src/components/nowplaying/visualDraw.ts`,
 * imported and not copied. That file was already written to know nothing about
 * React or the player — it takes a canvas context, the song's facts and the
 * moment — which is exactly what makes this cheap, and docs/UNIVERSAL.md says
 * to keep it that way.
 *
 * On web this runs as it does today. On the phone Expo renders this same React
 * DOM component inside a webview. The check is whether the canvas actually
 * paints there, which no amount of reading can settle — hence the Maestro flow.
 *
 * `'use dom'` is reserved for genuinely DOM-only pieces, per the Stack table.
 * A canvas drawing is the archetype; ordinary UI must never come here.
 */
import { useEffect, useRef, useState } from 'react'

import { draw, type Memory } from '../../../web/src/components/nowplaying/visualDraw'
import type { Rgb } from '../../../web/src/lib/visuals'

const PALETTE: readonly [Rgb, Rgb, Rgb] = [
  [122, 92, 255],
  [255, 122, 182],
  [92, 214, 255],
]

// `dom` is Expo's own prop: passing it is what makes this render in a webview
// on native rather than inline. The component never reads it, which is the
// point — the same code runs both ways.
export default function SpikeSongVisual(_props: {
  dom?: import('expo/dom').DOMProps
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Reported back so the flow has something to assert on besides "it looked
  // like it worked": a canvas that never painted leaves this false.
  const [painted, setPainted] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const memory: Memory = {}
    let raf = 0
    let last = performance.now()
    const started = last

    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now

      draw('pulse', ctx, canvas.width, canvas.height, {
        time: (now - started) / 1000,
        dt,
        playing: true,
        still: false,
        bpm: 120,
        energy: 0.7,
        danceability: 0.6,
        palette: PALETTE,
        cover: null,
        spectrum: null,
      }, memory)

      if (!painted) {
        // A drawing that runs but paints nothing is the failure worth catching,
        // so this reads a pixel back rather than trusting that draw() returned.
        const { data } = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1)
        if (data[3] !== 0) setPainted(true)
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [painted])

  return (
    <div style={{ background: '#0c0b13', padding: 8 }}>
      <canvas
        ref={canvasRef}
        width={300}
        height={300}
        data-testid="spike-canvas"
        style={{ display: 'block', width: 300, height: 300 }}
      />
      {/* Maestro matches on text, so the result is written out as words. */}
      <div data-testid="spike-canvas-status" style={{ color: '#f2eef8' }}>
        {painted ? 'canvas-painted' : 'canvas-blank'}
      </div>
    </div>
  )
}
