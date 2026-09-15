import type { ReactNode } from 'react'
import { StatsScreen } from '../../src/features/stats/StatsScreen'

/** The stats route: a thin file that renders its feature, on the Overview tab. */
export default function StatsRoute(): ReactNode {
  return <StatsScreen initialTab="overview" />
}
