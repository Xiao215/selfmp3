import type { ReactNode } from 'react'
import { useRouter } from 'expo-router'
import { useStartAnalysis } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { library as cloudLibrary, session as cloudSession } from '../../replica'
import { useConnection } from '../../connection/ConnectionProvider'
import { STORAGE_ROUTE } from '../welcome/storage.model'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { signOutWarning } from './signOut'
import { useSignOut } from './useSignOut'
import { type Confirming } from './settings.model'

export function Confirmations({
  confirming,
  onDone,
}: {
  confirming: Confirming
  onDone: () => void
}): ReactNode {
  const router = useRouter()
  const { storageForgotten } = useConnection()
  const { removeAll } = useDownloads()
  const startAnalysis = useStartAnalysis()
  const signOut = useSignOut()

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
      run: () => void signOut(),
    },
    'forget-storage': {
      title: 'Forget the bucket?',
      body: 'Your music stays in it, untouched. This device, and every other one signed in to your account, asks for a bucket again.',
      label: 'Forget the bucket',
      run: () =>
        void (async () => {
          const session = await cloudSession.loadSession()
          if (!session) return
          await cloudSession.disconnectStorage(session)
          storageForgotten()
          router.replace(STORAGE_ROUTE)
        })(),
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
