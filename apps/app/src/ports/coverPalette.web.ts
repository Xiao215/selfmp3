import { paletteFromPixels, type Palette } from '@selfmp3/client'

/**
 * Reading a cover's colours in a browser: draw it at 24 pixels and read the
 * pixels back, as the web app does.
 *
 * The art comes from the Mac, another origin, so the image asks for CORS; the
 * server answers with this app's origin, which keeps the canvas readable. A
 * cover that can't be read keeps the placeholder colours instead.
 */
export function sampleCoverPalette(uri: string): Promise<Palette | null> {
  return new Promise(resolve => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 24
        canvas.height = 24
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return resolve(null)
        context.drawImage(image, 0, 0, 24, 24)
        resolve(paletteFromPixels(context.getImageData(0, 0, 24, 24).data))
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
