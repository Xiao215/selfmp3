import type { Href, useRouter } from 'expo-router'
import { leaveStage, stageCovers } from '../../shell/stageExit'
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

/** How long a link waits for Now Playing to go down before it is followed regardless. */
const LINK_WAIT_MS = 1500

/** A link to Now Playing itself, which has nothing to put away first. */
const TO_NOW_PLAYING = /^(?:[a-z][a-z0-9+.-]*:)?\/*now-playing(?:[/?#]|$)/i

/**
 * Before a link the system handed the app is followed (`app/+native-intent`):
 * the phone's Now Playing put away, as `leaveTo` puts it away. Expo Router
 * opens a link's page on the stack it finds, and with Now Playing up that is
 * the modal's: the page was drawn inside it, over the shell's overlay host,
 * so the page's own confirmations opened out of sight and its buttons did
 * nothing (R3-m5). Resolves once the modal has gone, or after a while
 * regardless, so a link is never lost to an exit that was stopped or was
 * already on its way.
 */
export function putAwayForLink(router: Router, path: string): Promise<void> {
  if (!stageCovers() || TO_NOW_PLAYING.test(path)) return Promise.resolve()
  return new Promise(resolve => {
    let followed = false
    const timer = setTimeout(() => {
      followed = true
      resolve()
    }, LINK_WAIT_MS)
    leaveStage(() => {
      clearTimeout(timer)
      // Too late: the link's page is up by now, and back would take it away.
      if (followed) return
      if (router.canGoBack()) router.back()
      resolve()
    })
  })
}
