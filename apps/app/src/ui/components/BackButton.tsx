import type { ReactNode } from 'react'
import type { Href } from 'expo-router'
import { useUnistyles } from 'react-native-unistyles'
import { usePageBack } from '../useBackTo'
import { IconButton } from './IconButton'
import { ChevronLeft } from './Icons'

/** What a page's way back is told: where it falls back to, and whether it is its own. */
export interface BackProps {
  /** Where it goes when there is no page behind this one: a link, a reload. */
  to?: Href
  /**
   * The page's own way back, in place of going back a page: a tag's page
   * shrinks into the tile it grew from first.
   */
  onPress?: () => void
  /**
   * Drawn on a computer too, even for a page the sidebar opened: a song's or
   * an answer's page, which the sidebar never opens.
   */
  always?: boolean
  testID?: string
}

/**
 * The way back from a page that was opened from another: a round ‹ at the
 * head's left, as the month page has (docs/ui-mock `P33`), with the page's
 * title under it on a phone.
 *
 * One control for all of them: three ways back that look like three
 * different things are three things to learn. Every page's ‹ is this one, so
 * its size, its fill and when it shows are decided here and nowhere else.
 *
 * Back to the page you were just on; `to` only when there is none (J1,
 * `usePageBack`). A computer draws it only for a page opened from inside
 * another: what the sidebar opens has the sidebar — unless `always`.
 */
export function BackButton({ to = '/', onPress, always = false, testID }: BackProps): ReactNode {
  const { theme } = useUnistyles()
  const { shown, back } = usePageBack(to)
  if (!shown && !always) return null
  return (
    <IconButton label="Back" filled onPress={onPress ?? back} testID={testID}>
      <ChevronLeft size={20} color={theme.colors.textPrimary} />
    </IconButton>
  )
}
