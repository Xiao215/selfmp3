import type { ReactNode } from 'react'
import { useLayout } from '../../shell/useLayout'
import { BackRow } from './BackRow'

/**
 * "‹ You", on a phone, above the title of a page the You tab leads to: Stats,
 * Tags and Settings.
 *
 * A phone has four tabs, and those four pages share the last one, so each
 * needs a way back to the list it was chosen from. A computer reaches all of
 * them from the sidebar, which is always there, and draws nothing.
 */
export function BackToYou(): ReactNode {
  const { wide } = useLayout()
  if (wide) return null
  return <BackRow label="You" href="/you" testID="back-to-you" />
}
