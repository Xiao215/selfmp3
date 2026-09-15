import type { ReactNode } from 'react'
import { StatsScreen } from '../../src/features/stats/StatsScreen'

/** The listening report's route: the same Stats page, opened on its Report tab. */
export default function ReportRoute(): ReactNode {
  return <StatsScreen initialTab="report" />
}
