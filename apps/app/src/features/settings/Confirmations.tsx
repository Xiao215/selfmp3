import type { ReactNode } from 'react'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { clientApi, queryKeys, useStartAnalysis } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { library as cloudLibrary, session as cloudSession } from '../../replica'
import { forgetCovers } from '../../offline/covers'
import { clearCachedLibrary } from '../../offline/libraryCache'
import { clearCachedLyrics } from '../../offline/lyricsCache'
import { clearCachedMotion } from '../../offline/motionCache'
import { clearCachedPlaylists } from '../../offline/playlistCache'
import { clearRecent } from '../../ports/recentCopies'
import { useConnection } from '../../connection/ConnectionProvider'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { SIGNED_OUT_ROUTE, signOutOfCloud, signOutWarning } from './signOut'
import { usePlayer } from '../../player/PlayerProvider'
import { type Confirming } from './settings.model'

export function Confirmations({
  confirming,
  onDone,
}: {
  confirming: Confirming
  onDone: () => void
}): ReactNode {
  const router = useRouter()
  const client = useQueryClient()
  const { signedOutOfCloud } = useConnection()
  const { removeAll, forgetExcluded, queue: downloadQueue } = useDownloads()
  const startAnalysis = useStartAnalysis()
  const player = usePlayer()

  const dialogs: Record<
    Exclude<Confirming, null>,
    { title: string; body: string; label: string; run: () => void }
  > = {
    'remove-downloads': {
      title: 'Remove all downloaded songs from this device?',
      body: 'The library itself is not touched. Downloading automatically is turned off too, or they would just come back.',
      label: 'Remove all downloads',
      run: () => void removeAll(),
    },
    'redo-analysis': {
      title: 'Throw away existing analysis and redo every song?',
      body: 'Tempo, key, energy and loudness are worked out again from each file.',
      label: 'Redo all',
      run: () => startAnalysis.mutate(true),
    },
    'sign-out': {
      title: 'Sign out?',
      body: signOutWarning(cloudLibrary.pendingCloudChanges()),
      label: 'Sign out',
      run: () =>
        void signOutOfCloud({
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
    },
    'forget-missing': {
      title: 'Permanently forget missing songs?',
      body: 'Their tags and play history go with them.',
      label: 'Forget missing songs',
      run: () =>
        void clientApi()
          .purgeMissing()
          .then(() => client.invalidateQueries({ queryKey: queryKeys.library })),
    },
  }
  const dialog = confirming === null ? null : dialogs[confirming]

  return (
    <ConfirmDialog
      open={dialog !== null}
      title={dialog?.title ?? ''}
      body={dialog?.body ?? ''}
      confirmLabel={dialog?.label ?? ''}
      danger
      onConfirm={() => {
        dialog?.run()
        onDone()
      }}
      onCancel={onDone}
    />
  )
}
