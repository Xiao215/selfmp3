import { leading, type } from '@selfmp3/client'

import type { textScale as SameShape } from './textScale'
import { scaledSizes, textScaleFor } from '../ui/textScale.model'

/**
 * A browser's font-size setting, which react-native-web's sizes, all in
 * pixels, never heard: set to Very large, the root's text doubled and a
 * song's title stayed 15. The setting is the root's font size, read once as
 * the app starts, before any stylesheet is made (`index.ts` imports this
 * first), and the type scale and its line heights are scaled to it in place.
 * A change to the setting takes a reload, as it does for most of the web.
 */
function readScale(): number {
  if (typeof document === 'undefined') return 1
  return textScaleFor(parseFloat(getComputedStyle(document.documentElement).fontSize))
}

export const textScale: typeof SameShape = readScale()

if (textScale !== 1) {
  Object.assign(type, scaledSizes(type, textScale))
  Object.assign(leading, scaledSizes(leading, textScale))
}
