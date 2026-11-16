import { useCallback, useEffect, useState } from 'react'
import { copyText } from '../ports/clipboard'
import { showToast } from './toast'

/** How long a Copy button says it copied before it goes back to Copy. */
const COPIED_MS = 2000

/**
 * A Copy button that answers where it was pressed: `copied` is true for a
 * moment after a copy worked, for the button to say "Copied" with a tick. No
 * toast for it, which came up at the foot of the page, far from the button and
 * over Ask's field. A copy that failed is still a toast, since it has to be
 * read.
 */
export function useCopied(failed = 'Couldn’t copy it'): {
  copied: boolean
  copy: (text: string) => void
} {
  // When, not a flag, so a second copy while it says Copied holds it again.
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
  useEffect(() => {
    if (copiedAt === null) return undefined
    const timer = setTimeout(() => setCopiedAt(null), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copiedAt])
  const copy = useCallback(
    (text: string) => {
      void copyText(text).then(done => {
        if (done) setCopiedAt(Date.now())
        else showToast(failed, 'error')
      })
    },
    [failed],
  )
  return { copied: copiedAt !== null, copy }
}
