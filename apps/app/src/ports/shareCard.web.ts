import { WRAPPED_RANGE_LABELS, type Wrapped } from '@selfmp3/shared'
import { withAlpha } from '@selfmp3/client'
import {
  eyebrow,
  facts,
  figure,
  figureUnit,
  numberOneLine,
  rankShare,
  shareFileName,
} from '../features/wrapped/wrapped.model'
import type { CardPalette } from './shareCard.types'

/**
 * The shareable Wrapped card, drawn to a canvas.
 *
 * Laid out like the report page it comes from, so the picture says what the
 * page says: the minutes over the number one's blurred cover, the traits, the
 * six facts, the number one with its artwork, then the rest of the top songs
 * beside the top artists with their bars. 1080×1350, the portrait every
 * social app shows whole, and drawn rather than screenshotted so it has no app
 * chrome. The colours are the theme on screen, passed in already resolved.
 */
export const canShareCard = true

const WIDTH = 1080
const HEIGHT = 1350
const PAD = 72
const FONT = `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'Hiragino Sans', 'Noto Sans CJK JP', system-ui, sans-serif`

type Context = CanvasRenderingContext2D & { letterSpacing?: string }

function draw(
  canvas: HTMLCanvasElement,
  wrapped: Wrapped,
  palette: CardPalette,
  cover: HTMLImageElement | null,
): void {
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d') as Context | null
  if (!ctx) return
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const inner = WIDTH - PAD * 2

  // --- head -------------------------------------------------------------------
  caps(ctx, 'SELF.MP3 · WRAPPED', PAD, 96, palette.muted, 22, 4)
  ctx.fillStyle = palette.secondary
  ctx.font = `500 24px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(WRAPPED_RANGE_LABELS[wrapped.range], WIDTH - PAD, 96)
  ctx.textAlign = 'left'

  // --- hero: the minutes, over the number one's cover ---------------------------
  const heroTop = 132
  const heroX = PAD + 48
  // As tall as its traits need: one line of pills leaves no empty band below.
  const traitLines = chips(ctx, palette, wrapped.personality.traits, heroX, 0, inner - 96, false)
  const heroHeight = 322 + (traitLines > 0 ? traitLines * 62 - 12 : 0) + 56
  ctx.save()
  roundRect(ctx, PAD, heroTop, inner, heroHeight, 32)
  ctx.clip()
  ctx.fillStyle = palette.surface
  ctx.fillRect(PAD, heroTop, inner, heroHeight)
  if (cover) {
    blurred(ctx, cover, PAD, heroTop, inner, heroHeight)
    const wash = ctx.createLinearGradient(PAD, 0, PAD + inner, 0)
    wash.addColorStop(0.04, palette.surface)
    wash.addColorStop(0.42, withAlpha(palette.surface, 0.8))
    wash.addColorStop(1, withAlpha(palette.surface, 0.35))
    ctx.fillStyle = wash
    ctx.fillRect(PAD, heroTop, inner, heroHeight)
  }
  const glow = ctx.createRadialGradient(PAD + inner, heroTop, 0, PAD + inner, heroTop, inner * 0.9)
  glow.addColorStop(0, withAlpha(palette.accentDim, 0.45))
  glow.addColorStop(1, withAlpha(palette.accentDim, 0))
  ctx.fillStyle = glow
  ctx.fillRect(PAD, heroTop, inner, heroHeight)
  ctx.restore()
  outline(ctx, PAD, heroTop, inner, heroHeight, 32, palette.border)

  caps(ctx, eyebrow(wrapped.range).toUpperCase(), heroX, heroTop + 72, palette.secondary, 22, 3)
  ctx.fillStyle = palette.text
  ctx.font = `700 176px ${FONT}`
  ctx.letterSpacing = '-6px'
  ctx.fillText(figure(wrapped.totals.minutes), heroX - 6, heroTop + 236)
  ctx.letterSpacing = '0px'
  ctx.fillStyle = palette.secondary
  ctx.font = `500 32px ${FONT}`
  ctx.fillText(figureUnit(wrapped.totals.minutes), heroX, heroTop + 290)
  chips(ctx, palette, wrapped.personality.traits, heroX, heroTop + 322, inner - 96)

  // --- the six facts -------------------------------------------------------------
  const factTop = heroTop + heroHeight + 58
  const factWidth = inner / 3
  facts(wrapped).forEach((fact, index) => {
    const x = PAD + (index % 3) * factWidth
    const y = factTop + Math.floor(index / 3) * 124
    ctx.fillStyle = palette.muted
    ctx.font = `500 22px ${FONT}`
    ctx.fillText(fact.label, x, y)
    ctx.fillStyle = palette.text
    ctx.font = `700 44px ${FONT}`
    ctx.fillText(fit(ctx, fact.value, factWidth - 24), x, y + 50)
    if (fact.hint) {
      ctx.fillStyle = palette.muted
      ctx.font = `500 20px ${FONT}`
      ctx.fillText(fact.hint, x, y + 80)
    }
  })

  // --- your number one -------------------------------------------------------------
  const top = wrapped.topSongs[0]
  const oneTop = factTop + 248 + 20
  const oneHeight = 170
  if (top) {
    ctx.save()
    roundRect(ctx, PAD, oneTop, inner, oneHeight, 24)
    ctx.clip()
    ctx.fillStyle = palette.surface
    ctx.fillRect(PAD, oneTop, inner, oneHeight)
    const wash = ctx.createLinearGradient(PAD, 0, PAD + inner * 0.85, 0)
    wash.addColorStop(0, withAlpha(palette.accentDim, 0.35))
    wash.addColorStop(1, withAlpha(palette.accentDim, 0))
    ctx.fillStyle = wash
    ctx.fillRect(PAD, oneTop, inner, oneHeight)
    ctx.restore()
    outline(ctx, PAD, oneTop, inner, oneHeight, 24, palette.border)

    const art = 130
    const artX = PAD + 20
    const artY = oneTop + 20
    ctx.save()
    roundRect(ctx, artX, artY, art, art, 16)
    ctx.clip()
    if (cover) {
      coverFill(ctx, cover, artX, artY, art, art)
    } else {
      ctx.fillStyle = withAlpha(palette.accent, 0.3)
      ctx.fillRect(artX, artY, art, art)
      ctx.fillStyle = palette.text
      ctx.font = `700 56px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText(top.title.slice(0, 1), artX + art / 2, artY + art / 2 + 20)
      ctx.textAlign = 'left'
    }
    ctx.restore()

    const textX = artX + art + 28
    const textWidth = PAD + inner - textX - 24
    caps(ctx, 'YOUR NUMBER ONE', textX, oneTop + 48, palette.accent, 20, 3)
    ctx.fillStyle = palette.text
    ctx.font = `700 42px ${FONT}`
    ctx.fillText(fit(ctx, top.title, textWidth), textX, oneTop + 96)
    ctx.fillStyle = palette.secondary
    ctx.font = `500 26px ${FONT}`
    ctx.fillText(fit(ctx, top.artist || 'Unknown artist', textWidth), textX, oneTop + 130)
    ctx.fillStyle = palette.muted
    ctx.font = `500 22px ${FONT}`
    ctx.fillText(numberOneLine(top), textX, oneTop + 160)
  }

  // --- the rest of the songs, and the artists and tags ----------------------------------
  const listTop = oneTop + oneHeight + 58
  const column = (inner - 56) / 2
  ranked(
    ctx,
    palette,
    'TOP SONGS',
    PAD,
    listTop,
    column,
    wrapped.topSongs.slice(1, 1 + rowsFrom(listTop)).map((song, index) => ({
      rank: index + 2,
      name: song.title,
      plays: song.plays,
    })),
    null,
  )
  const right = PAD + column + 56
  const artists = wrapped.topArtists.slice(0, rowsFrom(listTop))
  ranked(
    ctx,
    palette,
    'TOP ARTISTS',
    right,
    listTop,
    column,
    artists.map((artist, index) => ({ rank: index + 1, name: artist.key, plays: artist.plays })),
    wrapped.topArtists[0]?.plays ?? 1,
  )
  // A library of one artist leaves the column mostly empty: the page's tags go under it.
  const tagsTop = listTop + 54 + Math.max(1, artists.length) * 50 + 6
  const tagRows = rowsFrom(tagsTop)
  if (wrapped.topTags.length > 0 && tagRows > 0) {
    ranked(
      ctx,
      palette,
      'TOP TAGS',
      right,
      tagsTop,
      column,
      wrapped.topTags
        .slice(0, tagRows)
        .map((tag, index) => ({ rank: index + 1, name: tag.key, plays: tag.plays })),
      wrapped.topTags[0]?.plays ?? 1,
    )
  }
}

