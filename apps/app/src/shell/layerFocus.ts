import type { RefObject } from 'react'

/**
 * A modal layer taking focus as it opens and giving it back as it closes
 * (`layerFocus.web.ts`). A phone has no focus to move: VoiceOver and TalkBack
 * are kept to the layer by the page being hidden from them (`OverlayProvider`).
 */
export function useLayerFocus(_ref: RefObject<unknown>, _modal: boolean): void {}

/**
 * The topmost modal layer's Tab and arrow keys (`layerFocus.web.ts`). An
 * iPad's keyboard moves through the layer on the system's own terms.
 */
export function useLayerKeys(_top: () => unknown): void {}
