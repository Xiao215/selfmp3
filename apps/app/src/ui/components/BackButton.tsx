import type { ReactNode } from 'react'
import { useUnistyles } from 'react-native-unistyles'
import { useLayout } from '../../shell/useLayout'
import { useBackTo } from './BackRow'
import { IconButton } from './IconButton'
import { ChevronLeft } from './Icons'

/**
 * The way back from a page that was opened from another: a round ‹ at the
 * head's left, as the month page has (docs/ui-mock `P33`).
 *
 * One control for all of them. Profile's three pages each drew their own —
 * a text row on two, this button on the third — and three ways back that
 * look like three different things is three things to learn (Xiao,
 * 2026-09-20).
 *
 * Back when the page behind is the one it names, and in its place otherwise
 * (`backRow.model.ts`), so it never stacks pages up. A computer reaches all
 * of them from the sidebar, which is always there, and draws nothing.
 */
export function BackButton({
  to,
  label,
  testID,
  always = false,
}: {
  /** Where it goes when this page was not opened from there. */
  to: string
  /** That page, as it names itself: "Profile", "Stats". */
  label: string
  testID?: string
  /** Show it at every width, for a page a computer also opens over another. */
  always?: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const { wide } = useLayout()
  const backTo = useBackTo()
  if (wide && !always) return null
  return (
    <IconButton label={`Back to ${label}`} filled onPress={() => backTo(to)} testID={testID}>
      <ChevronLeft size={22} color={theme.colors.textPrimary} />
    </IconButton>
  )
}
