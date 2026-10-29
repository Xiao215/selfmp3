import { useState } from 'react'
import type { ReactNode } from 'react'
import { library as cloudLibrary } from '../../replica'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { signOutWarning } from './signOut'
import { useSignOut } from './useSignOut'
import { thisPlace } from '../../ports/place'

/**
 * "Sign out?", before this device signs out: what goes with it, and the
 * changes made here that have not reached the bucket. Settings asks it, and so
 * does Where it lives, which a person may reach with the wrong account; each
 * had written the dialog out, and the count of unsent changes with it.
 *
 * The count is read as the dialog opens, not on every render: Settings redraws
 * for many reasons, and the count walks the changes not yet sent. It is kept
 * while the dialog closes, so the words do not change under the fade.
 */
export function SignOutDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): ReactNode {
  const signOut = useSignOut()
  const [shown, setShown] = useState(false)
  const [warning, setWarning] = useState('')
  if (open !== shown) {
    setShown(open)
    if (open) {
      setWarning(signOutWarning(cloudLibrary.pendingCloudChanges(), thisPlace()))
    }
  }
  return (
    <ConfirmDialog
      open={open}
      title="Sign out?"
      body={warning}
      confirmLabel="Sign out"
      danger
      onConfirm={() => {
        onClose()
        void signOut()
      }}
      onCancel={onClose}
    />
  )
}
