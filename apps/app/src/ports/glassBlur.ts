import type { ThemePalette } from '@selfmp3/client'

/**
 * The blur behind glass (docs/ui-mock `S2`, "Glass"): the floating bar, the
 * search circle, controls over artwork.
 *
 * A phone draws the translucent fill alone. The blur would need `expo-blur`,
 * a native module (docs/UI-MIGRATION.md, Open question 6).
 */
export const glassBlur = {} as const

/**
 * The fill of a bar that floats over the page.
 *
 * Opaque here, because nothing blurs behind it: the eight per cent of the
 * page that came through was a wash once the web had blurred it, and the
 * page's own words, still legible, reading up through the tab bar once it
 * had not.
 */
export function glassFill(colors: ThemePalette): string {
  return colors.glassSolid
}
