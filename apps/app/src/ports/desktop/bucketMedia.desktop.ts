import type { DesktopBridge } from '@selfmp3/desktop-bridge'
import { holdBucket } from '@selfmp3/replica'

import type { MediaRoutes } from '../../api/mediaAddress.model'
import type { BucketMediaSetup } from '../bucketMedia.types'
import { doormanUrl } from '../doormanUrl'
import { desktop } from './bridge'

/**
 * Bucket songs the installed desktop app has not downloaded, streamed.
 *
 * The window's `<audio>` element cannot send the doorman's bearer header, so
 * a song's address is the shell's own, `app://selfmp3/_stream/<key>`, and the
 * main process asks the doorman with the header (apps/desktop/src/main/stream.ts).
 * It is handed the session here: the page keeps it beside the replica, which
 * the main process cannot read.
 *
 * Like the phone's twin (`../bucketMedia.ts`) the address is known only once
 * the player has said which key each song has and that there is a session
 * (`configure`), and is `''` until then — an honest "cannot play this". Covers
 * stay null: a computer keeps a bucket's covers as files, as a phone does.
 *
 * The shell is the first to hear the bucket refuse for the day, as a tab's
 * service worker is, and says so; the page's own reads then hold off too.
 */

const SIGNED_OUT: BucketMediaSetup = { pathOf: () => null, bearer: null }

interface DesktopBucketMedia {
  readonly routes: MediaRoutes
  configure(next: BucketMediaSetup | null): void
}

function over(bridge: DesktopBridge): DesktopBucketMedia {
  let setup = SIGNED_OUT
  let hearing = false

  return {
    routes: {
      stream: songId => {
        const key = setup.bearer === null ? null : setup.pathOf(songId)
        return key === null ? '' : bridge.bucket.streamUrl(key)
      },
      art: () => null,
    },

    configure(next) {
      setup = next ?? SIGNED_OUT
      if (!hearing) {
        hearing = true
        bridge.bucket.onCapped(message => holdBucket(message, 'read'))
      }
      const token = setup.bearer
      void bridge.bucket.use(token === null ? null : { doormanUrl, token }).catch(() => {
        // The shell refused the session's shape: songs not here say they cannot be had.
      })
    },
  }
}

/** Null outside the installed app, where a browser's service worker attaches the header. */
export const desktopBucketMedia = desktop ? over(desktop) : null
