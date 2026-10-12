import { describe, expect, it } from 'vitest'
import { QR_QUIET, qrDrawing } from './qr.model'

/** The invite's QR code, drawn as one path with a quiet border. */

describe('an invite’s QR code', () => {
  it('is a square with a quiet border, and the three finder squares in its corners', () => {
    const drawing = qrDrawing('https://xiao215.github.io/selfmp3/join/KQ7482')
    const across = drawing.size - QR_QUIET * 2
    // Versions grow by four modules from 21.
    expect((across - 21) % 4).toBe(0)
    for (const [x, y] of [
      [0, 0],
      [across - 7, 0],
      [0, across - 7],
    ] as const) {
      // A finder's top-left module, and the dark centre three in from it.
      expect(drawing.path).toContain(`M${x + QR_QUIET} ${y + QR_QUIET}h1v1h-1z`)
      expect(drawing.path).toContain(`M${x + QR_QUIET + 3} ${y + QR_QUIET + 3}h1v1h-1z`)
    }
  })

  it('grows with what it says', () => {
    expect(qrDrawing('KQ7482').size).toBeLessThan(
      qrDrawing(`https://example.com/${'a'.repeat(120)}`).size,
    )
  })
})
