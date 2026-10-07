import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { squareCover } from './squareCover.js'

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

  it('keeps a PNG a PNG', async () => {
    const out = await squareCover(await picture(400, 200, RED, undefined, 'png'), '.png')
    expect(out.extension).toBe('.png')
    expect((await sharp(out.data).metadata()).format).toBe('png')
    expect(await sizeOf(out.data)).toEqual({ width: 200, height: 200 })
  })
})
