import type { ReactNode } from 'react'
import { useUnistyles } from 'react-native-unistyles'
import { usePageBack } from '../useBackTo'
import { IconButton } from './IconButton'
import { ChevronLeft } from './Icons'

/**
 * The way back from a page that was opened from another: a round ‹ at the
 * head's left, as the month page has (docs/ui-mock `P33`), with the page's
 * title under it on a phone.
 *
 * One control for all of them. Profile's three pages each drew their own —
 * a text row on two, this button on the third — and three ways back that
 * look like three different things is three things to learn (Xiao,
 * 2026-09-20).
 *
 * Back to the page you were just on; `to` only when there is none (J1,
 * `usePageBack`). A computer draws it only for a page opened from inside
 * another: what the sidebar opens has the sidebar.
 */
export function BackButton({
  to,
  testID,
}: {
  /** Where it goes when there is no page behind this one: a link, a reload. */
  to: string
  testID?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const { shown, back } = usePageBack(to as never)
  if (!shown) return null
  return (
    <IconButton label="Back" filled onPress={back} testID={testID}>
      <ChevronLeft size={22} color={theme.colors.textPrimary} />
    </IconButton>
  )
}
