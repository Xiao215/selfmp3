import { WRAPPED_RANGE_LABELS, type Wrapped } from '@selfmp3/shared'
import { shareFileName } from '../features/wrapped/wrapped.model'
import type { CardPalette } from './shareCard.types'

/**
 * The shareable Wrapped card, drawn to a canvas: the web's `lib/wrappedCard.ts`.
 *
 * 1080×1080 because that is what every social app crops to, and drawn rather
 * than screenshotted so it is the same everywhere and has no app chrome. The
 * colours are the theme on screen, passed in already resolved.
 */
export const canShareCard = true

const SIZE = 1080
const FONT = `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif`

type Context = CanvasRenderingContext2D & { letterSpacing?: string }

function draw(canvas: HTMLCanvasElement, wrapped: Wrapped, palette: CardPalette): void {
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d') as Context | null
  if (!ctx) return
  const pad = 84

  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, SIZE, SIZE)
  const glow = ctx.createRadialGradient(SIZE, 0, 0, SIZE, 0, SIZE * 1.1)
  glow.addColorStop(0, palette.accentDim)
  glow.addColorStop(1, 'transparent')
  ctx.globalAlpha = 0.75
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.globalAlpha = 1
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = palette.muted
  ctx.font = `600 26px ${FONT}`
  ctx.letterSpacing = '4px'
  ctx.fillText('SELF.MP3 · WRAPPED', pad, pad + 26)
  ctx.letterSpacing = '0px'
  ctx.fillStyle = palette.secondary
  ctx.font = `500 26px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(WRAPPED_RANGE_LABELS[wrapped.range], SIZE - pad, pad + 26)
  ctx.textAlign = 'left'

  ctx.fillStyle = palette.text
  ctx.font = `700 148px ${FONT}`
  ctx.fillText(Math.round(wrapped.totals.minutes).toLocaleString(), pad, 320)
  ctx.fillStyle = palette.accent
  ctx.font = `600 40px ${FONT}`
  ctx.fillText('minutes listened', pad, 378)

  const facts: readonly [string, string][] = [
    [wrapped.totals.plays.toLocaleString(), 'plays'],
    [wrapped.totals.songsPlayed.toLocaleString(), 'songs'],
    [
      `${wrapped.longestStreakDays}`,
      wrapped.longestStreakDays === 1 ? 'day streak' : 'days in a row',
    ],
  ]
  facts.forEach(([value, label], index) => {
    const x = pad + index * 300
    ctx.fillStyle = palette.text
    ctx.font = `650 52px ${FONT}`
    ctx.fillText(value, x, 470)
    ctx.fillStyle = palette.muted
    ctx.font = `500 25px ${FONT}`
    ctx.fillText(label, x, 506)
  })

  const column = (SIZE - pad * 2 - 60) / 2
  list(
    ctx,
    palette,
    'TOP SONGS',
    pad,
    590,
    column,
    wrapped.topSongs.map(s => [s.title, `${s.plays}`]),
  )
  list(
    ctx,
    palette,
    'TOP ARTISTS',
    pad + column + 60,
    590,
    column,
    wrapped.topArtists.map(a => [a.key, `${a.plays}`]),
  )

  ctx.fillStyle = palette.surface
  roundRect(ctx, pad, SIZE - pad - 148, SIZE - pad * 2, 148, 26)
  ctx.fill()
  ctx.fillStyle = palette.muted
  ctx.font = `600 22px ${FONT}`
  ctx.letterSpacing = '3px'
  ctx.fillText('LISTENING PERSONALITY', pad + 36, SIZE - pad - 92)
  ctx.letterSpacing = '0px'
  ctx.fillStyle = palette.accent
  ctx.font = `650 40px ${FONT}`
  ctx.fillText(
    fit(ctx, wrapped.personality.line || 'Casual listener', SIZE - pad * 2 - 72),
    pad + 36,
    SIZE - pad - 42,
  )
}

/** A titled, numbered list: top songs and top artists share the shape. */
function list(
  ctx: Context,
  palette: CardPalette,
  title: string,
  x: number,
  y: number,
  width: number,
  rows: readonly (readonly [string, string])[],
): void {
  ctx.fillStyle = palette.muted
  ctx.font = `600 22px ${FONT}`
  ctx.letterSpacing = '3px'
  ctx.fillText(title, x, y)
  ctx.letterSpacing = '0px'
  if (rows.length === 0) {
    ctx.font = `400 26px ${FONT}`
    ctx.fillText('nothing yet', x, y + 52)
    return
  }
  rows.slice(0, 5).forEach((row, index) => {
    const lineY = y + 56 + index * 52
    ctx.fillStyle = palette.accent
    ctx.font = `650 26px ${FONT}`
    ctx.fillText(`${index + 1}`, x, lineY)
    // The count first, so the title knows how much room it has left.
    ctx.fillStyle = palette.muted
    ctx.font = `500 24px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText(row[1], x + width, lineY)
    const countWidth = ctx.measureText(row[1]).width
    ctx.textAlign = 'left'
    ctx.fillStyle = palette.text
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(fit(ctx, row[0], width - countWidth - 60), x + 38, lineY)
  })
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

/** Render the card and hand it to the browser as a download. */
export async function shareWrappedCard(wrapped: Wrapped, palette: CardPalette): Promise<void> {
  const canvas = document.createElement('canvas')
  draw(canvas, wrapped, palette)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
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
