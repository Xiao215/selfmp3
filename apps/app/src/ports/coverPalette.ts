import type { Palette } from '@selfmp3/client'

/**
 * Reading a cover's colours, where the platform can.
 *
 * On a phone there is no canvas to draw the image into and read back
 * (`coverPixels.ts` says why decoding it here is not worth it), so Now Playing
 * glows with the palette built from the tone the server sent with the song
 * (`useCoverPalette`).
 */
export function sampleCoverPalette(_uri: string): Promise<Palette | null> {
  return Promise.resolve(null)
}
