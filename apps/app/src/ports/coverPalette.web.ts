import { paletteFromPixels, type Palette } from '@selfmp3/client'
import { readCoverPixels } from './coverPixels'

/**
 * Reading a cover's colours in a browser, from the same 24-pixel drawing the
 * playing song's colour is read from.
 */
export async function sampleCoverPalette(uri: string): Promise<Palette | null> {
  const pixels = await readCoverPixels(uri)
  return pixels ? paletteFromPixels(pixels) : null
}
