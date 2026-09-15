import { useMemo } from 'react'
import type { ReactNode } from 'react'
import Svg, { Path } from 'react-native-svg'
import { energyWavePath } from '@selfmp3/client'
import { useAccent } from '../accent'

/**
 * A song's energy as a small wave, drawn with react-native-svg from the path
 * `packages/client` computes.
 */
export function EnergyWave({
  energy,
  width = 22,
  height = 12,
  color,
}: {
  energy: number
  width?: number
  height?: number
  color?: string
}): ReactNode {
  const accent = useAccent()
  const path = useMemo(() => energyWavePath(energy, width, height), [energy, width, height])
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      accessibilityRole="image"
      accessibilityLabel={`Energy ${Math.round(energy * 100)} of 100`}
    >
      <Path
        d={path}
        fill="none"
        stroke={color ?? accent.accent}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
