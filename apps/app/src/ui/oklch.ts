/**
 * OKLCH to a hex colour, because React Native cannot do it itself.
 *
 * The web app builds every colour from `oklch(L C var(--accent-hue))` and lets
 * the browser resolve it, which is what keeps the palette evenly weighted as
 * the hue moves — the same lightness really does look the same lightness, in a
 * way HSL never manages. React Native has no OKLCH and no custom properties,
 * so the same arithmetic happens here and the result is handed over as hex.
 *
 * The conversion is the standard one: OKLCH → OKLab → LMS → linear sRGB →
 * sRGB, with the matrices from Björn Ottosson's original description.
 */

/** `0.72 0.16 268` → `#8f8cf2`. Out-of-gamut colours are clipped per channel. */
export function oklchToHex(lightness: number, chroma: number, hueDegrees: number): string {
  const hue = (hueDegrees * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)

  // OKLab to the cone responses, which is where the cube roots come out.
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.089484178 * a - 1.291485548 * b) ** 3

  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return `#${channel(red)}${channel(green)}${channel(blue)}`
}

/**
 * The same colour with an alpha, as `#rrggbbaa` — React Native reads that
 * form, and it is how the web's `oklch(L C H / a)` tints come across.
 */
export function oklchToHexAlpha(
  lightness: number,
  chroma: number,
  hueDegrees: number,
  alpha: number,
): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  return `${oklchToHex(lightness, chroma, hueDegrees)}${byte.toString(16).padStart(2, '0')}`
}

/** One linear-light channel as two hex digits, gamma-encoded and clipped. */
function channel(linear: number): string {
  const encoded =
    linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.abs(linear) ** (1 / 2.4) - 0.055
  const byte = Math.round(Math.min(1, Math.max(0, encoded)) * 255)
  return byte.toString(16).padStart(2, '0')
}
