import { useCallback, useMemo } from 'react'
import { useRouter } from 'expo-router'
import { useDownloads } from '../../offline/DownloadsProvider'
import { library as cloudLibrary, session as cloudSession } from '../../replica'
import { forgetCovers } from '../../offline/covers'
import { libraryCache, lyricsCache, motionCache, playlistCache } from '../../offline/caches'
import { clearRecent } from '../../ports/recentCopies'
import { forgetWaitingEdits } from '../../offline/waitingEdits'
import { useConnection } from '../../connection/ConnectionProvider'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { SIGNED_OUT_ROUTE, forgetAccount, signOutOfCloud, type ForgetSteps } from './signOut'

/**
 * What this device keeps of an account, each step wired to the app
 * (`signOut.ts` has the order and the reasons).
 */
function useForgetSteps(): ForgetSteps {
  const { forgetExcluded, queue: downloadQueue } = useDownloads()
  return useMemo(
    () => ({
      forgetLibrary: async () => {
        await cloudLibrary.forgetCloudLibrary()
        await cloudSession.clearEnded()
      },
      removeDownloads: () => {
        // The copies kept for having been played go with the downloads.
        clearRecent()
        return downloadQueue.removeAll()
      },
      forgetSavedLibrary: async () => {
        // Edits held for a server name its ids too; none is sent to the next library.
        forgetWaitingEdits()
        await libraryCache.clear()
        // All found by id, and another account's library hands the same
        // ids to other songs and playlists: anything kept would be the
        // wrong words, curve, members or picture.
        await Promise.all([
          playlistCache.clear(),
          lyricsCache.clear(),
          motionCache.clear(),
          forgetCovers(),
        ])
      },
      forgetExcluded,
    }),
    [forgetExcluded, downloadQueue],
  )
}

/**
 * Signing this device out, with every step wired to the app. Settings
 * confirms first; Where it lives, which a person may reach with the wrong
 * account, offers it under the address.
 */
export function useSignOut(): () => Promise<void> {
  const router = useRouter()
  const { signedOutOfCloud } = useConnection()
  const player = usePlayerCommands()
  const forget = useForgetSteps()

  return useCallback(
    () =>
      signOutOfCloud({
        stopPlaying: () => player.clearQueue(),
        sendPendingChanges: () => cloudLibrary.flushCloudChanges(),
        endSession: async () => {
          const session = await cloudSession.loadSession()
          if (session) await cloudSession.signOut(session)
        },
        ...forget,
        done: () => {
          signedOutOfCloud()
          router.replace(SIGNED_OUT_ROUTE)
        },
      }),
    [router, signedOutOfCloud, forget, player],
  )
}

/**
 * Forget what this device kept of an account whose sign-in the doorman
 * ended, before another account's sign-in takes its place: the same steps
 * as signing out, with nothing left to send and no session to end.
 */
export function useForgetEndedAccount(): () => Promise<void> {
  const forget = useForgetSteps()
  return useCallback(() => forgetAccount(forget), [forget])
}
