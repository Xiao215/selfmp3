import type { ViewStyle } from 'react-native'

/** A browser blurs the layer itself, and react-native-web passes it through. */
export function blurLayer(radius: number): ViewStyle | undefined {
  return radius > 0 ? ({ filter: `blur(${radius}px)` } as unknown as ViewStyle) : undefined
}
