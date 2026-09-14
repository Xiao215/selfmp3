import type { ReactNode } from 'react'
import { Redirect } from 'expo-router'

/** The report's old address. A saved link or bookmark still lands on it. */
export default function WrappedRedirect(): ReactNode {
  return <Redirect href="/stats/report" />
}
