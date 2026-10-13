import { useCallback } from 'react'
import { useRouter, type Href } from 'expo-router'
import { noteTagUsed } from '../library/recentTags.store'
import { enterFromSidebar } from '../../shell/sidebarEntry'
import { tagFromTileLink, tagLink } from './placeLinks'

/** How a tag is being opened, where its page should know. */
interface OpenTagHow {
  /**
   * The door it came through: a Home tile, which the page grows out of and
   * goes back into, or the sidebar (or the palette's Go to), whose pages wear
   * no ‹ on a computer (J1).
   */
  readonly from?: 'tile' | 'sidebar'
  /**
   * Going there some other way than the router: the phone's Now Playing is a
   * modal over the app, and puts itself away first (`leaveTo`).
   */
  readonly go?: (href: Href) => void
}

/**
 * Open a tag's page, from anywhere one is opened: a tile, a chip on a row or
 * in a menu, the sidebar, a search, a ranking. Every open counts as using the
 * tag (Xiao, 2026-10-13), so the sidebar's recent tags lead with what was
 * reached for last whichever door it was — it used to miss Home, Now Playing,
 * the song menu, the song's page, Stats and an artist's page, each of which
 * navigated by hand.
 *
 * Made once per router, so a list handing it to every row keeps its rows' memo.
 */
export function useOpenTag(): (
  tag: { readonly id: number; readonly name: string },
  how?: OpenTagHow,
) => void {
  const router = useRouter()
  return useCallback(
    (tag, how = {}) => {
      noteTagUsed(tag.id)
      if (how.from === 'sidebar') enterFromSidebar()
      const href = how.from === 'tile' ? tagFromTileLink(tag.name) : tagLink(tag.name)
      if (how.go) how.go(href)
      else router.navigate(href)
    },
    [router],
  )
}
