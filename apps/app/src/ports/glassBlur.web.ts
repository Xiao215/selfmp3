import type { ThemePalette } from '@selfmp3/client'

/**
 * A browser blurs what scrolls under the glass itself, with `backdrop-filter`,
 * which react-native-web passes through to the element's style.
 */
export const glassBlur = {
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
} as const

/** Translucent, because the blur behind it turns the page into light. */
export function glassFill(colors: ThemePalette): string {
  return colors.glass
}
