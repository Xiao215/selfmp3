import sharp from 'sharp'

/**
 * A cover made square, the shape every place draws one.
 *
 * Most covers that are not square came from a video: yt-dlp embeds the
 * video's still, 1280×720, or an older 4:3 one (480×360, 640×480) with black
 * bands above and below — and for a YouTube Music art track, the square art
 * sits in the middle of it on black at the sides. Every square frame cropped
 * those to their middle, which kept the bands in a letterboxed still; and the
 * places that draw the whole file — the lock screen, the widget, a browser's
 * media controls, every device that keeps the bucket's copy — showed a
 * rectangle with bars (Xiao, 2026-10-07).
 *
 * So the black border is trimmed first, which for an art track leaves exactly
 * the art, and what is left is cropped to its centre square. The trim is kept
 * only when what it leaves is a good part of the picture: a night scene with
 * one bright spot is not art on a border, and cutting to the spot would lose
 * the scene.
 *
 * A cover already square is handed back as it was, byte for byte: nothing is
 * re-encoded that need not be, and its hash — the bucket's name for it — stays.
 */
export async function squareCover(
  data: Buffer,
  extension: string,
): Promise<{ data: Buffer; extension: string }> {
  const meta = await sharp(data).metadata()
  // EXIF orientation 5–8 is a quarter turn: the stored width is the height drawn.
  const turned = (meta.orientation ?? 1) >= 5
  const width = turned ? meta.height : meta.width
  const height = turned ? meta.width : meta.height
  if (!width || !height || width === height) return { data, extension }

  const upright = await sharp(data).rotate().toBuffer()
  let source = upright
  let w = width
  let h = height
  try {
    const trimmed = await sharp(upright)
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

  const side = Math.min(w, h)
  const pipeline = sharp(source).resize(side, side, { fit: 'cover', position: 'centre' })
  // A PNG or WebP stays what it was; anything else is a JPEG, as most covers are.
  if (extension === '.png') return { data: await pipeline.png().toBuffer(), extension }
  if (extension === '.webp') return { data: await pipeline.webp().toBuffer(), extension }
  return { data: await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer(), extension: '.jpg' }
}

/** How dark a pixel still counts as border: video black is rarely exactly zero. */
const TRIM_THRESHOLD = 24

/** A trim that leaves less of the picture than this was cutting into it. */
const KEEP_AREA = 0.25
