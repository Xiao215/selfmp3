import type { Href, useRouter } from 'expo-router'
import { leaveStage } from '../../shell/stageExit'
import { goBack } from '../../ui/useBackTo'

type Router = ReturnType<typeof useRouter>

/**
 * Putting Now Playing away. The address names the song, so the page can be
 * the first one there is — a refresh, a copied link — and then there is
 * nothing to go back to: Home is where closing it lands. Going back
 * regardless did nothing at all, and the router said so.
 *
 * Through `leaveStage`, so the page sinks to the foot (the phone) or goes
 * back down (a computer) before the route changes, rather than being cut away
 * under a router that swaps routes at once (`shell/stageExit.ts`). Two quick
 * presses start one sink and go back once.
 */
export function putAway(router: Router): void {
  leaveStage(() => goBack(router, '/'))
}

/**
 * Leaving the phone's Now Playing for a page of the app: the song's own page,
 * a tag, an artist. The phone presents Now Playing as a modal over the whole
 * app, and a page pushed from inside it landed under the modal, out of sight.
 * So the modal goes down first, and then the page is pushed — down and then
 * along, not both at once — so back from it lands where Now Playing was opened.
 */
export function leaveTo(router: Router, href: Href): void {
  leaveStage(() => {
    if (router.canGoBack()) router.back()
    router.push(href)
  })
}
