import { toQR } from 'toqr'

/**
 * A room's invite as a QR code (docs/features/listen-together.md): a friend
 * across the table points their camera at the host's screen. The modules come
 * from `toqr` (the encoder Expo's own CLI prints its QR codes with); this turns
 * them into one SVG path, so a phone draws one shape rather than hundreds.
 */

/** The light border a reader needs around the code, in modules. */
export const QR_QUIET = 4

export interface QrDrawing {
  /** Modules across, border included: the path's viewBox is this square. */
  readonly size: number
  /** Every dark module, as one path in module units. */
  readonly path: string
}

export function qrDrawing(text: string): QrDrawing {
  const modules = toQR(text)
  const across = Math.round(Math.sqrt(modules.length))
  let path = ''
  for (let y = 0; y < across; y++) {
    for (let x = 0; x < across; x++) {
      if (modules[y * across + x]) path += `M${x + QR_QUIET} ${y + QR_QUIET}h1v1h-1z`
    }
  }
  return { size: across + QR_QUIET * 2, path }
}
