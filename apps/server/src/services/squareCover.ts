import sharp, { type ResizeOptions, type Sharp } from 'sharp'

/**
 * A cover made square, the shape every place draws one, and a JPEG.
 *
 * Most covers that are not square came from a video: yt-dlp embeds the
 * video's still, 1280×720, or an older 4:3 one (480×360, 640×480) with black
 * bands above and below — and for a YouTube Music art track, the square art
 * sits in the middle of it on black at the sides. A square frame cropping
 * those to their middle keeps the bands in a letterboxed still, and the places
 * that draw the whole file — the lock screen, the widget, a browser's media
 * controls, every device that keeps the bucket's copy — show a rectangle with
 * bars.
 *
 * So the black border is trimmed first, which for an art track leaves exactly
 * the art, and what is left is cropped to its centre square. The trim is kept
 * only when what it leaves is a good part of the picture: a night scene with
 * one bright spot is not art on a border, and cutting to the spot would lose
 * the scene.
 *
 * A JPEG is what every cover is kept as. A PNG cover — what yt-dlp makes of
 * a video's still when it puts it in an .m4a — was five or six times the
 * bytes of the same picture as a JPEG, and every device keeps every cover:
 * on a library of 109 songs, 27 PNGs were 15 of 17 MB of covers. A cover in
 * another format is re-encoded, on black where it was see-through.
 *
 * A JPEG already square is handed back as it was, byte for byte: nothing is
 * re-encoded that need not be, and its hash — the bucket's name for it — stays.
 * Unless it is bigger than a cover is kept (`COVER_MAX_SIDE`), and then it is
 * made smaller; past `COVER_MAX_PIXELS` it is refused unread.
 */
export async function squareCover(
  data: Buffer,
  extension: string,
): Promise<{ data: Buffer; extension: string }> {
  // The header alone: nothing is decoded until the size is known to be sane.
  const meta = await sharp(data).metadata()
  // EXIF orientation 5–8 is a quarter turn: the stored width is the height drawn.
  const turned = (meta.orientation ?? 1) >= 5
  const width = turned ? meta.height : meta.width
  const height = turned ? meta.width : meta.height
  if (!width || !height) return { data, extension }
  if (width * height > COVER_MAX_PIXELS) throw new CoverTooBig(width, height)
  if (width === height) {
    if (meta.format === 'jpeg' && width <= COVER_MAX_SIDE) return { data, extension: '.jpg' }
    return {
      data: await asJpeg(
        cover(data)
          .rotate()
          .resize(...fitted(width)),
      ),
      extension: '.jpg',
    }
  }

  const upright = await cover(data).rotate().toBuffer()
  let source = upright
  let w = width
  let h = height
  try {
    const trimmed = await cover(upright)
      .trim({ background: '#000000', threshold: TRIM_THRESHOLD })
      .toBuffer({ resolveWithObject: true })
    const tw = trimmed.info.width
    const th = trimmed.info.height
    if (tw * th >= KEEP_AREA * w * h) {
      source = trimmed.data
      w = tw
      h = th
    }
  } catch {
    // Nothing to trim, or nothing left if it did: the picture as it is.
  }

  const pipeline = cover(source).resize(...fitted(Math.min(w, h)))
  return { data: await asJpeg(pipeline), extension: '.jpg' }
}

/**
 * The most pixels a cover may have: a 4096-pixel square. sharp decodes about
 * four bytes a pixel, and an 800 KB PNG 16383 pixels on a side held 1.6 GB of
 * the server for twenty seconds — a few at once would take a Pi down.
 */
const COVER_MAX_PIXELS = 4096 * 4096

/** The largest side a kept cover has: every device keeps every cover, and none draws one bigger. */
export const COVER_MAX_SIDE = 2048

/** A picture too big to be read as a cover (`COVER_MAX_PIXELS`): refused, not kept as it came. */
export class CoverTooBig extends Error {
  constructor(width: number, height: number) {
    super(`a ${width}×${height} picture is too big for a cover`)
  }
}

/** A picture to work on, which sharp refuses to decode past the cover's limit. */
export function cover(input: Buffer | string): Sharp {
  return sharp(input, { limitInputPixels: COVER_MAX_PIXELS })
}

/** A square of `side`, no bigger than a kept cover, cropped to the centre. */
function fitted(side: number): [number, number, ResizeOptions] {
  const kept = Math.min(side, COVER_MAX_SIDE)
  return [kept, kept, { fit: 'cover', position: 'centre' }]
}

/** Sharp enough that a cover drawn the size of a window shows nothing lost. */
const JPEG_QUALITY = 85

function asJpeg(image: Sharp): Promise<Buffer> {
  return image
    .flatten({ background: '#000000' })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
}

/** How dark a pixel still counts as border: video black is rarely exactly zero. */
const TRIM_THRESHOLD = 24

/** A trim that leaves less of the picture than this was cutting into it. */
const KEEP_AREA = 0.25
