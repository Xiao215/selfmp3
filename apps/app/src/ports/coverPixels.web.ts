/** The side of the square a cover is drawn into before its pixels are read. */
const SAMPLE = 24

/**
 * A cover's pixels in a browser: draw its centre square at 24 pixels and read
 * them back — the part of the cover every screen shows, and the part the server
 * reads a colour from (`coverTones.ts`), so both find the same colour.
 *
 * The art comes from the server, another origin, so the image asks for CORS;
 * the server answers with this app's origin, which keeps the canvas readable.
 * A cover that can't be read answers null, and the caller keeps its fallback.
 */
export function readCoverPixels(uri: string): Promise<ArrayLike<number> | null> {
  return new Promise(resolve => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE
        canvas.height = SAMPLE
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return resolve(null)
        const side = Math.min(image.naturalWidth, image.naturalHeight)
        context.drawImage(
          image,
          (image.naturalWidth - side) / 2,
          (image.naturalHeight - side) / 2,
          side,
          side,
          0,
          0,
          SAMPLE,
          SAMPLE,
        )
        resolve(context.getImageData(0, 0, SAMPLE, SAMPLE).data)
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    // Its own address, not the cover's: the page's <img> loaded the cover
    // without CORS, and a browser may answer this request from that cached
    // copy, which the canvas is then not allowed to read.
    image.src = `${uri}${uri.includes('?') ? '&' : '?'}palette=1`
  })
}
