/**
 * A cover's pixels, drawn at 24×24, where the platform can read them.
 *
 * On a phone there is no canvas to draw an image into and read back. Decoding
 * the cover in JavaScript instead was measured: a 1280×720 PNG — most covers
 * are — takes the better part of a second on the JS thread, which is a stutter
 * at every change of song. So the phone answers nothing, and takes the colour
 * the server picked and sent with the song instead.
 */
export function readCoverPixels(_uri: string): Promise<ArrayLike<number> | null> {
  return Promise.resolve(null)
}
