import type { Rgb } from '@selfmp3/client'
import type { VisualColors } from './visuals.model'

/**
 * What the browser's Ripples canvas (`SongVisual.web.tsx`) paints once and
 * keeps, rather than painting again sixty times a second.
 *
 * Most of a frame never moves. The ground (a radial gradient over the whole
 * canvas) and the two washes in its corners change only when the canvas
 * changes size or the song's colours change; the disc's deep shadow changes
 * only with the disc's size and the ground's edge colour. At a device pixel
 * ratio of 2 in Focus each of those was a 2880×1800 fill, every frame, and the
 * shadow a 50-pixel `shadowBlur` — one of the dearest things a 2D canvas does.
 * So they are painted once, into canvases of their own, and each frame copies
 * them in with `drawImage`; only the halo, the rings and the disc's kick are
 * drawn fresh.
 *
 * This file is the part of that which is not drawing: what the kept layers
 * are a picture *of* (`layersKey`), holding one set and letting the old one
 * go when that changes (`createLayerCache`), how big the shadow's own canvas
 * has to be (`shadowSprite`), and how strong the flash is now that it is laid
 * over the kept ground rather than mixed into it (`flashLift`).
 */

/** The shadow under the disc, in canvas pixels: a canvas shadow ignores the transform. */
export const DISC_SHADOW = { blur: 50, offsetY: 20, alpha: 0.6 } as const

/** The size the canvas is drawn at, in its box's points, and the screen's density. */
export interface LayerSize {
  readonly width: number
  readonly height: number
  readonly dpr: number
}

const rgbKey = ([r, g, b]: Rgb): string => `${Math.round(r)},${Math.round(g)},${Math.round(b)}`

/**
 * What the kept layers depend on, as one string: the canvas's size in pixels,
 * its density, and every colour the ground, the washes and the shadow are
 * painted in. Two keys are equal exactly when the kept layers would come out
 * the same, so the colours are compared by value, rounded to the byte a canvas
 * draws them at — `useVisualLook` makes a new colours object for the same song
 * now and then, and that must not paint the layers again. The disc's own
 * colour (`inks[2]`) is not in it: the disc is drawn fresh every frame.
 */
export function layersKey({ width, height, dpr }: LayerSize, colors: VisualColors): string {
  const [middle, edge] = colors.ground
  const [first, second] = colors.inks
  return [
    `${Math.round(width * dpr)}x${Math.round(height * dpr)}@${dpr}`,
    rgbKey(middle),
    rgbKey(edge),
    rgbKey(first),
    rgbKey(second),
  ].join('|')
}

/**
 * One set of kept layers at a time, made the first time it is asked for under
 * a key and kept until the key changes — a resize, another density, other
 * colours — when the old set is let go (`free`) before the new one is made, so
 * there are never two full-size canvases held at once. `release` lets go of
 * whatever is held, for when the visual leaves the screen.
 */
interface LayerCache<T> {
  get(key: string, make: () => T): T
  release(): void
}

export function createLayerCache<T>(free: (layers: T) => void): LayerCache<T> {
  let held: { key: string; layers: T } | null = null
  return {
    get(key, make) {
      if (held && held.key === key) return held.layers
      if (held) free(held.layers)
      held = null
      const layers = make()
      held = { key, layers }
      return layers
    },
    release() {
      if (held) free(held.layers)
      held = null
    },
  }
}

/**
 * The canvas the disc's shadow is painted into on its own, for a disc of
 * `radius` points at `dpr`: a square in canvas pixels, with the disc's middle
 * at its middle and room on every side for the blur to fade out and for the
 * shadow's drop. `side` is its width and height in canvas pixels, and `half`
 * the distance from its middle to its edge in the box's points, which is how
 * far out from the disc's middle it is drawn.
 */
export function shadowSprite(radius: number, dpr: number): { side: number; half: number } {
  // A canvas blur of 50 is a Gaussian of about 25 pixels; it is gone by three
  // of those, and the shadow is dropped 20 below the disc on top of that.
  const pad = Math.ceil(DISC_SHADOW.blur * 1.5 + DISC_SHADOW.offsetY) + 2
  const side = Math.ceil(radius * dpr) * 2 + pad * 2
  return { side, half: side / 2 / dpr }
}

/**
 * How much white the flash lays over the ground's middle: what the ground's
 * middle used to be lightened by (5% at a full flash), or nothing at all when
 * that would not move a pixel by half a step — so a canvas between hits does
 * not fill the screen again with a wash nobody could see.
 */
export function flashLift(flash: number): number {
  const lift = Math.max(0, flash) * 0.05
  return lift * 255 < 0.5 ? 0 : lift
}
