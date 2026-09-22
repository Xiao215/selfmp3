import type { ReactNode } from 'react'
import { Ellipse, Path, Rect, Svg } from 'react-native-svg'
import { type IconTone, useInk } from './Icons'

/**
 * The app mark: the beamed pair of eighth notes, in this device's accent.
 *
 * It sits apart from the icon set because it is not one of them — it is drawn
 * on a 512-unit grid rather than 24, it is filled rather than stroked, and it
 * falls back to the accent instead of secondary text.
 */
export function BrandMark({
  size = 22,
  color: colorGiven,
  tone,
}: {
  size?: number
  color?: string
  tone?: IconTone
}): ReactNode {
  const color = useInk(colorGiven, tone, 'accent')
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill={color}>
      {/* The beam, then the two stems it joins. */}
      <Path d="M186 168 L370 130 L370 190 L186 228 Z" />
      <Rect x="186" y="168" width="26" height="180" rx="13" />
      <Rect x="344" y="130" width="26" height="180" rx="13" />
      {/* Noteheads: ellipses, leaning the way a written note does. */}
      <Ellipse cx="152" cy="348" rx="52" ry="39" transform="rotate(-22 152 348)" />
      <Ellipse cx="310" cy="310" rx="52" ry="39" transform="rotate(-22 310 310)" />
    </Svg>
  )
}
