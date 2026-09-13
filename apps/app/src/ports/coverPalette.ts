import type { Palette } from '@selfmp3/client'

/**
 * Reading a cover's colours, where the platform can.
 *
 * On a phone there is no canvas to draw the image into and read back, so
 * Now Playing keeps each song's placeholder colours there. The phone's
 * page doesn't use the glow yet anyway.
 */
export function sampleCoverPalette(_uri: string): Promise<Palette | null> {
  return Promise.resolve(null)
}