/** How many ranked rows fit under a list title set at `titleY`, before the card's foot. */
function rowsFrom(titleY: number): number {
  return Math.max(0, Math.floor((HEIGHT - 52 - (titleY + 54)) / 50) + 1)
}

/** Letter-spaced capitals, the page's section labels. */
function caps(
  ctx: Context,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number,
  spacing: number,
): void {
  ctx.fillStyle = color
  ctx.font = `600 ${size}px ${FONT}`
  ctx.letterSpacing = `${spacing}px`
  ctx.fillText(text, x, y)
  ctx.letterSpacing = '0px'
}

/**
 * The traits as the page's pills, wrapping onto a second line at most. Returns
 * how many lines they took; with `paint` false it only measures.
 */
function chips(
  ctx: Context,
  palette: CardPalette,
  traits: readonly string[],
  x: number,
  y: number,
  width: number,
  paint = true,
): number {
  const height = 50
  let cursorX = x
  let line = 0
  let lines = 0
  ctx.font = `600 24px ${FONT}`
  for (const trait of traits) {
    const label = `✦  ${trait}`
    const chipWidth = ctx.measureText(label).width + 40
    if (cursorX + chipWidth > x + width && cursorX > x) {
      line++
      cursorX = x
    }
    if (line > 1) break
    lines = line + 1
    if (!paint) {
      cursorX += chipWidth + 12
      continue
    }
    const chipY = y + line * (height + 12)
    roundRect(ctx, cursorX, chipY, chipWidth, height, height / 2)
    ctx.fillStyle = withAlpha(palette.accent, 0.14)
    ctx.fill()
    ctx.strokeStyle = withAlpha(palette.accent, 0.45)
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = palette.accent
    ctx.fillText(label, cursorX + 20, chipY + 33)
    cursorX += chipWidth + 12
  }
  return lines
}

