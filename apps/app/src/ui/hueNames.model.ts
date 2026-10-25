/**
 * What a tag's colour is called, for a screen reader: "Hue 138" said nothing
 * a listener could picture, where Settings' accents were already "Violet".
 * Each of the swatches' hues has its own name; any other hue (a tag's own,
 * leading the row) takes the nearest one's.
 */
const NAMES: readonly (readonly [hue: number, name: string])[] = [
  [0, 'Red'],
  [22, 'Coral'],
  [40, 'Orange'],
  [58, 'Amber'],
  [95, 'Lime'],
  [140, 'Green'],
  [168, 'Jade'],
  [192, 'Teal'],
  [212, 'Sky'],
  [235, 'Blue'],
  [262, 'Indigo'],
  [290, 'Purple'],
  [318, 'Magenta'],
]

/** The way round the wheel from `a` to `b`, whichever way is shorter. */
function around(a: number, b: number): number {
  const apart = Math.abs((((a - b) % 360) + 360) % 360)
  return Math.min(apart, 360 - apart)
}

export function hueName(hue: number): string {
  let best = NAMES[0] as readonly [number, string]
  for (const entry of NAMES) if (around(hue, entry[0]) < around(hue, best[0])) best = entry
  return best[1]
}

/**
 * A name set inside other words, kept to its own direction: an Arabic tag
 * ending in a number, in "Tag …", had its number jump to the left of it.
 * Unicode's first-strong isolate, which every platform's text draws.
 */
export function isolated(text: string): string {
  return `⁨${text}⁩`
}
