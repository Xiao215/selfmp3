import { WRAPPED_RANGE_LABELS, type Wrapped } from '@selfmp3/shared'

/**
 * The shareable Wrapped card, drawn to a canvas.
 *
 * 1080×1080 because that is what every social app crops to, and drawn rather
 * than screenshotted so the result is the same on a phone and a laptop and does
 * not include the app chrome. Colours are read from the live stylesheet, so a
 * card made with a different accent hue matches the app it came from.
 *
 * No image library: this is a few dozen `fillText` calls, and shipping a
 * renderer to render text would be absurd.
 */

export const CARD_SIZE = 1080

/** The tokens the card uses, resolved to real colours. */
export interface CardPalette {
  readonly background: string
  readonly surface: string
  readonly accent: string
  readonly accentDim: string
  readonly text: string
  readonly secondary: string
  readonly muted: string
}

/**
 * Resolve CSS custom properties to concrete colours.
 *
 * Reading `--accent` off the root gives back the literal
 * `oklch(0.72 0.16 var(--accent-hue))`, which canvas cannot parse. Assigning it
 * to a real element's `color` and reading the computed value makes the browser
 * do the substitution for us.
 */
export function readPalette(root: HTMLElement = document.documentElement): CardPalette {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  root.appendChild(probe)

  const resolve = (token: string, fallback: string): string => {
    probe.style.color = ''
    probe.style.color = `var(${token})`
    const value = getComputedStyle(probe).color
    return value && value !== 'rgba(0, 0, 0, 0)' ? value : fallback
  }

  const palette: CardPalette = {
    background: resolve('--surface-0', '#16151c'),
    surface: resolve('--surface-1', '#1d1c25'),
    accent: resolve('--accent', '#a78bfa'),
    accentDim: resolve('--accent-dim', '#4c3d80'),
    text: resolve('--text-primary', '#f5f4f8'),
    secondary: resolve('--text-secondary', '#bdb9c8'),
    muted: resolve('--text-muted', '#8b8798'),
  }

  probe.remove()
  return palette
}

const FONT = `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif`

/** Draw the whole card. The canvas is resized to 1080×1080 first. */
export function drawWrappedCard(
  canvas: HTMLCanvasElement,
  wrapped: Wrapped,
  palette: CardPalette,
): void {
  canvas.width = CARD_SIZE
  canvas.height = CARD_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const pad = 84

  // Background: the app's darkest surface, lifted toward the accent in one
  // corner so the card is not a flat rectangle.
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE)

  const glow = ctx.createRadialGradient(CARD_SIZE, 0, 0, CARD_SIZE, 0, CARD_SIZE * 1.1)
  glow.addColorStop(0, palette.accentDim)
  glow.addColorStop(1, 'transparent')
  ctx.globalAlpha = 0.75
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE)
  ctx.globalAlpha = 1

  ctx.textBaseline = 'alphabetic'

  // --- header --------------------------------------------------------------
  ctx.fillStyle = palette.muted
  ctx.font = `600 26px ${FONT}`
  ctx.letterSpacing = '4px'
  ctx.fillText('SELF.MP3 · WRAPPED', pad, pad + 26)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = palette.secondary
  ctx.font = `500 26px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(WRAPPED_RANGE_LABELS[wrapped.range], CARD_SIZE - pad, pad + 26)
  ctx.textAlign = 'left'

  // --- hero ----------------------------------------------------------------
  const minutes = Math.round(wrapped.totals.minutes)
  ctx.fillStyle = palette.text
  ctx.font = `700 148px ${FONT}`
  ctx.fillText(minutes.toLocaleString(), pad, 320)

  ctx.fillStyle = palette.accent
  ctx.font = `600 40px ${FONT}`
  ctx.fillText('minutes listened', pad, 378)

  // Three supporting numbers, evenly spaced.
  const facts: ReadonlyArray<[string, string]> = [
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

  // --- lists ---------------------------------------------------------------
  const columnWidth = (CARD_SIZE - pad * 2 - 60) / 2
  drawList(
    ctx,
    palette,
    'TOP SONGS',
    pad,
    590,
    columnWidth,
    wrapped.topSongs.map(song => [song.title, `${song.plays}`]),
  )
  drawList(
    ctx,
    palette,
    'TOP ARTISTS',
    pad + columnWidth + 60,
    590,
    columnWidth,
    wrapped.topArtists.map(artist => [artist.key, `${artist.plays}`]),
  )

  // --- footer --------------------------------------------------------------
  ctx.fillStyle = palette.surface
  roundRect(ctx, pad, CARD_SIZE - pad - 148, CARD_SIZE - pad * 2, 148, 26)
  ctx.fill()

  ctx.fillStyle = palette.muted
  ctx.font = `600 22px ${FONT}`
  ctx.letterSpacing = '3px'
  ctx.fillText('LISTENING PERSONALITY', pad + 36, CARD_SIZE - pad - 92)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = palette.accent
  ctx.font = `650 40px ${FONT}`
  ctx.fillText(
    fit(ctx, wrapped.personality.line || 'Casual listener', CARD_SIZE - pad * 2 - 72),
    pad + 36,
    CARD_SIZE - pad - 42,
  )
}

/** A titled, numbered list — top songs and top artists share the shape. */
function drawList(
  ctx: CanvasRenderingContext2D,
  palette: CardPalette,
  title: string,
  x: number,
  y: number,
  width: number,
  rows: ReadonlyArray<readonly [string, string]>,
): void {
  ctx.fillStyle = palette.muted
  ctx.font = `600 22px ${FONT}`
  ctx.letterSpacing = '3px'
  ctx.fillText(title, x, y)
  ctx.letterSpacing = '0px'

  if (rows.length === 0) {
    ctx.fillStyle = palette.muted
    ctx.font = `400 26px ${FONT}`
    ctx.fillText('nothing yet', x, y + 52)
    return
  }

  rows.slice(0, 5).forEach((row, index) => {
    const lineY = y + 56 + index * 52

    ctx.fillStyle = palette.accent
    ctx.font = `650 26px ${FONT}`
    ctx.fillText(`${index + 1}`, x, lineY)

    // The count is drawn first so the title knows how much room it has left.
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

/** Truncate with an ellipsis to fit `maxWidth` in the current font. */
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
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

/** A filename that sorts sensibly and says what it is. */
export function shareFileName(wrapped: Wrapped): string {
  return `selfmp3-wrapped-${wrapped.range}-${wrapped.to.slice(0, 10)}.png`
}

/**
 * Render the card and hand it to the browser as a download.
 *
 * Resolves once the blob exists, so the caller can show a spinner and report a
 * failure rather than guessing.
 */
export async function downloadWrappedCard(wrapped: Wrapped, palette: CardPalette): Promise<void> {
  const canvas = document.createElement('canvas')
  drawWrappedCard(canvas, wrapped, palette)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('could not render the card')

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = shareFileName(wrapped)
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in Safari; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
