import type { ReactNode } from 'react'
import { useRouter } from 'expo-router'
import { useDownloads } from '../../offline/DownloadsProvider'
import { session as cloudSession } from '../../replica'
import { useConnection } from '../../connection/ConnectionProvider'
import { STORAGE_ROUTE } from '../welcome/storage.model'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { showFailure } from '../../ui/toast'
import { SignOutDialog } from './SignOutDialog'
import type { Confirming } from './settings.model'
import { thisPlace } from '../../ports/place'

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
  const place = thisPlace()

  const dialogs: Record<
    Exclude<Confirming, 'sign-out' | null>,
    { title: string; body: string; label: string; run: () => void }
  > = {
    'remove-downloads': {
      title: `Remove all songs from this ${place}?`,
      body: 'The library itself is not touched. Downloading automatically is turned off too.',
      label: `Remove all from this ${place}`,
      run: () => void removeAll(),
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
            showFailure('Couldn’t disconnect your storage', caught)
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
