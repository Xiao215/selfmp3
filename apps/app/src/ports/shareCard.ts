import type { Wrapped } from '@selfmp3/shared'
import type { CardPalette } from './shareCard.types'

/**
 * Sharing Wrapped as an image, on a phone: not yet.
 *
 * The web draws the card on a canvas. A phone has no canvas without an Expo DOM
 * component, which needs a webview module and a native build (docs/UNIVERSAL.md,
 * "Stack": canvas work), so the button is not offered here.
 */
export const canShareCard = false

export function shareWrappedCard(
  _wrapped: Wrapped,
  _palette: CardPalette,
  _coverUri: string | null,
): Promise<void> {
  return Promise.reject(new Error('Sharing Wrapped as an image is not on this device yet.'))
}
