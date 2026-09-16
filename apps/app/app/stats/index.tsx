import type { ReactNode } from 'react'
import { StatsViaServer } from '../../src/features/stats/StatsViaServer'

/** The stats route: a thin file that renders its feature, on the Overview tab. */
export default function StatsRoute(): ReactNode {
  return <StatsViaServer initialTab="overview" />
}
