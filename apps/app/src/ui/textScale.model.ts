/** The size a browser's text is set at before anyone changes it. */
const BROWSER_DEFAULT_PX = 16

/**
 * How far past its own sizes the app's type goes for a browser's font-size
 * setting. Larger only: a smaller setting is not a request to shrink a type
 * scale already set for reading. No more than half again, past which rows and
 * pills sized for one line of text would cut their words off.
 */
export const MOST_TEXT_SCALE = 1.5

/** The text scale for a page whose root font size is `rootPx`. */
export function textScaleFor(rootPx: number): number {
  if (!Number.isFinite(rootPx) || rootPx <= BROWSER_DEFAULT_PX) return 1
  return Math.min(rootPx / BROWSER_DEFAULT_PX, MOST_TEXT_SCALE)
}

/** `sizes` scaled by `scale`, each to a whole point. */
export function scaledSizes<K extends string>(
  sizes: Readonly<Record<K, number>>,
  scale: number,
): Record<K, number> {
  const scaled = {} as Record<K, number>
  for (const key of Object.keys(sizes) as K[]) scaled[key] = Math.round(sizes[key] * scale)
  return scaled
}