/** A titled, numbered list; with `max`, each row carries its share of the first as a bar. */
function ranked(
  ctx: Context,
  palette: CardPalette,
  title: string,
  x: number,
  y: number,
  width: number,
  rows: readonly { rank: number; name: string; plays: number }[],
  max: number | null,
): void {
  caps(ctx, title, x, y, palette.muted, 22, 3)
  if (rows.length === 0) {
    ctx.fillStyle = palette.muted
    ctx.font = `400 26px ${FONT}`
    ctx.fillText('nothing else yet', x, y + 52)
    return
  }
  rows.forEach((row, index) => {
    const rowY = y + 54 + index * 50
    if (max !== null) {
      roundRect(ctx, x, rowY - 32, (width * rankShare(row.plays, max)) / 100, 44, 10)
      ctx.fillStyle = withAlpha(palette.bar, 0.22)
      ctx.fill()
    }
    ctx.fillStyle = palette.accent
    ctx.font = `700 26px ${FONT}`
    ctx.fillText(`${row.rank}`, x + 12, rowY)
    // The count first, so the name knows how much room it has left.
    ctx.fillStyle = palette.secondary
    ctx.font = `600 24px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText(row.plays.toLocaleString(), x + width - 14, rowY)
    const countWidth = ctx.measureText(row.plays.toLocaleString()).width
    ctx.textAlign = 'left'
    ctx.fillStyle = palette.text
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(fit(ctx, row.name, width - countWidth - 86), x + 50, rowY)
  })
}

/**
 * The cover blurred past recognition, as the page's hero shows it. Drawn down
 * to a few pixels and back up, which blurs in every browser; `ctx.filter` does
 * not exist in Safari.
 */
function blurred(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const small = document.createElement('canvas')
  small.width = 12
  small.height = Math.max(1, Math.round((12 * height) / width))
  const smallCtx = small.getContext('2d')
  if (!smallCtx) return
  coverFill(smallCtx, image, 0, 0, small.width, small.height)
  ctx.save()
  ctx.globalAlpha = 0.75
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(small, x - width * 0.1, y - height * 0.1, width * 1.2, height * 1.2)
  ctx.restore()
}

/** Draw an image to fill a box, cropped from the middle like `resizeMode="cover"`. */
function coverFill(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const sw = width / scale
  const sh = height / scale
  ctx.drawImage(
    image,
    (image.naturalWidth - sw) / 2,
    (image.naturalHeight - sh) / 2,
    sw,
    sh,
    x,
    y,
    width,
    height,
  )
}

function outline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
): void {
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r)
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
  return `${cut}…`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** The cover, loaded for the canvas; null when it cannot be (no art, or no CORS). */
function loadImage(uri: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    // Its own request: the page already drew this cover without CORS, and the
    // browser would hand the canvas that cached copy, which it may not read.
    image.src = `${uri}${uri.includes('?') ? '&' : '?'}for=card`
  })
}

function render(
  wrapped: Wrapped,
  palette: CardPalette,
  cover: HTMLImageElement | null,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  draw(canvas, wrapped, palette, cover)
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(resolve, 'image/png')
    } catch (error) {
      // A cover served without CORS taints the canvas, and toBlob refuses it.
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/** Render the card and hand it to the browser as a download. */
export async function shareWrappedCard(
  wrapped: Wrapped,
  palette: CardPalette,
  coverUri: string | null,
): Promise<void> {
  const cover = coverUri ? await loadImage(coverUri) : null
  let blob = await render(wrapped, palette, cover).catch(() => null)
  // Without the cover rather than not at all.
  if (!blob && cover) blob = await render(wrapped, palette, null).catch(() => null)
  if (!blob) throw new Error('could not render the card')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = shareFileName(wrapped)
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking at once can cancel the download in Safari; a moment is enough.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
