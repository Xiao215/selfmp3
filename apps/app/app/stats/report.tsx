import type { ReactNode } from 'react'
import { StatsViaServer } from '../../src/features/stats/StatsViaServer'

/** The listening report's route: the same Stats page, opened on its Report tab. */
export default function ReportRoute(): ReactNode {
  return <StatsViaServer initialTab="report" />
}
