import type { ReactNode } from 'react'
import { useRouter } from 'expo-router'
import { failureText, useStartAnalysis } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { session as cloudSession } from '../../replica'
import { useConnection } from '../../connection/ConnectionProvider'
import { STORAGE_ROUTE } from '../welcome/storage.model'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { showToast } from '../../ui/toast'
import { SignOutDialog } from './SignOutDialog'
import { devicePlace, type Confirming } from './settings.model'
import { deviceKind } from '../../ports/device'

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
  const place = devicePlace(deviceKind())

  const dialogs: Record<
    Exclude<Confirming, 'sign-out' | null>,
    { title: string; body: string; label: string; run: () => void }
  > = {
    'remove-downloads': {
      title: `Remove all songs from this ${place}?`,
      body: 'The library itself is not touched. Downloading automatically is turned off too, or they would just come back.',
      label: `Remove all from this ${place}`,
      run: () => void removeAll(),
    },
    'redo-analysis': {
      title: 'Throw away existing analysis and redo every song?',
      body: 'Tempo, key, energy and loudness are worked out again from each file.',
      label: 'Redo all',
      run: () => startAnalysis.mutate(true),
    },
    'forget-storage': {
      title: 'Disconnect your storage?',
      body: 'Your music stays in it, untouched. This device, and every other one signed in to your account, asks for storage again.',
      label: 'Disconnect',
      run: () =>
        void (async () => {
          try {
            const session = await cloudSession.loadSession()
            if (!session) return
            await cloudSession.disconnectStorage(session)
            storageForgotten()
            router.replace(STORAGE_ROUTE)
          } catch (caught) {
            // The dialog has closed already: the toast is the only place to say so.
            showToast(failureText('Couldn’t disconnect your storage', caught), 'error')
          }
        })(),
    },
  }
  const dialog = confirming === null || confirming === 'sign-out' ? null : dialogs[confirming]

  return (
    <>
      <SignOutDialog open={confirming === 'sign-out'} onClose={onDone} />
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
    </>
  )
}
