import { useCallback } from 'react'
import { useRouter } from 'expo-router'
import { useDownloads } from '../../offline/DownloadsProvider'
import { library as cloudLibrary, session as cloudSession } from '../../replica'
import { forgetCovers } from '../../offline/covers'
import { clearCachedLibrary } from '../../offline/libraryCache'
import { clearCachedLyrics } from '../../offline/lyricsCache'
import { clearCachedMotion } from '../../offline/motionCache'
import { clearCachedPlaylists } from '../../offline/playlistCache'
import { clearRecent } from '../../ports/recentCopies'
import { useConnection } from '../../connection/ConnectionProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { SIGNED_OUT_ROUTE, signOutOfCloud } from './signOut'

/**
 * Signing this device out, with every step wired to the app (`signOut.ts` has
 * the order and the reasons). Settings confirms first; Where it lives, which
 * a person may reach with the wrong account, offers it under the address.
 */
export function useSignOut(): () => Promise<void> {
  const router = useRouter()
  const { signedOutOfCloud } = useConnection()
  const { forgetExcluded, queue: downloadQueue } = useDownloads()
  const player = usePlayer()

  return useCallback(
    () =>
      signOutOfCloud({
        stopPlaying: () => player.clearQueue(),
        sendPendingChanges: () => cloudLibrary.flushCloudChanges(),
        endSession: async () => {
          const session = await cloudSession.loadSession()
          if (session) await cloudSession.signOut(session)
        },
        forgetLibrary: () => cloudLibrary.forgetCloudLibrary(),
        removeDownloads: () => {
          // The copies kept for having been played go with the downloads.
          clearRecent()
          return downloadQueue.removeAll()
        },
        forgetSavedLibrary: async () => {
          await clearCachedLibrary()
          // All found by id, and another account's library hands the same
          // ids to other songs and playlists: anything kept would be the
          // wrong words, curve, members or picture.
          await Promise.all([
            clearCachedPlaylists(),
            clearCachedLyrics(),
            clearCachedMotion(),
            forgetCovers(),
          ])
        },
        forgetExcluded,
        done: () => {
          signedOutOfCloud()
          router.replace(SIGNED_OUT_ROUTE)
        },
      }),
    [router, signedOutOfCloud, forgetExcluded, downloadQueue, player],
  )
}
