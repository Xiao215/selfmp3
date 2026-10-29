import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { COVER_MAX_SIDE, CoverTooBig, squareCover } from './squareCover.js'

const RED = { r: 220, g: 30, b: 40 }
const BLACK = { r: 0, g: 0, b: 0 }

/** A plain picture, with an optional block of another colour placed on it. */
async function picture(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
  block?: { width: number; height: number; colour: { r: number; g: number; b: number } },
  format: 'jpeg' | 'png' = 'jpeg',
): Promise<Buffer> {
  let image = sharp({ create: { width, height, channels: 3, background } })
  if (block) {
    const inner = await sharp({
      create: { width: block.width, height: block.height, channels: 3, background: block.colour },
    })
      .png()
      .toBuffer()
    image = image.composite([{ input: inner, gravity: 'centre' }])
  }
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 95 }).toBuffer()
}

async function sizeOf(data: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(data).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}

/** The colour at a point, as [r, g, b]. */
async function pixel(data: Buffer, x: number, y: number): Promise<number[]> {
  const { data: raw, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * info.channels
  return [raw[at] ?? 0, raw[at + 1] ?? 0, raw[at + 2] ?? 0]
}

const isRed = ([r, g, b]: number[]): boolean => (r ?? 0) > 150 && (g ?? 0) < 90 && (b ?? 0) < 90

describe('squareCover', () => {
  it('hands a square cover back untouched, so its hash stays', async () => {
    const square = await picture(300, 300, RED)
    const out = await squareCover(square, '.jpg')
    expect(out.data).toBe(square)
    expect(out.extension).toBe('.jpg')
  })

  it('crops a video still with no border to its centre square', async () => {
    const out = await squareCover(await picture(1280, 720, RED), '.jpg')
    expect(await sizeOf(out.data)).toEqual({ width: 720, height: 720 })
  })

  it('cuts an art track out of the black it sits on', async () => {
    const still = await picture(640, 360, BLACK, { width: 300, height: 300, colour: RED })
    const out = await squareCover(still, '.jpg')
    const { width, height } = await sizeOf(out.data)
    expect(width).toBe(height)
    // The art, edge to edge: no black left at the corners.
    expect(isRed(await pixel(out.data, 2, 2))).toBe(true)
    expect(isRed(await pixel(out.data, width - 3, height - 3))).toBe(true)
  })

  it('drops the bands of a letterboxed 4:3 still before cropping', async () => {
    const still = await picture(480, 360, BLACK, { width: 480, height: 270, colour: RED })
    const out = await squareCover(still, '.jpg')
    const { width, height } = await sizeOf(out.data)
    expect(width).toBe(height)
    expect(isRed(await pixel(out.data, Math.floor(width / 2), 2))).toBe(true)
  })

  it('keeps a dark picture whole rather than cutting to a small bright spot', async () => {
    const night = await picture(1280, 720, BLACK, {
      width: 100,
      height: 100,
      colour: { r: 255, g: 255, b: 255 },
    })
    const out = await squareCover(night, '.jpg')
    expect(await sizeOf(out.data)).toEqual({ width: 720, height: 720 })
  })

  it('keeps a PNG as a JPEG, square or not', async () => {
    const wide = await squareCover(await picture(400, 200, RED, undefined, 'png'), '.png')
    expect(wide.extension).toBe('.jpg')
    expect((await sharp(wide.data).metadata()).format).toBe('jpeg')
    expect(await sizeOf(wide.data)).toEqual({ width: 200, height: 200 })

    const square = await squareCover(await picture(300, 300, RED, undefined, 'png'), '.png')
    expect(square.extension).toBe('.jpg')
    expect((await sharp(square.data).metadata()).format).toBe('jpeg')
    expect(isRed(await pixel(square.data, 150, 150))).toBe(true)
  })

  it('puts a see-through cover on black', async () => {
    const clear = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .webp()
      .toBuffer()
    const out = await squareCover(clear, '.webp')
    expect(out.extension).toBe('.jpg')
    expect(await pixel(out.data, 32, 32)).toEqual([0, 0, 0])
  })
})

/**
 * A cover's size, held to what a cover needs. An 800 KB PNG 16383 pixels on
 * a side cost the server 1.6 GB to read, and a giant square JPEG was kept as
 * it came, for every device to decode.
 */
describe('a cover too big', () => {
  it('makes a square JPEG over the kept size smaller', async () => {
    const big = await picture(3000, 3000, RED)
    const { data, extension } = await squareCover(big, '.jpg')
    expect(extension).toBe('.jpg')
    expect(await sizeOf(data)).toEqual({ width: COVER_MAX_SIDE, height: COVER_MAX_SIDE })
  })

  it('crops a big wide picture to a square no bigger than kept', async () => {
    const { data } = await squareCover(await picture(3200, 2400, RED), '.jpg')
    expect(await sizeOf(data)).toEqual({ width: COVER_MAX_SIDE, height: COVER_MAX_SIDE })
  })

  it('refuses one with more pixels than a cover may have, without reading it', async () => {
    // A small PNG that says it is huge: one colour compresses to almost nothing.
    const bomb = await sharp({
      create: { width: 4200, height: 4200, channels: 3, background: BLACK },
    })
      .png({ compressionLevel: 9 })
      .toBuffer()
    await expect(squareCover(bomb, '.png')).rejects.toBeInstanceOf(CoverTooBig)
  })
})
