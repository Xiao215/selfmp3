import type { ViewStyle } from 'react-native'

/**
 * Blurring a layer and everything in it.
 *
 * A browser's `filter`, and nothing here. React Native implements `filter` on
 * the New Architecture, but the blur of a whole layer is what a phone pays
 * most for and it has drawn as nothing at all in this app before — the cover
 * glow behind Now Playing was three hard-edged discs on an iPad until it was
 * redrawn as gradients. Anything that must look blurred on a phone is drawn
 * blurred instead (a gradient, `Image`'s own `blurRadius`), not filtered.
 */
export function blurLayer(_radius: number): ViewStyle | undefined {
  return undefined
}
